import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { db } from "../../db.ts";
import type { Reading } from "../../../web/src/contract/common.ts";
import { kept, note, ok, off, setState, state, waiting } from "../store.ts";
import type { Job } from "../scheduler.ts";
import { askFor } from "./ask.ts";
import { abs } from "./http.ts";
import { probeIfDue } from "./probes.ts";

/**
 * The website's repository, read and never written.
 *
 * Every push to `main` is a production deployment of www.balkaris.ch, so the
 * git history is the deployment history, and the files under `public/` are
 * the asset library. Nothing else the desk can reach says who changed a page
 * or when; this can.
 *
 * A GIT DIRECTORY OF ITS OWN, NEVER THE PUBLISHER'S. The desk already holds a
 * clone of the website: the article publisher's working tree (SITE_REPO, see
 * src/publish.ts). Nothing in this folder ever runs git there, not even a
 * fetch. That clone is shallow (one commit of history, which is no history),
 * the publisher fetches it with --depth 1 and hard-resets it before every
 * publish, and it deletes `.git/*.lock` on the assumption that nothing else
 * runs git in it: a collector fetching there could have its lock removed
 * mid-flight and leave the publisher with a corrupt clone.
 *
 * So the collectors read through SITE_READ_REPO: on the box a BARE clone with
 * the whole history (/opt/balkaris-desk/site-read.git), made here on first
 * use with the deploy key the publisher already pushes with. Plan the disk
 * for it: the workstation's clone of the same history packed to about 235 MB
 * in October 2026, and it grows by every picture and video pushed. Bare, because nothing here needs a working file: a file is read with
 * `git show`, a folder is listed with `git ls-tree`, a picture's bytes come
 * from `git cat-file`. On the workstation SITE_READ_REPO points at an ordinary
 * clone's `.git`, which every command below reads the same way.
 *
 *   every call   `git --git-dir <dir> …`, with no working directory, ONE AT A
 *                TIME through a single promise chain, each with a time limit.
 *                A fetch that hangs must not hold a job forever, and two
 *                fetches must not meet on the same lock.
 *   the branch   fetched with its refspec spelled out into `refs/cc/<branch>`
 *                and read by that full name everywhere. A bare clone writes no
 *                fetch refspec, so a plain `git fetch` would only move
 *                FETCH_HEAD and every read would see the day of the clone. A
 *                ref only this file writes also cannot collide with anything
 *                else that fetches into the same directory.
 *   housekeeping no repack is ever started from here (gc.auto=0): the copy
 *                grows by what is pushed, a few small packs a day.
 *
 * Making the copy can be switched off (SITE_READ_CLONE=off), and
 * scripts/check-cc-site.ts does, so a workstation never clones from GitHub by
 * accident. A missing copy, a failed clone or a failed fetch is a failed run
 * of the "repo" job with a plain message, never a crash. The sitemap, the
 * probes and the speed test do not need this file; the crawl runs without it
 * on the sitemap alone, and says so.
 */

const execFileP = promisify(execFile);

const DIR = (): string => process.env.SITE_READ_REPO ?? "/opt/balkaris-desk/site-read.git";
const BRANCH = (): string => process.env.SITE_BRANCH ?? "main";
const REMOTE = (): string => process.env.SITE_REMOTE ?? "git@github.com:Balkaris-ch/balkaris-web-infrastructure.git";
const KEY = (): string => process.env.SITE_SSH_KEY ?? "/opt/balkaris-desk/.ssh/deploy_key";
const KNOWN = (): string => process.env.SITE_KNOWN_HOSTS ?? "/opt/balkaris-desk/.ssh/known_hosts";

/** The desk's own pointer at the branch, by its full name. Everything is read through it. */
export const REF = (): string => `refs/cc/${BRANCH()}`;

