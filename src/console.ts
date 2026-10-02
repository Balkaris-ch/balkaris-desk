import { db, log, queueState, reclaim } from "./db.ts";
import { serviceName, TOPICS } from "./catalogue.ts";
import { CLOSING_JOBS, type ClosingJob } from "./templates.ts";
import type { PostBlock } from "./blocks.ts";
import type { Person } from "./people.ts";
import { spell, type PageStats } from "./ga4.ts";

/**
 * The desk, as a person sees it.
 *
 * Fini, 23 September 2026: *"how can I see the article, where are the views?"*
 * The first console listed links and nothing else — which is a queue monitor,
 * not a desk. This one shows the article: the whole thing, typeset the way the
 * journal will typeset it, with the source's numbers beside it and the four
 * things a person can do to it.
 *
 * SERVER-RENDERED HTML AND FORM POSTS. No framework, no client bundle, no
 * build step. The box is a 3.7 GB VM whose job is to be always up, and a page
 * that a phone can open on a bad connection is worth more here than an
 * interface that needs JavaScript to show text that already exists.
 *
 * It renders the site's own PostBlock shapes, so what is on this page is what
 * will be on balkaris.ch — a preview that lies is worse than no preview.
 */

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Numbers as a person reads them. A null is never a zero — it is a dash. */
export const num = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
};

export const ago = (iso: string | null): string => {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (!Number.isFinite(ms)) return "—";
  const d = Math.floor(ms / 86_400_000);
  if (d >= 2) return `${d} days ago`;
  const h = Math.floor(ms / 3_600_000);
  if (h >= 2) return `${h} hours ago`;
  const m = Math.floor(ms / 60_000);
  return m >= 2 ? `${m} minutes ago` : "just now";
};

/**
 * The article, in the site's own shapes.
 *
 * Deliberately the same block union the journal renders
 * (balkaris-web-infrastructure/components/blocks/article.tsx). If a block type
 * is ever added there and not here, this preview silently stops showing part
 * of the article — so an unknown block is drawn as a visible complaint rather
 * than skipped.
 */
export function renderArticle(body: PostBlock[]): string {
  return body
    .map((b) => {
      if (typeof b === "string") return `<p>${esc(b)}</p>`;
      if ("h" in b) return `<h2>${esc(b.h)}</h2>`;
      if ("list" in b) {
        const tag = b.ordered ? "ol" : "ul";
        return `<${tag}>${b.list.map((i) => `<li>${esc(i)}</li>`).join("")}</${tag}>`;
      }
      if ("steps" in b) {
        return `<dl class="steps">${b.steps
          .map((s) => `<dt>${esc(s.term)}</dt><dd>${esc(s.text)}</dd>`)
          .join("")}</dl>`;
      }
      if ("note" in b) return `<aside>${esc(b.note)}</aside>`;
      if ("quote" in b) {
        return `<blockquote><p>${esc(b.quote)}</p>${b.who ? `<cite>${esc(b.who)}</cite>` : ""}</blockquote>`;
      }
      if ("code" in b) return `<pre><code>${esc(b.code)}</code></pre>`;
      if ("table" in b) {
        const head = `<tr>${b.table.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
        const rows = b.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
        return `<table class="tbl"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
      }
      return `<p class="unknown">A block this preview does not know how to draw: ${esc(JSON.stringify(b).slice(0, 120))}</p>`;
    })
    .join("\n");
}

