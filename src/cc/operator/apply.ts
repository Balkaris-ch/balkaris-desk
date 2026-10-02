import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { HTTPException } from "hono/http-exception";
import { db } from "../../db.ts";
import type { Person } from "../../people.ts";
import { commitSiteFiles, readSiteFile } from "../../publish.ts";
import { abs, get, pathOf } from "../site/http.ts";
import { commitUrl, inventory, lastSitemap } from "../site/index.ts";
import { note } from "../store.ts";
import type { NewProposal } from "./kinds.ts";
import { BRAND, ownTitle, PLAIN, shownTitle } from "./packs.ts";
import { now, proposalById, stuck, toProposalRow, type ProposalDb } from "./tables.ts";
import type { ProposalRow } from "../../../web/src/contract/operator.ts";

/**
 * A proposal becomes a line in the website, and a commit, when a person who
 * can publish approves it. Withdrawn, the line goes again.
 *
 * THE ONE DOOR. The desk changes the website only through src/publish.ts
 * `commitSiteFiles`, and only under content/desk/. The website already reads
 * content/desk/overrides.json (lib/desk.ts for titles and descriptions,
 * next.config.ts `deskRedirects` for redirects), with its own validation. So
 * an approval reads that file as it is on the branch, changes the one entry,
 * writes it back and pushes, authored by the person who approved: the site's
 * history then says what changed, for which address, proposed by whom and
 * approved by whom.
 *
 * VALIDATED HERE AS THE WEBSITE VALIDATES, and stricter: plain site-relative
 * addresses, a title of at most 110 characters and a description of at most
 * 300 (the operator proposes at most 60 and 155), never a title that carries
 * the brand the site appends itself, and never a redirect from an address in
 * the sitemap, under /api/ or /_next/, or one that answers anything but 404
 * or 410 on the live site when it is proposed and again when it is approved,
 * because it would hide a live page. A title or description is approved only
 * while the page still says what it was proposed against.
 *
 * WHO. Approving and withdrawing change the live site, so they take the same
 * right as publishing an article: an email Vercel knows (Person.canPublish).
 * Rejecting a proposal changes nothing on the site; anybody signed in may.
 *
 * A DEVELOPMENT COPY NEVER PUSHES TO THE REAL SITE. On a workstation copy of
 * the desk (the same three locks as the development sign-in) an approval is
 * refused unless the site folder's remote is a bare scratch repository under
 * the desk's own work/ folder: the copy's site folder is a clone of the
 * website (on the workstation, of its working copy on this machine), and an
 * approval there would become a real change to balkaris.ch.
 */

const execFileP = promisify(execFile);
const FILE = "content/desk/overrides.json";

/** "/services/" and "/services" are one address; the home page is "/". */
export const key = (p: string): string => {
  const t = p.trim();
  return t.length > 1 ? t.replace(/\/+$/, "") : t;
};

const fail = (status: 400 | 403 | 404 | 409 | 429 | 502, message: string): never => {
  throw new HTTPException(status, { message });
};

/* ---------- the rules -------------------------------------------------------- */

const liveAt = (): Map<string, number> => {
  const inv = inventory();
  return new Map(inv.state === "ok" ? inv.value.map((r) => [r.path, r.status]) : []);
};

