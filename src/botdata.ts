import { db } from "./db.ts";
import { explain } from "./why.ts";

/**
 * What the Insights page knows, said in a Telegram chat.
 *
 * Fini, 8 October 2026: "I also need the Blog Bot to be able to communicate
 * data from the Insights page." Three commands, each one message:
 *
 *   /insights   the state of the journal: published, waiting, being written,
 *               and what is stuck with the plain reason (the Inbox)
 *   /top        the most-read articles over the last 30 days, from GA4
 *   /inbox      only what is stuck or could not be read, with what to do
 *
 * The numbers come from the same places the Insights page reads: the desk's
 * own links, drafts and jobs, and GA4 through cc/ga4.ts. Each answer says
 * where its figures come from and never invents one: no GA4, no /top figures,
 * and the message says so.
 *
 * The text is Telegram HTML (the bot sends with parse_mode HTML): every value
 * that came from outside goes through `esc`.
 */

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface DraftRow {
  id: number;
  link_id: number;
  slug: string;
  post: string;
  state: string;
  created_at: string;
}

const titleOf = (post: string, slug: string): string => {
  try {
    const t = (JSON.parse(post) as { title?: unknown }).title;
    if (typeof t === "string" && t.trim()) return t.trim();
  } catch {
    /* a draft with broken JSON still has a slug */
  }
  return slug.replace(/-/g, " ");
};

/** "Sep 30", for a SQLite UTC timestamp. */
const day = (sqlUtc: string): string =>
  new Date(`${sqlUtc.replace(" ", "T")}Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Zurich" });

const shortUrl = (u: string): string => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\?.*$/, "").slice(0, 60);

/** Links with no draft whose latest job gave up, or that could not be read at all: the Inbox's stuck rows. */
function stuckRows(): { id: number; url: string; why: string; shared: string }[] {
  const rows = db
    .prepare(
      `SELECT l.id, l.url, l.state, l.error, l.created_at,
              (SELECT j.state FROM jobs j WHERE j.link_id = l.id AND j.kind IN ('write','ingest') ORDER BY j.id DESC LIMIT 1) AS job,
              (SELECT j.error FROM jobs j WHERE j.link_id = l.id AND j.kind IN ('write','ingest') ORDER BY j.id DESC LIMIT 1) AS jobError
         FROM links l
        WHERE NOT EXISTS (SELECT 1 FROM drafts d WHERE d.link_id = l.id)
        ORDER BY l.id DESC`,
    )
    .all() as { id: number; url: string; state: string; error: string | null; created_at: string; job: string | null; jobError: string | null }[];
  return rows
    .filter((r) => r.job === "stuck" || (r.state === "failed" && r.job !== "queued" && r.job !== "running"))
    .map((r) => ({ id: r.id, url: r.url, why: (r.job === "stuck" ? r.jobError : r.error) ?? "", shared: r.created_at }));
}

/** /insights: the journal at a glance. */
export function insightsSummary(): string {
  const drafts = db.prepare("SELECT id, link_id, slug, post, state, created_at FROM drafts ORDER BY id DESC").all() as unknown as DraftRow[];
  const listed = drafts.filter((d) => d.state === "listed");
  const waiting = drafts.filter((d) => d.state === "draft");
  const monthStart = new Date().toISOString().slice(0, 7);
  const listedThisMonth = db
    .prepare("SELECT COUNT(DISTINCT link_id) n FROM events WHERE what = 'auto.published' AND substr(at, 1, 7) = ?")
    .get(monthStart) as { n: number };
  const writing = db.prepare("SELECT COUNT(*) n FROM jobs WHERE kind IN ('write','ingest') AND state = 'running'").get() as { n: number };
  const queued = db.prepare("SELECT COUNT(*) n FROM jobs WHERE kind IN ('write','ingest') AND state = 'queued'").get() as { n: number };
  const stuck = stuckRows();

  const lines = [
    "<b>Insights</b>",
    "",
    `Published: <b>${listed.length}</b>${listedThisMonth.n ? ` (${listedThisMonth.n} this month)` : ""}`,
    `Drafts waiting: <b>${waiting.length}</b>`,
    `Being written: <b>${writing.n}</b>${queued.n ? `, ${queued.n} queued` : ""}`,
    `Inbox, stuck: <b>${stuck.length}</b>`,
  ];
  const latest = listed.slice(0, 3);
  if (latest.length) {
    lines.push("", "<b>Latest</b>");
    for (const d of latest) lines.push(`• ${esc(titleOf(d.post, d.slug))} (${day(d.created_at)})`);
  }
  if (stuck.length) lines.push("", "/inbox says why each one is stuck. /top has the most-read articles.");
  else lines.push("", "/top has the most-read articles.");
  return lines.join("\n");
}

/** /inbox: what is stuck, why in plain words, and what to do. */
export function inboxLines(): string {
  const stuck = stuckRows();
  if (!stuck.length) return "<b>Inbox</b>\n\nNothing is stuck. Every link shared became an article or is on its way.";
  const lines = [`<b>Inbox</b>: ${stuck.length} stuck`];
  for (const r of stuck.slice(0, 8)) {
    const w = explain(r.why);
    lines.push("", `<b>${esc(shortUrl(r.url))}</b> (shared ${day(r.shared)})`, esc(w.reason), `<i>${esc(w.next)}</i>`);
  }
  if (stuck.length > 8) lines.push("", `And ${stuck.length - 8} more on the desk, under Insights.`);
  return lines.join("\n");
}

/** /top: the most-read articles over the last 30 days. */
export async function topArticles(): Promise<string> {
  let read: Awaited<ReturnType<typeof import("./cc/ga4.ts").articleStats>>;
  try {
    const ga4 = await import("./cc/ga4.ts");
    read = await ga4.articleStats("30d");
  } catch (e) {
    return `<b>Most read, 30 days</b>\n\nGoogle Analytics could not be asked: ${esc(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
  }
  const rows = read.data?.rows ?? [];
  if (!read.data) return `<b>Most read, 30 days</b>\n\nNot available: ${esc(read.error ?? "Google Analytics gave no answer.")}`;
  if (!rows.length) return "<b>Most read, 30 days</b>\n\nNo article was read in the last 30 days, as far as Google Analytics counts (it counts only visitors who accepted cookies).";

  const titles = new Map((db.prepare("SELECT slug, post FROM drafts").all() as { slug: string; post: string }[]).map((d) => [d.slug, titleOf(d.post, d.slug)]));
  const lines = ["<b>Most read, 30 days</b>", ""];
  rows.slice(0, 5).forEach((r, i) => {
    const title = titles.get(r.slug) ?? r.slug.replace(/-/g, " ");
    const organic = r.byChannel.find((c) => c.label === "Organic Search")?.value ?? 0;
    lines.push(`${i + 1}. ${esc(title)}`, `   ${r.views} view${r.views === 1 ? "" : "s"}, ${r.users} reader${r.users === 1 ? "" : "s"}${organic ? `, ${organic} from Google` : ""}`);
  });
  const all = read.data.entrances;
  lines.push("", `Visits that began on an article: ${all.all}, ${all.organic} of them from search.`, "<i>Google Analytics counts only visitors who accepted cookies.</i>");
  return lines.join("\n");
}