export const CSS = `
  :root{color-scheme:dark;--bg:#0b0c0d;--card:#121315;--fg:#e9eaeb;--dim:#8b8e91;--line:#1e2022;
        --ok:#25f716;--warn:#f7b500;--bad:#f75e5e}
  *{box-sizing:border-box}
  body{margin:0;padding:34px 22px 80px;background:var(--bg);color:var(--fg);
       font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  main{max-width:860px;margin:0 auto}
  a{color:inherit}
  h1{font-size:21px;font-weight:600;letter-spacing:-.02em;margin:0 0 4px}
  .sub{color:var(--dim);margin:0 0 26px;font-size:13px}
  .back{display:inline-block;color:var(--dim);text-decoration:none;font-size:12.5px;margin-bottom:20px}
  .back:hover{color:var(--fg)}
  .pills{display:flex;flex-wrap:wrap;gap:9px;margin-bottom:24px}
  .pill{border:1px solid var(--line);border-radius:999px;padding:5px 13px;font-size:12.5px;color:var(--dim)}
  .pill b{color:var(--fg);font-weight:600}
  .dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;vertical-align:1px}
  .row{display:block;border:1px solid var(--line);border-radius:10px;padding:15px 17px;margin-bottom:10px;
       text-decoration:none;background:var(--card)}
  .row:hover{border-color:#2c2f33}
  .row b{display:block;font-weight:600;margin-bottom:3px}
  .row em{font-style:normal;color:var(--dim);font-size:12.5px}
  .tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}
  .tag{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);
       border:1px solid var(--line);border-radius:4px;padding:2px 7px}
  .tag.live{color:var(--ok);border-color:#1d3d19}
  .tag.wait{color:var(--warn);border-color:#3d3319}
  .tag.bad{color:var(--bad);border-color:#3d1f1f}
  .none{color:var(--dim);padding:36px 0;text-align:center;border:1px dashed var(--line);border-radius:10px}
  .flag{border:1px solid #3d3319;background:#191612;color:#f2d9a0;border-radius:8px;
        padding:12px 15px;font-size:13.5px;margin:18px 0}
  .stats{display:flex;flex-wrap:wrap;gap:0 26px;border:1px solid var(--line);border-radius:10px;
         padding:14px 17px;margin:18px 0;background:var(--card)}
  .stat{min-width:78px}
  .stat i{display:block;font-style:normal;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}
  .stat b{font-size:17px;font-weight:600}
  .caveat{color:var(--dim);font-size:12px;margin:-8px 0 20px}
  article{border-top:1px solid var(--line);padding-top:26px;margin-top:26px}
  article h1.t{font-size:27px;line-height:1.2;margin:0 0 8px}
  article .stand{color:var(--dim);font-size:16px;margin:0 0 26px}
  article h2{font-size:17px;margin:30px 0 10px}
  article p{margin:0 0 16px}
  article ul,article ol{margin:0 0 16px;padding-left:20px}
  article li{margin-bottom:6px}
  article aside{border-left:2px solid var(--line);padding:2px 0 2px 15px;color:var(--dim);margin:0 0 16px}
  article blockquote{margin:0 0 16px;padding-left:15px;border-left:2px solid var(--ok)}
  article cite{color:var(--dim);font-size:13px;font-style:normal}
  .steps{margin:0 0 16px}
  .steps dt{font-weight:600;margin-top:12px}
  .steps dd{margin:2px 0 0;color:var(--dim)}
  .tbl{width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px}
  .tbl th,.tbl td{text-align:left;padding:8px 10px 8px 0;border-bottom:1px solid var(--line)}
  .tbl th{color:var(--dim);font-size:11px;letter-spacing:.09em;text-transform:uppercase;font-weight:500}
  .unknown{color:var(--bad)}
  .acts{display:flex;flex-wrap:wrap;gap:10px;border-top:1px solid var(--line);padding-top:22px;margin-top:30px}
  button,.btn{font:inherit;font-size:13.5px;border:1px solid var(--line);background:var(--card);color:var(--fg);
         border-radius:8px;padding:9px 16px;cursor:pointer;text-decoration:none;display:inline-block}
  button:hover,.btn:hover{border-color:#34383d}
  button.go{border-color:#1d3d19;color:var(--ok)}
  button.off{color:var(--dim)}
  button.del{color:var(--bad);border-color:#3d1f1f}
  form{display:inline}
  select{font:inherit;font-size:13px;background:var(--card);color:var(--fg);border:1px solid var(--line);
         border-radius:8px;padding:8px 10px}
  .src{color:var(--dim);font-size:13px;margin:0 0 18px}
  .src a{color:var(--fg)}
  .who{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:22px;
       font-size:12.5px;color:var(--dim)}
  .who a{text-decoration:none}
  .who a:hover{color:var(--fg)}
  .who form{display:inline}
  .who button{font-size:12px;padding:4px 10px;border-radius:6px;color:var(--dim)}
  .ppl{width:100%;border-collapse:collapse;font-size:14px}
  .ppl td,.ppl th{padding:12px 12px 12px 0;border-bottom:1px solid var(--line);vertical-align:middle}
  .ppl th{color:var(--dim);font-size:11px;letter-spacing:.09em;text-transform:uppercase;font-weight:500;text-align:left}
  .ppl input{font:inherit;font-size:13.5px;background:#0b0c0d;color:var(--fg);border:1px solid var(--line);
             border-radius:7px;padding:8px 10px;width:100%;max-width:260px}
  .ppl .me{color:var(--ok)}
`;