/** Why a redirect may not be made, or null when it may. The website's own rules, then the desk's. */
export function redirectRefusal(fromRaw: string, toRaw: string, except: number[] = []): string | null {
  const from = key(fromRaw);
  const to = key(toRaw);
  if (!PLAIN.test(from) || from.length > 200) return `"${from}" is not a plain address on the site (a slash, then letters, digits, - _ and /): the website would ignore it.`;
  if (!(PLAIN.test(to) || to === "/") || to.length > 200) return `"${to}" is not a plain address on the site: the website would ignore it.`;
  if (from === to) return "A redirect cannot lead to the address it leaves from.";
  if (/^\/(api|_next)(\/|$)/i.test(from)) return `${from} is one of the website's own machine addresses: a redirect from it would break what answers there.`;
  const map = lastSitemap();
  if (!map) return "The desk has no reading of the sitemap yet, so it cannot tell whether that address is a live page. The crawl reads it; run it first.";
  if (map.entries.some((e) => e.path === from)) return `${from} is in the sitemap: a redirect from it would hide a live page.`;
  const status = liveAt();
  if (status.get(from) === 200) return `${from} answers 200 at the last crawl: a redirect from it would hide a live page.`;
  if (to !== "/" && status.get(to) !== 200) return `${to} is not a page that answered 200 at the last crawl, so a redirect there could lead nowhere.`;
  const open = (
    db.prepare("SELECT id, address, after_json FROM cc_proposals WHERE kind = 'redirect' AND state IN ('waiting','approved','applied')").all() as {
      id: number;
      address: string;
      after_json: string;
    }[]
  ).filter((r) => !except.includes(r.id));
  if (open.some((r) => r.address === to)) return `${to} is itself proposed as a redirect: a chain of redirects is refused.`;
  if (open.some((r) => (JSON.parse(r.after_json) as { to?: string }).to === from)) return `Another redirect leads to ${from}: a chain of redirects is refused.`;
  if (open.some((r) => r.address === from)) return `A redirect from ${from} is already waiting or live.`;
  return null;
}

/**
 * Why a redirect from this address may not be made, asked of the LIVE site
 * now: the crawl and the sitemap only know the addresses they reached. Only
 * an address that answers 404 or 410 today may be redirected; one that
 * already redirects to the same target is the same change, already there.
 */
export async function liveRefusal(fromRaw: string, toRaw: string): Promise<string | null> {
  const from = key(fromRaw);
  const to = key(toRaw);
  const g = await get(abs(from), { maxHops: 0, body: false, timeout: 15_000 });
  if (g.status === 404 || g.status === 410) return null;
  if (g.status === 0) return `${from} could not be checked on the live site (${g.error ?? "no answer"}), so no redirect is made from it: it might hide a live page. Try again in a moment.`;
  if (g.status >= 300 && g.status < 400) {
    const where = g.headers.location ? pathOf(g.headers.location, abs(from)) : null;
    if (where !== null && key(where) === to) return null;
    return `${from} already redirects on the live site${where ? ` to ${where}` : ""}: a second redirect from it would only compete with that one.`;
  }
  return `${from} answers ${g.status} on the live site today: a redirect from it would hide what is there. Only an address that answers 404 or 410 can be redirected.`;
}

export function metaRefusal(address: string, after: { title?: string; description?: string }): string | null {
  const a = key(address);
  if (!(a === "/" || PLAIN.test(a)) || a.length > 200) return `"${a}" is not a plain address on the site.`;
  if (after.title === undefined && after.description === undefined) return "It changes nothing.";
  if (after.title !== undefined && ownTitle(after.title) !== after.title.trim()) {
    return `The website adds "${BRAND.trim()}" to a title itself where it fits: a title that ends with the brand would show it twice.`;
  }
  if (after.title !== undefined && (!after.title.trim() || after.title.length > 110)) return "The website accepts a title of 1 to 110 characters.";
  if (after.description !== undefined && (!after.description.trim() || after.description.length > 300)) return "The website accepts a description of 1 to 300 characters.";
  if (/[\n<>]/.test(`${after.title ?? ""}${after.description ?? ""}`)) return "A title or description may not hold a line break, < or >.";
  if (liveAt().get(a) !== 200) return `${a} is not a page that answered 200 at the last crawl.`;
  return null;
}

/* ---------- making one ---------------------------------------------------------- */

/**
 * Keep a proposal. One from the operator replaces an older one still waiting
 * for the same address (it is the newer reading of the same page); a person's
 * must pass the rules first. A redirect is also asked of the live site.
 * Returns the new row, or the reason it was not made.
 */