/**
 * The publisher's git environment (deploy key, pinned host key, no prompt),
 * minus an author: nothing here commits. GIT_OPTIONAL_LOCKS=0 tells a read
 * not to take a lock it does not need. Any GIT_DIR, work tree or index the
 * desk's own environment might carry is dropped, so `--git-dir` is the only
 * place git looks.
 */
const GIT_ENV = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_SSH_COMMAND: `ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${KNOWN()} -i ${KEY()}`,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) delete env[k];
  return env;
};

/** What git said when it failed: its last line, without "fatal:", and whether it was stopped for taking too long. */
class GitError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

const gitError = (e: unknown, what: string): GitError => {
  const x = e as { stderr?: string | Buffer; killed?: boolean; signal?: string | null; message?: string };
  const stderr = x.stderr ? String(x.stderr) : "";
  if (x.killed || x.signal === "SIGTERM") return new GitError(`git ${what} took too long and was stopped`, stderr);
  const last = (stderr || x.message || String(e))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-1)[0];
  return new GitError((last ?? `git ${what} failed`).replace(/^(fatal|error):\s*/i, "").slice(0, 240), stderr);
};

/* One git call at a time, the publisher's pattern (src/publish.ts): a second
   caller waits for the first instead of colliding with it. */
let queue: Promise<unknown> = Promise.resolve();
function serialise<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

/** One git command against the read copy, text out. */
function git(args: string[], o: { timeout?: number; max?: number } = {}): Promise<string> {
  return serialise(async () => {
    try {
      const { stdout } = await execFileP("git", ["--git-dir", DIR(), ...args], {
        env: GIT_ENV(),
        timeout: o.timeout ?? 60_000,
        maxBuffer: o.max ?? 32 * 1024 * 1024,
        windowsHide: true,
      });
      return stdout;
    } catch (e) {
      throw gitError(e, args[0] ?? "");
    }
  });
}

/** The same, bytes out: a picture must not pass through a string. */
function gitBytes(args: string[], max: number): Promise<Buffer> {
  return serialise(async () => {
    try {
      const { stdout } = await execFileP("git", ["--git-dir", DIR(), ...args], {
        env: GIT_ENV(),
        timeout: 60_000,
        maxBuffer: max,
        encoding: "buffer",
        windowsHide: true,
      });
      return stdout;
    } catch (e) {
      throw gitError(e, args[0] ?? "");
    }
  });
}

/**
 * True when the read copy is on disk. A bare clone has no `.git` folder, and
 * the workstation's value already IS one, so the test is the HEAD file every
 * git directory has.
 */
export const readCopyExists = (): boolean => existsSync(path.join(DIR(), "HEAD"));

/**
 * Make the read copy when it is not there.
 *
 * A single-branch bare clone with the whole history, up to fifteen minutes.
 * The uptime probe is kept beating meanwhile: the scheduler runs one job at a
 * time, and a slow first clone must not leave a hole in the uptime record.
 */
async function ensureReadCopy(): Promise<void> {
  if (readCopyExists()) return;
  if (process.env.SITE_READ_CLONE === "off") {
    throw new Error(`There is no read copy of the website at ${DIR()}, and making one is switched off here (SITE_READ_CLONE=off).`);
  }
  await mkdir(path.dirname(DIR()), { recursive: true });
  /* Only a folder this clone itself created is ever removed again. */
  const existed = existsSync(DIR());
  const beat = setInterval(() => void probeIfDue(), 30_000);
  try {
    await serialise(async () => {
      try {
        await execFileP("git", ["clone", "--bare", "--single-branch", "--branch", BRANCH(), REMOTE(), DIR()], {
          env: GIT_ENV(),
          timeout: 15 * 60_000,
          windowsHide: true,
        });
      } catch (e) {
        /* A clone cut off half way leaves a folder that looks like a copy and
           is not one. Remove it, so the next run starts clean. */
        if (!existed) await rm(DIR(), { recursive: true, force: true }).catch(() => {});
        throw new Error(`Could not make the desk's read copy of the website: ${gitError(e, "clone").message}`);
      }
    });
  } finally {
    clearInterval(beat);
  }
}