/**
 * The desk's mark: the site's green on ink, a page with a line lifting off it.
 *
 * Inline SVG in a data url rather than a file, because the box serves no
 * static assets at all and adding a directory, a route and a cache header for
 * sixteen pixels would be the wrong trade. It is drawn once here and every
 * page points at the same string.
 */
const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
       <rect width="32" height="32" rx="7" fill="#0b0c0d"/>
       <rect x="7" y="6" width="14" height="20" rx="2" fill="none" stroke="#25f716" stroke-width="2.2"/>
       <path d="M11 12h6M11 16h6M11 20h3" stroke="#25f716" stroke-width="2" stroke-linecap="round" opacity=".55"/>
       <path d="M19 20l6-6" stroke="#25f716" stroke-width="2.6" stroke-linecap="round"/>
       <path d="M21.5 14H25v3.5" fill="none" stroke="#25f716" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
     </svg>`.replace(/\s+/g, " "),
  );

export function page(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} · Balkaris desk</title>
<link rel="icon" href="${FAVICON}" />
<style>${CSS}</style></head><body><main>${inner}</main></body></html>`;
}


/** Who is signed in, and the way to the people page. On every page. */
function bar(who: Person): string {
  return `<div class="who">
    <span>Signed in as <b style="color:var(--fg)">${esc(who.name)}</b>${
      who.canPublish ? "" : ` \u2014 <span style="color:var(--warn)">no email yet, so you cannot publish</span>`
    }</span>
    <span><a href="/console">Everything</a> &nbsp;\u00b7&nbsp; <a href="/people">People</a> &nbsp;
      <form method="post" action="/logout"><button>Sign out</button></form></span>
  </div>`;
}

/**
 * The people the desk knows.
 *
 * It learns a Telegram id the first time somebody writes to the bot, and
 * nothing else. The email is typed in here BY A PERSON, because guessing one
 * produces exactly what happened on the first real publish: Vercel refused
 * the build, the article sat on main doing nothing, and the domain owner got
 * an email about a deployment from an address nobody recognised.
 *
 * The byline is which name goes on an article they share — a key of `authors`
 * in the site's content/journal.ts.
 */