export async function propose(p: NewProposal, from: { source: "operator"; taskId: number } | { source: "person"; by: Person }): Promise<{ id: number } | { refused: string }> {
  const address = key(p.address);
  const olderOf = () =>
    from.source === "operator" ? (db.prepare("SELECT id FROM cc_proposals WHERE kind = ? AND address = ? AND state = 'waiting'").all(p.kind, address) as { id: number }[]).map((r) => r.id) : [];
  const why = p.kind === "redirect" ? redirectRefusal(address, p.after.to ?? "", olderOf()) : metaRefusal(address, p.after);
  if (why) return { refused: why };
  if (p.kind === "redirect") {
    const live = await liveRefusal(address, p.after.to ?? "");
    if (live) return { refused: live };
  }
  /* Asked again after the wait: another proposal may have been made meanwhile. */
  const older = olderOf();
  const again = p.kind === "redirect" ? redirectRefusal(address, p.after.to ?? "", older) : null;
  if (again) return { refused: again };
  for (const o of older) {
    db.prepare("UPDATE cc_proposals SET state = 'rejected', decided_by = 'the operator', decided_at = ?, note = ? WHERE id = ?").run(now(), "Replaced by a newer proposal for the same address.", o);
  }
  const r = db
    .prepare(
      "INSERT INTO cc_proposals (kind, address, before_json, after_json, why, source, task_id, proposed_by, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)",
    )
    .run(p.kind, address, JSON.stringify(p.before), JSON.stringify(p.after), p.why, from.source, from.source === "operator" ? from.taskId : null, from.source === "person" ? from.by.name : null, now());
  return { id: Number(r.lastInsertRowid) };
}

/* ---------- the site's file ------------------------------------------------------------ */

interface Overrides {
  meta: Record<string, Record<string, unknown>>;
  redirects: { from: string; to: string }[];
  [other: string]: unknown;
}

/** One change to the file at a time, read to write: two approvals at once must not overwrite each other. */
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(work, work);
  chain = run.catch(() => {});
  return run;
}

function devCopy(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (!(process.env.DESK_DEV_USER ?? "").trim()) return false;
  return !/^https:/i.test(process.env.DESK_URL ?? "https://desk.balkaris.ch");
}

/** The desk's own scratch folder: the one place a development copy may push to. */
const SCRATCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../work");

/**
 * On a development copy: why its site folder may not be pushed to, or null
 * when it may. It may only when its remote is a bare repository under the
 * desk's own work/ folder, made for a check. Anything else is, or leads to,
 * the real website: GitHub, or (as on the workstation) the website's own
 * working copy on this machine, from which the next push reaches GitHub.
 */
async function realRemote(): Promise<string | null> {
  if (!devCopy()) return null;
  const repo = process.env.SITE_REPO ?? "/opt/balkaris-desk/site";
  let remote = process.env.SITE_REMOTE ?? "git@github.com:Balkaris-ch/balkaris-web-infrastructure.git";
  if (existsSync(path.join(repo, ".git"))) {
    try {
      remote = (await execFileP("git", ["-C", repo, "remote", "get-url", "origin"], { timeout: 10_000 })).stdout.trim();
    } catch {
      /* No origin: the clone's own fetch would fail, and so will the approval. */
    }
  }
  let local: string | null = null;
  try {
    local = /^file:\/\//i.test(remote) ? fileURLToPath(remote) : /^([a-z]:[\\/]|\/|\.)/i.test(remote) ? path.resolve(remote) : null;
  } catch {
    local = null;
  }
  const inside = local !== null && (local.toLowerCase() + path.sep).startsWith(SCRATCH.toLowerCase() + path.sep) && local.toLowerCase() !== SCRATCH.toLowerCase();
  const bare = local !== null && existsSync(path.join(local, "HEAD")) && existsSync(path.join(local, "objects")) && !existsSync(path.join(local, ".git"));
  return inside && bare ? null : "not a scratch repository";
}