/**
 * Clear the lock a killed fetch of OUR ref left behind, and only that one,
 * and only when it is older than any fetch is allowed to take. On the
 * workstation another desk process may be fetching into the same directory a
 * second ago; ten minutes old is dead for everybody.
 */
async function clearDeadRefLock(): Promise<void> {
  const lock = path.join(DIR(), `${REF()}.lock`);
  try {
    if (Date.now() - statSync(lock).mtimeMs > 10 * 60_000) await rm(lock, { force: true });
  } catch {
    /* no lock: the usual case */
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS cc_commits (
    sha     TEXT PRIMARY KEY,
    at      TEXT NOT NULL,
    author  TEXT NOT NULL,
    subject TEXT NOT NULL,
    /* How many files the commit touched. NULL only for the repository's
       very first commit, which has nothing before it to compare with. */
    files   INTEGER,
    seen    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cc_commits_at ON cc_commits (at DESC);
`);

export interface Commit {
  sha: string;
  /** When it was committed, ISO. Every push to main is a production deployment, so this is also when the deploy began. */
  at: string;
  /** The author's name as git has it. */
  author: string;
  subject: string;
  /** Files changed, or null for the repository's very first commit. */
  files: number | null;
}

/** The commit on GitHub, for a link. The repository is private: it opens for people on the team. */
export function commitUrl(sha: string): string | null {
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(REMOTE());
  return m ? `https://github.com/${m[1]}/commit/${sha}` : null;
}

/* ---------- reading ------------------------------------------------------- */

interface Logged extends Commit {
  /** The paths it changed (kept in memory for this fetch, not stored). */
  paths: string[];
}

/**
 * What git knows of the branch, newest first.
 *
 * `--first-parent -m` makes a merge one deployment whose files are what it
 * brought in. `--name-only` lists those files without reading a byte of them,
 * which is what keeps a log over an image-heavy history cheap.
 */
async function log(limit: number): Promise<Logged[]> {
  const out = await git(["log", `-n${limit}`, "--first-parent", "-m", "--name-only", "--format=%x1e%H%x1f%cI%x1f%an%x1f%P%x1f%s", REF()], { timeout: 120_000 });
  const commits: Logged[] = [];
  for (const rec of out.split("\x1e")) {
    if (!rec.trim()) continue;
    const [header = "", ...rest] = rec.split("\n");
    const [sha = "", at = "", author = "", parents = "", subject = ""] = header.split("\x1f");
    if (!sha) continue;
    const paths = rest.map((l) => l.trim()).filter(Boolean);
    commits.push({ sha, at: new Date(at).toISOString(), author, subject, files: parents.trim() ? paths.length : null, paths });
  }
  return commits;
}

/** The commit the desk's ref points at, or null before the first fetch. */
export async function head(): Promise<string | null> {
  if (!readCopyExists()) return null;
  try {
    return (await git(["rev-parse", "--verify", "--quiet", `${REF()}^{commit}`])).trim() || null;
  } catch {
    return null;
  }
}

/**
 * The id of the tree a folder has on the fetched branch ("public" → its
 * tree's sha), or null when there is no such folder or nothing is fetched.
 * Equal ids, identical contents: a free "has anything under here changed".
 */
export async function treeOf(folder: string): Promise<string | null> {
  if (!readCopyExists()) return null;
  try {
    return (await git(["rev-parse", "--verify", "--quiet", `${REF()}:${folder.replace(/\/+$/, "")}`])).trim() || null;
  } catch {
    return null;
  }
}

/** The newest `limit` commits the desk has recorded, newest first. Read from the desk's table: cheap, and there whenever git is not. */
export function commits(limit = 20): Commit[] {
  return db.prepare("SELECT sha, at, author, subject, files FROM cc_commits ORDER BY at DESC LIMIT ?").all(limit) as unknown as Commit[];
}

/** A commit with its author's address and the paths it changed. Read from git when asked; nothing of it is stored. */
export interface CommitFiles extends Commit {
  /** The author's address as git has it: what matches a person in the desk's people table. */
  email: string;
  /** Repository-relative paths the commit changed (added, modified, removed). */
  paths: string[];
}

/**
 * The newest `limit` commits on the branch with the files each changed,
 * newest first: the same walk as the fetch (first parent, a merge as one
 * deployment), plus the author's address. For a screen that names the pages
 * a deployment touched. Empty before the first fetch; throws GitError's
 * plain message when git fails.
 */
export async function commitFiles(limit = 400): Promise<CommitFiles[]> {
  if (!readCopyExists()) return [];
  const n = Math.max(1, Math.min(5000, Math.floor(limit)));
  const out = await git(["log", `-n${n}`, "--first-parent", "-m", "--name-only", "--format=%x1e%H%x1f%cI%x1f%an%x1f%ae%x1f%P%x1f%s", REF()], { timeout: 120_000 });
  const list: CommitFiles[] = [];
  for (const rec of out.split("\x1e")) {
    if (!rec.trim()) continue;
    const [header = "", ...rest] = rec.split("\n");
    const [sha = "", at = "", author = "", email = "", parents = "", subject = ""] = header.split("\x1f");
    if (!sha) continue;
    const paths = rest.map((l) => l.trim()).filter(Boolean);
    list.push({ sha, at: new Date(at).toISOString(), author, email, subject, files: parents.trim() ? paths.length : null, paths });
  }
  return list;
}

const NO_COPY = "The desk has no read copy of the website's repository yet.";
const NO_COPY_STEP = "Nothing to set up: the repository job makes the copy itself on its next run, with the deploy key the publisher already uses. If it keeps failing, its reason is under Automations.";

/**
 * The site's deployments, newest first: every push to main is one, because
 * Vercel builds main as production. WHAT IS KNOWN IS THE COMMIT, not the
 * build: whether Vercel's build of it succeeded, and when it went live, is
 * Vercel's to say and needs its API. No "Success" is claimed here.
 */
export function deployments(limit = 20): Reading<Commit[]> {
  if (!readCopyExists()) return off("repo", NO_COPY, NO_COPY_STEP);
  const at = state("site:repo:fetched");
  if (!at) return waiting("repo", "The repository has not been fetched yet; the first fetch runs within a minute of the desk starting.");
  return ok(
    commits(limit),
    "repo",
    at,
    `Commits to the site's main branch; each starts a production build on Vercel. Whether that build succeeded is not known here. Recorded since ${historySince()?.slice(0, 10) ?? "the first fetch"}.`,
  );
}

/** The oldest commit the desk has recorded: where `commits()` honestly begins. Null before the first fetch. */
export function historySince(): string | null {
  const row = db.prepare("SELECT MIN(at) AS a FROM cc_commits").get() as { a: string | null };
  return row.a;
}

export interface RepoFile {
  /** Repository-relative, forward slashes: "public/og/home.jpg". */
  path: string;
  bytes: number;
  /** The blob's id: the same bytes always have the same one, so it is a free "has this file changed". */
  sha: string;
}

/** Every file under a folder ("public/", "content/posts/"), with sizes, as the branch has them. */
export async function filesUnder(prefix: string): Promise<RepoFile[]> {
  const out = await git(["ls-tree", "-r", "-l", "-z", REF(), "--", prefix.replace(/\/+$/, "")], { max: 64 * 1024 * 1024 });
  const files: RepoFile[] = [];
  for (const line of out.split("\0")) {
    /* "<mode> blob <sha> <size>\t<path>"; the size is padded with spaces. */
    const m = /^\d+ blob ([0-9a-f]+)\s+(\d+)\t(.+)$/s.exec(line);
    if (m) files.push({ sha: m[1] as string, bytes: Number(m[2]), path: m[3] as string });
  }
  return files;
}

/** A file's text as the branch has it, or null when there is no such file. */
export async function read(file: string): Promise<string | null> {
  try {
    return await git(["show", `${REF()}:${file}`], { max: 16 * 1024 * 1024 });
  } catch (e) {
    const said = e instanceof GitError ? e.stderr : "";
    if (/does not exist|exists on disk, but not in|invalid object name|not a valid object name/i.test(said)) return null;
    throw new Error(`Could not read ${file} from the website repository: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** A blob's bytes by its id (from `filesUnder`). For pictures: sharp reads the buffer, nothing is written to disk. */
export async function blob(sha: string): Promise<Buffer> {
  if (!/^[0-9a-f]{7,64}$/.test(sha)) throw new Error("not a blob id");
  return gitBytes(["cat-file", "blob", sha], 96 * 1024 * 1024);
}

export interface Change {
  sha: string;
  at: string;
  author: string;
  subject: string;
}

/** The last commit that touched a file or folder: when, and by whom. Null when nothing under it exists. */
export async function lastChange(pathPrefix: string): Promise<Change | null> {
  const out = await git(["log", "-n1", "--format=%H%x1f%cI%x1f%an%x1f%s", REF(), "--", pathPrefix.replace(/\/+$/, "")]);
  const [sha = "", at = "", author = "", subject = ""] = out.trim().split("\x1f");
  if (!sha) return null;
  return { sha, at: new Date(at).toISOString(), author, subject };
}

/** A package the website is built on: what its package.json asks for, and what its lock file pins. */
export interface PackageVersion {
  /** The range package.json asks for ("^16.3.5"), or null when it does not name the package. */
  declared: string | null;
  /** The exact version package-lock.json pins, which is what Vercel installs. Null when the lock does not say. */
  installed: string | null;
}

/** The framework versions the website is built with, read from its own package files at the fetched commit. */
export async function siteVersions(): Promise<{ next: PackageVersion; react: PackageVersion; node: string | null; commit: string | null }> {
  const pkg = JSON.parse((await read("package.json")) ?? "{}") as { dependencies?: Record<string, string>; engines?: Record<string, string> };
  let locked: Record<string, { version?: string }> = {};
  try {
    locked = (JSON.parse((await read("package-lock.json")) ?? "{}") as { packages?: Record<string, { version?: string }> }).packages ?? {};
  } catch {
    /* No lock, or one that will not parse: the declared range still stands. */
  }
  const of = (name: string): PackageVersion => ({ declared: pkg.dependencies?.[name] ?? null, installed: locked[`node_modules/${name}`]?.version ?? null });
  return { next: of("next"), react: of("react"), node: pkg.engines?.node ?? null, commit: await head() };
}

/* ---------- the job -------------------------------------------------------- */

export interface RepoFetch {
  head: string;
  /** Commits the desk had not recorded before this fetch, newest first. */
  fresh: Commit[];
}

/** An article's address, when a "Publish" commit changed exactly one article file. */
async function articleOf(c: Logged): Promise<string | null> {
  const posts = c.paths.filter((p) => /^content\/posts\/[^/]+\.ts$/.test(p) && !p.endsWith("/index.ts"));
  if (posts.length !== 1) return null;
  const file = posts[0] as string;
  const text = await read(file).catch(() => null);
  const slug = (text && /\bslug:\s*"([^"]+)"/.exec(text)?.[1]) || path.posix.basename(file, ".ts");
  return abs(`/insights/${slug}`);
}

let fetching: Promise<RepoFetch> | null = null;

/**
 * Make the read copy if needed, fetch the branch, and take note of what is new.
 *
 * Every commit not recorded before goes into `cc_commits` and becomes one
 * line in the activity feed, stamped with the commit's own time and author:
 * kind "insight" when its subject begins with "Publish" (the sentence the
 * desk's publisher writes when an article goes into the menus, so it links
 * to the article), kind "deploy" for the rest, since every push to main is a
 * production deployment of the site. One line per commit, ever: the commit's
 * id is the dedupe key.
 *
 * The first fetch finds a whole history at once. It records the newest three
 * hundred so the list is not empty, and speaks only about the last
 * fortnight, twenty lines at most, so the feed is not buried.
 */
export function fetchRepo(): Promise<RepoFetch> {
  fetching ??= doFetch().finally(() => {
    fetching = null;
  });
  return fetching;
}

async function doFetch(): Promise<RepoFetch> {
  await ensureReadCopy();
  await clearDeadRefLock();
  try {
    await git(["-c", "gc.auto=0", "-c", "maintenance.auto=false", "fetch", "--quiet", "--no-tags", "--refmap=", "origin", `+refs/heads/${BRANCH()}:${REF()}`], { timeout: 180_000 });
  } catch (e) {
    throw new Error(`git fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const now = await head();
  if (!now) throw new Error(`git fetch brought no ${BRANCH()} branch`);

  const known = new Set((db.prepare("SELECT sha FROM cc_commits").all() as { sha: string }[]).map((r) => r.sha));
  const first = known.size === 0;
  const fresh = (await log(first ? 300 : 200)).filter((c) => !known.has(c.sha));

  const seen = new Date().toISOString();
  const insert = db.prepare("INSERT OR IGNORE INTO cc_commits (sha, at, author, subject, files, seen) VALUES (?, ?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  try {
    for (const c of fresh) insert.run(c.sha, c.at, c.author, c.subject, c.files, seen);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  const fortnight = Date.now() - 14 * 86_400_000;
  const spoken = first ? fresh.filter((c) => Date.parse(c.at) >= fortnight).slice(0, 20) : fresh;
  for (const c of spoken) {
    const published = /^Publish\b/.test(c.subject);
    const href = published ? await articleOf(c) : commitUrl(c.sha);
    note(published ? "insight" : "deploy", c.subject, {
      tone: published ? "good" : "info",
      at: c.at,
      actor: c.author,
      dedupe: `commit:${c.sha}`,
      detail: c.files != null ? `${c.files} file${c.files === 1 ? "" : "s"} changed · ${c.sha.slice(0, 7)}` : c.sha.slice(0, 7),
      ...(href ? { href } : {}),
    });
  }

  setState("site:repo:head", now);
  setState("site:repo:fetched", seen);

  /* A picture added, replaced or removed: measure public/ now, not at
     tomorrow's run. Compared with the public/ the assets were last measured
     at (assets.ts stores its tree id), not with "a commit in this fetch
     touched it", so a request lost to a restart is made again on the next
     fetch, and the very first fetch asks too. */
  const tree = await treeOf("public");
  if (tree && tree !== state("site:assets:tree")) askFor("assets", tree);
  /* A crawl that ran without the repository missed the pages kept out of the
     sitemap and the redirect rules: ask for one until a crawl has had it. */
  if (kept<{ withoutRepo?: boolean }>("site:crawl")?.value.withoutRepo) askFor("crawl", "with-repository");

  return { head: now, fresh: fresh.map(({ paths: _paths, ...c }) => c) };
}

/** When the last fetch succeeded, ISO, or null. */
export const fetchedAt = (): string | null => state("site:repo:fetched");

export const repoJob: Job = {
  name: "repo",
  title: "Read the website's git history",
  every: 5 * 60,
  delay: 30,
  run: async () => {
    const { head: sha, fresh } = await fetchRepo();
    return fresh.length ? `${fresh.length} new commit${fresh.length === 1 ? "" : "s"}, now at ${sha.slice(0, 7)}` : `Nothing new, at ${sha.slice(0, 7)}`;
  },
};