export function peoplePage(people: Person[], who: Person): string {
  /* Two kinds of row, and the desk should say so plainly: somebody who signed
     in with Google (has an email, negative id until Telegram is linked), and
     somebody the bot has met (has a Telegram id, maybe no email yet). The
     owner joins them; everybody else reads. */
  const rows = people
    .map((p) => {
      const tg = p.telegram > 0 ? String(p.telegram) : "—";
      const mine = p.telegram === who.telegram;
      const tags = [
        p.owner ? `<span class="tag live">owner</span>` : "",
        p.revoked ? `<span class="tag bad">revoked</span>` : "",
        p.canPublish ? `<span class="tag">can publish</span>` : `<span class="tag wait">cannot publish</span>`,
      ]
        .filter(Boolean)
        .join(" ");

      if (!who.owner) {
        return `<tr>
          <td${mine ? ' class="me"' : ""}>${esc(p.name)}${mine ? " (you)" : ""}<br><em style="color:var(--dim);font-size:12px">${esc(p.email ?? "no email yet")}</em></td>
          <td style="color:var(--dim)">${esc(tg)}</td>
          <td>${esc(p.author)}</td>
          <td>${tags}</td>
        </tr>`;
      }

      return `<tr>
        <td${mine ? ' class="me"' : ""}>${esc(p.name)}${mine ? " (you)" : ""}</td>
        <td><form method="post" action="/people/${p.telegram}" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <input name="email" type="email" value="${esc(p.email ?? "")}" placeholder="their @balkaris.ch address" />
          <input name="author" value="${esc(p.author)}" placeholder="byline" style="max-width:110px" />
          <button>Save</button>
        </form></td>
        <td style="color:var(--dim)">${esc(tg)}${
          p.telegram < 0
            ? `<form method="post" action="/people/${p.telegram}/link" style="margin-top:6px">
                 <input name="telegram" placeholder="their Telegram id" style="max-width:130px" />
                 <button>Link</button>
               </form>`
            : ""
        }</td>
        <td>${tags}${
          p.owner
            ? ""
            : `<form method="post" action="/people/${p.telegram}/revoke" style="margin-top:6px">
                 <button class="${p.revoked ? "" : "del"}">${p.revoked ? "Allow again" : "Revoke"}</button>
               </form>`
        }</td>
      </tr>`;
    })
    .join("");

  return page(
    "People",
    `${bar(who)}
     <h1>People</h1>
     <p class="sub">Signing in is a <b>@balkaris.ch</b> Google account and nothing else. Publishing commits to the
     website under that same address, which is what makes Vercel build it.</p>
     <p class="sub">${
       who.owner
         ? "You are the owner, so you can change anybody's address, byline and access. Nobody else can."
         : "You can see the team. Only the owner changes addresses, bylines and access."
     }</p>
     <p class="sub">A person can appear twice — once from signing in, once from writing to the bot — until the
     two are linked. The byline on an article is whoever <b>shared</b> it on Telegram.</p>
     <table class="ppl">
       <thead><tr><th>Who</th><th>Email for publishing${who.owner ? " &nbsp;·&nbsp; byline" : ""}</th><th>Telegram</th><th></th></tr></thead>
       <tbody>${rows || `<tr><td colspan="4" class="none">Nobody yet.</td></tr>`}</tbody>
     </table>`,
  );
}

/* ---------- the list ------------------------------------------------------- */

interface Row {
  id: number;
  url: string;
  title: string | null;
  site: string | null;
  kind: string;
  platform: string | null;
  topic: string | null;
  services: string | null;
  state: string;
  error: string | null;
  created_at: string;
  views: number | null;
  likes: number | null;
  draft_id: number | null;
  slug: string | null;
  draft_state: string | null;
  echo: string | null;
}

const STATE_TAG: Record<string, { cls: string; word: string }> = {
  queued: { cls: "wait", word: "waiting for the workstation" },
  social: { cls: "wait", word: "waiting for the workstation" },
  drafted: { cls: "", word: "written — read it" },
  listed: { cls: "live", word: "published" },
  unlisted: { cls: "", word: "live at its url, not listed" },
  failed: { cls: "bad", word: "could not be read" },
};