const DEV_REFUSAL =
  "This is a development copy of the desk, and its site folder pushes to the website's own repository: approving here would change balkaris.ch. A development copy only pushes to a scratch repository under work/. Approve on desk.balkaris.ch instead.";

async function change(mutate: (o: Overrides) => void, subject: string, body: string, by: Person): Promise<{ sha: string; changed: boolean }> {
  if (await realRemote()) fail(409, DEV_REFUSAL);
  return locked(async () => {
    const raw = await readSiteFile(FILE);
    let file: Overrides = { meta: {}, redirects: [] };
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw) as Partial<Overrides>;
        file = { ...parsed, meta: parsed.meta && typeof parsed.meta === "object" ? parsed.meta : {}, redirects: Array.isArray(parsed.redirects) ? parsed.redirects : [] };
      } catch {
        fail(409, `${FILE} on the website is not valid JSON, so nothing was changed. It has to be repaired in the website's repository first.`);
      }
    }
    mutate(file);
    return commitSiteFiles([{ path: FILE, content: `${JSON.stringify(file, null, 2)}\n` }], subject, body, by);
  });
}

const quote = (s: string | null | undefined): string => (s ? `“${s}”` : "(none)");

function origin(p: ProposalDb): string {
  if (p.source === "person") return `Proposed by ${p.proposed_by ?? "a person"} on the desk on ${p.created_at.slice(0, 10)}`;
  return `Proposed by the desk's AI operator (task #${p.task_id ?? "?"}, run on the studio workstation's local model) on ${p.created_at.slice(0, 10)}`;
}

const what = (after: { title?: string; description?: string }): string =>
  after.title !== undefined && after.description !== undefined ? "title and description" : after.title !== undefined ? "title" : "description";

/* ---------- reading proposals ----------------------------------------------------------- */

type Live = Map<string, { title: string | null; description: string | null }>;

const liveWords = (): Live => {
  const inv = inventory();
  return new Map(inv.state === "ok" ? inv.value.map((r) => [r.path, { title: r.title, description: r.description }]) : []);
};

/**
 * What a waiting title or description change's page says now, where that is
 * neither what it was proposed against nor what it proposes (the latter: it
 * reached the site already, and applying again is harmless). By the last
 * crawl: a change made since then is seen at the next one.
 */
function driftOf(r: ProposalRow, live: Live): ProposalRow["drift"] {
  if (r.kind !== "meta" || !(r.state === "waiting" || r.state === "approved")) return null;
  const now = live.get(r.address);
  if (!now) return null;
  const out: NonNullable<ProposalRow["drift"]> = {};
  if (r.after.title !== undefined && now.title !== (r.before.title ?? null) && now.title !== r.shownTitle) out.title = now.title;
  if (r.after.description !== undefined && now.description !== (r.before.description ?? null) && now.description !== r.after.description) out.description = now.description;
  return Object.keys(out).length ? out : null;
}

const shape = (p: ProposalDb, live: Live): ProposalRow => {
  const r = toProposalRow(p, commitUrl);
  return { ...r, drift: driftOf(r, live) };
};

const driftWords = (d: NonNullable<ProposalRow["drift"]>): string =>
  [d.title !== undefined ? `the title “${d.title ?? "(none)"}”` : null, d.description !== undefined ? `the description “${d.description ?? "(none)"}”` : null].filter(Boolean).join(" and ");

/* ---------- approving, withdrawing, rejecting -------------------------------------------- */

const row = (id: number): ProposalRow => shape(proposalById(id)!, liveWords());

/** A proposal that may be approved (or applied again, or rejected): waiting, or approved and failed or cut off. */
const open = (p: ProposalDb): boolean => p.state === "waiting" || (p.state === "approved" && (!!p.error || stuck(p)));

