import type { Reading, SourceStatus } from "../../../web/src/contract/common.ts";
import { accountEmail } from "../gauth.ts";
import type { Job } from "../scheduler.ts";
import { cached, off, ok, record, waiting } from "../store.ts";
import { answered, ask, base, failed, placeOnBox, round, siteOrigin, SourceError, statusOf } from "./shared.ts";

/**
 * The Chrome UX Report: how fast the site was for real people in Chrome.
 *
 * FIELD DATA, NOT A LAB RUN. PageSpeed Insights loads a page once on Google's
 * machine; this is the 75th percentile of what visitors' own browsers
 * measured over the last 28 days. It is the only free source of INP, which a
 * lab run cannot produce at all.
 *
 * GOOGLE MAY HAVE NOTHING. An origin is in the report only when enough people
 * visit it in Chrome; the number is not published, and a site this size may
 * well be under it. Then the API answers 404, and that is a fact about the
 * site, not a fault: the reading is "off: Google has no field data for this
 * site yet", with no step, because nothing a person does today changes it.
 *
 * One API key, free, 150 requests a minute; the desk asks four times a day.
 * The history is weekly (each point is a 28-day window ending on a Saturday).
 *
 *   https://developer.chrome.com/docs/crux/api
 *   https://developer.chrome.com/docs/crux/history-api
 */

const API = (): string => base("CRUX_API_BASE", "https://chromeuxreport.googleapis.com/v1");
const apiKey = (): string => (process.env.GOOGLE_API_KEY ?? "").trim();

export const configured = (): boolean => !!apiKey();

const REASON = "The Chrome UX Report is not connected: the desk has no Google API key.";
const NO_DATA = "Google has no field data for this site yet.";

/**
 * The same key serves the lab runs (PageSpeed Insights), so the step asks for
 * both APIs at once. Console path as in
 * https://docs.cloud.google.com/docs/authentication/api-keys (read 2 October
 * 2026): Credentials, Create credentials, API key, at least one restriction,
 * Create. The key is made in the project the desk's service account lives in,
 * so Google's console has one project for the desk.
 */
export function step(): string {
  const project = accountEmail()?.match(/@([^.]+)\.iam\.gserviceaccount\.com$/)?.[1] ?? "the desk's Google Cloud project";
  return `In the Google Cloud console choose the project ${project}, open APIs & Services, Library and enable "Chrome UX Report API" and "PageSpeed Insights API", then open Credentials, press Create credentials, API key, restrict it to those two APIs and press Create, ${placeOnBox("GOOGLE_API_KEY")}.`;
}

export function status(): SourceStatus {
  return statusOf({
    id: "crux",
    name: "Chrome UX Report",
    feeds: "Field Core Web Vitals (LCP, INP, CLS at the 75th percentile) and their weekly history, when Google has any for the site",
    connected: configured(),
    offReason: REASON,
    step: step(),
  });
}

/* ---------- asking -------------------------------------------------------- */

export type FormFactor = "ALL" | "PHONE" | "DESKTOP" | "TABLET";

const METRICS = ["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift", "first_contentful_paint", "experimental_time_to_first_byte"];

/** Google's refusals: { error: { code, message, status, details: [{ reason }] } }. The reason decides, the wording does not. */
function refusal(status: number, json: unknown): SourceError {
  const err = ((json as { error?: unknown } | null)?.error ?? {}) as { status?: string; details?: { reason?: string }[] };
  const reasons = (err.details ?? []).map((d) => String(d?.reason ?? "")).concat(String(err.status ?? ""));
  const has = (...names: string[]) => reasons.some((r) => names.includes(r));
  if (status === 404) return new SourceError(404, "absent", NO_DATA, "NOT_FOUND");
  if (has("API_KEY_INVALID") || status === 401) return new SourceError(status, "auth", "Google says the API key is not valid", "API_KEY_INVALID");
  if (has("SERVICE_DISABLED")) return new SourceError(status, "forbidden", "The Chrome UX Report API is not enabled in the key's Cloud project", "SERVICE_DISABLED");
  if (has("API_KEY_SERVICE_BLOCKED")) return new SourceError(status, "forbidden", "The API key is not allowed to call the Chrome UX Report API: add it to the key's API restrictions", "API_KEY_SERVICE_BLOCKED");
  if (status === 429 || has("RATE_LIMIT_EXCEEDED", "RESOURCE_EXHAUSTED")) return new SourceError(status, "quota", "The Chrome UX Report was asked too often; it answers again within a minute", "QUOTA");
  if (status === 403) return new SourceError(403, "forbidden", "Google refused the API key for the Chrome UX Report: its restrictions do not allow this machine or this API", "FORBIDDEN");
  if (status >= 500) return new SourceError(status, "down", `The Chrome UX Report answered ${status}`);
  return new SourceError(status, "request", `The Chrome UX Report did not accept the request (${status})`);
}

