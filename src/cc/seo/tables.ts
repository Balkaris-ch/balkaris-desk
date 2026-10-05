import { db } from "../../db.ts";

/**
 * What the SEO engine remembers, in the desk's one database, every table
 * prefixed cc_seo_ beside the command center's own (src/cc/store.ts).
 *
 *   cc_seo_rank        one Search Console row per day, country (che and all),
 *                      device, query and page: the history Google keeps for
 *                      sixteen months and only gives when asked. rank.ts.
 *   cc_seo_rank_queries the same per day and query over the whole property:
 *                      Google's own figure for a query.
 *   cc_seo_rank_pages  the same per day and page, without the query: it holds
 *                      the impressions of the queries Google withholds as rare.
 *   cc_seo_rank_days   the same per day: the property's totals.
 *   cc_seo_snaps       one row per day snapshotted, so a day with no rows is
 *                      known to be a zero and not a gap.
 *   cc_seo_keywords    every phrase: from Search Console, Google Autocomplete
 *                      research, the audit, or a person. keywords.ts.
 *   cc_seo_clusters    the topic clusters phrases belong to, and the page that
 *                      answers each, or none: a gap.
 *   cc_seo_opps        the opportunities the rules find (rules.ts, engine.ts),
 *                      with a person's decision that no run resets.
 *   cc_seo_owner_tasks what only the owner (or the lead in the owner's
 *                      browser) can do: "Needs you". owner.ts.
 *   cc_seo_ai_checks   a question asked of an AI assistant and what it said
 *                      about Balkaris. aisearch.ts.
 *   cc_seo_referrals   GA4 sessions by day, source, medium and landing page,
 *                      for referrals and AI assistants. referrals.ts.
 *   cc_seo_readiness   the AI-readiness check of each page. readiness.ts.
 *   cc_seo_imports     the monthly CSVs no API gives (Search Console's
 *                      Generative AI report, Bing's AI Performance).
 *   cc_seo_competitors, cc_seo_sightings, cc_seo_comp_pages
 *                      the domains seen beside or instead of Balkaris, where
 *                      they were seen, and what their pages say. competitors.ts.
 *   cc_seo_profiles    the studio's profiles and listings, checked weekly. presence.ts.
 *
 * NO PERSONAL DATA. Search Console rows are queries and the site's own pages;
 * GA4 rows are counts. No visitor, no enquirer, no user agent string. The one
 * person named anywhere is the one who changed a state ("Fini marked it done").
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS cc_seo_rank (
    day         TEXT NOT NULL,
    /* 'all' or an ISO 3166-1 alpha-3 code in lower case, as Search Console writes it ('che'). */
    country     TEXT NOT NULL,
    /* DESKTOP, MOBILE or TABLET. */
    device      TEXT NOT NULL,
    query       TEXT NOT NULL,
    /* The full address as Google reports it: the apex and www hosts are different pages to Google. */
    page        TEXT NOT NULL,
    clicks      INTEGER NOT NULL,
    impressions INTEGER NOT NULL,
    position    REAL NOT NULL,
    PRIMARY KEY (day, country, device, query, page)
  );
  CREATE INDEX IF NOT EXISTS cc_seo_rank_query ON cc_seo_rank (query, day);
  CREATE INDEX IF NOT EXISTS cc_seo_rank_page ON cc_seo_rank (page, day);

  /* Per day and query over the whole property: Google's own figure for a
     query. Summing cc_seo_rank over pages would count an impression twice
     when two pages showed in one search. */
  CREATE TABLE IF NOT EXISTS cc_seo_rank_queries (
    day TEXT NOT NULL, country TEXT NOT NULL, device TEXT NOT NULL, query TEXT NOT NULL,
    clicks INTEGER NOT NULL, impressions INTEGER NOT NULL, position REAL NOT NULL,
    PRIMARY KEY (day, country, device, query)
  );
  CREATE INDEX IF NOT EXISTS cc_seo_rank_queries_query ON cc_seo_rank_queries (query, day);

  CREATE TABLE IF NOT EXISTS cc_seo_rank_pages (
    day TEXT NOT NULL, country TEXT NOT NULL, device TEXT NOT NULL, page TEXT NOT NULL,
    clicks INTEGER NOT NULL, impressions INTEGER NOT NULL, position REAL NOT NULL,
    PRIMARY KEY (day, country, device, page)
  );
  CREATE INDEX IF NOT EXISTS cc_seo_rank_pages_page ON cc_seo_rank_pages (page, day);

  CREATE TABLE IF NOT EXISTS cc_seo_rank_days (
    day TEXT NOT NULL, country TEXT NOT NULL, device TEXT NOT NULL,
    clicks INTEGER NOT NULL, impressions INTEGER NOT NULL, position REAL NOT NULL,
    PRIMARY KEY (day, country, device)
  );

  CREATE TABLE IF NOT EXISTS cc_seo_snaps (
    day        TEXT PRIMARY KEY,
    at         TEXT NOT NULL,
    query_rows INTEGER NOT NULL,
    page_rows  INTEGER NOT NULL,
    day_rows   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cc_seo_keywords (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    /* Lower case, spaces collapsed: one phrase, one row. */
    phrase     TEXT NOT NULL UNIQUE,
    lang       TEXT,
    cluster    TEXT,
    intent     TEXT,
    /* A comma list in a fixed order: gsc,autocomplete,audit,manual. */
    sources    TEXT NOT NULL DEFAULT '',
    /* relevant | weak | irrelevant | unjudged */
    status     TEXT NOT NULL DEFAULT 'unjudged',
    status_by  TEXT,
    status_at  TEXT,
    /* The page that answers it, a path; mapped_by audit | rule | person. */
    page       TEXT,
    mapped_by  TEXT,
    local      INTEGER NOT NULL DEFAULT 0,
    question   INTEGER NOT NULL DEFAULT 0,
    price      INTEGER NOT NULL DEFAULT 0,
    note       TEXT,
    /* The seed phrase the research expanded, when it came from Autocomplete. */
    seed       TEXT,
    first_seen TEXT NOT NULL,
    last_seen  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cc_seo_keywords_cluster ON cc_seo_keywords (cluster);

  CREATE TABLE IF NOT EXISTS cc_seo_clusters (
    key        TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    lang       TEXT NOT NULL,
    intent     TEXT,
    /* high | medium | low: the audit's judgement, or a person's. */
    priority   TEXT NOT NULL,
    /* The audit's order of attack, 1 first. */
    rank       INTEGER,
    page       TEXT,
    mapped_by  TEXT,
    /* The audit's own words about the page ("gap", "exists", "partial: …"). */
    page_said  TEXT,
    why        TEXT,
    action     TEXT,
    examples   TEXT NOT NULL DEFAULT '[]',
    source     TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cc_seo_opps (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    page         TEXT,
    keyword      TEXT,
    cluster      TEXT,
    title        TEXT NOT NULL,
    evidence     TEXT NOT NULL,
    priority     TEXT NOT NULL,
    priority_why TEXT NOT NULL,
    potential    TEXT,
    action       TEXT NOT NULL,
    early        INTEGER NOT NULL DEFAULT 0,
    /* A person's decision, never reset by a run: open | queued | in-progress | done | dismissed. */
    state        TEXT NOT NULL DEFAULT 'open',
    state_by     TEXT,
    state_at     TEXT,
    state_note   TEXT,
    /* The operator task its action queued. */
    task_id      INTEGER,
    /* 0 when the rules no longer find it; the decision above is kept. */
    active       INTEGER NOT NULL DEFAULT 1,
    cleared_at   TEXT,
    cleared_why  TEXT,
    first_seen   TEXT NOT NULL,
    last_seen    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cc_seo_opps_open ON cc_seo_opps (active, state);
  CREATE INDEX IF NOT EXISTS cc_seo_opps_page ON cc_seo_opps (page);

  CREATE TABLE IF NOT EXISTS cc_seo_owner_tasks (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    step       TEXT NOT NULL,
    why        TEXT,
    impact     TEXT NOT NULL,
    effort     TEXT,
    /* owner | lead-chrome */
    who        TEXT NOT NULL,
    origin     TEXT NOT NULL,
    sort       INTEGER NOT NULL DEFAULT 0,
    /* Done is a person's mark, never the desk's. */
    done       INTEGER NOT NULL DEFAULT 0,
    done_by    TEXT,
    done_at    TEXT,
    note       TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cc_seo_ai_checks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    engine      TEXT NOT NULL,
    question    TEXT NOT NULL,
    lang        TEXT NOT NULL,
    day         TEXT NOT NULL,
    kind        TEXT NOT NULL,
    /* 1 named, 0 not named, NULL the answer could not be read whole. */
    mentioned   INTEGER,
    position    INTEGER,
    competitors TEXT NOT NULL DEFAULT '[]',
    sources     TEXT NOT NULL DEFAULT '[]',
    excerpt     TEXT,
    by          TEXT NOT NULL,
    note        TEXT,
    added_by    TEXT,
    added_at    TEXT NOT NULL,
    UNIQUE (engine, question, day, by)
  );

  CREATE TABLE IF NOT EXISTS cc_seo_referrals (
    day      TEXT NOT NULL,
    source   TEXT NOT NULL,
    medium   TEXT NOT NULL,
    landing  TEXT NOT NULL,
    sessions INTEGER NOT NULL,
    users    INTEGER NOT NULL,
    PRIMARY KEY (day, source, medium, landing)
  );

  CREATE TABLE IF NOT EXISTS cc_seo_readiness (
    path       TEXT PRIMARY KEY,
    checked_at TEXT NOT NULL,
    status     INTEGER NOT NULL,
    json       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cc_seo_imports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,
    month       TEXT NOT NULL,
    columns     TEXT NOT NULL,
    rows        TEXT NOT NULL,
    hash        TEXT NOT NULL,
    imported_by TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    UNIQUE (kind, month)
  );

  CREATE TABLE IF NOT EXISTS cc_seo_competitors (
    domain     TEXT PRIMARY KEY,
    name       TEXT,
    first_seen TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cc_seo_sightings (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    domain   TEXT NOT NULL,
    name     TEXT,
    /* google | google-local | google-aio | google-ai-mode | chatgpt | perplexity | gemini | copilot | claude */
    engine   TEXT NOT NULL,
    /* organic | local-pack | named | cited */
    kind     TEXT NOT NULL,
    query    TEXT NOT NULL,
    lang     TEXT,
    cluster  TEXT,
    position INTEGER,
    day      TEXT NOT NULL,
    by       TEXT NOT NULL,
    note     TEXT,
    UNIQUE (domain, engine, kind, query, day, by)
  );
  CREATE INDEX IF NOT EXISTS cc_seo_sightings_domain ON cc_seo_sightings (domain);

  CREATE TABLE IF NOT EXISTS cc_seo_comp_pages (
    url        TEXT PRIMARY KEY,
    domain     TEXT NOT NULL,
    /* 'ranking': the address observed for the query; 'home': only the domain was observed. */
    address    TEXT NOT NULL DEFAULT 'home',
    cluster    TEXT,
    query      TEXT,
    status     INTEGER,
    title      TEXT,
    h1         TEXT,
    words      INTEGER,
    lang       TEXT,
    schema     TEXT NOT NULL DEFAULT '[]',
    price      INTEGER,
    price_text TEXT,
    fetched_at TEXT,
    error      TEXT,
    added_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cc_seo_profiles (
    key        TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL,
    url        TEXT,
    /* exists | not-found | unknown | not-checked */
    state      TEXT NOT NULL DEFAULT 'not-checked',
    state_why  TEXT,
    checked_at TEXT,
    http       INTEGER,
    /* JSON { name, address, phone } read by the check, or NULL. */
    nap        TEXT,
    /* JSON { name, address, phone, day } as the audit saw it, or NULL. */
    nap_seen   TEXT,
    owner_task TEXT,
    source     TEXT NOT NULL,
    sort       INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
`);

/** Now, as the tables write it. */
export const now = (): string => new Date().toISOString();

/** JSON from a column, or the fallback when it is empty or not JSON. */
export function json<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/* SEO › Backlinks' own (src/cc/seo/backlinks.ts), in a block of its own so nothing above is touched.
 *
 *   cc_seo_backlinks   one row per LINKING PAGE the desk knows of besides Bing's own list: a page a
 *                      person follows or had checked, a linking page from Search Console's Links
 *                      export, a referring page GA4 named. What the desk's own reading of the page
 *                      found is kept beside it: live, lost (it linked and no longer does), waiting
 *                      (read, no link yet), unreadable. first_live and lost_at are the days of the
 *                      desk's own readings: the only honest "new" and "lost".
 *   cc_seo_gsc_links   Search Console's Links tables as the owner exported them: the newest import of
 *                      a table replaces the one before. kind sites: key a site, n1 its linking pages,
 *                      n2 the pages it links to. kind pages: key a page of the website, n1 incoming
 *                      links, n2 linking sites. kind texts: key a link text, n1 its rank.
 *   cc_seo_ref_pages   GA4 sessions by day, referring ADDRESS (pageReferrer) and landing page: every
 *                      visit that came from another site whatever its medium, which the session's
 *                      source alone does not give ("ig" is no address). Counts only.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS cc_seo_backlinks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_url  TEXT NOT NULL UNIQUE,
    /* Without www. */
    source_host TEXT NOT NULL,
    /* The page of the website it links to, a path, when a reading or a source said. */
    target      TEXT,
    anchor      TEXT,
    /* JSON list of the link's own rel words as the desk read them; NULL while it has read none. */
    rel         TEXT,
    /* Who says the link exists, a comma list in a fixed order: bing,google,check,manual,ga4. */
    origins     TEXT NOT NULL,
    /* live | lost | waiting | unreadable | not-checked */
    state       TEXT NOT NULL DEFAULT 'not-checked',
    state_why   TEXT,
    http        INTEGER,
    /* 1 when a person follows it ("Links we are working on"). */
    tracked     INTEGER NOT NULL DEFAULT 0,
    note        TEXT,
    first_seen  TEXT NOT NULL,
    first_live  TEXT,
    last_live   TEXT,
    lost_at     TEXT,
    checked_at  TEXT,
    /* Google's "Last crawled" for the linking page, from the export. */
    gsc_crawled TEXT,
    added_by    TEXT,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cc_seo_backlinks_host ON cc_seo_backlinks (source_host);

  CREATE TABLE IF NOT EXISTS cc_seo_gsc_links (
    kind TEXT NOT NULL,
    key  TEXT NOT NULL,
    n1   INTEGER,
    n2   INTEGER,
    PRIMARY KEY (kind, key)
  );

  CREATE TABLE IF NOT EXISTS cc_seo_ref_pages (
    day      TEXT NOT NULL,
    referrer TEXT NOT NULL,
    host     TEXT NOT NULL,
    landing  TEXT NOT NULL,
    sessions INTEGER NOT NULL,
    PRIMARY KEY (day, referrer, landing)
  );
`);

/* Google's own actions (src/cc/seo/google-actions.ts), in a block of their own so nothing above is touched.
 *
 *   cc_seo_inspect_now  Google's URL Inspection of ONE address asked for by a person ("Inspect now"):
 *                       the newest answer per address, WHOLE, as JSON: what cc_inspect has no column
 *                       for (rich results, phone usability, the pages Google found links on, who
 *                       asked). The index state itself is also written to cc_inspect under the day
 *                       it was asked, like every other result, so every screen and the engine see it.
 *   cc_seo_announced    what the desk last told the IndexNow engines about each sitemap address: the
 *                       lastmod it had then. An address whose lastmod has moved on since, or that is
 *                       new, is "changed since the last announcement". `at` NULL: seen, never announced
 *                       by the desk (the first sight is a baseline: the website's own workflow has
 *                       announced every deployment so far).
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS cc_seo_inspect_now (
    url        TEXT PRIMARY KEY,
    path       TEXT NOT NULL,
    at         TEXT NOT NULL,
    by         TEXT NOT NULL,
    is_indexed INTEGER NOT NULL,
    coverage   TEXT,
    /* JSON: the whole answer in the contract's shape (InspectNow, web/src/contract/seo/google.ts). */
    answer     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cc_seo_inspect_now_path ON cc_seo_inspect_now (path);

  CREATE TABLE IF NOT EXISTS cc_seo_announced (
    path    TEXT PRIMARY KEY,
    lastmod TEXT,
    at      TEXT,
    by      TEXT
  );
`);

/* AI Search's own (src/cc/seo/aisearch.ts), in a block of its own so nothing above is touched.
 *
 *   cc_seo_ai_questions  the questions the owner tracks: asked of every assistant each round. A
 *                        question that was only ever recorded counts as tracked until a person
 *                        retires it here (active 0: kept with its answers, left out of the round).
 *   cc_seo_ai_removed    an answer a person removed, by assistant, question, day and recorder, so
 *                        importing the audit's files again does not bring it back. Recording it
 *                        again by hand takes the mark away.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS cc_seo_ai_questions (
    /* The question in lower case with single spaces: one question, one row. */
    key        TEXT PRIMARY KEY,
    question   TEXT NOT NULL,
    lang       TEXT NOT NULL,
    kind       TEXT NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    added_by   TEXT,
    added_at   TEXT NOT NULL,
    changed_by TEXT,
    changed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS cc_seo_ai_removed (
    engine     TEXT NOT NULL,
    /* The question's key, as in cc_seo_ai_questions. */
    question   TEXT NOT NULL,
    day        TEXT NOT NULL,
    by         TEXT NOT NULL,
    removed_by TEXT,
    removed_at TEXT NOT NULL,
    PRIMARY KEY (engine, question, day, by)
  );
`);

/* SEO › Automations' own (src/cc/seo/jobs.ts), in a block of its own so nothing above is touched.
 *
 *   cc_seo_job_runs  the runs of the jobs the SEO section depends on, copied from the scheduler's
 *                    cc_runs before it drops them: the scheduler keeps a week, and a weekly job
 *                    runs once a week, so its own table can never show two runs of one. Kept 400
 *                    days (3,000 rows a job at most). ok NULL: a restart of the desk cut it off.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS cc_seo_job_runs (
    job     TEXT NOT NULL,
    started TEXT NOT NULL,
    ended   TEXT,
    ok      INTEGER,
    note    TEXT,
    PRIMARY KEY (job, started)
  );
  CREATE INDEX IF NOT EXISTS cc_seo_job_runs_started ON cc_seo_job_runs (started);
`);

/* The full SEO audit's own (src/cc/seo/audit.ts), in a block of its own so nothing above is touched.
 *
 *   cc_seo_audits  one row per "Run full SEO audit": who asked and when, each step with how it
 *                  ended, and the section's headline counts as it started and as it ended, so a
 *                  person can see afterwards what an audit found. The newest sixty are kept.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS cc_seo_audits (
    /* The ISO time it was asked: stable for one audit. */
    id          TEXT PRIMARY KEY,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    by          TEXT NOT NULL,
    deep        INTEGER NOT NULL DEFAULT 0,
    /* running | done | failed */
    state       TEXT NOT NULL,
    /* JSON: the steps as the audit keeps them (audit.ts, KeptStep[]). */
    steps       TEXT NOT NULL,
    /* JSON: the counts when it was asked, and when it ended (contract AuditCounts); after is NULL while it runs. */
    before      TEXT NOT NULL,
    after       TEXT
  );
`);

/* The web layer's own (src/cc/seo/web/), in a block of its own so nothing above is touched.
 *
 *   cc_seo_research      what one web source answered for one researched phrase in one mode
 *                        (plain, questions, modifiers, alphabet, front), kept seven days so a
 *                        second look costs no request. web/suggest.ts.
 *   cc_seo_serp_checks   "who ranks for this phrase": one row per result page asked for, with the
 *                        engine (google or duckduckgo, never mixed up), who fetched it (the studio
 *                        workstation, the server, or DataForSEO) and what the page held. web/serp.ts.
 *   cc_seo_fetch_tasks   pages the studio workstation is asked to fetch (POST /runner/fetch/next):
 *                        the address and headers handed out, and how it ended. The page itself is
 *                        parsed on arrival and never kept. web/fetchq.ts.
 *   cc_seo_domain_facts  what the open web says about any typed domain, one row per fact as a
 *                        Reading (JSON), kept seven days. web/domain.ts.
 *
 * And columns added to tables above: a demand figure on each keyword with its source and day
 * (web/volumes.ts), and the title and address of a result on each sighting (web/serp.ts).
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS cc_seo_research (
    seed     TEXT NOT NULL,
    lang     TEXT NOT NULL,
    country  TEXT NOT NULL,
    /* plain | questions | modifiers | alphabet | front */
    mode     TEXT NOT NULL,
    /* google | bing */
    source   TEXT NOT NULL,
    /* JSON: [{ phrase, strength, type, from }] exactly as the source ordered them. */
    rows     TEXT NOT NULL,
    requests INTEGER NOT NULL,
    asked_by TEXT,
    asked_at TEXT NOT NULL,
    PRIMARY KEY (seed, lang, country, mode, source)
  );

  CREATE TABLE IF NOT EXISTS cc_seo_serp_checks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    phrase       TEXT NOT NULL,
    lang         TEXT NOT NULL,
    country      TEXT NOT NULL,
    /* google | duckduckgo */
    engine       TEXT NOT NULL,
    /* queued | running | done | failed */
    state        TEXT NOT NULL,
    /* workstation | server | dataforseo */
    source       TEXT NOT NULL,
    cluster      TEXT,
    requested_by TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    done_at      TEXT,
    error        TEXT,
    /* JSON: { organic, localPack, ads, adHosts, related, questions } (web/parse.ts SerpResult). */
    result       TEXT,
    /* Balkaris's own position among the organic results; NULL = not in the first ten (or not done). */
    own_position INTEGER,
    /* The workstation's fetch task, when one was queued for it. */
    fetch_id     INTEGER
  );
  CREATE INDEX IF NOT EXISTS cc_seo_serp_checks_phrase ON cc_seo_serp_checks (phrase, lang, engine, id DESC);
  CREATE INDEX IF NOT EXISTS cc_seo_serp_checks_state ON cc_seo_serp_checks (state);

  CREATE TABLE IF NOT EXISTS cc_seo_fetch_tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    /* What the page is for: 'serp'. */
    purpose    TEXT NOT NULL,
    /* The row it belongs to (cc_seo_serp_checks.id). */
    ref        INTEGER,
    /* google | duckduckgo: each has its own pace and allowance. */
    lane       TEXT NOT NULL,
    url        TEXT NOT NULL,
    /* JSON: the request headers the workstation sends. */
    headers    TEXT NOT NULL,
    timeout_ms INTEGER NOT NULL,
    max_bytes  INTEGER NOT NULL,
    /* queued | running | done | failed */
    state      TEXT NOT NULL DEFAULT 'queued',
    attempts   INTEGER NOT NULL DEFAULT 0,
    runner     TEXT,
    created_at TEXT NOT NULL,
    taken_at   TEXT,
    done_at    TEXT,
    status     INTEGER,
    final_url  TEXT,
    bytes      INTEGER,
    error      TEXT
  );
  CREATE INDEX IF NOT EXISTS cc_seo_fetch_tasks_state ON cc_seo_fetch_tasks (state, id);

  CREATE TABLE IF NOT EXISTS cc_seo_domain_facts (
    domain   TEXT NOT NULL,
    /* registration | robots | sitemap | home | tranco | wayback | commoncrawl | wikipedia | crux | pagespeed */
    fact     TEXT NOT NULL,
    /* JSON: the fact as a Reading (ok with its value, or off / waiting with the reason). */
    reading  TEXT NOT NULL,
    at       TEXT NOT NULL,
    asked_by TEXT,
    PRIMARY KEY (domain, fact)
  );
`);

/**
 * Add a column a table made earlier may not have yet: SQLite has no "ADD COLUMN IF NOT EXISTS",
 * and the box's database was created before the web layer existed.
 */
export function addColumn(table: string, column: string, type: string): void {
  const have = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
  if (!have) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/* A keyword's demand figures, each with where it came from and when (web/volumes.ts). NULL = nobody has given one. */
for (const [column, type] of [
  ["volume", "INTEGER"],
  ["volume_low", "INTEGER"],
  ["volume_high", "INTEGER"],
  ["cpc", "REAL"],
  ["cpc_currency", "TEXT"],
  ["competition", "TEXT"],
  ["competition_index", "INTEGER"],
  ["volume_source", "TEXT"],
  ["volume_at", "TEXT"],
  ["difficulty", "INTEGER"],
  ["difficulty_source", "TEXT"],
  ["difficulty_at", "TEXT"],
] as const) {
  addColumn("cc_seo_keywords", column, type);
}
/* The result itself beside a sighting read from a result page: its title and its address. */
addColumn("cc_seo_sightings", "title", "TEXT");
addColumn("cc_seo_sightings", "url", "TEXT");