/** Approve and apply. Throws an HTTPException with the reason when it may not, or when the push failed (the proposal then stays approved, with the error, to be applied again). */
export async function approve(id: number, by: Person): Promise<ProposalRow> {
  if (!by.canPublish) fail(403, `${by.name} cannot publish yet: approving changes the live site, and Vercel only builds a commit from an email it knows. Add the email on the people page first.`);
  const p = proposalById(id) ?? fail(404, `There is no proposal #${id}.`);
  if (p.state === "applied") fail(409, "That proposal is already live on the site.");
  if (!open(p)) fail(409, `That proposal is ${p.state}; only a waiting one can be approved.`);
  const after = JSON.parse(p.after_json) as { title?: string; description?: string; to?: string };
  const before = JSON.parse(p.before_json) as { title?: string | null; description?: string | null };
  const refusal = p.kind === "redirect" ? redirectRefusal(p.address, after.to ?? "", [p.id]) : metaRefusal(p.address, after);
  if (refusal) fail(409, refusal);
  if (await realRemote()) fail(409, DEV_REFUSAL);
  if (p.kind === "meta") {
    const drift = driftOf(toProposalRow(p), liveWords());
    if (drift) fail(409, `${p.address} changed since this was proposed: at the last crawl it shows ${driftWords(drift)}. Approving would replace newer words; ask the operator again.`);
  } else {
    const live = await liveRefusal(p.address, after.to ?? "");
    if (live) fail(409, live);
  }
  /* The live site was asked: somebody may have approved it meanwhile. */
  const still = proposalById(id)!;
  if (!open(still) || still.decided_at !== p.decided_at) fail(409, `That proposal is ${still.state} now.`);

  db.prepare("UPDATE cc_proposals SET state = 'approved', decided_by = ?, decided_at = ?, error = NULL WHERE id = ?").run(by.name, now(), id);

  const subject = p.kind === "redirect" ? `Desk: redirect ${p.address} to ${after.to}` : `Desk: new ${what(after)} for ${p.address}`;
  const lines =
    p.kind === "redirect"
      ? [`${p.address} now redirects to ${after.to}: added to ${FILE}.`]
      : [
          `${p.address}: changed in ${FILE}.`,
          ...(after.title !== undefined ? [`Title: ${quote(before.title)} → ${quote(after.title)} (shown as ${quote(shownTitle(after.title))}: the website adds the brand where it fits)`] : []),
          ...(after.description !== undefined ? [`Description: ${quote(before.description)} → ${quote(after.description)}`] : []),
        ];
  const body = [
    ...lines,
    "",
    `${origin(p)}, approved by ${by.name}.`,
    p.kind === "redirect"
      ? "The website reads this file when it builds (next.config.ts, deskRedirects); no page's source is changed."
      : "The website reads this file when it builds (lib/desk.ts); the page's own source is unchanged.",
    `Desk: ${process.env.DESK_URL ?? "https://desk.balkaris.ch"}/operator?ap=approved`,
  ].join("\n");

  try {
    const done = await change(
      (o) => {
        if (p.kind === "redirect") {
          o.redirects = o.redirects.filter((r) => r?.from !== p.address);
          o.redirects.push({ from: p.address, to: after.to as string });
        } else {
          const entry = { ...(o.meta[p.address] ?? {}) };
          if (after.title !== undefined) entry.title = after.title;
          if (after.description !== undefined) entry.description = after.description;
          o.meta[p.address] = entry;
        }
      },
      subject,
      body,
      by,
    );
    db.prepare("UPDATE cc_proposals SET state = 'applied', applied_at = ?, sha = ?, error = NULL, note = ? WHERE id = ?").run(
      now(),
      done.sha,
      done.changed ? null : "The site's file already said this, so nothing was committed.",
      id,
    );
    /* An older change to the same address that this one replaces is no longer what the site says. */
    const older = db.prepare("SELECT id FROM cc_proposals WHERE kind = ? AND address = ? AND state = 'applied' AND id <> ?").all(p.kind, p.address, id) as { id: number }[];
    for (const o of older) {
      db.prepare("UPDATE cc_proposals SET state = 'withdrawn', withdrawn_by = ?, withdrawn_at = ?, note = ? WHERE id = ?").run(by.name, now(), `Replaced by #${id}.`, o.id);
    }
    note("operator-change", p.kind === "redirect" ? `Applied a redirect from ${p.address}` : `Applied a new ${what(after)} for ${p.address}`, {
      tone: "good",
      detail: `${p.kind === "redirect" ? `To ${after.to}. ` : ""}Approved by ${by.name}${done.changed ? `, commit ${done.sha}` : "; the site already said this"}`,
      href: "/operator?ap=approved#approvals",
      actor: by.name,
      dedupe: `op:applied:${id}`,
    });
    return row(id);
  } catch (e) {
    if (e instanceof HTTPException) {
      db.prepare("UPDATE cc_proposals SET state = 'waiting', decided_by = NULL, decided_at = NULL WHERE id = ?").run(id);
      throw e;
    }
    const why = (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);
    db.prepare("UPDATE cc_proposals SET error = ? WHERE id = ?").run(why, id);
    return fail(502, `Approved, but not applied: ${why}. Nothing reached the site; it can be applied again.`);
  }
}

