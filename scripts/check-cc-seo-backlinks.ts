/**
 * SEO › Backlinks, proved without Google, GA4, Bing or any website.
 *
 *   node --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-seo-backlinks.ts
 *   npm run check:seo-backlinks
 *
 * Nothing leaves this machine: a throwaway database, a guard on `fetch` that
 * refuses every host, and the wires of src/cc/seo/backlinks.ts and
 * src/cc/seo/presence.ts replaced by specimens. Every page, host, name and
 * figure in here is a SPECIMEN (specimen-a.example, "Specimen Studio"); none
 * of it describes the real website or its real profiles.
 *
 * What is proved:
 *   1. reading a page for links: every link to the website with its words
 *      and rel, comments and scripts are not the page, a robots meta tag
 *      makes every link unfollowed, a mention outside a link is counted;
 *   2. one reading after another: a link found is kept (live, found today),
 *      a later reading without it is "lost" with a notice, a page that cannot
 *      be read is unknown and never lost, robots.txt is obeyed before any
 *      request, a reading is kept for the day;
 *   3. what the desk will not read: its own site, internal names and
 *      addresses, other ports; and the hour's cap (429 with when to ask);
 *   4. following a link, and taking a never-linked one off the list;
 *   5. Search Console's Links export: each of the four tables told from its
 *      cells under any header language, the website's own rows left out, the
 *      day a site was first imported kept across imports, junk refused;
 *   6. the page: GA4's two reports of the same sessions taken per site and
 *      day, never summed; "ig" and l.instagram.com are instagram.com; an AI
 *      assistant only by its own host (thankyou.com is not You.com); a visit
 *      from a network is the studio's profile only when the profile's own
 *      address referred it; a pasted address is searched by its host; the
 *      window before is compared only from GA4's first whole day;
 *   7. Bing, connected, is read from what its job kept: no request while the
 *      page is drawn, and a link Bing no longer lists is lost, not counted;
 *   8. the pager and the CSVs: 50 rows a page, the export has every matching
 *      row, a phone keeps its "+", a formula still gets its quote;
 *   9. the profiles: Instagram's "not available" screen is not found, a page
 *      that does not name the profile is not "exists", a failed check keeps
 *      what the last one read and writes the status it got, a person's
 *      address goes through the guarded fetch, the website's imprint address
 *      is read; add, change, remove, an address found and confirmed; Check
 *      once a minute;
 *  10. the one true name, address and phone: the owner's only, one rule for
 *      "the same value", every profile marked the same or different, and
 *      taken back when all three are emptied;
 *  11. the daily job: registered for the SEO area, reads GA4's referring
 *      addresses (a page with a path becomes a page to read, a front door or
 *      a search does not) and reads the due linking pages again.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-seo-backlinks-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE = "https://www.balkaris.ch";
for (const k of ["GSC_SITE", "BING_API_KEY", "BING_SITE", "GOOGLE_API_KEY", "GA4_HOSTS", "SITE_READ_REPO", "SITE_REPO", "DESK_DEV_USER", "VERCEL_DRAIN_SECRET"]) delete process.env[k];
process.env.GA4_PROPERTY_ID = "1";
process.env.SITE_READ_CLONE = "off";
/* GA4 starts unconnected; section 6 gives it a specimen key file nothing can be signed with. */
const absentKey = path.join(dir, "absent.json");
const specimenKey = path.join(dir, "specimen-key.json");
writeFileSync(specimenKey, JSON.stringify({ client_email: "specimen@specimen.invalid", private_key: "specimen" }));
process.env.GA4_CREDENTIALS_FILE = absentKey;

/* ---- nothing leaves this machine ------------------------------------------ */
const refused: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  refused.push(url.split("?")[0]!);
  throw new Error(`the check tried to leave the machine: ${url.split("?")[0]}`);
}) as typeof fetch;

