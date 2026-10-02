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
