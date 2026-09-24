import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { db, log } from "./db.ts";
import type { PostBlock } from "./blocks.ts";
import type { Person } from "./people.ts";
import { coverPath } from "./covers.ts";
import { watchFrom, type Watch } from "./watch.ts";

/**
 * An approved article becomes a file in the website, and a push.
 *
 * TWO STATES, ONE BRANCH — Fini, 23 September 2026: *"we should have no new
 * branch, it is stupid... like already active but not on the super menu... and
 * when we click publish we then add it to the super menu."*
 *
 *   publish   the article's file is written with `listed: false` and pushed.
 *             It is live at balkaris.ch/insights/<slug> within about two
 *             minutes, carrying noindex, and appears in no menu, no shelf, no
 *             sitemap and no search.
 *   list      the same file with `listed: true`. Now it is in all of them.
 *   unlist    back to false. The url keeps working; it leaves the menus and
 *             the index.
 *   remove    the file is deleted and the barrel rewritten. The url 404s.
 *
 * So "take it down" genuinely takes it down, and nothing is ever a revert.
 *
 * THE DESK OWNS content/posts/ COMPLETELY. It writes each article's file and
 * rewrites the barrel from its own database every time, so the directory is
 * always exactly what the desk believes. Nothing in there is hand-edited —
 * the place to change one of these is here.
 *
 * A FAILED PUSH CHANGES NOTHING. The state in the database moves only after
 * git has succeeded, so a draft is never marked published because a push half
 * worked, and the console can try again without writing the article twice.
 */

const execFileP = promisify(execFile);

const REPO = process.env.SITE_REPO ?? "/opt/balkaris-desk/site";
const BRANCH = process.env.SITE_BRANCH ?? "main";
const REMOTE = process.env.SITE_REMOTE ?? "git@github.com:Balkaris-ch/balkaris-web-infrastructure.git";
const KEY = process.env.SITE_SSH_KEY ?? "/opt/balkaris-desk/.ssh/deploy_key";
const KNOWN = process.env.SITE_KNOWN_HOSTS ?? "/opt/balkaris-desk/.ssh/known_hosts";

const POSTS_DIR = "content/posts";

/**
 * Every git call carries the deploy key, and every COMMIT carries a person.
 *
 * THE DESK HAS NO IDENTITY OF ITS OWN, and that is not a stylistic choice.
 * The first real publish was authored as desk@balkaris.ch and Vercel refused
 * to build it: "desk@balkaris.ch attempted to deploy a commit to Balkaris on
 * Vercel through GitHub, but they're not a member of the team." The article
 * sat on main doing nothing. So a commit is authored as whoever pressed the
 * button, with the email on their own Vercel account, and the build goes
 * through under their name.
 */
const GIT_ENV = (by?: Person | null) => ({
  ...process.env,
  GIT_SSH_COMMAND: `ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${KNOWN} -i ${KEY}`,
  GIT_TERMINAL_PROMPT: "0",
  ...(by?.email
    ? {
        GIT_AUTHOR_NAME: by.name,
        GIT_AUTHOR_EMAIL: by.email,
        GIT_COMMITTER_NAME: by.name,
        GIT_COMMITTER_EMAIL: by.email,
      }
    : {}),
});

