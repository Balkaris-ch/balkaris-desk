/**
 * SEO › Automations and the jobs behind it, proved without a network.
 *
 *   node --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-seo-automations-and-jobs.ts
 *   npm run check:seo-automations
 *
 * A throwaway database, the desk's scheduler switched off (CC_SCHEDULER=off),
 * and a guard on `fetch` that refuses every host: nothing leaves this machine.
 * The SEO engine's own jobs are registered as they are; the desk jobs the SEO
 * section reads (the crawl, the index check, PageSpeed...) are stand-ins with
 * the same names that return a line, and they never come due by themselves
 * (an hour's start delay), so only what the check asks for runs.
 *
 * What is proved:
 *   1. the list: every described job is listed, the Chrome UX Report job with
 *      them, and a job added to the engine's list without a description is
 *      listed, watched and kept all the same;
 *   2. a job that does not run is "late", not "Success / Due now": its time is
 *      said, the tile counts it, a job inside its time, a switched-off one and
 *      one waiting for its key are not late;
 *   3. a failed run is tried again after half an hour, three times at most,
 *      then waits for its regular time; without a scheduler nothing is
 *      promised;
 *   4. a run a restart cut off is run again two minutes after it began, once;
 *   5. the watch: nothing in its first ten minutes, the most overdue job in
 *      its own intervals first, one ask at a time, the job really starts, the
 *      log says so once a day with a link that opens the job;
 *   6. the runs are kept past the scheduler's week, so a weekly job shows two
 *      runs and the period counts them;
 *   7. the period in the head changes what the page counts;
 *   8. the export: a CSV of the period's runs, Excel-safe, and a plain
 *      refusal when there is nothing to export;
 *   9. the top bar's light turns for a job half an hour late, and stays quiet
 *      where no scheduler runs;
 *  10. the week's summary: written from the desk's own tables, kept for the
 *      page, sent on Telegram only when the owner said so and the desk can,
 *      and only the owner may say so;
 *  11. the steps done by hand open the screen they are done on.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-seo-automations-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE = "https://www.balkaris.ch";
for (const k of ["GSC_SITE", "BING_API_KEY", "BING_SITE", "GOOGLE_API_KEY", "GA4_PROPERTY_ID", "SITE_READ_REPO", "SITE_REPO", "DESK_DEV_USER", "TELEGRAM_BOT_TOKEN"]) delete process.env[k];
process.env.GA4_CREDENTIALS_FILE = path.join(dir, "absent.json");
process.env.SITE_READ_CLONE = "off";

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
const section = (title: string) => console.log(`\n${title}`);

/* ---- the modules ------------------------------------------------------------ */

const { db } = await import("../src/db.ts");
const scheduler = await import("../src/cc/scheduler.ts");
const store = await import("../src/cc/store.ts");
const J = await import("../src/cc/seo/jobs.ts");
const { routes } = await import("../src/cc/routes/seo/automations.ts");
const { apiError } = await import("../src/cc/api.ts");
const { Hono } = await import("hono");
import type { Vars } from "../src/cc/access.ts";
import type { SeoAutomationsPayload, SeoJobRuns } from "../web/src/contract/seo/automations.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms: number): string => new Date(ms).toISOString();

/* The desk jobs the SEO section reads, as stand-ins: same names, a line for a result. */
const ran: string[] = [];
const standIn = (name: string, title: string, every: number, o: { ready?: () => boolean; fail?: () => boolean } = {}) => ({
  name,
  title,
  every,
  delay: 3600,
  ...(o.ready ? { ready: o.ready } : {}),
  run: async () => {
    ran.push(name);
    if (o.fail?.()) throw new Error(`=SUM(1) specimen failure of ${name}`);
    return `specimen run of ${name}`;
  },
});
let inspectFails = false;
scheduler.register(
  standIn("crawl", "Read every page of the website", 24 * 3600),
  standIn("sitemap", "Read the sitemap", 15 * 60),
  standIn("gsc-daily", "Refresh Search Console figures", 12 * 3600),
  standIn("gsc-inspect", "Inspect every sitemap address", 24 * 3600, { fail: () => inspectFails }),
  standIn("speed", "Measure page speed", 24 * 3600),
  standIn("crux-daily", "Read Chrome UX Report field data", 24 * 3600),
  standIn("bing-daily", "Read Bing Webmaster", 24 * 3600, { ready: () => false }),
);
/* A job a colleague adds to the engine's list without describing it here. */
J.jobs.push({ name: "seo-specimen", title: "A specimen job nobody described", every: 24 * 3600, delay: 3600, run: async () => "specimen" });
scheduler.register(...J.jobs);