/**
 * One question. Null when Google has no data for the origin: that 404 is an
 * answer, and the source counts as having answered. The key travels in the
 * address, so the address is never logged.
 */
async function call<T>(method: "queryRecord" | "queryHistoryRecord", body: Record<string, unknown>): Promise<T | null> {
  try {
    if (!configured()) throw new SourceError(0, "auth", REASON, "NO_KEY");
    const res = await ask("The Chrome UX Report", `${API()}/records:${method}?key=${encodeURIComponent(apiKey())}`, { method: "POST", body });
    if (res.status === 404) {
      answered("crux");
      return null;
    }
    if (res.status !== 200) throw refusal(res.status, res.json);
    answered("crux");
    return res.json as T;
  } catch (e) {
    failed("crux", e);
    throw e;
  }
}

/* ---------- the newest 28 days -------------------------------------------- */

/** One vital at the 75th percentile, with how visits split over Google's three bands. */
export interface Vital {
  /** LCP, INP, FCP and TTFB in milliseconds; CLS without a unit. */
  p75: number;
  /** Share of page loads in each band, in percent. Null when Google sent no histogram. */
  good: number | null;
  needsImprovement: number | null;
  poor: number | null;
}

export interface FieldVitals {
  origin: string;
  formFactor: FormFactor;
  lcp: Vital | null;
  inp: Vital | null;
  cls: Vital | null;
  fcp: Vital | null;
  ttfb: Vital | null;
  /** The 28 days the figures cover: YYYY-MM-DD. */
  from: string | null;
  to: string | null;
}

interface RawMetric {
  histogram?: { density?: number | string }[];
  percentiles?: { p75?: number | string | null };
}

const date = (d?: { year?: number; month?: number; day?: number }): string | null =>
  d?.year && d.month && d.day ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null;

/** Google sends CLS as a string ("0.05") and the others as numbers; both are read. */
function vital(m?: RawMetric): Vital | null {
  const p75 = m?.percentiles?.p75;
  if (p75 == null || !Number.isFinite(Number(p75))) return null;
  const share = (i: number) => {
    const d = Number(m?.histogram?.[i]?.density);
    return Number.isFinite(d) ? round(d * 100, 1) : null;
  };
  return { p75: Number(p75), good: share(0), needsImprovement: share(1), poor: share(2) };
}

type Kept<T> = { none: true } | { none: false; value: T };

const HOUR = 3_600_000;
const KEEP = 26 * HOUR;
const CAVEAT = "Field data: the 75th percentile of real Chrome visits over 28 days, for the whole site. Not a lab run.";

export interface ReadOptions {
  /** Ask Google now instead of using the kept answer. The daily job does; a screen does not. */
  fresh?: boolean;
}