async function git(args: string[], by?: Person | null, cwd = REPO): Promise<string> {
  const { stdout } = await execFileP("git", args, {
    cwd,
    env: GIT_ENV(by),
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * One git operation at a time.
 *
 * Two clicks on Publish raced on the very first use and the second died on
 * "Unable to create .git/shallow.lock: File exists" — while the first was
 * quietly succeeding, so the page said "nothing changed" about a push that
 * was going through. A promise chain is the whole fix: the second caller
 * waits rather than colliding.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialise<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

/**
 * Clear a lock nothing is holding.
 *
 * A git process killed mid-fetch — a restart, a timeout, an OOM — leaves its
 * lock behind and every later fetch fails on it forever. Since `serialise`
 * guarantees nothing else here is running git, a lock at this point is dead
 * by definition.
 */
async function clearStaleLocks(): Promise<void> {
  for (const lock of ["shallow.lock", "index.lock", "HEAD.lock", "config.lock"]) {
    const f = path.join(REPO, ".git", lock);
    if (existsSync(f)) {
      await rm(f, { force: true });
      log("publish.stalelock", { lock });
    }
  }
}

/**
 * The desk's own clone, made on first use and kept shallow.
 *
 * Shallow because the desk never reads history — it writes a file and pushes
 * it — and the box has 28 GB for everything. `--depth 1` keeps a repo with
 * hundreds of image commits in it down to something a 3.7 GB VM can hold
 * comfortably.
 */
async function ensureRepo(): Promise<void> {
  if (existsSync(path.join(REPO, ".git"))) {
    await clearStaleLocks();
    /* Always start from what is actually on the branch. Another session, or a
       person, has almost certainly pushed since the last publish. */
    await git(["fetch", "--depth", "1", "origin", BRANCH]);
    await git(["checkout", "-B", BRANCH, `origin/${BRANCH}`]);
    await git(["reset", "--hard", `origin/${BRANCH}`]);
    await git(["clean", "-fd", "--", POSTS_DIR]);
    return;
  }
  await mkdir(path.dirname(REPO), { recursive: true });
  await execFileP("git", ["clone", "--depth", "1", "--branch", BRANCH, REMOTE, REPO], {
    env: GIT_ENV(),
    timeout: 300_000,
  });
  log("publish.cloned", { repo: REPO, branch: BRANCH });
}

/* ---------- writing the article as TypeScript ------------------------------ */

const q = (s: string): string => JSON.stringify(s);

function blockLiteral(b: PostBlock): string {
  if (typeof b === "string") return `    ${q(b)},`;
  if ("h" in b) return `    { h: ${q(b.h)} },`;
  if ("list" in b) {
    return `    { list: [${b.list.map(q).join(", ")}]${b.ordered ? ", ordered: true" : ""} },`;
  }
  if ("steps" in b) {
    const items = b.steps.map((s) => `      { term: ${q(s.term)}, text: ${q(s.text)} },`).join("\n");
    return `    {\n      steps: [\n${items}\n      ],\n    },`;
  }
  if ("note" in b) return `    { note: ${q(b.note)} },`;
  if ("quote" in b) return `    { quote: ${q(b.quote)}${b.who ? `, who: ${q(b.who)}` : ""} },`;
  if ("code" in b) return `    { code: ${q(b.code)}${b.lang ? `, lang: ${q(b.lang)}` : ""} },`;
  if ("table" in b) {
    const head = `[${b.table.head.map(q).join(", ")}]`;
    const rows = b.table.rows.map((r) => `        [${r.map(q).join(", ")}]`).join(",\n");
    return `    {\n      table: {\n        head: ${head},\n        rows: [\n${rows},\n        ],\n      },\n    },`;
  }
  return "";
}

export interface StoredPost {
  slug: string;
  title: string;
  standfirst: string;
  excerpt: string;
  topics: string[];
  services: string[];
  readingTime: number;
  body: PostBlock[];
  takeaways: string[];
  faq?: { q: string; a: string }[];
  source: { url: string; site: string; title: string; author: string | null };
  /* Filled in at publish from the link row, never written by the model. */
  watch?: Watch;
}

/**
 * The article as a source file a person can read in a diff.
 *
 * TypeScript rather than JSON on purpose: it is what the rest of the content
 * layer is, it type-checks in CI, and a reviewer reading the commit sees the
 * article rather than an escaped blob.
 */
function articleFile(
  post: StoredPost,
  listed: boolean,
  meta: { model: string | null; kind: string; sharedBy: string; byline: string; cover?: { alt: string; caption: string } },
): string {
  const ident = post.slug.replace(/[^a-z0-9]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, "");
  const date = new Date().toISOString().slice(0, 10);

  return `import type { Post } from "../types";

/**
 * WRITTEN BY THE DESK — desk.balkaris.ch, ${date}.
 *
 * Shared by ${meta.sharedBy}, drafted from ${post.source.author ? `@${post.source.author}` : post.source.site} (${meta.kind})
 * by ${meta.model ?? "a local model"} on the workstation, and approved by a person before it
 * reached this repository. Edit it at the desk, not here: the next approval
 * overwrites this file.
 *
 * Source: ${post.source.url}
 */
export const ${ident || "article"}: Post = {
  slug: ${q(post.slug)},
  listed: ${listed},
  title: ${q(post.title)},
  standfirst: ${q(post.standfirst)},
  excerpt: ${q(post.excerpt)},
  date: ${q(date)},
  author: "Balkaris",
  /* The byline is whoever SHARED the link, not whoever pressed publish: they
     found the thing and thought it was worth writing about. A key of
     \`authors\` in content/journal.ts; an unknown one falls back to the studio,
     so a typo costs a byline and never a page. */
  by: ${q(meta.byline)},
  readingTime: ${post.readingTime},
  topics: [${post.topics.map(q).join(", ")}],
  services: [${post.services.map(q).join(", ")}],
${
    post.watch
      ? `  /* Shown, never hosted: an id and a platform, and ${post.watch.platform} serves
     its own bytes when a reader presses play. */
  watch: {
    platform: ${q(post.watch.platform)},
    id: ${q(post.watch.id)},
    url: ${q(post.watch.url)},${post.watch.handle ? `
    handle: ${q(post.watch.handle)},` : ""}${
          post.watch.seconds ? `
    seconds: ${post.watch.seconds},` : ""
        }
  },
`
      : ""
  }${
    meta.cover
      ? `  cover: ${q(`/insights/${post.slug}.webp`)},
  coverAlt: ${q(meta.cover.alt)},
  coverCaption: ${q(meta.cover.caption)},
`
      : ""
  }  metaTitle: ${q(post.title.slice(0, 70))},
  metaDescription: ${q(post.excerpt.slice(0, 160))},
  takeaways: [
${post.takeaways.map((t) => `    ${q(t)},`).join("\n")}
  ],${
    post.faq?.length
      ? `
  faq: [
${post.faq.map((f) => `    { q: ${q(f.q)}, a: ${q(f.a)} },`).join("\n")}
  ],`
      : ""
  }
  body: [
${post.body.map(blockLiteral).filter(Boolean).join("\n")}
  ],
};
`;
}

/** The barrel, rewritten from whatever files are actually in the directory. */
async function writeBarrel(dir: string): Promise<number> {
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".ts") && f !== "index.ts")
    .sort();

  const imports = files
    .map((f) => {
      const slug = f.replace(/\.ts$/, "");
      const ident = slug.replace(/[^a-z0-9]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, "");
      return { slug, ident: ident || "article" };
    })
    .reverse(); /* newest first, matching the journal's own order */

  const head = `import type { Post } from "../types";
${imports.map((i) => `import { ${i.ident} } from "./${i.slug}";`).join("\n")}

/**
 * Articles written by the desk, at desk.balkaris.ch.
 *
 * THIS DIRECTORY IS WRITTEN BY A MACHINE. Every file in it, including this
 * one, is generated by balkaris-desk when somebody approves a draft — it
 * writes the article's own file, rewrites this barrel, commits and pushes.
 * Editing a file here by hand works until the next approval overwrites it;
 * the place to change one of these articles is the desk.
 *
 * Hand-written articles stay in content/journal.ts, where they always were.
 * Both kinds are the same \`Post\` and the site cannot tell them apart.
 *
 * A generated article arrives with \`listed: false\` — live at its own URL, and
 * absent from the menu, the front page, the shelves, the sitemap and search
 * until a person presses Publish. See \`listedPosts\` in content/journal.ts.
 */
export const generated: Post[] = [${imports.length ? `\n${imports.map((i) => `  ${i.ident},`).join("\n")}\n` : ""}];
`;
  await writeFile(path.join(dir, "index.ts"), head, "utf8");
  return imports.length;
}

/* ---------- the four actions ----------------------------------------------- */

export type PublishAction = "publish" | "list" | "unlist" | "remove";

const WORDS: Record<PublishAction, string> = {
  publish: "goes live at its own url, unlisted",
  list: "goes into the menus",
  unlist: "comes out of the menus",
  remove: "is taken off the site",
};

export interface PublishResult {
  sha: string;
  url: string;
  listed: boolean;
}

export async function publish(draftId: number, action: PublishAction, by: Person): Promise<PublishResult> {
  return serialise(() => doPublish(draftId, action, by));
}

async function doPublish(draftId: number, action: PublishAction, by: Person): Promise<PublishResult> {
  if (!by.email) {
    throw new Error(
      `${by.name} has no email on the desk yet, and Vercel refuses a commit from somebody who is not on the team. Add it on the people page first.`,
    );
  }
  const d = db.prepare("SELECT * FROM drafts WHERE id = ?").get(draftId) as
    | {
        id: number;
        link_id: number;
        slug: string;
        post: string;
        model: string | null;
        state: string;
        cover_alt: string | null;
        cover_caption: string | null;
      }
    | undefined;
  if (!d) throw new Error("no such draft");

  const link = db
    .prepare("SELECT kind, url, author, duration_s, attach, from_user, from_name FROM links WHERE id = ?")
    .get(d.link_id) as {
    kind: string;
    url: string;
    author: string | null;
    duration_s: number | null;
    attach: number | null;
    from_user: number | null;
    from_name: string | null;
  };

  /* Whose name goes on the article: whoever sent the link to the bot. */
  const sharer = link.from_user
    ? (db.prepare("SELECT name, author FROM people WHERE telegram = ?").get(link.from_user) as
        | { name: string; author: string }
        | undefined)
    : undefined;
  const byline = sharer?.author ?? "balkaris";
  const sharedBy = sharer?.name ?? link.from_name ?? "the studio";
  const post = JSON.parse(d.post) as StoredPost;
  /* The video, if there is one and the sharer wanted it. Derived here rather
     than stored on the draft, so "just the text" is one flag away and needs
     nothing re-read. */
  post.watch = watchFrom(link);
  const listed = action === "list";

  await ensureRepo();

  const dir = path.join(REPO, POSTS_DIR);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${post.slug}.ts`);

  if (action === "remove") {
    await rm(file, { force: true });
  } else {
    /* The picture goes in beside the article. Its absence is never fatal: a
       piece with no cover is a piece the journal draws its own plate for. */
    const picture = coverPath(post.slug);
    if (picture) {
      await mkdir(path.join(REPO, "public", "insights"), { recursive: true });
      await writeFile(path.join(REPO, "public", "insights", `${post.slug}.webp`), picture);
    }
    await writeFile(
      file,
      articleFile(post, listed, {
        model: d.model,
        kind: link.kind,
        sharedBy,
        byline,
        cover: picture && d.cover_alt ? { alt: d.cover_alt, caption: d.cover_caption ?? "" } : undefined,
      }),
      "utf8",
    );
  }
  const count = await writeBarrel(dir);

  /* Nothing to say to git? Then nothing happened, and saying so is better
     than an empty commit that looks like a publish in the history. */
  const dirty = await git(["status", "--porcelain", "--", POSTS_DIR, "public/insights"], by);
  if (!dirty) {
    log("publish.nochange", { draft: draftId, action }, d.link_id);
    const sha = await git(["rev-parse", "HEAD"], by);
    return { sha, url: `/insights/${post.slug}`, listed };
  }

  await git(["add", "--", POSTS_DIR, "public/insights"], by);
  const subject =
    action === "remove"
      ? `Take "${post.title}" off the site`
      : action === "list"
        ? `Publish "${post.title}"`
        : action === "unlist"
          ? `Take "${post.title}" out of the menus`
          : `Add "${post.title}", live but unlisted`;

  const body = `Shared by ${sharedBy}, written by the desk from ${
    post.source.author ? `@${post.source.author}` : post.source.site
  }, published by ${by.name}.
It ${WORDS[action]}.

Source: ${post.source.url}
Desk: ${process.env.DESK_URL ?? "https://desk.balkaris.ch"}/draft/${draftId}
${count} generated article${count === 1 ? "" : "s"} in content/posts after this.`;

  await git(["commit", "-m", subject, "-m", body], by);
  const sha = await git(["rev-parse", "--short", "HEAD"], by);

  /* The push is the only step that can fail in a way that matters, and it is
     last: if it throws, the caller leaves the draft where it was and the
     console offers to try again. Nothing here has touched the desk's own
     state yet. */
  await git(["push", "origin", `HEAD:${BRANCH}`], by);

  log("publish.pushed", { draft: draftId, action, sha, slug: post.slug }, d.link_id);
  return { sha, url: `/insights/${post.slug}`, listed };
}

/** Is the publisher able to work at all? Used by the console before it offers. */
export async function publishReady(): Promise<{ ok: boolean; why?: string }> {
  try {
    if (!existsSync(KEY)) return { ok: false, why: `no deploy key at ${KEY}` };
    await execFileP("git", ["ls-remote", "--heads", REMOTE, BRANCH], { env: GIT_ENV(), timeout: 30_000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, why: (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 160) };
  }
}

/** Read back what the repo currently says, so the console never guesses. */
export async function onSite(slug: string): Promise<"absent" | "unlisted" | "listed"> {
  const file = path.join(REPO, POSTS_DIR, `${slug}.ts`);
  if (!existsSync(file)) return "absent";
  const text = await readFile(file, "utf8");
  return /listed:\s*true/.test(text) ? "listed" : "unlisted";
}