export function listPage(who: Person): string {
  reclaim();
  const q = queueState();
  const rows = db
    .prepare(
      `SELECT l.*, d.id AS draft_id, d.slug, d.state AS draft_state, d.echo
         FROM links l
         LEFT JOIN drafts d ON d.id = (SELECT MAX(id) FROM drafts WHERE link_id = l.id)
        ORDER BY l.id DESC LIMIT 60`,
    )
    .all() as unknown as Row[];

  const awake = q.lastSeen && Date.now() - Date.parse(`${q.lastSeen}Z`) < 5 * 60_000;

  const body = rows.length
    ? rows
        .map((r) => {
          const state = r.draft_state === "listed" ? "listed" : r.draft_state === "unlisted" ? "unlisted" : r.state;
          const tag = STATE_TAG[state] ?? { cls: "", word: state };
          const svc = (r.services ? (JSON.parse(r.services) as string[]) : []).map(serviceName).slice(0, 3);
          const shelf = TOPICS.find((t) => t.id === r.topic)?.name;
          const href = r.draft_id ? `/draft/${r.draft_id}` : `/link/${r.id}`;
          return `<a class="row" href="${href}">
            <b>${esc(r.title ?? r.url)}</b>
            <em>${esc(r.site ?? r.platform ?? "")}${r.kind !== "article" ? ` · ${esc(r.kind)}` : ""} · ${esc(ago(r.created_at))}${
              r.likes !== null ? ` · ${num(r.likes)} likes` : ""
            }</em>
            <span class="tags">
              <span class="tag ${tag.cls}">${esc(tag.word)}</span>
              ${shelf ? `<span class="tag">${esc(shelf)}</span>` : ""}
              ${svc.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}
              ${r.echo ? `<span class="tag wait">ends like another</span>` : ""}
            </span>
          </a>`;
        })
        .join("")
    : `<p class="none">Nothing yet. Send the bot a link — an article, a TikTok, a Reel or a carousel.</p>`;

  return page(
    "Desk",
    `${bar(who)}
     <h1>Balkaris desk</h1>
     <p class="sub">Send a link to @insight_balkaris_bot. It is read and matched here, written on the workstation, and goes to balkaris.ch when you say so.</p>
     <div class="pills">
       <span class="pill"><span class="dot" style="background:${awake ? "var(--ok)" : "#55585a"}"></span>workstation <b>${awake ? "awake" : "asleep"}</b></span>
       <span class="pill">queued <b>${q.queued}</b></span>
       <span class="pill">writing <b>${q.running}</b></span>
       <span class="pill">to read <b>${q.drafts}</b></span>
       ${q.stuck ? `<span class="pill">stuck <b>${q.stuck}</b></span>` : ""}
     </div>
     ${body}`,
  );
}

/* ---------- one article ---------------------------------------------------- */

