/**
 * The AI Operator's machinery, end to end, without a model: a throwaway
 * database and a throwaway website repository in work/, the real server on
 * port 3434, and a fake runner that answers with canned text through the
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

const PORT = 3434;
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
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith(BASE)) return real(input as never, init);
  if (url.startsWith(SITE)) {
    const p = new URL(url).pathname.replace(/\/+$/, "") || "/";
    asked.push(p);
    const r = LIVE[p];
    if (Array.isArray(r)) return new Response(null, { status: r[0], headers: { location: r[1] } });
    if (r === 200) return new Response(`<html><body><main><h1>Specimen</h1><p>Specimen text for ${p}.</p></main></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
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

check("the server came up on port 3434", await until(async () => (await ask("/health").catch(() => null))?.status === 200));

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

check("nothing tried to leave this machine", left.length === 0, left.slice(0, 4).join(", "));
await finish();