async function read<T>(key: string, o: ReadOptions, askGoogle: () => Promise<T | null>): Promise<Reading<T>> {
  if (!configured()) return off("crux", REASON, step());
  try {
    const had = await cached<Kept<T>>(`crux:${key}`, o.fresh ? 0 : KEEP, async () => {
      const value = await askGoogle();
      return value === null ? { none: true } : { none: false, value };
    });
    if (had.value.none) return off("crux", NO_DATA);
    return ok(had.value.value, "crux", had.at, had.stale ? `${CAVEAT} Kept from the last good read; the newest attempt failed.` : CAVEAT);
  } catch (e) {
    return waiting("crux", `The last read failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
  }
}

/**
 * The site's Core Web Vitals as visitors experienced them. "ALL" is every
 * device together; PHONE and DESKTOP are narrower and so even less likely to
 * have data. Off, without a step, when Google has none.
 */
export function vitals(formFactor: FormFactor = "ALL", o: ReadOptions = {}): Promise<Reading<FieldVitals>> {
  const origin = siteOrigin();
  return read<FieldVitals>(`vitals:${formFactor}`, o, async () => {
    const got = await call<{ record?: { metrics?: Record<string, RawMetric>; collectionPeriod?: { firstDate?: object; lastDate?: object } } }>("queryRecord", {
      origin,
      metrics: METRICS,
      ...(formFactor === "ALL" ? {} : { formFactor }),
    });
    if (!got?.record) return null;
    const m = got.record.metrics ?? {};
    return {
      origin,
      formFactor,
      lcp: vital(m.largest_contentful_paint),
      inp: vital(m.interaction_to_next_paint),
      cls: vital(m.cumulative_layout_shift),
      fcp: vital(m.first_contentful_paint),
      ttfb: vital(m.experimental_time_to_first_byte),
      from: date(got.record.collectionPeriod?.firstDate),
      to: date(got.record.collectionPeriod?.lastDate),
    };
  });
}

/* ---------- week by week --------------------------------------------------- */

/** One weekly point: the 75th percentiles over the 28 days ending on `end`. Null where Google had too few visits that week. */
export interface VitalsWeek {
  start: string | null;
  end: string | null;
  lcp: number | null;
  inp: number | null;
  cls: number | null;
}

/** The vitals week by week, oldest first, for up to forty weeks (about ten months). Google adds a point each Monday. */
export function history(formFactor: FormFactor = "ALL", o: ReadOptions = {}): Promise<Reading<{ origin: string; formFactor: FormFactor; weeks: VitalsWeek[] }>> {
  const origin = siteOrigin();
  return read(`history:${formFactor}`, o, async () => {
    const got = await call<{
      record?: {
        metrics?: Record<string, { percentilesTimeseries?: { p75s?: (number | string | null)[] } }>;
        collectionPeriods?: { firstDate?: object; lastDate?: object }[];
      };
    }>("queryHistoryRecord", {
      origin,
      metrics: METRICS.slice(0, 3),
      collectionPeriodCount: 40,
      ...(formFactor === "ALL" ? {} : { formFactor }),
    });
    if (!got?.record) return null;
    const m = got.record.metrics ?? {};
    /* A week without enough visits comes back as null (or the word "NaN"); it stays null. */
    const at = (name: string, i: number): number | null => {
      const v = m[name]?.percentilesTimeseries?.p75s?.[i];
      return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
    };
    const weeks = (got.record.collectionPeriods ?? []).map((p, i) => ({
      start: date(p.firstDate),
      end: date(p.lastDate),
      lcp: at("largest_contentful_paint", i),
      inp: at("interaction_to_next_paint", i),
      cls: at("cumulative_layout_shift", i),
    }));
    return { origin, formFactor, weeks };
  });
}

/* ---------- the daily read -------------------------------------------------- */

/** Refresh what the screens show and write the day's three figures into the desk's own series. */
async function daily(): Promise<string> {
  const all = await vitals("ALL", { fresh: true });
  if (all.state === "waiting") throw new Error(all.reason);
  if (all.state === "off") return all.reason;

  if (all.value.lcp) record("crux.lcp", all.value.lcp.p75);
  if (all.value.inp) record("crux.inp", all.value.inp.p75);
  if (all.value.cls) record("crux.cls", all.value.cls.p75);

  const rest = [await vitals("PHONE", { fresh: true }), await vitals("DESKTOP", { fresh: true }), await history("ALL", { fresh: true })];
  const failures = rest.filter((r) => r.state === "waiting").length;
  if (failures) throw new Error(`${failures} of the Chrome UX Report reads failed and kept their last answer`);
  return `Field vitals for ${all.value.from} to ${all.value.to} read`;
}

export const jobs: Job[] = [
  {
    name: "crux-daily",
    title: "Read field speed from the Chrome UX Report",
    every: 24 * 3600,
    delay: 480,
    ready: configured,
    run: () => daily(),
  },
];