let passed = 0;
let failed = 0;
function check(name: string, good: boolean, detail?: unknown): void {
  if (good) passed++;
  else failed++;
  console.log(`${good ? "ok  " : "FAIL"} ${name}${!good && detail !== undefined ? `\n     ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
}
const section = (name: string) => console.log(`\n${name}`);

/* ---- the modules ------------------------------------------------------------ */
const { db } = await import("../src/db.ts");
const store = await import("../src/cc/store.ts");
await import("../src/cc/seo/tables.ts");
await import("../src/cc/seo/aisearch.ts");
const ga4 = await import("../src/cc/ga4.ts");
const L = await import("../src/cc/seo/backlinks.ts");
const P = await import("../src/cc/seo/presence.ts");
const bing = await import("../src/cc/search/bing.ts");
const seoJobs = await import("../src/cc/seo/jobs.ts");
const audit = await import("../src/cc/site/audit.ts");
const { routes } = await import("../src/cc/routes/seo/backlinks.ts");
const { apiError } = await import("../src/cc/api.ts");
const { Hono } = await import("hono");
import type { Person } from "../src/people.ts";
import type { Vars } from "../src/cc/access.ts";
import type { GuardedFetch } from "../src/cc/site/audit.ts";
import type { Fetched } from "../src/cc/seo/html.ts";
import type { SeoBacklinksPayload } from "../web/src/contract/seo/backlinks.ts";

const OWNER = { telegram: 1, name: "Specimen Owner", email: "owner@specimen.invalid", owner: true, canPublish: true, seesLeads: true } as unknown as Person;
const MEMBER = { telegram: 2, name: "Specimen Member", email: "member@specimen.invalid", owner: false, canPublish: false, seesLeads: false } as unknown as Person;

const app = new Hono<Vars>();
app.use("*", async (c, next) => {
  c.set("who", c.req.header("x-specimen-who") === "member" ? MEMBER : OWNER);
  await next();
});
app.route("/api/v1/seo/backlinks", routes);
app.onError(apiError);

async function ask<T = Record<string, unknown>>(p: string, o: { who?: "owner" | "member"; body?: unknown } = {}): Promise<{ status: number; json: T; text: string; headers: Headers }> {
  const res = await app.request(`/api/v1/seo/backlinks${p}`, {
    method: o.body !== undefined ? "POST" : "GET",
    headers: { "x-specimen-who": o.who ?? "owner", ...(o.body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
  });
  const text = await res.text();
  let json = {} as T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    /* a CSV */
  }
  return { status: res.status, json, text, headers: res.headers };
}
const page = async (q = ""): Promise<SeoBacklinksPayload> => {
  const r = await ask<SeoBacklinksPayload>(q ? `?${q}` : "");
  if (r.status !== 200) throw new Error(`GET /api/v1/seo/backlinks${q ? `?${q}` : ""} answered ${r.status}: ${r.text.slice(0, 300)}`);
  return r.json;
};
const count = (sql: string, ...a: (string | number)[]): number => (db.prepare(sql).get(...a) as { n: number }).n;

/* ---- the specimen web ------------------------------------------------------- */
type Answer = { status: number; body: string | null; url?: string; headers?: Record<string, string>; sent?: number };
const web = new Map<string, Answer>();
const robots = new Map<string, string>();
const asked: string[] = [];
L.wire.page = async (url: string): Promise<GuardedFetch> => {
  asked.push(url);
  const a = web.get(url) ?? { status: 404, body: null };
  return { url: a.url ?? url, status: a.status, hops: [], loop: false, headers: { "content-type": "text/html; charset=utf-8", ...(a.headers ?? {}) }, ttfb: 0, total: 0, bytes: (a.body ?? "").length, truncated: false, body: a.body, error: null, sent: a.sent ?? 1 };
};
L.wire.robots = async (origin: string) => robots.get(origin) ?? null;
L.wire.sleep = async () => {};
L.wire.ga4Ready = () => false;

const presenceAsks: { how: "plain" | "guarded"; url: string }[] = [];
const fetched = (url: string): Fetched => {
  const a = web.get(url) ?? { status: 404, body: null };
  return { status: a.status, url: a.url ?? url, html: a.body, contentType: "text/html", error: a.status ? null : "specimen: no answer" };
};
P.wire.fetchPage = async (url: string) => {
  presenceAsks.push({ how: "plain", url });
  return fetched(url);
};
P.wire.guarded = async (url: string) => {
  presenceAsks.push({ how: "guarded", url });
  return fetched(url);
};
P.wire.sleep = async () => {};

const today = store.today();
const day = (n: number) => store.today(n);

const PARTNER = `<!doctype html><html><head><title>Specimen partner page</title></head><body>
<!-- <a href="https://www.balkaris.ch/hidden">in a comment</a> -->
<script>var s = '<a href="https://www.balkaris.ch/in-a-script">x</a>';</script>
<p>We worked with Balkaris on this site.</p>
<a href="https://www.balkaris.ch/web-design-development">Web design by Balkaris</a>
<a href="https://balkaris.ch/kontakt" rel="nofollow">contact</a>
<a href="https://www.balkaris.ch/" rel="sponsored noopener"><img src="logo.png" alt="Specimen logo"></a>
<a href="https://www.balkaris.ch/web-design-development">Web design by Balkaris</a>
<a href="https://specimen-b.example/">another site</a>
<a href="/relative">a page of this site</a>
</body></html>`;

try {
  /* ============ 1. reading a page for links ================================== */
  section("1. reading a page for links");
  {
    const r = L.linksIn(PARTNER, "https://specimen-a.example/partners");
    const by = (p: string) => r.links.find((l) => l.path === p);
    check("three links to the website, the repeated one counted twice", r.links.length === 3 && by("/web-design-development")?.times === 2, r.links);
    check("its words and rel are read: followed, nofollow, sponsored", by("/web-design-development")?.follow === true && by("/kontakt")?.follow === false && by("/")?.follow === false && !!by("/")?.rel.includes("sponsored"), r.links);
    check("a picture link's words are its alt text", by("/")?.anchor === "Specimen logo", by("/"));
    check("a link in a comment or a script is not the page's", !r.links.some((l) => l.path === "/hidden" || l.path === "/in-a-script"));
    check("the studio named outside a link counts as a mention (the link's own words do not)", r.mentions === 1, r.mentions);
    check("the page's title is read", r.title === "Specimen partner page", r.title);
    const closed = L.linksIn(`<html><head><meta name="robots" content="noindex, nofollow"></head><body><a href="https://www.balkaris.ch/">x</a></body></html>`, "https://specimen-a.example/");
    check("a page whose robots tag says nofollow follows none of its links", closed.pageNofollow && closed.links.every((l) => !l.follow));
  }

  /* ============ 2. one reading after another ================================= */
  section("2. readings over time");
  {
    L.forgetForCheck();
    const A = "https://specimen-a.example/partners";
    web.set(A, { status: 200, body: PARTNER });
    const first = await L.checkPage("specimen-a.example/partners", { who: "Specimen Member" });
    const row = db.prepare("SELECT * FROM cc_seo_backlinks WHERE source_url = ?").get(A) as { id: number; state: string; first_live: string; origins: string; target: string; anchor: string; rel: string } | undefined;
    check("a page that links: verdict links, and the desk keeps a row for it", first.verdict === "links" && row?.state === "live" && row.first_live === today && row.origins === "check", { first: first.verdict, row });
    check("the row keeps the followed link's page, words and rel", row?.target === "/web-design-development" && row.anchor === "Web design by Balkaris" && row.rel === "[]", row);
    const before = asked.length;
    const again = await L.checkPage(A, { who: "Specimen Member" });
    check("asked again the same day, the kept reading answers and nothing is fetched", again.cached && asked.length === before);
    web.set(A, { status: 200, body: "<html><body><p>Balkaris made our site.</p></body></html>" });
    const gone = await L.checkPage(A, { who: "Specimen Member", fresh: true });
    const lost = db.prepare("SELECT state, lost_at, first_live FROM cc_seo_backlinks WHERE source_url = ?").get(A) as { state: string; lost_at: string; first_live: string };
    check("read again without the link: lost, with the day, the first day kept", gone.verdict === "mentions" && lost.state === "lost" && lost.lost_at === today && lost.first_live === today, lost);
    check("a lost link is said in the activity", count("SELECT COUNT(*) AS n FROM cc_activity WHERE kind = 'seo-backlinks' AND text LIKE 'A link to the website is gone%'") === 1);

    const B = "https://specimen-c.example/clients";
    web.set(B, { status: 200, body: `<a href="https://www.balkaris.ch/">Balkaris</a>` });
    await L.checkPage(B, { who: "Specimen Member" });
    web.set(B, { status: 503, body: null });
    const down = await L.checkPage(B, { who: "Specimen Member", fresh: true });
    const b = db.prepare("SELECT state, lost_at, first_live FROM cc_seo_backlinks WHERE source_url = ?").get(B) as { state: string; lost_at: string | null; first_live: string };
    check("a page that cannot be read is unknown, never lost", down.verdict === "unreadable" && b.state === "unreadable" && b.lost_at === null && b.first_live === today, b);

    robots.set("https://specimen-d.example", "User-agent: *\nDisallow: /private\n");
    const n = asked.length;
    const shut = await L.checkPage("https://specimen-d.example/private/page", { who: "Specimen Member" });
    check("robots.txt says no: unreadable, and the page itself is never asked", shut.verdict === "unreadable" && /robots\.txt/.test(shut.why ?? "") && asked.length === n, shut.why);
  }

  /* ============ 3. what the desk will not read ================================ */
  section("3. refusals and the hour's cap");
  {
    const refusedBy = (raw: string): string => {
      try {
        L.linkUrl(raw);
        return "";
      } catch (e) {
        return e instanceof audit.Refused ? e.message : `not a refusal: ${String(e)}`;
      }
    };
    check("the website itself is an internal link, not read", /website itself/.test(refusedBy("https://www.balkaris.ch/kontakt")));
    check("internal names are not read", !!refusedBy("http://localhost/") && !!refusedBy("intranet.corp/x"));
    check("a private address is not read", !!refusedBy("http://10.0.0.8/"));
    check("another port is not read", /ports/.test(refusedBy("https://specimen-a.example:8080/")));
    check("the guard's words say read, not audit", !/audit/.test(refusedBy("http://localhost/")), refusedBy("http://localhost/"));
    const r = await ask("/check", { body: { url: "https://www.balkaris.ch/" } });
    check("POST /check refuses the website itself with 400 and the sentence", r.status === 400 && /website itself/.test((r.json as { error?: string }).error ?? ""), r);
    const empty = await ask("/check", { body: { url: "" } });
    check("POST /check without an address: 400", empty.status === 400);

    L.forgetForCheck();
    for (let i = 1; i <= L.CHECKS.perPersonHour; i++) {
      web.set(`https://specimen-e.example/p${i}`, { status: 200, body: "<p>nothing here</p>" });
      await L.checkPage(`https://specimen-e.example/p${i}`, { who: OWNER.name, fresh: true });
    }
    const busy = await ask("/check", { body: { url: "https://specimen-e.example/one-more", fresh: true } });
    check(`the ${L.CHECKS.perPersonHour + 1}st page in an hour for one person: 429 with when to ask again`, busy.status === 429 && Number(busy.headers.get("retry-after")) > 0 && /in the last hour/.test((busy.json as { error?: string }).error ?? ""), busy.json);
    L.forgetForCheck();
  }

  /* ============ 4. following a link ============================================ */
  section("4. following a link");
  {
    const f = await ask<{ ok: boolean; line: string }>("/links", { body: { url: "https://specimen-f.example/credits", note: "credit promised (specimen)" } });
    const id = (db.prepare("SELECT id FROM cc_seo_backlinks WHERE source_url = ?").get("https://specimen-f.example/credits") as { id: number }).id;
    const row = L.knownLink(id);
    check("POST /links follows a page: tracked, by hand, its note, not read yet", f.status === 200 && !!row?.tracked && row.origins.includes("manual") && row.note === "credit promised (specimen)" && row.state === "not-checked", { f: f.json, row });
    const bad = await ask(`/links/${id}`, { body: { tracked: "yes" } });
    check("tracked must be true or false: 400", bad.status === 400);
    const nan = await ask("/links/abc", { body: { tracked: false } });
    check("a link that is not a number: 400", nan.status === 400);
    const read = await ask<{ check: { verdict: string } }>(`/links/${id}/check`, { body: {} });
    check("POST /links/:id/check reads it now (no page: unreadable, said)", read.status === 200 && read.json.check.verdict === "unreadable");
    const off = await ask<{ line: string }>(`/links/${id}`, { body: { tracked: false } });
    check("stopped following a page that never linked: it leaves the list", off.status === 200 && !L.knownLink(id) && /never linked/.test(off.json.line), off.json);
    const A = (db.prepare("SELECT id FROM cc_seo_backlinks WHERE source_url = ?").get("https://specimen-a.example/partners") as { id: number }).id;
    L.follow("https://specimen-a.example/partners", OWNER.name);
    L.changeLink(A, { tracked: false }, OWNER.name);
    check("stopped following a page that did link: it stays, with what was read", !!L.knownLink(A) && L.knownLink(A)!.state === "lost");
  }

  /* ============ 5. Search Console's Links export ================================ */
  section("5. Search Console's Links export");
  {
    const sites = L.importGscLinks("Website,Verweisende Seiten,Zielseiten\nspecimen-g.example,12,3\nwww.specimen-h.example,1,1\nwww.balkaris.ch,9,9\n", OWNER.name);
    check("a German header, bare site names then two counts: Top linking sites", sites.kind === "sites" && sites.rows === 2, sites);
    const g = L.googleLinks()!;
    check("the website's own row is left out, www. is dropped", g.sites.map((s) => s.host).sort().join(",") === "specimen-g.example,specimen-h.example", g.sites);
    store.setState("seo:bl:gsc-first:sites", JSON.stringify({ "specimen-g.example": "2026-01-01" }));
    L.importGscLinks("Site,Pages,Targets\nspecimen-g.example,13,3\n", OWNER.name);
    const g2 = L.googleLinks()!;
    check("a new export replaces the table, and keeps the day a site was first imported", g2.sites.length === 1 && g2.sites[0]!.pages === 13 && g2.sites[0]!.firstSeen === "2026-01-01", g2.sites);
    const pages = L.importGscLinks("Seite,Eingehende Links,Verweisende Websites\nhttps://www.balkaris.ch/,5,2\nhttps://www.balkaris.ch/kontakt,1,1\n", OWNER.name);
    check("addresses of the website then counts: Top linked pages", pages.kind === "pages" && L.googleLinks()!.pages.map((p) => p.path).join(",") === "/,/kontakt");
    const texts = L.importGscLinks("Rang,Linktext\n1,Balkaris\n2,specimen words\n", OWNER.name);
    check("a rank then words: Top linking text", texts.kind === "texts" && L.googleLinks()!.texts.join("|") === "Balkaris|specimen words");
    const links = L.importGscLinks("Link,Zuletzt gecrawlt\nhttps://specimen-i.example/blog/a,2026-09-30\nhttps://specimen-i.example/blog/b,2026-09-29\n", OWNER.name);
    const kept = db.prepare("SELECT origins, gsc_crawled FROM cc_seo_backlinks WHERE source_url = ?").get("https://specimen-i.example/blog/a") as { origins: string; gsc_crawled: string };
    check("other sites' addresses: Latest links, each a linking page for the desk to read", links.kind === "links" && links.rows === 2 && kept.origins === "google" && kept.gsc_crawled === "2026-09-30", kept);
    let said = "";
    try {
      L.importGscLinks("a,b\nfoo,bar\n", OWNER.name);
    } catch (e) {
      said = e instanceof Error ? e.message : String(e);
    }
    check("a file that is none of the four is refused with what the four are", /could not tell which Links table/.test(said), said);
    const member = await ask("/import", { who: "member", body: { csv: "Site,Pages,Targets\nspecimen-g.example,1,1\n" } });
    check("POST /import is the owner's: 403 for anybody else", member.status === 403);
    const owner = await ask<{ kind: string; line: string }>("/import", { body: { csv: "Site,Pages,Targets\nspecimen-g.example,13,3\n" } });
    check("POST /import for the owner: 200 and the sentence", owner.status === 200 && owner.json.kind === "sites" && /Top linking sites/.test(owner.json.line), owner.json);
  }

  /* ============ 6. the page ====================================================== */
  section("6. the page: GA4's referrals, sites, profiles");
  {
    const off = await page();
    check("GA4 not connected: the visits are off with the reason, not zero", off.referrers.state === "off" && off.sites.state === "ok" && off.sites.value.rows.every((r) => r.visits === null), off.referrers);
    check("the links tile counts Google's export when Bing is not connected, from Google", off.tiles.links.state === "ok" && off.tiles.links.source === "gsc" && off.tiles.links.value.value === 13, off.tiles.links);
    check("the Search Console link names no property while none is known", off.gscLinksUrl === "https://search.google.com/search-console/links");

    process.env.GA4_CREDENTIALS_FILE = specimenKey;
    store.setState(`ga4:measured:1:${ga4.hosts().join(",")}`, JSON.stringify({ since: day(-40), fullFrom: day(-39) }));
    const put = db.prepare("INSERT INTO cc_seo_referrals (day, source, medium, landing, sessions, users) VALUES (?, ?, ?, ?, ?, ?)");
    put.run(day(-3), "chatgpt.com", "referral", "/specimen-a", 2, 2);
    put.run(day(-3), "thankyou.com", "referral", "/specimen-b", 1, 1);
    put.run(day(-3), "ig", "social", "/", 1, 1);
    const ref = db.prepare("INSERT INTO cc_seo_ref_pages (day, referrer, host, landing, sessions) VALUES (?, ?, ?, ?, ?)");
    ref.run(day(-3), "https://chatgpt.com/", "chatgpt.com", "/specimen-a", 2);
    ref.run(day(-2), "https://l.instagram.com/", "l.instagram.com", "/", 3);
    store.setState("seo:bl:ref:to", day(-1));
    P.upsertProfile({ key: "instagram-specimen", name: "Instagram @specimen.profile", kind: "social", url: "https://www.instagram.com/specimen.profile/", state: "not-checked", stateWhy: "specimen", seen: null, ownerTask: null, source: "audit", sort: 1 });

    const p = await page();
    const row = (h: string) => (p.sites.state === "ok" ? p.sites.value.rows.find((r) => r.host === h) : undefined);
    check("GA4 connected: the visits are read", p.referrers.state === "ok", p.referrers);
    check("two reports of the same sessions are the larger, never the sum (chatgpt.com: 2, not 4)", row("chatgpt.com")?.visits?.sessions === 2, row("chatgpt.com"));
    check("an AI assistant by its own host", row("chatgpt.com")?.kind === "ai" && row("chatgpt.com")?.label === "ChatGPT");
    check("thankyou.com is a site, not You.com", row("thankyou.com")?.kind === "site" && row("thankyou.com")?.label === null, row("thankyou.com"));
    check("'ig' and l.instagram.com are one row, instagram.com, every medium counted (1 + 3)", row("instagram.com")?.visits?.sessions === 4 && (row("instagram.com")?.hosts ?? []).includes("l.instagram.com"), row("instagram.com"));
    check("a visit from the network is not the studio's profile without the profile's own address", row("instagram.com")?.kind === "site" && row("instagram.com")?.profileKey === "instagram-specimen", row("instagram.com"));
    ref.run(day(-2), "https://www.instagram.com/specimen.profile/", "instagram.com", "/", 1);
    const p2 = await page();
    const ig = p2.sites.state === "ok" ? p2.sites.value.rows.find((r) => r.host === "instagram.com") : undefined;
    check("named by the profile's own address, it is the studio's profile", ig?.kind === "profile" && ig.label === "Instagram @specimen.profile", ig);

    const found = await page("q=https%3A%2F%2Fwww.thankyou.com%2Fpage");
    check("a pasted address is searched by its host", found.asked.q === "thankyou.com" && found.sites.state === "ok" && found.sites.value.total === 1, found.asked);
    const g = await page("from=google");
    const gHosts = g.sites.state === "ok" ? g.sites.value.rows.map((r) => r.host) : [];
    check("from=google lists the sites in Google's export (its sites, and its linking pages' sites), and no other", gHosts.includes("specimen-g.example") && gHosts.includes("specimen-i.example") && !gHosts.includes("chatgpt.com"), gHosts);
    const fresh = await page("from=new");
    check("from=new lists the sites first seen inside the period", fresh.sites.state === "ok" && fresh.sites.value.rows.some((r) => r.host === "chatgpt.com") && !fresh.sites.value.rows.some((r) => r.host === "specimen-g.example"));
    const week = await page("range=7d");
    check("measured whole from its first whole day: the week before is compared", week.tiles.sites.state === "ok" && week.tiles.sites.value.previous !== null, week.tiles.sites);
    const quarter = await page("range=90d");
    check("a window before GA4's first whole day is not compared", quarter.tiles.sites.state === "ok" && quarter.tiles.sites.value.previous === null, quarter.tiles.sites);

    const open = await page("open=l.instagram.com");
    check("?open= with a host opens its site, echoed as the site, with its sessions by day (1 + 4)", open.asked.open === "instagram.com" && open.open?.host === "instagram.com" && (open.open.days ?? []).reduce((n, d) => n + d.sessions, 0) === 5, open.open);
    check("the detail lists the referring addresses GA4 named", !!open.open?.referrers.some((r) => r.url === "https://l.instagram.com/"));
    const lostSite = await page("open=specimen-a.example");
    check("the detail lists the desk's readings of the site's pages", lostSite.open?.links.some((l) => l.source === "https://specimen-a.example/partners" && l.state === "lost") === true, lostSite.open?.links);
    const none = await page("open=nothing-known.example");
    check("a site nothing knows about opens as null (the page says so), not an error", none.open === null && none.asked.open === "nothing-known.example");
    check("the tracked list counts every reading by state", p.tracked.state === "ok" && p.tracked.value.counts.lost >= 1 && p.tracked.value.counts.unreadable >= 1, p.tracked);
    check("the page made no request anywhere", refused.length === 0, refused);
  }

  /* ============ 7. Bing, connected ============================================== */
  section("7. Bing, read from what its job kept");
  {
    process.env.BING_API_KEY = "specimen";
    const home = "https://www.balkaris.ch/";
    store.keep("bing:link-counts", { total: 2, pages: [{ url: home, path: "/", links: 2 }], complete: true });
    store.setState("bing.links.at", new Date().toISOString());
    const put = db.prepare("INSERT INTO cc_bing_links (target, source, anchor, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)");
    put.run(home, "https://specimen-j.example/a", "Balkaris", day(-10), day(-1));
    put.run(home, "https://specimen-j.example/b", "old words", day(-20), day(-15));
    store.setState("bing.links.memo", JSON.stringify({ read: [home], listed: [home], readOn: { [home]: day(-1) }, countsDay: day(-1) }));
    const before = refused.length;
    const p = await page();
    const j = p.sites.state === "ok" ? p.sites.value.rows.find((r) => r.host === "specimen-j.example") : undefined;
    check("drawing the page asks Bing nothing", refused.length === before, refused.slice(before));
    check("the links tile is Bing's kept count", p.tiles.links.state === "ok" && p.tiles.links.source === "bing" && p.tiles.links.value.value === 2, p.tiles.links);
    check("a link Bing no longer lists is lost, not counted", j?.links?.bing === 1 && j.links.lost === 1, j?.links);
    check("bing.inboundLinks leaves it out and bing.lostLinks has it", (() => {
      const live = bing.inboundLinks(50);
      const gone = bing.lostLinks(50);
      return live.state === "ok" && gone.state === "ok" && live.value.length === 1 && gone.value.length === 1 && gone.value[0]!.source.endsWith("/b");
    })());
    delete process.env.BING_API_KEY;
  }

  /* ============ 8. the pager and the CSVs ============================================ */
  section("8. pager and exports");
  {
    const lines = ["Site,Pages,Targets", ...Array.from({ length: 120 }, (_, i) => `specimen-many-${String(i).padStart(3, "0")}.example,1,1`)];
    L.importGscLinks(lines.join("\n"), OWNER.name);
    const p1 = await page("from=google&sort=domain");
    const total = p1.sites.state === "ok" ? p1.sites.value.total : 0;
    const pages = Math.ceil(total / 50);
    check("50 rows a page, the total and the pages said", p1.sites.state === "ok" && p1.sites.value.rows.length === 50 && total >= 120 && p1.sites.value.pages === pages, { total, pages });
    const p3 = await page("from=google&sort=domain&page=99");
    check("a page past the end shows the last, and says so", p3.asked.page === pages && p3.sites.state === "ok" && p3.sites.value.rows.length === total - (pages - 1) * 50, p3.asked);
    const csv = await ask("/export.csv?from=google&sort=domain");
    const rows = csv.text.trim().split("\r\n");
    check(`the CSV has every matching row, not one page (${total} and the header)`, csv.status === 200 && rows.length === total + 1 && /^﻿?Site,/.test(rows[0]!), [rows.length, rows.slice(0, 2)]);
    const raw = new Uint8Array(await (await app.request("/api/v1/seo/backlinks/export.csv?list=profiles", { headers: { "x-specimen-who": "owner" } })).arrayBuffer());
    check("the CSV begins with the mark Excel needs to read UTF-8", raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf);
    const links = await ask("/export.csv?list=links");
    check("list=links: every linking page, with what the desk's reading found", links.status === 200 && /specimen-a\.example\/partners/.test(links.text) && /lost/.test(links.text));
    P.addProfile({ name: "=Specimen formula", kind: "directory" }, OWNER.name);
    const site = db.prepare("SELECT key FROM cc_seo_profiles WHERE key = 'instagram-specimen'").get();
    P.editProfile("instagram-specimen", { stated: { phone: "+41 44 000 00 00" } }, OWNER.name);
    const prof = await ask("/export.csv?list=profiles");
    check("a phone keeps its + in the CSV", !!site && /[,"]\+41 44 000 00 00 \[A\]/.test(prof.text) && !/'\+41/.test(prof.text), prof.text.split("\r\n").find((l) => l.includes("+41")));
    check("a cell that would run as a formula still gets its quote", /'=Specimen formula/.test(prof.text));
  }

  /* ============ 9. the profiles ========================================================= */
  section("9. the profiles");
  {
    const IG = "https://www.instagram.com/specimen.profile/";
    web.set(IG, { status: 200, body: `<html><head><title>Instagram</title></head><body><script>{"pageID":"httpErrorPage"},"url":"\\/specimen.profile\\/"</script></body></html>` });
    let r = await P.checkOne("instagram-specimen");
    check("Instagram's own 'not available' screen, served with 200, is not found", r.row.state === "not-found" && r.row.http === 200, r.row);
    check("a profile's address a person may have typed goes through the guarded fetch", presenceAsks.at(-1)?.how === "guarded" && presenceAsks.at(-1)?.url === IG, presenceAsks.at(-1));
    web.set(IG, { status: 200, body: `<html><head><title>Specimen Studio (@specimen.profile) • Instagram photos and videos</title></head></html>` });
    r = await P.checkOne("instagram-specimen");
    check("a page whose title names the handle exists, and its name is read", r.row.state === "exists" && r.row.nap?.name === "Specimen Studio", r.row);
    web.set(IG, { status: 200, body: `<html><head><title>Log in • Instagram</title></head><body>"\\/specimen.profile\\/"</body></html>` });
    r = await P.checkOne("instagram-specimen");
    check("a page that only echoes the path is no proof: the profile read as existing before stays so, with the reason this read failed", r.row.state === "exists" && /Kept from the last good read/.test(r.row.stateWhy) && /sign-in|does not name/.test(r.row.stateWhy), r.row);
    web.set(IG, { status: 503, body: null });
    r = await P.checkOne("instagram-specimen");
    check("a failed check writes the status it got and keeps what the last one read (its state and its name)", r.row.state === "exists" && r.row.http === 503 && r.row.nap?.name === "Specimen Studio", r.row);

    P.upsertProfile({ key: "website", name: "Specimen website", kind: "website", url: "https://www.balkaris.ch/", state: "not-checked", stateWhy: "specimen", seen: null, ownerTask: null, source: "audit", sort: 0 });
    web.set("https://www.balkaris.ch/", { status: 402, body: null });
    r = await P.checkOne("website");
    check("the website answering 402 says so, through the plain fetch", r.row.state === "unknown" && /The website answered 402/.test(r.row.stateWhy) && presenceAsks.at(-1)?.how === "plain", r.row);
    web.set("https://www.balkaris.ch/", {
      status: 200,
      body: `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Specimen Studio","telephone":"+41 44 000 00 00"}</script></head><body><a href="/impressum">Impressum</a></body></html>`,
    });
    web.set("https://www.balkaris.ch/impressum", { status: 200, body: "<html><body><h2>Business Address</h2><p>Specimenweg 8 8000 Zürich Switzerland</p></body></html>" });
    r = await P.checkOne("website");
    check("the website's imprint address is read when its structured data has none", r.row.state === "exists" && r.row.nap?.address === "Specimenweg 8, 8000 Zürich" && r.row.nap.name === "Specimen Studio", r.row.nap);

    const add = await ask<{ line: string }>("/profiles", { body: { name: "Specimen Directory", kind: "directory" } });
    check("POST /profiles adds a row, without an address", add.status === 200 && P.profile("specimen-directory")?.url === null, add.json);
    const dup = await ask("/profiles", { body: { name: "specimen directory", kind: "directory" } });
    check("a second row with the same name is refused", dup.status === 400);
    const local = await ask("/profiles/specimen-directory", { body: { url: "http://localhost/x" } });
    check("an internal address is refused for a profile", local.status === 400, local.json);
    const ip = await ask("/profiles/specimen-directory", { body: { url: "http://10.1.1.1/x" } });
    check("a bare IP address is refused for a profile", ip.status === 400);
    const ch = await ask<{ line: string }>("/profiles/specimen-directory", { body: { url: "specimen-k.example/studio", stated: { name: "Specimen Studio" } } });
    const after = P.profile("specimen-directory")!;
    check("POST /profiles/:key gives an address (not checked yet) and what it states, as the person's", ch.status === 200 && after.url === "https://specimen-k.example/studio" && after.state === "not-checked" && after.napSeen?.by === OWNER.name, after);
    const website = await ask("/profiles/website", { body: { url: "https://specimen.example/" } });
    check("the website's own address is not a row to change", website.status === 400);
    const auditRow = await ask("/profiles/instagram-specimen", { body: { remove: true } });
    check("an audit row cannot be removed (it would come back)", auditRow.status === 400);
    store.setState("seo:presence:found:specimen-found", JSON.stringify({ url: "https://specimen-l.example/studio", what: "specimen", day: today }));
    P.addProfile({ name: "Specimen Found", kind: "directory" }, OWNER.name);
    const keyFound = P.profiles().find((x) => x.name === "Specimen Found")!.key;
    store.setState(`seo:presence:found:${keyFound}`, JSON.stringify({ url: "https://specimen-l.example/studio", what: "specimen", day: today }));
    const use = await ask<{ line: string }>(`/profiles/${keyFound}/found`, { body: { use: true } });
    check("an address the weekly check found becomes the row's when a person says it is the studio's", use.status === 200 && P.profile(keyFound)?.url === "https://specimen-l.example/studio", use.json);
    const rm = await ask(`/profiles/${keyFound}`, { body: { remove: true } });
    check("a row a person added can be removed", rm.status === 200 && !P.profile(keyFound));
    web.set("https://specimen-k.example/studio", { status: 200, body: "<html><head><title>Specimen Studio · studio</title></head></html>" });
    const one = await ask<{ line: string }>("/profiles/specimen-directory/check", { body: {} });
    const twice = await ask("/profiles/specimen-directory/check", { body: {} });
    check("Check asks one address now, and once a minute at most", one.status === 200 && twice.status === 429 && Number(twice.headers.get("retry-after")) > 0, { one: one.json, twice: twice.status });
  }

  /* ============ 10. the one true name, address and phone =============================== */
  section("10. the one true name, address and phone");
  {
    check("one rule: word order and 'strasse'/'str.' do not make another address", P.sameKey.address("Specimenstrasse 8, 8304 Specimen") === P.sameKey.address("Specimenstr. 8, Specimen 8304"));
    check("one rule: +41 and 0 are one phone", P.sameKey.phone("+41 44 000 00 00") === P.sameKey.phone("044 000 00 00"));
    const at = new Date().toISOString();
    db.prepare("INSERT OR REPLACE INTO cc_seo_owner_tasks (id, title, step, why, impact, effort, who, origin, done, created_at, updated_at) VALUES ('nap-decision', 'Decide the one true name, address and phone', 'Decide it (specimen)', 'specimen', 'high', '10 min', 'owner', 'specimen', 0, ?, ?)").run(at, at);
    P.editProfile("specimen-directory", { stated: { address: "Otherweg 1, 9000 Specimen" } }, OWNER.name);
    const member = await ask("/nap", { who: "member", body: { name: "Specimen Studio" } });
    check("POST /nap is the owner's: 403 for anybody else", member.status === 403);
    const set = await ask<{ line: string }>("/nap", { body: { name: "Specimen Studio", address: "Specimenweg 8, 8000 Zürich", phone: "044 000 00 00" } });
    check("the owner records it: 200 and the sentence", set.status === 200 && /Recorded/.test(set.json.line), set.json);
    const p = await page();
    const nap = p.nap.state === "ok" ? p.nap.value : null;
    const site = p.profiles.state === "ok" ? p.profiles.value.rows.find((r) => r.key === "website") : undefined;
    check("the page carries the agreed values", nap?.truth?.address === "Specimenweg 8, 8000 Zürich" && nap.truth.by === OWNER.name, nap?.truth);
    check("each value is marked the same as the agreed, by the one rule (+41 44 … is 044 …)", site?.shown.phone?.match === true && site.shown.address?.match === true, site?.shown);
    check("a profile stating something else is counted as differing", (nap?.differing ?? 0) >= 1 && nap!.groups.find((g) => g.field === "address")!.variants.some((v) => v.match === false), nap?.groups);
    check("the decision task is the page's, first in Needs you", p.needsYou[0]?.id === "nap-decision" && p.nap.state === "ok" && p.nap.value.decision?.id === "nap-decision");
    const back = await ask<{ line: string }>("/nap", { body: { name: "", address: "", phone: "" } });
    const p2 = await page();
    check("all three empty takes the decision back", back.status === 200 && p2.nap.state === "ok" && p2.nap.value.truth === null && p2.nap.value.differing === null);
  }

  /* ============ 11. the daily job ======================================================= */
  section("11. the daily job");
  {
    check("the SEO collector registers seo-backlinks", seoJobs.jobs.some((j) => j.name === "seo-backlinks"));
    L.wire.ga4Ready = () => true;
    L.wire.measuredSince = async () => day(-40);
    L.wire.report = (async () => ({
      data: {
        rows: [
          { date: day(-2), pageReferrer: "https://specimen-m.example/blog/our-partners", landingPage: "/", sessions: 2 },
          { date: day(-2), pageReferrer: "https://l.instagram.com/", landingPage: "/", sessions: 1 },
          { date: day(-2), pageReferrer: "https://www.google.com/search", landingPage: "/", sessions: 4 },
          { date: day(-2), pageReferrer: "https://www.balkaris.ch/kontakt", landingPage: "/", sessions: 9 },
        ],
        ranges: [],
        rowCount: 4,
        tokens: 0,
      },
      at: Date.now(),
      source: "ga4",
    })) as unknown as typeof L.wire.report;
    web.set("https://specimen-m.example/blog/our-partners", { status: 200, body: `<a href="https://www.balkaris.ch/" rel="ugc">Balkaris</a>` });
    L.forgetForCheck();
    const said = await L.dailyRead();
    const kept = db.prepare("SELECT origins, state, rel FROM cc_seo_backlinks WHERE source_url = ?").get("https://specimen-m.example/blog/our-partners") as { origins: string; state: string; rel: string } | undefined;
    check("a referring address with a path becomes a page to read, and is read: a ugc link, live", kept?.state === "live" && kept.origins.includes("ga4") && kept.rel === '["ugc"]', { said, kept });
    check("a front door, a search and the website itself become no page to read", count("SELECT COUNT(*) AS n FROM cc_seo_backlinks WHERE source_host IN ('l.instagram.com', 'google.com', 'balkaris.ch')") === 0);
    check("the website's own pages are not kept as referrers", count("SELECT COUNT(*) AS n FROM cc_seo_ref_pages WHERE host LIKE '%balkaris.ch'") === 0);
    check("its line says what it did", /referring-address rows/.test(said) && /linking page/.test(said), said);
  }
} catch (e) {
  failed++;
  console.log(`FAIL the check stopped: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
} finally {
  try {
    db.close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