import type { Person } from "../src/people.ts";
const OWNER = { telegram: 1, name: "Specimen Owner", email: "owner@specimen.invalid", owner: true, canPublish: true, seesLeads: true } as unknown as Person;
const MEMBER = { telegram: 2, name: "Specimen Member", email: "member@specimen.invalid", owner: false, canPublish: false, seesLeads: false } as unknown as Person;
const app = new Hono<Vars>();
app.use("*", async (c, next) => {
  c.set("who", c.req.header("x-specimen-who") === "member" ? MEMBER : OWNER);
  await next();
});
app.route("/seo/automations", routes);
app.onError(apiError);
async function page(range = "30d"): Promise<SeoAutomationsPayload> {
  const res = await app.request(`/seo/automations?range=${range}`);
  return (await res.json()) as SeoAutomationsPayload;
}
const runsOf = (d: SeoAutomationsPayload): Record<string, SeoJobRuns> => (d.runs.state === "ok" ? d.runs.value : {});

/** Put a job's last run where a test needs it: cc_jobs as the scheduler writes it, and its rows in cc_runs. */
function setRuns(name: string, rows: { start: number; ok: boolean | null; note?: string }[]): void {
  db.prepare("DELETE FROM cc_runs WHERE job = ?").run(name);
  db.prepare("DELETE FROM cc_seo_job_runs WHERE job = ?").run(name);
  const sorted = [...rows].sort((a, b) => a.start - b.start);
  for (const r of sorted) {
    db.prepare("INSERT INTO cc_runs (job, started, ended, ok, note) VALUES (?, ?, ?, ?, ?)").run(
      name,
      iso(r.start),
      r.ok === null ? null : iso(r.start + 5000),
      r.ok === null ? null : r.ok ? 1 : 0,
      r.note ?? (r.ok === null ? null : r.ok ? "specimen ok" : "specimen failure"),
    );
  }
  const last = sorted.at(-1);
  const lastDone = [...sorted].reverse().find((r) => r.ok !== null);
  db.prepare("UPDATE cc_jobs SET last_start = ?, last_end = ?, last_ok = ?, last_note = ?, enabled = 1 WHERE name = ?").run(
    last ? iso(last.start) : null,
    lastDone ? iso(lastDone.start + 5000) : null,
    lastDone ? (lastDone.ok ? 1 : 0) : null,
    lastDone ? (lastDone.note ?? null) : null,
    name,
  );
}
/** Every job ran a moment ago and is fine: the quiet starting point of a test. */
function allFresh(now: number): void {
  for (const j of scheduler.status()) if (j.ready) setRuns(j.name, [{ start: now - 30_000, ok: true }]);
}

