/**
 * The AI Operator's machinery, end to end, without a model: a throwaway
 * database and a throwaway website repository in work/, the real server on
 * port 3454, and a fake runner that answers with canned text through the
 * same function the workstation's runner calls (src/cc/operator/work.ts).
 *
 *   node --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-operator.ts
 *
 * What is proved:
 *    1. tasks are made from the desk's own data, queue in order, and say
 *       what is ahead of them; an article job waiting goes first;
 *    2. the runner takes them oldest first, through the secret door only;
 *    3. Stop cancels a queued task, and a running one's answer is discarded;
 *    4. invalid JSON is refused once with the reason, and the second, valid
 *       answer is kept; a figure the data does not hold is refused, then
 *       removed and named;
 *    5. a model that fails makes a failed task with the reason, not a silence;
 *    6. a task left running by a restart is reclaimed at the runner's next
 *       ask, and one whose runner vanished after fifteen minutes;
 *    7. proposals: a person who cannot publish cannot approve; an approval
 *       commits the one entry to content/desk/overrides.json in a scratch
 *       repository whose remote is a local bare one, with a subject and body
 *       that say what, where, proposed by whom and approved by whom; a
 *       redirect from an address in the sitemap is refused; a withdrawal
 *       removes the entry; a development copy refuses to push anywhere but a
 *       local repository;
 *    8. the brand: the model is given and writes a title's own part, and
 *       the site's " | Balkaris" is never stored, doubled, or left out of
 *       the length and duplicate checks;
 *    9. the workstation is judged by its asks for operator tasks, a task
 *       whose workstation went quiet stops reading as "working", a job kind
 *       the runner never takes holds nothing up, an audit keeps the crawl's
 *       own rules and moves on when the screen is read;
 *   10. a redirect is asked of the live site (a stub here), a cut-off
 *       approval is offered again, a page that changed since is not
 *       overwritten, counts are counted, and an error from the operator's
 *       door never throws into the runner's loop;
 *   11. nothing tried to leave this machine.
 *
 * Everything in here is made up: the people end in desk.test and every page
 * is a specimen.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "work", `check-op-${process.pid}`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const PORT = 3454;
const BASE = `http://127.0.0.1:${PORT}`;
const RUNNER = "runner-secret-of-the-operator-check";

/* ---- a website repository of our own: a bare remote and a seed commit ------ */
const remote = path.join(dir, "remote.git");
const seed = path.join(dir, "seed");
const git = (args: string[], cwd?: string) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "Specimen Seed", GIT_AUTHOR_EMAIL: "seed@desk.test", GIT_COMMITTER_NAME: "Specimen Seed", GIT_COMMITTER_EMAIL: "seed@desk.test" },
  }).trim();
git(["init", "--bare", "--initial-branch=main", remote]);
git(["init", "--initial-branch=main", seed]);
mkdirSync(path.join(seed, "content", "desk"), { recursive: true });
writeFileSync(path.join(seed, "content", "desk", "overrides.json"), `${JSON.stringify({ meta: {}, redirects: [] }, null, 2)}\n`);
writeFileSync(path.join(seed, "README.md"), "Specimen website for the operator check.\n");
git(["-c", "core.autocrlf=false", "add", "."], seed);
git(["commit", "-m", "Specimen website"], seed);
git(["push", pathToFileURL(remote).href, "main"], seed);

for (const name of ["DESK_SESSION_SECRET", "TELEGRAM_BOT_TOKEN", "TELEGRAM_OWNER_ID", "SITE_READ_REPO", "GOOGLE_API_KEY"]) delete process.env[name];
process.env.NODE_ENV = "development";
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.DESK_PORT = String(PORT);
process.env.DESK_URL = BASE;
process.env.DESK_OWNER = "owner@desk.test";
/* A development copy, so the guard against pushing to a real website is on. */
process.env.DESK_DEV_USER = "owner@desk.test";
process.env.DESK_RUNNER_SECRET = RUNNER;
process.env.TELEGRAM_WEBHOOK_SECRET = "hook";
process.env.DESK_AUTOPUBLISH = "0";
process.env.GA4_CREDENTIALS_FILE = path.join(dir, "no-such-key.json");
process.env.CC_SCHEDULER = "off";
/* The live website, as a stub inside this process (below): the operator asks it whether an address answers. */
const SITE = "http://site.specimen.test";
process.env.SITE_BASE = SITE;
process.env.SITE_READ_CLONE = "off";
process.env.SITE_REPO = path.join(dir, "site");
process.env.SITE_REMOTE = pathToFileURL(remote).href;
process.env.SITE_BRANCH = "main";

/* ---- nothing leaves this machine ------------------------------------------- */
/* What the stub website answers: the specimen pages, a live page the crawl never
   reached, an address that already redirects, and 404 for everything else. */
