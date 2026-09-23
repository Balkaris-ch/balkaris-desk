import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * What the website's own pages actually did, read from GA4.
 *
 * Fini, 23 September 2026: *"I don't see the views. I need to see the views…
 * these views like comment, share, saved is from the video. But I also need
 * the metric of the page. Like how many views we have. How much time people
 * spend on the page."*
 *
 * Two different numbers sit side by side on a draft, and they answer one
 * question together: did an article built on a post that performed well,
 * itself perform well? The source's likes are the post's; these are ours.
 *
 * NO LIBRARY. A service-account call is a JWT you sign, a token you exchange
 * and one POST — about sixty lines — and google-auth-library would be a
 * dependency tree an order of magnitude larger than the thing it wraps. The
 * pattern was proved before anything was built on it.
 *
 * THE CAVEAT IS PART OF THE NUMBER. GA4 only fires after a visitor accepts
 * the cookie banner, so every figure here undercounts by however many decline.
 * It is a fair comparison BETWEEN articles and it is not an audited count, and
 * the console says so in words rather than printing a confident number.
 */

const PROPERTY = process.env.GA4_PROPERTY_ID ?? "543223467";
const KEY_FILE = process.env.GA4_CREDENTIALS_FILE ?? "/opt/balkaris-desk/ga4.json";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

interface Key {
  client_email: string;
  private_key: string;
}

function key(): Key | null {
  try {
    const k = JSON.parse(readFileSync(KEY_FILE, "utf8")) as Key;
    return k.client_email && k.private_key ? k : null;
  } catch {
    return null;
  }
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** Tokens last an hour; asking for a new one per request would be silly. */
let cached: { token: string; until: number } | null = null;

async function token(): Promise<string | null> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;

  const k = key();
  if (!k) return null;

  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: k.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now };
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(k.private_key, "base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google refused the analytics key (${res.status})`);

  const { access_token, expires_in } = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!access_token) throw new Error("no access token came back");
  cached = { token: access_token, until: Date.now() + (expires_in ?? 3600) * 1000 };
  return access_token;
}

export interface PageStats {
  path: string;
  views: number;
  people: number;
  /** Average seconds a visitor spent on it. Rounded; nobody needs decimals. */
  seconds: number;
}

/**
 * Every /insights page, over the last `days`.
 *
 * One call for all of them rather than one per article: the desk shows a list
 * far more often than it shows one piece, and a report is a report whether it
 * carries two rows or forty.
 */
export async function insightsPages(days = 28): Promise<Map<string, PageStats>> {
  const t = await token();
  const out = new Map<string, PageStats>();
  if (!t) return out;

  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`, {
    method: "POST",
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }, { name: "userEngagementDuration" }],
      dimensionFilter: {
        filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: "/insights/" } },
      },
      limit: 200,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) throw new Error(`GA4 answered ${res.status}: ${(await res.text()).slice(0, 160)}`);

  const json = (await res.json()) as {
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  };

  for (const r of json.rows ?? []) {
    const path = (r.dimensionValues[0]?.value ?? "").replace(/\/$/, "");
    const views = Number(r.metricValues[0]?.value ?? 0);
    const people = Number(r.metricValues[1]?.value ?? 0);
    const engaged = Number(r.metricValues[2]?.value ?? 0);
    if (!path) continue;
    out.set(path, {
      path,
      views,
      people,
      /* userEngagementDuration is the TOTAL seconds across everyone, so the
         average is per view rather than a metric GA4 hands over directly. */
      seconds: views ? Math.round(engaged / views) : 0,
    });
  }
  return out;
}

/**
 * The console asks constantly and GA4 has a daily quota, so a reading is kept
 * for ten minutes. An article's view count does not change meaningfully in
 * that window, and a console that burns the quota by lunchtime shows nothing
 * all afternoon.
 */
let sheet: { at: number; pages: Map<string, PageStats>; error: string | null } | null = null;

export async function pages(): Promise<{ pages: Map<string, PageStats>; error: string | null; age: number }> {
  if (sheet && Date.now() - sheet.at < 10 * 60_000) {
    return { pages: sheet.pages, error: sheet.error, age: Date.now() - sheet.at };
  }
  try {
    const got = await insightsPages();
    sheet = { at: Date.now(), pages: got, error: null };
  } catch (e) {
    /* Keep whatever was last read: a stale number with its age shown beats an
       empty column that looks like "nobody visited". */
    const why = e instanceof Error ? e.message : String(e);
    sheet = { at: Date.now(), pages: sheet?.pages ?? new Map(), error: why };
  }
  return { pages: sheet.pages, error: sheet.error, age: 0 };
}

export const configured = (): boolean => !!key();

/** Seconds as a person says them. */
export const spell = (s: number): string => {
  if (!s) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
};