try {
  /* ============ 8a. nothing to export yet ===================================== */
  section("8a. the export with no run kept");
  {
    const res = await app.request("/seo/automations/export.csv?range=7d");
    const body = (await res.json()) as { error?: string };
    check("no run yet: a plain refusal, not an empty file", res.status === 409 && /nothing to export/i.test(body.error ?? ""), { status: res.status, body });
  }

  /* ============ 1. the list ================================================== */
  section("1. the list");
  const now0 = Date.now();
  allFresh(now0);
  {
    const d = await page();
    const names = d.jobs.map((j) => j.name);
    check(
      "every SEO engine job and every desk job it reads is listed",
      ["seo-snapshot", "seo-engine", "seo-readiness", "seo-referrals", "seo-research", "seo-competitors", "seo-presence", "crawl", "sitemap", "gsc-daily", "gsc-inspect", "speed", "bing-daily"].every((n) => names.includes(n)),
      names,
    );
    check("the Chrome UX Report job SEO › Technical reads is listed, with what it reads", names.includes("crux-daily") && /Chrome UX Report/.test(runsOf(d)["crux-daily"]?.reads ?? ""), runsOf(d)["crux-daily"]);
    const spec = d.jobs.find((j) => j.name === "seo-specimen");
    check("a job added to the engine's list without a description is listed all the same", !!spec && spec.group === "seo" && spec.what.startsWith("A specimen job"), spec);
    check("and watched and kept", J.watched().includes("seo-specimen"));
    check("the page says whether anything starts by itself here: not on this copy", d.scheduler.on === false && d.scheduler.stalled === false && d.scheduler.watch.on === false, d.scheduler);
    check("every job inside its time reads Success", d.jobs.filter((j) => j.ready).every((j) => runsOf(d)[j.name]?.state === "ok"), Object.fromEntries(Object.entries(runsOf(d)).map(([k, v]) => [k, v.state])));
  }

  /* ============ 2. late ======================================================= */
  section("2. a job that does not run is late");
  {
    const now = Date.now();
    allFresh(now);
    /* The daily research ran 26 hours ago: two hours past its time. */
    setRuns("seo-research", [{ start: now - 26 * HOUR, ok: true }]);
    /* The crawl is 5 minutes past its time: due, not yet late. */
    setRuns("crawl", [{ start: now - 24 * HOUR - 5 * MIN, ok: true }]);
    /* The PageSpeed job is switched off and far behind. */
    setRuns("speed", [{ start: now - 5 * DAY, ok: true }]);
    db.prepare("UPDATE cc_jobs SET enabled = 0 WHERE name = 'speed'").run();
    const d = await page();
    const r = runsOf(d);
    const research = r["seo-research"]!;
    check("two hours past its time: Late, not Success", research.state === "late", research.state);
    check("and since when", research.lateSince === iso(now - 26 * HOUR + 24 * HOUR) && research.nextRun === research.lateSince, { lateSince: research.lateSince, nextRun: research.nextRun });
    check("five minutes past its time is due, not late", r.crawl?.state === "ok" && r.crawl.lateSince === null, r.crawl);
    check("a switched-off job is Off, never late", r.speed?.state === "off" && r.speed.lateSince === null && r.speed.nextRun === null, r.speed);
    check("a job waiting for its key is Waiting, never late", r["bing-daily"]?.state === "waiting" && r["bing-daily"].lateSince === null, r["bing-daily"]);
    const day = d.day.state === "ok" ? d.day.value : null;
    const title = d.jobs.find((j) => j.name === "seo-research")!.title;
    check("the day's tile counts the late job by name", !!day && day.late.includes(title) && day.late.length === 1, day);
    check("the Next run tile says it is late", d.next?.name === "seo-research" && d.next.late === true, d.next);
    /* A failed last run is said before lateness: the row then shows Failed and its Next run still says late. */
    setRuns("seo-research", [{ start: now - 26 * HOUR, ok: false }]);
    const f = runsOf(await page())["seo-research"]!;
    check("a failed job that is also late reads Failed, with its lateness kept", f.state === "failed" && f.lateSince !== null, f);
    db.prepare("UPDATE cc_jobs SET enabled = 1 WHERE name = 'speed'").run();
  }

  /* ============ 3. retry ====================================================== */
  section("3. a failed run is tried again");
  {
    const now = Date.now();
    allFresh(now);
    J._test.boot(now - 3 * HOUR);
    /* The index check failed 40 minutes ago (Search Console answered 500). */
    setRuns("gsc-inspect", [
      { start: now - 2 * DAY, ok: true },
      { start: now - 40 * MIN, ok: false, note: "Stopped early: Search Console answered 500" },
    ]);
    const on = J._test.standingsOn(now).get("gsc-inspect")!;
    check("with a scheduler: again half an hour after the failed start", on.why === "retry" && on.dueAt === iso(now - 40 * MIN + 30 * MIN) && on.failsInRow === 1, on);
    const off = J.standings(now).get("gsc-inspect")!;
    check("without one, no try is promised: its regular time", off.why === "regular" && off.dueAt === iso(now - 40 * MIN + 24 * HOUR), off);
    J._test.watching(true);
    const r = runsOf(await page())["gsc-inspect"]!;
    check("the row says which try comes next", r.nextWhy === "retry" && r.retry?.attempt === 1 && r.retry.of === 3, { nextWhy: r.nextWhy, retry: r.retry });
    check("the watch asks for it", J.planAsk(now)?.name === "gsc-inspect" && J.planAsk(now)?.why === "retry", J.planAsk(now));
    /* Four failures in a row: it waits for its regular time. */
    setRuns("gsc-inspect", [0, 1, 2, 3].map((i) => ({ start: now - (4 - i) * 35 * MIN, ok: false })));
    const gave = J._test.standingsOn(now).get("gsc-inspect")!;
    check("after three tries it waits for its regular time and says why", gave.why === "regular" && gave.gaveUp === "failed" && gave.failsInRow === 4, gave);
    /* A quarter-hourly job's own time comes before half an hour: no extra try. */
    setRuns("sitemap", [{ start: now - 5 * MIN, ok: false }]);
    const quick = J._test.standingsOn(now).get("sitemap")!;
    check("a job that runs every quarter of an hour simply runs at its time", quick.why === "regular" && quick.gaveUp === null, quick);
    J._test.watching(null);
  }

  /* ============ 4. cut by a restart =========================================== */
  section("4. a run a restart cut off");
  {
    const now = Date.now();
    allFresh(now);
    J._test.boot(now - 30 * MIN);
    setRuns("seo-competitors", [
      { start: now - 8 * DAY, ok: true },
      { start: now - 40 * MIN, ok: null },
    ]);
    const s = J._test.standingsOn(now).get("seo-competitors")!;
    check("it is run again two minutes after it began, not a week later", s.why === "again" && s.cutAt === iso(now - 40 * MIN) && s.dueAt === iso(now - 38 * MIN), s);
    J._test.watching(true);
    const r = runsOf(await page())["seo-competitors"]!;
    check("the row keeps the last finished run and says it was cut", r.last?.ok === true && r.cutAt === iso(now - 40 * MIN) && r.recent[0]?.state === "cut", { last: r.last, cutAt: r.cutAt, recent: r.recent.slice(0, 2) });
    J._test.watching(null);
    setRuns("seo-competitors", [
      { start: now - 90 * MIN, ok: null },
      { start: now - 40 * MIN, ok: null },
    ]);
    const twice = J._test.standingsOn(now).get("seo-competitors")!;
    check("cut twice in a row: no third try before its regular time", twice.gaveUp === "cut" && twice.why === "regular", twice);
  }

  /* ============ 5. the watch ================================================== */
  section("5. the watch");
  {
    const now = Date.now();
    allFresh(now);
    /* Only stand-ins may run in this part: the engine's own jobs stay fresh. */
    setRuns("crawl", [{ start: now - 24 * HOUR - 6 * MIN, ok: true }]);
    setRuns("gsc-daily", [{ start: now - 12 * HOUR - 50 * MIN, ok: true }]);
    J._test.boot(now - 5 * MIN);
    check("nothing is asked in the desk's first ten minutes", J.planAsk(now) === null);
    J._test.boot(now - 2 * HOUR);
    const ask = J.planAsk(now);
    check("the most overdue in its own intervals first: 50 min of 12 h before 6 min of 24 h", ask?.name === "gsc-daily" && ask.why === "late", ask);
    ran.length = 0;
    const did = J.beat(now);
    check("a look asks the scheduler for it", did?.name === "gsc-daily", did);
    await new Promise((r) => setTimeout(r, 300));
    check("and the job really runs", ran.includes("gsc-daily"), ran);
    const log = store.activity(20, ["seo"]).find((a) => a.text.includes("passed over"));
    check("the log says the scheduler passed it over, with a link that opens the job", !!log && log.href === "/seo/automations?open=gsc-daily", log);
    check("the ask is kept for the page", J.watchAsks()[0]?.name === "gsc-daily" && (await page()).scheduler.watch.asks[0]?.name === "gsc-daily");
    /* One ask at a time: the crawl is still late, but while gsc-daily had not started nothing else was asked. */
    const later = J.planAsk(now + 1000);
    check("the next look asks for the next late job once the first has started", later?.name === "crawl", later);
    J.beat(now + 1000);
    await new Promise((r) => setTimeout(r, 300));
    const lines = store.activity(50, ["seo"]).filter((a) => a.text.includes("passed over"));
    check("one log line per job per day", lines.length === 2 && ran.includes("crawl"), lines.map((l) => l.text));
  }

  /* ============ 6. runs kept past the week ===================================== */
  section("6. the runs are kept past the scheduler's week");
  {
    const now = Date.now();
    allFresh(now);
    setRuns("seo-presence", [
      { start: now - 20 * DAY, ok: true, note: "specimen: 5 profiles checked" },
      { start: now - 13 * DAY, ok: true, note: "specimen: 5 profiles checked again" },
      { start: now - 6 * DAY, ok: true, note: "specimen: the newest check" },
    ]);
    J.keepRuns(now);
    /* The scheduler drops what is older than a week after its next run. */
    db.prepare("DELETE FROM cc_runs WHERE started < ?").run(iso(now - 7 * DAY));
    const kept = J.runsOf("seo-presence", 10);
    check("a weekly job shows its last three runs, not one", kept.length === 3 && kept[0]!.start === iso(now - 6 * DAY) && kept[2]!.start === iso(now - 20 * DAY), kept.map((k) => k.start));
    const r = runsOf(await page("30d"))["seo-presence"]!;
    check("the row's last runs reach past the week", r.recent.length === 3, r.recent.map((x) => x.start));
    check("a second copy of the same runs adds nothing", J.keepRuns(now) >= 0 && (db.prepare("SELECT COUNT(*) AS n FROM cc_seo_job_runs WHERE job = 'seo-presence'").get() as { n: number }).n === 3);
  }

  /* ============ 7. the period ================================================== */
  section("7. the period in the head changes the page");
  {
    setRuns("gsc-inspect", [{ start: Date.now() - 2 * DAY, ok: false, note: "Stopped early: Search Console answered 500" }]);
    const week = await page("7d");
    const month = await page("30d");
    const p7 = week.period.state === "ok" ? week.period.value : null;
    const p30 = month.period.state === "ok" ? month.period.value : null;
    check("the period is read", !!p7 && !!p30 && p7.days === 7 && p30.days === 30, { p7: week.period.state, p30: month.period.state });
    check("30 days counts the kept runs 7 days leaves out", !!p7 && !!p30 && p30.ok > p7.ok, { p7: p7?.ok, p30: p30?.ok });
    check("each job's counts follow the period", (runsOf(month)["seo-presence"]?.period.ok ?? 0) === 3 && (runsOf(week)["seo-presence"]?.period.ok ?? 0) === 1, { m: runsOf(month)["seo-presence"]?.period, w: runsOf(week)["seo-presence"]?.period });
    check("a failed run of the period is listed with its job", !!p30 && p30.failures.length >= 1 && p30.failures.every((f) => !!f.title), p30?.failures.slice(0, 2));
  }

  /* ============ 8. the export ================================================== */
  section("8. the export");
  {
    setRuns("gsc-inspect", [{ start: Date.now() - HOUR, ok: false, note: "=HYPERLINK(\"specimen\")" }]);
    const res = await app.request("/seo/automations/export.csv?range=30d");
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.toString("utf8");
    const lines = text.replace(/^﻿/, "").trim().split(/\r\n/);
    check("a CSV file with a name that says what and when", res.status === 200 && /text\/csv/.test(res.headers.get("content-type") ?? "") && /balkaris-seo-job-runs-.*-30d\.csv/.test(res.headers.get("content-disposition") ?? ""), res.headers.get("content-disposition"));
    check("Excel reads it as UTF-8 (a byte-order mark)", bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf);
    check("one line per run, the header first", lines[0] === "Job,Name,Started (UTC),Ended (UTC),Seconds,Result,What it said" && lines.length > 5, lines.slice(0, 2));
    check("a note that starts like a formula is not run by a spreadsheet", lines.some((l) => l.includes("'=HYPERLINK")) && !lines.some((l) => /,=HYPERLINK/.test(l)), lines.filter((l) => l.includes("HYPERLINK")));
    const week = (await app.request("/seo/automations/export.csv?range=7d")).text();
    check("the period narrows the file", !(await week).includes("profiles checked again") && text.includes("profiles checked again"));
  }

  /* ============ 9. the top bar's light ======================================== */
  section("9. the top bar's light");
  {
    const now = Date.now();
    allFresh(now);
    check("no scheduler here: nothing to vouch for", J.lateCheck(now) === null);
    J._test.watching(true);
    J._test.boot(now - 3 * HOUR);
    check("every job on time: the light stays green", J.lateCheck(now)?.ok === true, J.lateCheck(now));
    setRuns("seo-research", [{ start: now - 25 * HOUR, ok: true }]);
    const c = J.lateCheck(now);
    check("a job an hour past its time turns it, by name", c?.ok === false && c.detail.includes(J.jobs.find((j) => j.name === "seo-research")!.title), c);
    J._test.boot(now - 20 * MIN);
    check("not while the desk is settling after a restart", J.lateCheck(now) === null);
    J._test.watching(null);
  }

  /* ============ 10. the week's summary ======================================== */
  section("10. the week's summary");
  {
    const D = await import("../src/cc/seo/jobs-digest.ts");
    const sent: string[] = [];
    let ready = false;
    D.wire.tell = async (html: string) => {
      sent.push(html);
      return true;
    };
    D.wire.ready = () => ready;
    const now = Date.now();
    allFresh(now);
    const before = await page();
    check("before the first summary: waiting, with what writes it", before.digest.state === "waiting" && /Run now/.test(before.digest.state === "waiting" ? before.digest.reason : ""), before.digest);
    check("the summary's job is listed, and anyone who may run SEO jobs can ask for it", before.jobs.some((j) => j.name === "seo-digest") && !!runsOf(before)["seo-digest"]?.askableFrom);
    setRuns("seo-research", [{ start: now - 26 * HOUR, ok: true }]);
    setRuns("gsc-inspect", [{ start: now - HOUR, ok: false, note: "Stopped early: Search Console answered 500" }]);
    J._test.watching(true);
    J._test.boot(now - 3 * HOUR);
    const line = await D.writeDigest(now);
    J._test.watching(null);
    const kept = D.digests()[0];
    const texts = kept?.lines.map((l) => l.text) ?? [];
    check("written and kept, Telegram off: nothing sent", !!kept && kept.sent === null && sent.length === 0 && /Telegram is off/.test(line), { line, sent: kept?.sent });
    check("it counts the runs", texts.some((t) => /^Runs: [\d,]+ finished, [\d,]+ failed/.test(t)), texts);
    check("it names the failing job and the late one by their titles", texts.some((t) => t.startsWith("Failing now:") && t.includes("Inspect every sitemap address")) && texts.some((t) => t.startsWith("Late now:") && t.includes("Research search phrases")), texts);
    check("it says what the engine found, linked to where it is seen", kept!.lines.some((l) => l.text.startsWith("Opportunities:") && l.href === "/seo/opportunities"), kept?.lines);
    const after = await page();
    check("the page shows it", after.digest.state === "ok" && after.digest.value.list[0]?.at === kept?.at && after.digest.value.job === "seo-digest");
    const refused = await app.request("/seo/automations/digest", { method: "POST", headers: { "x-specimen-who": "member", "content-type": "application/json" }, body: JSON.stringify({ telegram: true }) });
    check("only the owner may have it sent on Telegram", refused.status === 403 && D.telegram().on === false, refused.status);
    const bad = await app.request("/seo/automations/digest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ telegram: "yes" }) });
    check("a malformed ask is refused in a sentence", bad.status === 400 && /telegram/.test(((await bad.json()) as { error: string }).error));
    const on = await app.request("/seo/automations/digest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ telegram: true }) });
    const onBody = (await on.json()) as { ok: boolean; line: string };
    check("the owner switches it on; without a bot it says the summary stays on the page", on.status === 200 && onBody.ok && /cannot reach you/.test(onBody.line) && D.telegram().on, onBody);
    await D.writeDigest(now + 1000);
    check("on, but the desk cannot reach Telegram: not sent, and said so", D.digests()[0]?.sent === false && sent.length === 0);
    ready = true;
    await D.writeDigest(now + 2000);
    check("on and reachable: sent once, as escaped HTML with the desk's address", D.digests()[0]?.sent === true && sent.length === 1 && sent[0]!.startsWith("<b>SEO, ") && sent[0]!.includes("/seo/automations"), sent[0]?.slice(0, 200));
    check("each summary is kept, newest first (eight at most)", D.digests().length === 3 && D.digests()[0]!.at > D.digests()[1]!.at);
    await app.request("/seo/automations/digest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ telegram: false }) });
    check("and off again", D.telegram().on === false);
  }

  /* ============ 11. the steps done by hand ===================================== */
  section("11. the steps done by hand open where they are done");
  {
    db.prepare(
      `INSERT OR REPLACE INTO cc_seo_owner_tasks (id, title, step, why, impact, effort, who, origin, sort, done, created_at, updated_at)
       VALUES ('specimen-brave', 'Submit the homepage to Brave (specimen)', 'Submit the homepage at https://search.brave.com/submit-url (specimen).', NULL, 'low', NULL, 'lead-chrome', 'specimen', 1, 0, ?, ?)`,
    ).run(iso(Date.now()), iso(Date.now()));
    const d = await page();
    const links = d.stepLinks["specimen-brave"] ?? [];
    check("a step that names Brave's form links to it", links.some((l) => l.href === "https://search.brave.com/submit-url"), d.stepLinks);
    check("Search Console's links only while the desk knows the property: none here", Object.values(d.stepLinks).every((ls) => ls.every((l) => !l.href.includes("search-console"))));
  }

  section("nothing left the machine");
  check("no request was made", refused.length === 0, refused);
} catch (e) {
  failed++;
  console.log("FAIL the check itself threw:", e);
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