const LIVE: Record<string, number | [number, string]> = {
  "/": 200,
  "/services": 200,
  "/about": 200,
  "/specimen-a": 200,
  "/specimen-b": 200,
  "/hidden-live": 200,
  "/moved": [308, "/about"],
};
const asked: string[] = [];
const real = globalThis.fetch;
const left: string[] = [];
/* The pages' own text, where a check needs more than a line: a FAQ is checked against it. */
const TEXT: Record<string, string> = {
  "/services":
    "Specimen services. We design and build specimen websites for specimen businesses. Every specimen project starts with a short workshop about your goals. We deliver a first specimen draft within two weeks of the workshop. Specimen support continues after launch with monthly reports.",
};
/* What a page's head says, for reading a change back after a deploy. */
const HEADS: Record<string, string> = {};
/* Files the stub website serves as they are: a share picture already on the site, and its sitemap. */
const FILES: Record<string, { type: string; body: Uint8Array | string }> = {};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith(BASE)) return real(input as never, init);
  if (url.startsWith(SITE)) {
    const p = new URL(url).pathname.replace(/\/+$/, "") || "/";
    asked.push(p);
    const file = FILES[p];
    if (file) return new Response(file.body as BodyInit, { status: 200, headers: { "content-type": file.type } });
    const r = LIVE[p];
    if (Array.isArray(r)) return new Response(null, { status: r[0], headers: { location: r[1] } });
    if (r === 200) return new Response(`<html><head>${HEADS[p] ?? ""}</head><body><main><h1>Specimen</h1><p>${TEXT[p] ?? `Specimen text for ${p}.`}</p></main></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
    return new Response("Specimen: not found", { status: 404 });
  }
  left.push(url.split("?")[0]!);
  throw new Error("the operator check lets nothing leave this machine");
}) as typeof fetch;

const said: string[] = [];
const quiet = { error: console.error, warn: console.warn, log: console.log };
console.error = (...a: unknown[]) => void said.push(a.map(String).join(" "));
console.warn = (...a: unknown[]) => void said.push(a.map(String).join(" "));

let failed = 0;
let passed = 0;
const check = (what: string, ok: boolean, detail = "") => {
  if (ok) passed++;
  else failed++;
  quiet.log(`${ok ? "  ok  " : "  FAIL"} ${what}${detail ? `  — ${detail}` : ""}`);
};

const { db } = await import("../src/db.ts");
const people = await import("../src/people.ts");
const { seal } = await import("../src/session.ts");
await import("../src/server.ts");
const { operatorOnce } = await import("../src/cc/operator/work.ts");

type Person = ReturnType<typeof people.rememberGoogle>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (done: () => Promise<boolean>, ms = 8000): Promise<boolean> => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await done()) return true;
  return false;
};

interface Answer {
  status: number;
  json: any;
  text: string;
}
async function ask(pathname: string, o: { who?: Person; method?: string; body?: unknown; runner?: boolean } = {}): Promise<Answer> {
  const headers: Record<string, string> = {};
  if (o.who) headers.cookie = `desk=${seal(o.who.telegram)}`;
  if (o.method && o.method !== "GET" && !o.runner) headers.origin = BASE;
  if (o.runner) headers.authorization = `Bearer ${RUNNER}`;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await real(BASE + pathname, { method: o.method ?? "GET", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text };
}
const show = (a: Answer) => `${a.status} ${a.text.slice(0, 160).replace(/\s+/g, " ")}`;

async function finish(): Promise<never> {
  console.error = quiet.error;
  console.warn = quiet.warn;
  quiet.log(`\n${failed ? `${failed} FAILED, ${passed} passed` : `all ${passed} passed`}.`);
  if (failed && said.length) quiet.log(`\nwhat the server said meanwhile:\n${said.map((s) => `  ${s.split("\n")[0]!.slice(0, 220)}`).join("\n")}`);
  await wait(1500);
  db.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* Windows keeps a file a moment longer. */
  }
  process.exit(failed ? 1 : 0);
}

check(`the server came up on port ${PORT}`, await until(async () => (await ask("/health").catch(() => null))?.status === 200));

/* ---- the people -------------------------------------------------------------- */
const owner = people.rememberGoogle("owner@desk.test", "Specimen Owner");
const helper = people.remember(4242, "Specimen Helper"); /* no email: may not publish */

/* ---- a crawl, as the site collector would have stored it ---------------------- */
const at = new Date().toISOString();
const facts = (title: string | null, description: string | null, h1: string) => ({
  title,
  description,
  canonical: null,
  robots: null,
  lang: "en",
  h1: [h1],
  h2: 2,
  og: { title, description, image: null, type: "website", url: null },
  twitter: { card: null, image: null },
  schema: [],
  schemaTypes: ["WebPage"],
  words: 420,
  links: { internal: 3, internalFromContent: 1, external: 0 },
  images: [],
  videos: [],
  mentions: [],
});
const fetched = (p: string) => ({ hops: [], lands: p, landed: 200, ttfb: 50, total: 80, bytes: 20000, cacheControl: null, vercelCache: "HIT", contentType: "text/html", robotsTag: null });
const pages: [string, string, string | null, string | null, string][] = [
  ["/", "home", "Specimen Studio | Balkaris", "The specimen home page of a specimen studio, written for this check and nothing else.", "Specimen home"],
  ["/services", "service", "Specimen services | Balkaris", "Specimen services offered by the specimen studio, written for the operator check.", "Specimen services"],
  ["/about", "standard", "About the specimen studio | Balkaris", "Who the specimen studio is: a page written for the operator check, and nothing more.", "About the specimen studio"],
  ["/specimen-a", "standard", "Specimen page A, with a title that runs far past where a search result cuts it off", "A specimen description for page A that is fine as it is and long enough to pass.", "Specimen page A"],
  ["/specimen-b", "standard", "Specimen page B | Balkaris", null, "Specimen page B"],
];
for (const [p, kind, title, description, h1] of pages) {
  db.prepare(
    "INSERT INTO cc_pages (path, kind, status, in_sitemap, listed_by, title, descr, heading, score, fetched, facts, hash, first_seen, last_seen, last_changed) VALUES (?, ?, 200, 1, 'sitemap', ?, ?, ?, 90, ?, ?, ?, ?, ?, ?)",
  ).run(p, kind, title, description, h1, JSON.stringify(fetched(p)), JSON.stringify(facts(title, description, h1)), `hash-${p}`, at, at, at);
}
const issue = (id: string, rule: string, severity: string, p: string | null, text: string, measured: unknown, bound: unknown) =>
  db.prepare("INSERT INTO cc_issues (id, rule, severity, path, text, measured, bound, related, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)").run(id, rule, severity, p, text, JSON.stringify(measured), JSON.stringify(bound), at, at);
issue("title.long|/specimen-a", "title.long", "warning", "/specimen-a", "Title is 82 characters; over 60 is cut in results.", 82, 60);
issue("description.missing|/specimen-b", "description.missing", "warning", "/specimen-b", "No meta description.", null, null);
issue("links.broken|/about", "links.broken", "critical", "/about", "Links to /old-services, which answers 404.", "/old-services", 200);
db.prepare("INSERT INTO cc_links (source, target, text, internal, place, rel, times) VALUES ('/about', '/old-services', 'Our specimen services', 1, 'main', '', 1)").run();
db.prepare("INSERT INTO cc_targets (target, internal, status, landed, lands, outcome, remark, checked) VALUES ('/old-services', 1, 404, 404, '/old-services', 'broken', NULL, ?)").run(at);
const sitemap = {
  at,
  status: 200,
  entries: pages.map(([p]) => ({ path: p, loc: `https://www.balkaris.ch${p}`, lastmod: null, priority: 0.5, changefreq: null })),
  robots: { status: 200, sitemaps: [], rules: 0 },
  issues: [],
};
db.prepare("INSERT OR REPLACE INTO cc_cache (key, json, at) VALUES ('site:sitemap', ?, ?)").run(JSON.stringify(sitemap), Date.now());
db.prepare("INSERT OR REPLACE INTO cc_cache (key, json, at) VALUES ('site:crawl', ?, ?)").run(
  JSON.stringify({ started: at, finished: at, seconds: 3, pages: 5, inSitemap: 5, outsideSitemap: 0, changed: 0, added: 0, gone: 0, siteScore: 90, issues: { critical: 1, warning: 2, opportunity: 0 }, links: { internal: 1, external: 0, targetsChecked: 1, externalChecked: 0 }, withoutRepo: true }),
  Date.now(),
);
db.prepare("INSERT OR REPLACE INTO cc_state (key, value) VALUES ('site:crawl:finished', ?)").run(at);

/* ---- the fake runner ----------------------------------------------------------------- */
const handed: { id: number; kind: string; prompt: string; attempt: number }[] = [];
let canned: (prompt: string) => string | Error = () => "";
const runner = (name = "specimen-runner") =>
  operatorOnce({
    desk: BASE,
    name,
    secret: RUNNER,
    log: () => {},
    ensure: async () => ({ ok: true }),
    ask: async (prompt, opts) => {
      const id = Number(/\[task (\d+)\]/.exec(opts.system ?? "")?.[1] ?? 0);
      handed.push({ id, kind: "", prompt, attempt: 0 });
      const out = canned(prompt);
      if (out instanceof Error) throw out;
      return { text: out, model: String(opts.model), ms: 1200, tokensIn: 900, tokensOut: 60 };
    },
  });
const task = (id: number) => db.prepare("SELECT * FROM cc_ai_tasks WHERE id = ?").get(id) as any;
/** As if the workstation last asked for anything, articles or tasks, this many minutes ago. */
const setOpSeen = (minutesAgo: number) => {
  db.prepare("INSERT INTO cc_state (key, value) VALUES ('op:runner:seen', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify({ name: "specimen-runner", at: new Date(Date.now() - minutesAgo * 60_000).toISOString() }),
  );
  db.prepare(`UPDATE runners SET last_seen = datetime('now', '-${Math.round(minutesAgo)} minutes')`).run();
};
const make = async (body: object, who: Person = owner) => ask("/api/v1/operator/tasks", { who, method: "POST", body });

quiet.log("\n1. tasks are made and queue in order");
let a = await make({ kind: "ask", prompt: "Which specimen page has the most findings?", context: "pages", depth: "quick" });
check("a question is queued (202)", a.status === 202 && a.json?.task?.state === "queued" && a.json.task.ahead === 0, show(a));
const qAsk = a.json?.task?.id as number;
check("its pack is the crawl's pages, assembled on the box", JSON.parse(task(qAsk).pack).blocks[0]?.name === "pages");
a = await make({ kind: "traffic", range: "30d", prompt: "Analyze our traffic this month" });
const qTraffic = a.json?.task?.id as number;
check("a traffic summary is queued behind it", a.status === 202 && a.json.task.ahead === 1, show(a));
check("named by what it covers, not by the suggestion's words", a.json?.task?.title === "Analyze traffic for the last 30 days", a.json?.task?.title);
check("with GA4 not connected, its pack says so instead of a figure", JSON.parse(task(qTraffic).pack).blocks[0]?.state === "off");
a = await make({ kind: "metadata" });
const qMeta = a.json?.task?.id as number;
const metaPack = qMeta ? JSON.parse(task(qMeta).pack) : null;
check("metadata picks the pages whose title or description breaks a rule", a.status === 202 && metaPack?.meta?.map((m: any) => m.path).sort().join(",") === "/specimen-a,/specimen-b", show(a));
a = await make({ kind: "redirect" });
const qRedirect = a.json?.task?.id as number;
const redPack = qRedirect ? JSON.parse(task(qRedirect).pack) : null;
check(
  "redirect offers the broken address with candidates the rules chose",
  a.status === 202 && redPack?.redirects?.[0]?.from === "/old-services" && redPack.redirects[0].candidates.some((c: any) => c.path === "/services"),
  JSON.stringify(redPack?.redirects?.[0]?.candidates ?? null),
);
a = await make({ kind: "ask", prompt: "x" });
check("an empty question is refused with a sentence (400)", a.status === 400 && typeof a.json?.error === "string", show(a));
a = await make({ kind: "brief" });
check("a brief without a topic is refused (400)", a.status === 400, show(a));
a = await ask("/api/v1/operator", { who: owner });
check(
  "the screen lists the four, oldest first, each with what is ahead",
  a.status === 200 && a.json.tasks.map((t: any) => t.id).join() === [qAsk, qTraffic, qMeta, qRedirect].join() && a.json.tasks.map((t: any) => t.ahead).join() === "0,1,2,3",
  JSON.stringify(a.json?.tasks?.map((t: any) => [t.id, t.ahead])),
);
check("and says the workstation has never asked for work", a.json?.runner?.state === "never", a.json?.runner?.line);

quiet.log("\n2. the runner's door, and articles first");
a = await ask("/runner/next", { method: "POST", runner: true, body: { name: "specimen-runner", kinds: ["write"] } });
a = await ask("/api/v1/operator", { who: owner });
check(
  "an article runner's heartbeat alone does not make it online for questions",
  a.json?.runner?.state === "articles" && /does not take operator tasks/.test(a.json.runner.line),
  `${a.json?.runner?.state}: ${a.json?.runner?.line}`,
);
a = await ask("/runner/op/next", { method: "POST", body: { name: "nobody" } });
check("without the runner's secret the door is shut (401)", a.status === 401, show(a));
db.prepare("INSERT INTO links (url, title, site, state) VALUES ('https://example.test/specimen-article', 'Specimen article link', 'example.test', 'queued')").run();
db.prepare("INSERT INTO jobs (link_id, kind) VALUES (1, 'write')").run();
a = await ask("/runner/op/next", { method: "POST", runner: true, body: { name: "specimen-runner" } });
check("while an article job waits, no question is handed out", a.status === 200 && a.json.task === null && /article/.test(a.json.wait ?? ""), show(a));
db.prepare("UPDATE jobs SET state = 'done'").run();
/* A job of a kind the runner never takes (the console's "reclose") is nobody's work: it must not hold up a question. */
db.prepare("INSERT INTO jobs (link_id, kind) VALUES (1, 'reclose')").run();
a = await ask("/api/v1/operator", { who: owner });
check("the runner's ask for an operator task counts: the workstation is online", a.json?.runner?.state === "online", a.json?.runner?.line);
check("a queued job of a kind the runner never takes is not counted as an article first", a.json?.runner?.articlesFirst === 0, String(a.json?.runner?.articlesFirst));

quiet.log("\n3. answered in order; Stop");
a = await ask(`/api/v1/operator/tasks/${qTraffic}/cancel`, { who: helper, method: "POST" });
check("Stop cancels a queued task", a.status === 200 && a.json.task.state === "cancelled", show(a));
canned = () => "The specimen page with the most findings is /about, with a critical finding.";
check("the runner takes a task", (await runner()) === true);
check("the oldest first: the question", task(qAsk).state === "done" && task(qAsk).result_text.includes("/about"), task(qAsk).state);
check("the system prompt and the data travel with it", handed[0]?.prompt.includes("QUESTION: Which specimen page") && handed[0].prompt.includes("PAGES"));

quiet.log("\n4. invalid JSON, then valid; a figure the data does not hold");
canned = () => "Here are the titles: {not json";
await runner();
check("the cancelled task was skipped: metadata came next", handed.at(-1)?.prompt.includes("better search title") === true);
check(
  "the model is given the titles without the brand, and told the site adds it",
  handed.at(-1)?.prompt.includes('without the "| Balkaris" the site adds') === true &&
    handed.at(-1)?.prompt.includes("Specimen page B\n") === true &&
    handed.at(-1)?.prompt.includes("never write Balkaris in a title") === true,
);
check("invalid JSON goes back to the queue with the reason", task(qMeta).state === "queued" && task(qMeta).retried === 1 && /not valid JSON/.test(task(qMeta).retry_note ?? ""), `${task(qMeta).state} ${task(qMeta).retry_note}`);
canned = (p) =>
  p.includes("YOUR LAST ANSWER WAS REFUSED")
    ? JSON.stringify({
        pages: [
          { path: "/specimen-a", title: "Specimen page A | Balkaris", description: "A specimen description for page A that is fine as it is and long enough to pass." },
          { path: "/specimen-b", title: "Specimen page B | Balkaris", description: "Specimen page B of the specimen studio, described for the operator check and nothing else." },
        ],
      })
    : "{";
await runner();
check("the second, valid answer is kept", task(qMeta).state === "done", `${task(qMeta).state} ${task(qMeta).error ?? ""}`);
check("the retry was told why", handed.at(-1)?.prompt.includes("YOUR LAST ANSWER WAS REFUSED: the answer is not valid JSON") === true);
const waiting = db.prepare("SELECT * FROM cc_proposals WHERE state = 'waiting' ORDER BY id").all() as any[];
check("each page became a proposal, waiting", waiting.length === 2 && waiting[0].address === "/specimen-a", JSON.stringify(waiting.map((w) => w.address)));
check(
  "a title the model wrote with the brand is kept without it, so the site does not show it twice",
  JSON.parse(waiting[0].after_json).title === "Specimen page A",
  waiting[0]?.after_json,
);
a = await ask(`/api/v1/operator/proposals/${waiting[0].id}`, { who: owner });
check("the review shows it as the site will, the brand included", a.json?.shownTitle === "Specimen page A | Balkaris" && a.json?.lengths?.title === 26, `${a.json?.shownTitle} ${a.json?.lengths?.title}`);
const { strayNames, check: checkAnswer, figuresIn, strayFigures } = await import("../src/cc/operator/kinds.ts");
const { shownTitle } = await import("../src/cc/operator/packs.ts");
{
  const target = { path: "/x", lang: "en", kind: "Page", shown: "Specimen X | Balkaris", title: "Specimen X", description: null, h1: "Specimen X", ogTitle: null, ogDescription: null, excerpt: null, findings: [] };
  const pk = { builtAt: at, range: "30d", depth: "quick", blocks: [], known: ["/x"], meta: [target] } as never;
  const description = "A specimen description for page X of the specimen studio, long enough to pass the check.";
  /* The site adds the brand only where the whole fits in 60 (website lib/seo.tsx withBrand): a 57-character title is shown alone, a 61-character one is too long. */
  const fits = checkAnswer("metadata", "", pk, JSON.stringify({ pages: [{ path: "/x", title: "Specimen X for the specimen studio and its specimen pages", description }] }), false, new Map());
  check("a title of 57 characters is kept, and shown without the brand", fits.ok && shownTitle("Specimen X for the specimen studio and its specimen pages") === "Specimen X for the specimen studio and its specimen pages", fits.ok ? "kept" : fits.why);
  check("  a short title is shown with the brand", shownTitle("Specimen X") === "Specimen X | Balkaris");
  const long = checkAnswer("metadata", "", pk, JSON.stringify({ pages: [{ path: "/x", title: "Specimen X for the specimen studio and all of its specimen pages", description }] }), false, new Map());
  check("a title over 60 characters is refused", !long.ok && /title is \d+ characters; the title must be 10 to 60/.test(long.why), long.ok ? "kept" : long.why);
  const twin = checkAnswer("metadata", "", pk, JSON.stringify({ pages: [{ path: "/x", title: "Specimen services", description }] }), false, new Map([["/services", "Specimen services | Balkaris"]]));
  check("a duplicate is judged on the title as shown", !twin.ok && /same as \/services/.test(twin.why), twin.ok ? "kept" : twin.why);
  const f = figuresIn("Period: 2026-09-01 to 2026-09-30. Visitors: 1,234 (40 → 52).");
  check(
    "a number that is only part of a date in the data does not pass as a count",
    strayFigures("There were 30 visitors.", f).stray.join() === "30" &&
      strayFigures("It ran to 30 September.", f).stray.length === 0 &&
      strayFigures("1,234 visitors, up from 40 to 52.", f).stray.length === 0 &&
      strayFigures("234 visitors.", f).stray.join() === "234",
    JSON.stringify([strayFigures("There were 30 visitors.", f).stray, strayFigures("It ran to 30 September.", f).stray, strayFigures("234 visitors.", f).stray]),
  );
}
check(
  "a title that names a place the page never mentions is caught",
  strayNames("Specimen commercials in Zürich | Balkaris", "Specimen commercials for the specimen studio").join() === "Zürich" &&
    strayNames("Specimen page B | Balkaris", "Specimen page B").length === 0,
);
check("a proposal changes only what differs", JSON.parse(waiting[0].after_json).description === undefined && JSON.parse(waiting[1].after_json).title === undefined);

quiet.log("\n5. redirects: the model only ranks the rules' candidates");
canned = (p) =>
  p.includes("YOUR LAST ANSWER WAS REFUSED")
    ? JSON.stringify({ picks: [{ from: "/old-services", to: "/services", why: "Both are about the specimen services." }] })
    : JSON.stringify({ picks: [{ from: "/old-services", to: "/somewhere-invented", why: "Invented." }] });
await runner();
check("a pick outside the candidates is refused", task(qRedirect).retried === 1 && /not one of its candidates/.test(task(qRedirect).retry_note ?? ""), task(qRedirect).retry_note ?? "");
await runner();
const red = db.prepare("SELECT * FROM cc_proposals WHERE kind = 'redirect' AND state = 'waiting'").get() as any;
check("a candidate is kept as a waiting proposal", task(qRedirect).state === "done" && red?.address === "/old-services" && JSON.parse(red.after_json).to === "/services", `${task(qRedirect).state} ${task(qRedirect).error ?? ""}`);

quiet.log("\n6. a figure the data does not hold");
a = await make({ kind: "ask", prompt: "How many specimen findings are critical?", context: "issues", depth: "quick" });
const qFig = a.json?.task?.id as number;
canned = () => "There are 9137 critical findings.";
await runner();
check("an answer quoting a figure the data does not hold is refused", task(qFig).state === "queued" && /9137/.test(task(qFig).retry_note ?? ""), task(qFig).retry_note ?? "");
canned = () => "There is 1 critical finding, on /about, out of 9137 in all.";
await runner();
const fig = task(qFig);
check(
  "the second time it is kept, with the stray figure removed and named",
  fig.state === "done" && fig.result_text.includes("[?]") && !fig.result_text.includes("9137") && JSON.parse(fig.result_data).flags[0]?.includes("9137"),
  fig.result_text,
);

quiet.log("\n7. an audit keeps the crawl's rules; a failed task");
{
  /* Without a fresh crawl an audit would start one: it may not when the owner switched the crawl off, or when one failed minutes ago. */
  const finishedAt = (db.prepare("SELECT value FROM cc_state WHERE key = 'site:crawl:finished'").get() as any).value as string;
  db.prepare("UPDATE cc_state SET value = ? WHERE key = 'site:crawl:finished'").run(new Date(Date.now() - 3_600_000).toISOString());
  db.prepare("UPDATE cc_jobs SET enabled = 0 WHERE name = 'crawl'").run();
  a = await make({ kind: "audit", depth: "quick" });
  check("with the crawl switched off by the owner, an audit is refused, not crawled anyway (409)", a.status === 409 && /switched the crawl off/.test(a.json?.error ?? ""), show(a));
  db.prepare("UPDATE cc_jobs SET enabled = 1, last_start = ?, last_ok = 0, last_note = 'specimen failure' WHERE name = 'crawl'").run(new Date(Date.now() - 2 * 60_000).toISOString());
  a = await make({ kind: "audit", depth: "quick" });
  check("a crawl that failed minutes ago is not started again at once (429)", a.status === 429 && /specimen failure/.test(a.json?.error ?? ""), show(a));
  db.prepare("UPDATE cc_jobs SET last_start = NULL, last_ok = NULL, last_note = NULL WHERE name = 'crawl'").run();
  db.prepare("UPDATE cc_state SET value = ? WHERE key = 'site:crawl:finished'").run(finishedAt);
  /* An audit whose crawl finished while the workstation was off: reading the screen moves it on. */
  const before = new Date(Date.parse(finishedAt) - 60_000).toISOString();
  const waited = Number(
    db
      .prepare("INSERT INTO cc_ai_tasks (kind, prompt, options, pack, state, stage, asked_by, created_at) VALUES ('audit', 'Run a full SEO audit', ?, NULL, 'queued', 'crawl', 'Specimen Owner', ?)")
      .run(JSON.stringify({ depth: "quick", range: "30d", crawlAsked: before }), before).lastInsertRowid,
  );
  a = await ask("/api/v1/operator/live", { who: owner });
  const moved = a.json?.tasks?.find((t: any) => t.id === waited);
  check("an audit whose crawl finished meanwhile waits for the workstation, not the crawl, once the screen is read", moved?.stage === null && JSON.parse(task(waited).pack ?? "null")?.blocks?.[0]?.name === "issues", JSON.stringify(moved));
  await ask(`/api/v1/operator/tasks/${waited}/cancel`, { who: owner, method: "POST" });
}
a = await make({ kind: "audit", depth: "quick" });
const qAudit = a.json?.task?.id as number;
check("an audit with a fresh crawl is queued at once, with the findings", a.status === 202 && task(qAudit).stage === null && JSON.parse(task(qAudit).pack).blocks[0].name === "issues", show(a));
canned = () => new Error("Ollama is not answering at http://127.0.0.1:11434 (specimen). Start it, then try again.");
await runner();
check("the model's failure is a failed task with its reason", task(qAudit).state === "failed" && /Ollama is not answering/.test(task(qAudit).error), task(qAudit).error);
a = await ask("/api/v1/operator", { who: owner });
check("and the actions say so", a.json?.actions?.some((x: any) => x.text.startsWith("Could not finish")), JSON.stringify(a.json?.actions?.map((x: any) => x.text)));

quiet.log("\n8. a running task's answer after Stop is discarded");
a = await make({ kind: "ask", prompt: "Which specimen page is the home page?", context: "pages", depth: "quick" });
const qStop = a.json?.task?.id as number;
canned = () => "The home page is /.";
await operatorOnce({
  desk: BASE,
  name: "specimen-runner",
  secret: RUNNER,
  log: () => {},
  ensure: async () => ({ ok: true }),
  ask: async () => {
    await ask(`/api/v1/operator/tasks/${qStop}/cancel`, { who: owner, method: "POST" });
    return { text: "The home page is /.", model: "specimen", ms: 10, tokensIn: 1, tokensOut: 1 };
  },
});
check("Stop while running marks it cancelled and its answer is discarded", task(qStop).state === "cancelled" && task(qStop).result_text === null, task(qStop).state);

quiet.log("\n9. a task left running is reclaimed");
a = await make({ kind: "ask", prompt: "Which specimen page has no description?", context: "pages", depth: "quick" });
const qLost = a.json?.task?.id as number;
a = await ask("/runner/op/next", { method: "POST", runner: true, body: { name: "restarting-runner" } });
check("the runner takes it", a.json?.task?.id === qLost && task(qLost).state === "running");
a = await ask("/runner/op/next", { method: "POST", runner: true, body: { name: "restarting-runner" } });
check("restarted, the same runner asks again and is handed the same task (attempt 2)", a.json?.task?.id === qLost && a.json.task.attempt === 2, show(a));
/* The workstation goes quiet mid-answer: past the longest an answer takes, the screen stops saying it works. */
db.prepare("UPDATE cc_ai_tasks SET taken_at = ?, runner = 'vanished-runner' WHERE id = ?").run(new Date(Date.now() - 9 * 60_000).toISOString(), qLost);
setOpSeen(20);
a = await ask("/api/v1/operator/live", { who: owner });
const lostRow = a.json?.tasks?.find((t: any) => t.id === qLost);
check(
  "a running task past the longest answer shows lost contact, and no 'Analyzing' chip",
  lostRow?.state === "running" && typeof lostRow.lost?.backAt === "string" && a.json.working === null,
  JSON.stringify({ lost: lostRow?.lost, working: a.json?.working }),
);
check("and the workstation is not called online for it", a.json?.runner?.state === "off", `${a.json?.runner?.state}: ${a.json?.runner?.line}`);
db.prepare("UPDATE cc_ai_tasks SET taken_at = ? WHERE id = ?").run(new Date(Date.now() - 20 * 60_000).toISOString(), qLost);
a = await ask("/api/v1/operator/live", { who: owner });
check("after fifteen minutes the screen itself puts it back in the queue", task(qLost).state === "queued" && a.json?.tasks?.find((t: any) => t.id === qLost)?.state === "queued", task(qLost).state);
a = await ask("/runner/op/next", { method: "POST", runner: true, body: { name: "another-runner" } });
check("a runner that vanished loses it after fifteen minutes", a.json?.task?.id === qLost && a.json.task.attempt === 3, show(a));
a = await ask(`/runner/op/result/${qLost}`, { method: "POST", runner: true, body: { ok: true, text: "/specimen-b has no description." } });
check("and its answer is taken", a.status === 200 && task(qLost).state === "done", show(a));

quiet.log("\n10. approving, refusing, withdrawing");
const metaA = waiting[0].id as number;
a = await ask(`/api/v1/operator/proposals/${metaA}/approve`, { who: helper, method: "POST" });
check("a person who cannot publish cannot approve (403)", a.status === 403 && /cannot publish/.test(a.json?.error ?? ""), show(a));
a = await ask(`/api/v1/operator/proposals/${metaA}/approve`, { who: owner, method: "POST" });
check("the owner approves: applied, with a commit", a.status === 200 && a.json.proposal.state === "applied" && typeof a.json.proposal.sha === "string", show(a));
const onRemote = (file: string) => git(["--git-dir", remote, "show", `main:${file}`]);
let overrides = JSON.parse(onRemote("content/desk/overrides.json"));
check("the remote's overrides.json holds the one entry, without the brand", overrides.meta["/specimen-a"]?.title === "Specimen page A" && overrides.redirects.length === 0, JSON.stringify(overrides));
const msg = git(["--git-dir", remote, "log", "-1", "--format=%s%n%b%n%an <%ae>"]);
check(
  "its commit says what, where, proposed by whom and approved by whom, as the approver",
  msg.startsWith("Desk: new title for /specimen-a") && msg.includes("Specimen page A, with a title") && msg.includes("AI operator (task #") && msg.includes("approved by Specimen Owner") && msg.includes("owner@desk.test"),
  msg.split("\n").slice(0, 3).join(" | "),
);
a = await ask(`/api/v1/operator/proposals/${red.id}/approve`, { who: owner, method: "POST" });
overrides = JSON.parse(onRemote("content/desk/overrides.json"));
check("the redirect is applied beside it", a.status === 200 && overrides.redirects[0]?.from === "/old-services" && overrides.redirects[0]?.to === "/services" && overrides.meta["/specimen-a"], JSON.stringify(overrides));
a = await ask("/api/v1/operator/proposals", { who: helper, method: "POST", body: { from: "/services", to: "/about" } });
check("a redirect from an address in the sitemap is refused", a.status === 409 && /sitemap/.test(a.json?.error ?? ""), show(a));
a = await ask("/api/v1/operator/proposals", { who: helper, method: "POST", body: { from: "/old-thing", to: "/nowhere" } });
check("a redirect to a page that does not answer is refused", a.status === 409, show(a));
a = await ask("/api/v1/operator/proposals", { who: helper, method: "POST", body: { from: "/api/apply", to: "/about" } });
check("a redirect from the website's own machine addresses is refused", a.status === 409 && /machine addresses/.test(a.json?.error ?? ""), show(a));
a = await ask("/api/v1/operator/proposals", { who: helper, method: "POST", body: { from: "/hidden-live", to: "/about" } });
check("a redirect from a live page the crawl never reached is refused: the live site is asked", a.status === 409 && /answers 200 on the live site/.test(a.json?.error ?? "") && asked.includes("/hidden-live"), show(a));
a = await ask("/api/v1/operator/proposals", { who: helper, method: "POST", body: { from: "/moved", to: "/services" } });
check("so is one from an address that already redirects", a.status === 409 && /already redirects on the live site to \/about/.test(a.json?.error ?? ""), show(a));
a = await ask("/api/v1/operator/proposals", { who: helper, method: "POST", body: { from: "/old-thing", to: "/about" } });
check("a plain one by hand, from an address that answers 404, waits for approval", a.status === 201 && a.json.proposal.state === "waiting" && a.json.proposal.source === "person", show(a));
a = await ask(`/api/v1/operator/proposals/${a.json?.proposal?.id}/reject`, { who: helper, method: "POST" });
check("and can be rejected by anybody signed in", a.status === 200 && a.json.proposal.state === "rejected", show(a));

/* An approval cut off by a restart: still "approved" minutes later, with no error. */
a = await ask("/api/v1/operator/proposals", { who: helper, method: "POST", body: { from: "/old-thing-two", to: "/about" } });
const cut = a.json?.proposal?.id as number;
db.prepare("UPDATE cc_proposals SET state = 'approved', decided_by = 'Specimen Owner', decided_at = ? WHERE id = ?").run(new Date(Date.now() - 10 * 60_000).toISOString(), cut);
a = await ask(`/api/v1/operator/proposals/${cut}`, { who: owner });
check("an approval cut off by a restart is offered again, saying so", a.json?.state === "approved" && /stopped while applying/.test(a.json?.error ?? ""), show(a));
a = await ask(`/api/v1/operator/proposals/${cut}/reject`, { who: owner, method: "POST" });
check("and, not being on the site, it can be rejected", a.status === 200 && a.json.proposal.state === "rejected", show(a));
/* One whose push did reach the site before the desk stopped. */
db.prepare("UPDATE cc_proposals SET state = 'approved', decided_at = ?, sha = NULL WHERE id = ?").run(new Date(Date.now() - 10 * 60_000).toISOString(), red.id);
a = await ask(`/api/v1/operator/proposals/${red.id}/reject`, { who: owner, method: "POST" });
check("one cut off after its push is not rejected: its change is on the site", a.status === 409 && /in the site's file already/.test(a.json?.error ?? ""), show(a));
a = await ask(`/api/v1/operator/proposals/${red.id}/approve`, { who: owner, method: "POST" });
check("applied again, it is recorded as live and nothing new is committed", a.status === 200 && a.json.proposal.state === "applied" && /already said this/.test(a.json.proposal.note ?? ""), show(a));
a = await ask(`/api/v1/operator/proposals/${metaA}/withdraw`, { who: owner, method: "POST" });
overrides = JSON.parse(onRemote("content/desk/overrides.json"));
check("withdrawn, the entry is removed and the redirect stays", a.status === 200 && a.json.proposal.state === "withdrawn" && !overrides.meta["/specimen-a"] && overrides.redirects.length === 1, JSON.stringify(overrides));
check("its commit says so", git(["--git-dir", remote, "log", "-1", "--format=%s"]).startsWith("Desk: withdraw the title for /specimen-a"));

/* The page's words changed after the proposal (a person edited them in the website's code; the crawl read it). */
const metaB = waiting[1].id as number;
db.prepare("UPDATE cc_pages SET descr = ? WHERE path = '/specimen-b'").run("A specimen description a person wrote into the page after the proposal was made.");
a = await ask(`/api/v1/operator/proposals/${metaB}`, { who: owner });
check("a waiting change whose page changed since says what the page says now", /a person wrote into the page/.test(a.json?.drift?.description ?? ""), JSON.stringify(a.json?.drift));
a = await ask(`/api/v1/operator/proposals/${metaB}/approve`, { who: owner, method: "POST" });
check("and approving it is refused rather than replacing newer words (409)", a.status === 409 && /changed since this was proposed/.test(a.json?.error ?? ""), show(a));
db.prepare("UPDATE cc_pages SET descr = NULL WHERE path = '/specimen-b'").run();

/* The development copy's guard: point the scratch clone at a remote that is not on this machine. */
const site = process.env.SITE_REPO!;
git(["-C", site, "remote", "set-url", "origin", "git@github.com:specimen/not-a-real-site.git"]);
a = await ask(`/api/v1/operator/proposals/${metaB}/approve`, { who: owner, method: "POST" });
check("a development copy whose site folder pushes elsewhere refuses to approve", a.status === 409 && /development copy/.test(a.json?.error ?? ""), show(a));
check("and the proposal is still waiting", (db.prepare("SELECT state FROM cc_proposals WHERE id = ?").get(metaB) as any).state === "waiting");
/* As on the workstation: the site folder's remote is a working copy of the website on this machine, not a scratch bare repository. */
git(["-C", site, "remote", "set-url", "origin", seed]);
a = await ask(`/api/v1/operator/proposals/${metaB}/approve`, { who: owner, method: "POST" });
check("so does one whose remote is a working copy on this machine", a.status === 409 && /development copy/.test(a.json?.error ?? ""), show(a));
git(["-C", site, "remote", "set-url", "origin", pathToFileURL(remote).href]);

a = await ask("/api/v1/operator", { who: owner });
check("the screen shows the change in Approved and the withdrawal in Completed", a.json?.approvals?.approved?.some((p: any) => p.address === "/old-services") && a.json.approvals.completed.some((p: any) => p.address === "/specimen-a" && p.state === "withdrawn"));
{
  const h = await ask("/api/v1/operator/history?tab=actions", { who: owner });
  check(
    "and the actions name them",
    a.json?.actions?.some((x: any) => x.text === "Withdrew the title for /specimen-a") && h.json?.actions?.some((x: any) => x.text === "Applied a redirect from /old-services"),
    JSON.stringify(h.json?.actions?.map((x: any) => x.text).slice(0, 8)),
  );
}
check(
  "the tabs count proposals in the database",
  a.json?.approvals?.counts?.completed === (db.prepare("SELECT COUNT(*) AS n FROM cc_proposals WHERE state IN ('withdrawn','rejected')").get() as any).n &&
    a.json.approvals.counts.waiting === (db.prepare("SELECT COUNT(*) AS n FROM cc_proposals WHERE state = 'waiting'").get() as any).n,
  JSON.stringify(a.json?.approvals?.counts),
);
a = await ask("/api/v1/operator/history?tab=tasks", { who: owner });
check(
  "history lists every task, and counts them in the database",
  a.status === 200 && a.json.tasks.length >= 8 && a.json.counts.results >= 4 && a.json.counts.tasks === (db.prepare("SELECT COUNT(*) AS n FROM cc_ai_tasks").get() as any).n && a.json.most === 100,
  show(a),
);
a = await ask(`/api/v1/operator/tasks/${qMeta}`, { who: owner });
check("a result says which data it was given and from when", a.status === 200 && a.json.given[0]?.source === "crawl" && typeof a.json.given[0]?.asOf === "string" && a.json.proposals.length === 2, show(a));

quiet.log("\n11. the to-do list");
a = await ask("/api/v1/operator/todos", { who: helper, method: "POST", body: { title: "Specimen: check the specimen redirect", note: "A note" } });
const todo = a.json?.todo?.id;
check("a to-do is added", a.status === 201 && a.json.todo.who === "Specimen Helper", show(a));
a = await ask(`/api/v1/operator/todos/${todo}`, { who: owner, method: "POST", body: { done: true } });
check("and done, by whom", a.status === 200 && a.json.todo.done === true && a.json.todo.doneBy === "Specimen Owner", show(a));

quiet.log("\n12. a fault in the operator's door never costs the article runner");
let threw = false;
let did: boolean | null = null;
try {
  /* A desk that answers this door with an error (as a box without these routes answers 404). */
  did = await operatorOnce({ desk: `${BASE}/no-such-door`, name: "specimen-runner", secret: RUNNER, log: () => {}, ensure: async () => ({ ok: true }), ask: async () => ({ text: "", model: "x", ms: 1, tokensIn: 1, tokensOut: 1 }) });
} catch {
  threw = true;
}
check("an error from the door is 'nothing done', not 'desk unreachable'", did === false && !threw, `did ${did}, threw ${threw}`);
threw = false;
try {
  await operatorOnce({ desk: BASE, name: "specimen-runner", secret: "not-the-secret", log: () => {}, ensure: async () => ({ ok: true }) });
} catch {
  threw = true;
}
check("a refused secret still reaches the runner's loop", threw);

/* ============ 13. the website's overrides v2: share cards, search, canonicals, structured data ============ */
quiet.log("\n13. overrides v2: every new kind of change, by hand, through the one door");
const sharp = (await import("sharp")).default;
db.prepare("DELETE FROM cc_cache WHERE key LIKE 'op:excerpt:%'").run();
const tree = () => git(["--git-dir", remote, "ls-tree", "-r", "--name-only", "main"]).split("\n");
const b64 = (b: Buffer) => b.toString("base64");
TEXT["/about"] =
  "About the specimen studio. The specimen studio is a small team that builds specimen websites for specimen businesses. The team works from one specimen office and answers every enquiry within a day.";
FILES["/og/about.jpg"] = { type: "image/jpeg", body: new Uint8Array(await sharp({ create: { width: 1200, height: 630, channels: 3, background: { r: 40, g: 40, b: 40 } } }).jpeg().toBuffer()) };

/* A phone photo stored on its side (EXIF orientation 6): upright it is 1600 by 900, and it is made 1200 by 630. */
const sideways = await sharp({ create: { width: 900, height: 1600, channels: 3, background: { r: 200, g: 120, b: 60 } } }).jpeg({ quality: 70 }).withMetadata({ orientation: 6 }).toBuffer();
a = await ask("/api/v1/operator/pictures", { who: helper, method: "POST", body: { address: "/services", data: b64(sideways) } });
const pic = a.json?.picture;
check(
  "a share picture is taken: upright, 1200 by 630, named by the page and a hash of its bytes",
  a.status === 201 && pic?.width === 1200 && pic?.height === 630 && pic?.format === "jpeg" && /^services-[0-9a-f]{8}\.jpg$/.test(pic?.name ?? "") && pic.sitePath === `/desk/og/${pic.name}`,
  show(a),
);
a = await ask(pic ? pic.url : "/nothing", { who: helper });
check("the desk serves it until it is committed", a.status === 200, `${a.status}`);
const noise = await sharp({ create: { width: 1400, height: 1400, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 60 } } }).png().toBuffer();
a = await ask("/api/v1/operator/pictures", { who: helper, method: "POST", body: { address: "/services", data: b64(noise) } });
check("a picture over 600 KB is refused with its size", a.status === 400 && /600 KB/.test(a.json?.error ?? ""), show(a));
a = await ask("/api/v1/operator/pictures", { who: helper, method: "POST", body: { address: "/services", data: b64(await sharp({ create: { width: 400, height: 200, channels: 3, background: "#888" } }).png().toBuffer()) } });
check("so is one too small for a share card", a.status === 400 && /600 by 315/.test(a.json?.error ?? ""), show(a));
a = await ask("/api/v1/operator/pictures", { who: helper, method: "POST", body: { address: "/services", data: b64(Buffer.from("not a picture at all, only words in a file")) } });
check("and a file that is not a picture", a.status === 400, show(a));

const propose = (body: object, who: Person = helper) => ask("/api/v1/operator/proposals", { who, method: "POST", body });
a = await propose({ kind: "og", address: "/services", ogTitle: "Specimen services", ogImage: pic?.sitePath });
check("a share title that copies the page's title is refused: it adds nothing", a.status === 409 && /same as the page's title/.test(a.json?.error ?? ""), show(a));
a = await propose({ kind: "og", address: "/services", ogImage: "/desk/og/never-uploaded-1234abcd.jpg" });
check("a desk picture that was never uploaded is refused", a.status === 409 && /upload it again/.test(a.json?.error ?? ""), show(a));
a = await propose({ kind: "og", address: "/services", ogImage: "/og/About.JPG" });
check("a picture address the website would ignore is refused before anyone approves it", a.status === 409 && /picture address/.test(a.json?.error ?? ""), show(a));
a = await propose({ kind: "og", address: "/services", ogTitle: "Specimen websites, built with you", ogDescription: "How a specimen project runs, from the first workshop to the reports after launch.", ogImage: pic?.sitePath });
const og = a.json?.proposal;
check(
  "a share card is proposed by hand, saying what changes, the picture as a picture",
  a.status === 201 && og?.kind === "og" && og.state === "waiting" && og.picture?.name === pic?.name && og.changes.some((c: any) => c.look === "picture" && c.after === pic?.url) && /share picture/.test(og.consequence),
  show(a),
);
a = await propose({ kind: "og", address: "/services", ogTitle: "Specimen websites, built with you", ogDescription: "How a specimen project runs, from the first workshop to the reports after launch.", ogImage: pic?.sitePath });
check("pressing twice never makes a twin", a.status === 409 && /already waits/.test(a.json?.error ?? ""), show(a));
a = await propose({ kind: "og", address: "/about", ogImage: "/og/about.jpg" });
const ogSite = a.json?.proposal;
check("a picture already on the site is read from it and checked", a.status === 201 && ogSite?.picture === null && ogSite.after.ogImage === "/og/about.jpg", show(a));

a = await ask(`/api/v1/operator/proposals/${og?.id}/approve`, { who: helper, method: "POST" });
check("a person who cannot publish cannot approve a share card (403)", a.status === 403, show(a));
a = await ask(`/api/v1/operator/proposals/${og?.id}/approve`, { who: owner, method: "POST" });
overrides = JSON.parse(onRemote("content/desk/overrides.json"));
check(
  "approved: the entry and the picture go to the site in one commit",
  a.status === 200 &&
    a.json.proposal.state === "applied" &&
    overrides.meta["/services"]?.ogImage === pic?.sitePath &&
    overrides.meta["/services"]?.ogTitle === "Specimen websites, built with you" &&
    tree().includes(`public${pic?.sitePath}`),
  show(a),
);
{
  const m = git(["--git-dir", remote, "log", "-1", "--format=%s%n%b", "--name-only"]);
  check("its commit names the change, who proposed it and who approved it", m.startsWith("Desk: new share card for /services") && m.includes("Proposed by Specimen Helper") && m.includes("approved by Specimen Owner") && m.includes(`public${pic?.sitePath}`), m.slice(0, 200));
}

/* Read back after the deploy: first a page that does not show it, then one that does. */
FILES["/sitemap.xml"] = { type: "application/xml", body: `<urlset>${["/", "/services", "/about", "/specimen-a", "/specimen-b"].map((p) => `<url><loc>https://www.balkaris.ch${p === "/" ? "" : p}</loc></url>`).join("")}</urlset>` };
a = await ask(`/api/v1/operator/proposals/${og?.id}/check`, { who: helper, method: "POST" });
check("read back, a page that does not show the change says which fields are missing", a.status === 200 && a.json.proposal.readBack?.ok === false && a.json.proposal.readBack.missing.length >= 3, show(a));
HEADS["/services"] = [
  '<meta property="og:title" content="Specimen websites, built with you">',
  '<meta name="twitter:title" content="Specimen websites, built with you">',
  '<meta property="og:description" content="How a specimen project runs, from the first workshop to the reports after launch.">',
  '<meta name="twitter:description" content="How a specimen project runs, from the first workshop to the reports after launch.">',
  `<meta property="og:image" content="https://www.balkaris.ch${pic?.sitePath}">`,
  `<meta name="twitter:image" content="https://www.balkaris.ch${pic?.sitePath}">`,
  '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
].join("");
a = await ask(`/api/v1/operator/proposals/${og?.id}/check`, { who: helper, method: "POST" });
check("and once the page shows it, it says so", a.status === 200 && a.json.proposal.readBack?.ok === true, show(a));

/* In and out of search. */
a = await propose({ kind: "index", address: "/", noindex: true });
check("the home page can never be taken out of search, and the refusal says what it would do", a.status === 409 && /home page/.test(a.json?.error ?? "") && /sitemap/.test(a.json?.error ?? ""), show(a));
a = await propose({ kind: "index", address: "/about", noindex: false });
check("a page the desk never took out of search cannot be put back", a.status === 409 && /never took/.test(a.json?.error ?? ""), show(a));
a = await propose({ kind: "index", address: "/about", noindex: true });
const outOf = a.json?.proposal;
check("taking a page out of search says it leaves the sitemap", a.status === 201 && /leaves the sitemap/.test(outOf?.consequence ?? ""), show(a));
a = await propose({ kind: "canonical", address: "/about", canonical: "/services" });
check("a page going out of search gets no canonical beside it", a.status === 409 && /never both/.test(a.json?.error ?? ""), show(a));
a = await ask(`/api/v1/operator/proposals/${outOf?.id}/approve`, { who: owner, method: "POST" });
overrides = JSON.parse(onRemote("content/desk/overrides.json"));
check("approved, the file says noindex: true and nothing else changes", a.status === 200 && overrides.meta["/about"]?.noindex === true && overrides.meta["/services"]?.ogImage === pic?.sitePath, JSON.stringify(overrides.meta));
a = await propose({ kind: "index", address: "/about", noindex: false });
check("now it can be put back", a.status === 201 && a.json.proposal.after.noindex === false, show(a));
await ask(`/api/v1/operator/proposals/${a.json?.proposal?.id}/reject`, { who: helper, method: "POST" });

/* Canonicals. */
a = await propose({ kind: "canonical", address: "/specimen-b", canonical: "/specimen-b" });
check("a page cannot name itself", a.status === 409, show(a));
a = await propose({ kind: "canonical", address: "/specimen-b", canonical: "/about" });
check("nor point at a page that is out of search", a.status === 409 && /out of search/.test(a.json?.error ?? ""), show(a));
a = await propose({ kind: "canonical", address: "/specimen-b", canonical: "/nowhere" });
check("nor at an address not in the sitemap", a.status === 409 && /not in the sitemap/.test(a.json?.error ?? ""), show(a));
a = await propose({ kind: "canonical", address: "/specimen-b", canonical: "/services" });
const canon = a.json?.proposal;
check("a canonical to a live page in the sitemap is proposed", a.status === 201 && canon?.after.canonical === "/services", show(a));
a = await propose({ kind: "canonical", address: "/specimen-a", canonical: "/specimen-b" });
check("a chain is refused", a.status === 409 && /chain|canonical of its own/.test(a.json?.error ?? ""), show(a));
a = await ask(`/api/v1/operator/proposals/${canon?.id}/approve`, { who: owner, method: "POST" });
overrides = JSON.parse(onRemote("content/desk/overrides.json"));
check("approved, the canonical is in the file", a.status === 200 && overrides.meta["/specimen-b"]?.canonical === "/services", show(a));

/* Structured data: only what the page says. */
const faq = (q: string, ans: string) => ({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: ans } }] });
a = await propose({ kind: "schema", address: "/services", jsonLd: faq("How fast is a first draft?", "We deliver a first specimen draft within 3 weeks.") });
check("a block with a figure the page does not say is refused", a.status === 409 && /does not say/.test(a.json?.error ?? ""), show(a));
a = await propose({ kind: "schema", address: "/services", jsonLd: faq("Who runs the project?", "Our partner Specimenco runs every specimen project.") });
check("so is one naming what the page does not mention", a.status === 409 && /does not mention/.test(a.json?.error ?? ""), show(a));
a = await propose({ kind: "schema", address: "/services", jsonLd: { "@context": "https://schema.org", "@type": "Organization", name: "Balkaris" } });
check("the company's own Organization is never repeated", a.status === 409 && /#organization/.test(a.json?.error ?? ""), show(a));
a = await propose({ kind: "schema", address: "/services", jsonLd: { "@context": "http://schema.org", "@type": "FAQPage" } });
check("a block the website would skip is refused", a.status === 409 && /@context/.test(a.json?.error ?? ""), show(a));
a = await propose({ kind: "schema", address: "/services", jsonLd: "{ not json" });
check("written by hand, text that is not JSON is refused with the reason (400)", a.status === 400 && /not valid JSON/.test(a.json?.error ?? ""), show(a));
a = await propose({ kind: "schema", address: "/services", jsonLd: JSON.stringify(faq("How does a specimen project start?", "Every specimen project starts with a short workshop about your goals.")) });
const sch = a.json?.proposal;
check("a FAQ from the page's own words is proposed, drawn as code", a.status === 201 && sch?.changes?.[0]?.look === "code", show(a));
a = await ask(`/api/v1/operator/proposals/${sch?.id}/approve`, { who: owner, method: "POST" });
overrides = JSON.parse(onRemote("content/desk/overrides.json"));
check("approved, the block is in the page's jsonLd list", a.status === 200 && overrides.meta["/services"]?.jsonLd?.[0]?.["@type"] === "FAQPage" && overrides.meta["/services"].ogTitle, JSON.stringify(overrides.meta["/services"]));

/* Withdraw: the fields go, and the picture with them. */
a = await ask(`/api/v1/operator/proposals/${og?.id}/withdraw`, { who: owner, method: "POST" });
overrides = JSON.parse(onRemote("content/desk/overrides.json"));
check(
  "withdrawn, the share card leaves the file and its picture leaves the site in the same commit",
  a.status === 200 && a.json.proposal.state === "withdrawn" && !overrides.meta["/services"]?.ogImage && !overrides.meta["/services"]?.ogTitle && overrides.meta["/services"]?.jsonLd && !tree().includes(`public${pic?.sitePath}`),
  JSON.stringify(overrides.meta["/services"]),
);
for (const id of [sch?.id, canon?.id, outOf?.id]) await ask(`/api/v1/operator/proposals/${id}/withdraw`, { who: owner, method: "POST" });
overrides = JSON.parse(onRemote("content/desk/overrides.json"));
check("every withdrawal undoes its own field and leaves the file valid", !overrides.meta["/services"] && !overrides.meta["/about"] && !overrides.meta["/specimen-b"], JSON.stringify(overrides));

/* The drift bug of the audit: the website now adds the brand only where it fits, so the same words without it are the same title. */
db.prepare("UPDATE cc_pages SET title = 'Specimen page A, with a title that runs far past where a search result cuts it off' WHERE path = '/specimen-a'").run();
const driftId = Number(
  db
    .prepare("INSERT INTO cc_proposals (kind, address, before_json, after_json, why, source, proposed_by, state, created_at) VALUES ('meta', '/specimen-a', ?, ?, NULL, 'person', 'Specimen Helper', 'waiting', ?)")
    .run(JSON.stringify({ title: "Specimen page A, with a title that runs far past where a search result cuts it off | Balkaris" }), JSON.stringify({ title: "Specimen page A, shorter" }), new Date().toISOString()).lastInsertRowid,
);
a = await ask(`/api/v1/operator/proposals/${driftId}`, { who: owner });
check("a title that differs only by the brand the site adds is not 'changed since'", a.status === 200 && a.json.drift === null, JSON.stringify(a.json?.drift));
a = await propose({ kind: "meta", address: "/specimen-a", title: "Specimen page A, shorter" });
check("and a person's meta proposal that repeats a waiting one is refused", a.status === 409 && /already waits/.test(a.json?.error ?? ""), show(a));
db.prepare("UPDATE cc_proposals SET state = 'rejected' WHERE id = ?").run(driftId);

/* ============ 14. the local model's new tasks ============ */
quiet.log("\n14. the local model's page and search tasks");
db.prepare("UPDATE cc_pages SET facts = json_set(facts, '$.images', json(?)) WHERE path = '/about'").run(
  JSON.stringify([{ file: "/work/specimen-team-at-work.jpg", remote: null, via: "direct", alt: "absent", width: null, height: null, loading: null, hidden: false, place: "main", unnamedLink: false }]),
);
const day = new Date().toISOString();
const kw1 = Number(db.prepare("INSERT INTO cc_seo_keywords (phrase, sources, status, first_seen, last_seen) VALUES ('specimen website design', 'manual', 'unjudged', ?, ?)").run(day, day).lastInsertRowid);
const kw2 = Number(db.prepare("INSERT INTO cc_seo_keywords (phrase, sources, status, first_seen, last_seen) VALUES ('free specimen games', 'manual', 'unjudged', ?, ?)").run(day, day).lastInsertRowid);
db.prepare("INSERT INTO cc_seo_clusters (key, name, lang, priority, source, first_seen, updated_at) VALUES ('specimen-design', 'Specimen design', 'en', 'high', 'manual', ?, ?)").run(day, day);
const serpRow = Number(
  db
    .prepare("INSERT INTO cc_seo_serp_checks (phrase, lang, country, engine, state, source, requested_by, requested_at, done_at, result, own_position) VALUES ('specimen website design', 'en', 'ch', 'google', 'done', 'server', 'Specimen Owner', ?, ?, ?, NULL)")
    .run(day, day, JSON.stringify({ organic: [{ position: 1, title: "Specimen design studio", url: "https://specimen-rival.test/design", host: "specimen-rival.test", snippet: "Prices from the first call." }], localPack: [], ads: 0, adHosts: [], related: [], questions: [] }))
    .lastInsertRowid,
);
db.prepare("INSERT INTO cc_seo_comp_pages (url, domain, address, query, status, title, h1, words, schema, price_text, added_at) VALUES ('https://specimen-rival.test/design', 'specimen-rival.test', 'ranking', 'specimen website design', 200, 'Specimen design studio', 'Design', 1800, '[\"FAQPage\"]', 'from 900', ?)").run(day);
db.prepare("UPDATE cc_seo_keywords SET page = '/services' WHERE id = ?").run(kw1);

a = await make({ kind: "og" });
check("a page task without a page is refused (400)", a.status === 400 && /which page/.test(a.json?.error ?? ""), show(a));
a = await make({ kind: "schema", path: "/about", schemaType: "FAQPage" });
const tSchema = a.json?.task?.id;
check("a structured-data task is queued with the page's own text", a.status === 202 && JSON.parse(task(tSchema).pack).page?.own.includes("answers every enquiry within a day"), show(a));
const tOg = (await make({ kind: "og", path: "/about" })).json?.task?.id;
const tLinks = (await make({ kind: "links", path: "/services" })).json?.task?.id;
check("a links task is given candidates from the link graph", JSON.parse(task(tLinks).pack).linkFrom?.some((c: any) => c.path === "/about"), JSON.stringify(JSON.parse(task(tLinks).pack).linkFrom));
const tAlt = (await make({ kind: "alt", path: "/about" })).json?.task?.id;
const tKw = (await make({ kind: "keywords", ids: [kw1, kw2] })).json?.task?.id;
a = await make({ kind: "serp", serpId: serpRow });
const tSerp = a.json?.task?.id;
check("a results task is given the kept result page, their pages and ours", a.status === 202 && /OUR PAGE: \/services/.test(JSON.parse(task(tSerp).pack).blocks[0].text), show(a));

let ogAsked = 0;
canned = (prompt) => {
  if (prompt.includes("TASK: Write the share card")) {
    ogAsked++;
    return ogAsked === 1
      ? JSON.stringify({ ogTitle: "Over 500 specimen sites built by the studio", ogDescription: "A small team that builds specimen websites for specimen businesses, and answers within a day." })
      : JSON.stringify({ ogTitle: "The small team behind specimen websites", ogDescription: "A small team that builds specimen websites for specimen businesses, and answers every enquiry within a day." });
  }
  if (prompt.includes("questions a reader of the page"))
    return JSON.stringify({
      questions: [
        { question: "Who is the specimen studio?", answer: "The specimen studio is a small team that builds specimen websites for specimen businesses." },
        { question: "How fast does the team answer?", answer: "The team answers every enquiry within a day." },
      ],
    });
  if (prompt.includes("needs links from other pages")) return JSON.stringify({ links: [{ from: "/about", words: "specimen services", why: "A reader of the studio's story wants to see what it offers." }, { from: "/nowhere", words: "x y", why: "z" }] });
  if (prompt.includes("Write an alt text")) return JSON.stringify({ alts: [{ src: "/work/specimen-team-at-work.jpg", alt: "The specimen team at work" }] });
  if (prompt.includes("Judge each search phrase"))
    return JSON.stringify({
      phrases: [
        { phrase: "specimen website design", judgement: "relevant", topic: "Specimen design", newTopic: false, intent: "commercial", why: "It is what the studio offers." },
        { phrase: "free specimen games", judgement: "irrelevant", topic: "Games", newTopic: true, intent: "informational", why: "Nobody looking for games is a client." },
      ],
    });
  if (prompt.includes("Compare the FIRST RESULTS"))
    return JSON.stringify({ theyHave: [{ what: "The first result states a price from the first call.", seenOn: ["https://specimen-rival.test/design", "https://made-up.test/x"] }], outline: ["Say what a first workshop costs.", "Add a FAQ about timing."], notes: "Do not copy their prices." });
  return "Specimen answer.";
};
for (let i = 0; i < 12 && (await runner()); i++);
const res = async (id: number) => (await ask(`/api/v1/operator/tasks/${id}`, { who: owner })).json;
let r = await res(tOg);
check(
  "share card: a figure the page does not hold is sent back once; the second answer becomes a proposal",
  ogAsked === 2 && r?.task?.retried === true && r.proposals?.[0]?.kind === "og" && r.proposals[0].after.ogTitle === "The small team behind specimen websites",
  JSON.stringify({ ogAsked, retried: r?.task?.retried, p: r?.proposals?.[0]?.after }),
);
r = await res(tSchema);
check("structured data: the FAQ from the page's own words becomes a schema proposal", r?.proposals?.[0]?.kind === "schema" && r.proposals[0].after.jsonLd["@type"] === "FAQPage" && r.proposals[0].after.jsonLd.mainEntity.length === 2, JSON.stringify(r?.flags ?? r));
r = await res(tLinks);
check("links: an invented page is dropped on the last answer and named; the rest is a to-do for the website's code", r?.todos?.length === 1 && r.todos[0].page === "/about" && r.todosAdded === false && r.flags.some((f: string) => /nowhere/.test(f)), JSON.stringify(r?.todos ?? r));
a = await ask(`/api/v1/operator/tasks/${tLinks}/todos`, { who: helper, method: "POST" });
check("its to-dos are put on the list with one press", a.status === 200 && a.json.added === 1 && (db.prepare("SELECT COUNT(*) AS n FROM cc_todos WHERE title = 'Link /about to /services'").get() as any).n === 1, show(a));
a = await ask(`/api/v1/operator/tasks/${tLinks}/todos`, { who: helper, method: "POST" });
check("and only once", a.status === 409, show(a));
r = await res(tAlt);
check("alt texts: one per picture without one, as to-dos", r?.todos?.[0]?.note.includes("The specimen team at work"), JSON.stringify(r?.todos ?? r));
r = await res(tKw);
check(
  "keywords: each phrase judged, with its id, its topic (given or new) and intent",
  r?.keywords?.length === 2 && r.keywords.find((k: any) => k.id === kw1)?.topic === "Specimen design" && r.keywords.find((k: any) => k.id === kw2)?.newTopic === true,
  JSON.stringify(r?.keywords ?? r),
);
a = await ask("/api/v1/seo/keywords/bulk", { who: owner, method: "POST", body: { op: "irrelevant", ids: [kw2] } });
check("'Apply these judgements' is the Keywords screen's own bulk address", a.status === 200 && (db.prepare("SELECT status FROM cc_seo_keywords WHERE id = ?").get(kw2) as any)?.status === "irrelevant", show(a));
r = await res(tSerp);
check(
  "search results: what the first results have, naming only addresses it was given",
  r?.serp?.theyHave?.[0]?.seenOn?.join() === "https://specimen-rival.test/design" && r.serp.page === "/services" && r.serp.outline.length === 2,
  JSON.stringify(r?.serp ?? r),
);
a = await make({ kind: "keywords", ids: Array.from({ length: 31 }, (_, i) => i + 1) });
check("more than thirty phrases at once is refused (400)", a.status === 400, show(a));

/* The "View" link right after queueing: a task that has not finished is said to be waiting, not replaced by another's answer. */
const tWait = (await make({ kind: "ask", prompt: "Which specimen page is newest?", context: "pages" })).json?.task?.id;
a = await ask(`/api/v1/operator?result=${tWait}`, { who: owner });
check("?result= of an unfinished task shows it as pending, not another answer", a.status === 200 && a.json.pending?.id === tWait && a.json.answer === null && Array.isArray(a.json.serps), show(a));
await ask(`/api/v1/operator/tasks/${tWait}/cancel`, { who: owner, method: "POST" });

check("nothing tried to leave this machine", left.length === 0, left.slice(0, 4).join(", "));
await finish();