/** Take an applied change off the site again: its entry is removed and the page says what its source says. */
export async function withdraw(id: number, by: Person): Promise<ProposalRow> {
  if (!by.canPublish) fail(403, `${by.name} cannot publish yet: withdrawing changes the live site. Add the email on the people page first.`);
  const p = proposalById(id) ?? fail(404, `There is no proposal #${id}.`);
  if (p.state !== "applied") fail(409, `That proposal is ${p.state}; only one that is live can be withdrawn.`);
  const after = JSON.parse(p.after_json) as { title?: string; description?: string; to?: string };
  const subject = p.kind === "redirect" ? `Desk: withdraw the redirect from ${p.address}` : `Desk: withdraw the ${what(after)} for ${p.address}`;
  const body = [
    p.kind === "redirect" ? `${p.address} no longer redirects to ${after.to}: removed from ${FILE}.` : `${p.address}: the ${what(after)} the desk applied is removed from ${FILE}; the page says what its source says again.`,
    "",
    `${origin(p)}, approved by ${p.decided_by ?? "a person"}${p.sha ? ` (commit ${p.sha})` : ""}, withdrawn by ${by.name}.`,
  ].join("\n");
  let untouched = false;
  try {
    const done = await change(
      (o) => {
        if (p.kind === "redirect") {
          const before = o.redirects.length;
          o.redirects = o.redirects.filter((r) => !(r?.from === p.address && r?.to === after.to));
          untouched = o.redirects.length === before;
        } else {
          const entry = { ...(o.meta[p.address] ?? {}) };
          let removed = 0;
          for (const k of ["title", "description"] as const) {
            if (after[k] !== undefined && entry[k] === after[k]) {
              delete entry[k];
              removed++;
            }
          }
          untouched = removed === 0;
          if (Object.keys(entry).length) o.meta[p.address] = entry;
          else delete o.meta[p.address];
        }
      },
      subject,
      body,
      by,
    );
    db.prepare("UPDATE cc_proposals SET state = 'withdrawn', withdrawn_by = ?, withdrawn_at = ?, withdrawn_sha = ?, error = NULL, note = ? WHERE id = ?").run(
      by.name,
      now(),
      done.changed ? done.sha : null,
      untouched ? "The site's file no longer held this change, so there was nothing to remove." : null,
      id,
    );
    note("operator-change", p.kind === "redirect" ? `Withdrew the redirect from ${p.address}` : `Withdrew the ${what(after)} for ${p.address}`, {
      tone: "warn",
      detail: `By ${by.name}${done.changed ? `, commit ${done.sha}` : ""}`,
      href: "/operator?ap=completed#approvals",
      actor: by.name,
      dedupe: `op:withdrawn:${id}`,
    });
    return row(id);
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    const why = (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);
    db.prepare("UPDATE cc_proposals SET error = ? WHERE id = ?").run(why, id);
    return fail(502, `Not withdrawn: ${why}. Nothing changed on the site.`);
  }
}