export function draftPage(
  id: number,
  siteBase: string,
  who: Person,
  ours?: { stats: PageStats | null; error: string | null; on: boolean },
): string | null {
  const d = db.prepare("SELECT * FROM drafts WHERE id = ?").get(id) as
    | {
        id: number;
        link_id: number;
        slug: string;
        post: string;
        template: string;
        model: string | null;
        ms: number | null;
        state: string;
        echo: string | null;
        cover_alt: string | null;
        closing: string | null;
        created_at: string;
      }
    | undefined;
  if (!d) return null;

  const l = db.prepare("SELECT * FROM links WHERE id = ?").get(d.link_id) as Record<string, unknown>;
  const post = JSON.parse(d.post) as {
    title: string;
    standfirst: string;
    excerpt: string;
    readingTime: number;
    body: PostBlock[];
    takeaways: string[];
    faq?: { q: string; a: string }[];
    services: string[];
    source: { url: string; site: string; title: string; author: string | null };
  };

  /* Three states, and the buttons offered are only the ones that make sense
     from where it actually is. `state` is the desk's record of what the last
     successful push did — never a guess, because a failed push leaves it
     untouched. */
  const onSite: "draft" | "unlisted" | "listed" =
    d.state === "listed" ? "listed" : d.state === "unlisted" ? "unlisted" : "draft";
  const shelf = TOPICS.find((t) => t.id === l.topic)?.name ?? "";
  const kind = String(l.kind ?? "article");

  /* The source's own numbers and, once it is live, the article's. Both are
     shown with the same weight because the question they answer together is
     the only reason either is kept: did a piece built on something that
     performed well, itself perform well? */
  const sourceStats =
    kind === "article"
      ? ""
      : `<div class="stats">
           <div class="stat"><i>views</i><b>${num(l.views as number | null)}</b></div>
           <div class="stat"><i>likes</i><b>${num(l.likes as number | null)}</b></div>
           <div class="stat"><i>comments</i><b>${num(l.comments as number | null)}</b></div>
           <div class="stat"><i>shares</i><b>${num(l.shares as number | null)}</b></div>
           <div class="stat"><i>saves</i><b>${num(l.saves as number | null)}</b></div>
           <div class="stat"><i>when read</i><b style="font-size:13px">${esc(ago(l.captured_at as string | null))}</b></div>
         </div>
         <p class="caveat">The source's own numbers when we read it${
           l.posted_at ? `, posted ${esc(ago(l.posted_at as string))}` : ""
         }. A dash means the platform does not publish that one — Instagram gives no shares or saves, and never a zero.</p>`;

  const jobs = (Object.keys(CLOSING_JOBS) as ClosingJob[])
    .map((j) => `<option value="${j}"${j === d.closing ? " selected" : ""}>${esc(CLOSING_JOBS[j].name)}</option>`)
    .join("");

  return page(
    post.title,
    `${bar(who)}
     <a class="back" href="/console">← everything</a>
     <p class="src">${esc(kind)} · from <a href="${esc(post.source.url)}" rel="noreferrer noopener">${esc(
       post.source.author ? `@${post.source.author}` : post.source.site,
     )}</a> · ${esc(shelf)} · written ${esc(ago(d.created_at))} by ${esc(d.model ?? "?")} in ${
       d.ms ? Math.round(d.ms / 1000) : "?"
     }s · ${esc(d.template)}, ends on ${esc(d.closing ?? "—")}</p>

     ${
       /* OUR numbers, beside the source's. Fini: "I also need the metric of the
          page. Like how many views we have. How much time people spend on the
          page." A page nobody has visited yet reads as zero rather than as a
          gap, because a gap looks like a broken feature. */
       onSite === "draft"
         ? ""
         : !ours?.on
           ? `<p class="caveat">Page views are not switched on yet \u2014 the desk has no analytics key.</p>`
           : ours.error
             ? `<p class="flag">Could not read the page's views: ${esc(ours.error)}</p>`
             : `<div class="stats">
                  <div class="stat"><i>views</i><b>${num(ours.stats?.views ?? 0)}</b></div>
                  <div class="stat"><i>people</i><b>${num(ours.stats?.people ?? 0)}</b></div>
                  <div class="stat"><i>time on page</i><b>${esc(spell(ours.stats?.seconds ?? 0))}</b></div>
                  <div class="stat"><i>since</i><b style="font-size:13px">published</b></div>
                </div>
                <p class="caveat">This article's own numbers, last 28 days. GA4 only counts a visitor who accepted
                the cookie banner, so it undercounts \u2014 fair between articles, not an audited figure.</p>`
     }
     ${sourceStats}
     ${d.echo ? `<p class="flag"><b>Ends like another article.</b> ${esc(d.echo)}</p>` : ""}

     <article>
       ${
         /* The real picture, served by the desk from what it drew. */
         d.cover_alt
           ? `<img src="/cover/${esc(d.slug)}.webp" alt="${esc(d.cover_alt)}"
                   style="width:100%;border-radius:10px;margin:0 0 10px;display:block" />
              <form method="post" action="/draft/${d.id}/redraw" style="margin:0 0 22px">
                <button class="off">Draw another cover</button>
              </form>`
           : `<p class="caveat" style="margin:0 0 20px">No cover drawn yet \u2014 it is queued for the workstation.</p>`
       }
       ${
         /* Attach the video, or just the text. Only where there IS a video:
            an article link and a carousel have nothing to play, and a button
            offering to attach nothing is a button that teaches you to
            distrust the page. */
         l.kind === "video"
           ? `<form method="post" action="/draft/${d.id}/attach" style="margin:0 0 22px">
                <button class="off">${l.attach === 0 ? "Attach the video" : "Just the text, no video"}</button>
                <span class="caveat" style="margin-left:10px">${
                  l.attach === 0
                    ? "It reads as prose. The video is credited but not shown."
                    : "Ten silent seconds play in the article, cut by us. No " +
                      esc(String(l.platform ?? "platform")) +
                      " player, no recommendations, no cookies."
                }</span>
              </form>
              <form method="post" action="/draft/${d.id}/clip" style="margin:0 0 22px">
                <button class="off">Cut the silent clip again</button>
                <span class="caveat" style="margin-left:10px">Ten seconds, no sound, about 130&nbsp;KB. It never touches the words.</span>
              </form>`
           : ""
       }
       <h1 class="t">${esc(post.title)}</h1>
       <p class="stand">${esc(post.standfirst)}</p>
       ${renderArticle(post.body)}
       ${
         post.takeaways?.length
           ? `<h2>Key takeaways</h2><ul>${post.takeaways.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>`
           : ""
       }
       ${
         post.faq?.length
           ? `<h2>Asked before deciding</h2><dl class="steps">${post.faq
               .map((f) => `<dt>${esc(f.q)}</dt><dd>${esc(f.a)}</dd>`)
               .join("")}</dl>`
           : `<p class="unknown">No questions section \u2014 the site's template has one.</p>`
       }
     </article>

     ${
       onSite === "draft"
         ? `<p class="caveat">Not on the site at all yet. Putting it there gives it a real url that
            nobody can find: no menu, no shelf, no sitemap, and noindex so a crawler leaves it alone.</p>`
         : onSite === "unlisted"
           ? `<p class="caveat">Live at its own url and in none of the menus. It carries noindex, so it is
              readable by anyone you send the link to and invisible to search.</p>`
           : `<p class="caveat">Published: in the menu, on the shelves, in the sitemap and in search.</p>`
     }

     <div class="acts">
       ${
         !who.canPublish
           ? `<p class="caveat" style="margin:0">Add your Vercel email on the <a href="/people">people page</a>
              before you can publish \u2014 the commit goes out under your name and Vercel will refuse it otherwise.</p>`
           : onSite === "draft"
           ? `<form method="post" action="/draft/${d.id}/publish"><button class="go">Put it on the site, unlisted</button></form>`
           : onSite === "unlisted"
             ? `<form method="post" action="/draft/${d.id}/list"><button class="go">Publish it properly</button></form>
                <a class="btn" href="${esc(siteBase)}/insights/${esc(d.slug)}" rel="noreferrer noopener">Read it on the site ↗</a>
                <form method="post" action="/draft/${d.id}/takedown"><button class="off">Take it off the site</button></form>`
             : `<a class="btn" href="${esc(siteBase)}/insights/${esc(d.slug)}" rel="noreferrer noopener">Read it on the site ↗</a>
                <form method="post" action="/draft/${d.id}/unlist"><button class="off">Out of the menus</button></form>
                <form method="post" action="/draft/${d.id}/takedown"><button class="del">Take it off the site</button></form>`
       }
       ${
         /* Only when it is needed. Five ways to end an article is machinery,
            and machinery on a page somebody reads every day is clutter — so it
            appears beside the warning that calls for it and nowhere else. */
         d.echo
           ? `<form method="post" action="/draft/${d.id}/reclose">
                <select name="job">${jobs}</select>
                <button>End it differently</button>
              </form>`
           : ""
       }
       ${
         onSite === "draft"
           ? `<form method="post" action="/draft/${d.id}/remove" onsubmit="return confirm('Delete this draft? The link stays and can be written again.')">
                <button class="del">Delete the draft</button>
              </form>`
           : ""
       }
     </div>`,
  );
}

/** A link with no draft yet: what we know, and why it is waiting. */
export function linkPage(id: number): string | null {
  const l = db.prepare("SELECT * FROM links WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!l) return null;

  const jobs = db.prepare("SELECT * FROM jobs WHERE link_id = ? ORDER BY id").all(id) as {
    id: number;
    kind: string;
    state: string;
    attempts: number;
    error: string | null;
  }[];

  return page(
    String(l.title ?? l.url),
    `<a class="back" href="/console">← everything</a>
     <h1>${esc(l.title ?? l.url)}</h1>
     <p class="sub"><a href="${esc(l.url as string)}" rel="noreferrer noopener">${esc(l.url)}</a></p>
     ${l.error ? `<p class="flag">${esc(l.error)}</p>` : ""}
     <div class="pills">
       <span class="pill">state <b>${esc(l.state)}</b></span>
       <span class="pill">kind <b>${esc(l.kind)}</b></span>
       <span class="pill">shared <b>${esc(ago(l.created_at as string))}</b></span>
     </div>
     ${jobs
       .map(
         (j) =>
           `<p class="src">job ${j.id} · ${esc(j.kind)} · <b>${esc(j.state)}</b> · ${j.attempts} attempt(s)${
             j.error ? ` · ${esc(j.error)}` : ""
           }</p>`,
       )
       .join("")}
     <form method="post" action="/link/${id}/retry"><button>Try it again</button></form>`,
  );
}

export function note(what: string, detail: unknown, linkId?: number): void {
  log(what, detail, linkId);
}