/** Whether the site's file already holds this proposal's change, as it is on the branch now. */
async function onSite(p: ProposalDb): Promise<boolean> {
  const raw = await readSiteFile(FILE);
  if (raw === null) return false;
  let file: Partial<Overrides>;
  try {
    file = JSON.parse(raw) as Partial<Overrides>;
  } catch {
    return false;
  }
  const after = JSON.parse(p.after_json) as { title?: string; description?: string; to?: string };
  if (p.kind === "redirect") return Array.isArray(file.redirects) && file.redirects.some((r) => r?.from === p.address && r?.to === after.to);
  const entry = file.meta && typeof file.meta === "object" ? file.meta[p.address] : undefined;
  if (!entry) return false;
  return (after.title === undefined || entry.title === after.title) && (after.description === undefined || entry.description === after.description);
}

/**
 * Say no to a waiting proposal. Nothing on the site changes, so anybody
 * signed in may. One that was approved and failed or was cut off is checked
 * against the site's file first: if its change reached the site after all, it
 * is not rejected (that would leave a live change listed as refused) but
 * applied again, which records it, and then withdrawn.
 */
export async function reject(id: number, by: Person): Promise<ProposalRow> {
  const p = proposalById(id) ?? fail(404, `There is no proposal #${id}.`);
  if (!open(p)) fail(409, `That proposal is ${p.state}; only a waiting one can be rejected.`);
  /* A development copy never pushed it (approving there is refused), so there is nothing on the site to look for. */
  if (p.state === "approved" && !(await realRemote()) && (await onSite(p))) {
    fail(409, "Its change is in the site's file already, so it is live. Apply again to record that, then withdraw it if it should go.");
  }
  db.prepare("UPDATE cc_proposals SET state = 'rejected', decided_by = ?, decided_at = ?, error = NULL WHERE id = ? AND state = ?").run(by.name, now(), id, p.state);
  note("operator-change", `Rejected a proposed ${p.kind === "redirect" ? "redirect from" : "change to"} ${p.address}`, {
    tone: "quiet",
    detail: `By ${by.name}`,
    href: "/operator?ap=completed#approvals",
    actor: by.name,
    dedupe: `op:rejected:${id}`,
  });
  return row(id);
}

/** A redirect a person asks for by hand: checked by the same rules and asked of the live site, then waiting like any other. */
export async function proposeRedirect(fromRaw: string, toRaw: string, by: Person): Promise<ProposalRow> {
  const from = key(fromRaw);
  const to = key(toRaw);
  const made = await propose({ kind: "redirect", address: from, before: { to: null }, after: { to }, why: null }, { source: "person", by });
  if ("refused" in made) return fail(409, made.refused);
  note("operator-proposal", `Proposed a redirect from ${from}`, { tone: "info", detail: `To ${to}, by ${by.name}`, href: "/operator?ap=waiting#approvals", actor: by.name, dedupe: `op:proposed:${made.id}` });
  return row(made.id);
}

/** Proposals by state, newest first, at most `limit`. */
export function proposals(states: string[], limit = 50): ProposalRow[] {
  const marks = states.map(() => "?").join(",");
  const live = liveWords();
  return (db.prepare(`SELECT * FROM cc_proposals WHERE state IN (${marks}) ORDER BY COALESCE(withdrawn_at, applied_at, decided_at, created_at) DESC, id DESC LIMIT ?`).all(...states, limit) as unknown as ProposalDb[]).map((p) =>
    shape(p, live),
  );
}

/** How many proposals there are in these states, all of them. */
export function proposalCount(states: string[]): number {
  const marks = states.map(() => "?").join(",");
  return (db.prepare(`SELECT COUNT(*) AS n FROM cc_proposals WHERE state IN (${marks})`).get(...states) as { n: number }).n;
}

export const proposalRow = (id: number): ProposalRow | null => {
  const p = proposalById(id);
  return p ? shape(p, liveWords()) : null;
};
