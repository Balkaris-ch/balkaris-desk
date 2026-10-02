import type { SourceId } from "@/contract/common";
import type { JobState, RunState } from "@/contract/automations";
import type { ChipTone } from "@/components/ui/Badge";
import type { IconName } from "@/components/ui/icons";

/**
 * How the Automations screen says things. Plain functions and tables, so the
 * server's components and the browser's both print a job the same way.
 */

/** "every 2 minutes", "every 3 hours", "once a day". */
export function everyText(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s % 86_400 === 0) return s === 86_400 ? "once a day" : `every ${s / 86_400} days`;
  if (s % 3600 === 0) return s === 3600 ? "every hour" : `every ${s / 3600} hours`;
  if (s % 60 === 0) return s === 60 ? "every minute" : `every ${s / 60} minutes`;
  return `every ${s} seconds`;
}

/**
 * A job's state as a word and a tone. "Waiting" is never red: a credential
 * nobody has created yet is not a fault. It says "access", not "a key": a
 * source can have its key and still wait for an API to be enabled or an
 * account to be added (Search Console).
 */
export const STATE: Record<JobState, { label: string; tone: ChipTone }> = {
  running: { label: "Running", tone: "info" },
  ok: { label: "Success", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  waiting: { label: "Waiting for access", tone: "warn" },
  paused: { label: "Paused by Google", tone: "warn" },
  off: { label: "Switched off", tone: "quiet" },
  new: { label: "Not run yet", tone: "quiet" },
};

/** One run's end, as a dot, a word and a title. A run a restart cut off is quiet: it neither failed nor finished. */
export const RUN_STATE: Record<RunState, { tone: ChipTone; word: string; title: string }> = {
  running: { tone: "info", word: "running", title: "Running now" },
  cut: { tone: "quiet", word: "cut off", title: "Cut off by a restart of the desk: it neither finished nor failed" },
  ok: { tone: "good", word: "", title: "Finished" },
  failed: { tone: "bad", word: "", title: "Failed" },
};

/** The icon beside a job, by what it reads. */
export const SOURCE_ICON: Partial<Record<SourceId, IconName>> = {
  probe: "pulse",
  repo: "branch",
  crawl: "sitemap",
  psi: "gauge",
  "ga4-live": "users",
  ga4: "line-chart",
  gsc: "search",
  bing: "link",
  clarity: "eye",
  crux: "gauge",
};

/** A few jobs read the same source but are better told apart by what they do. */
export const JOB_ICON: Record<string, IconName> = {
  crawl: "file-text",
  assets: "image",
  sitemap: "sitemap",
};

/** The article writer's kinds of work, as a person says them. */
export const WORK_KIND: Record<string, string> = {
  write: "Writing an article",
  ingest: "Reading a shared video or post",
  cover: "Drawing a cover",
  clip: "Cutting a preview clip",
  reclose: "Rewriting a closing",
};

export const workKind = (kind: string): string => WORK_KIND[kind] ?? kind;

/** "0.4s", "39s", "2m 14s": a run's length. */
export function took(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 10) return `${(Math.round(s * 10) / 10).toString()}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  if (m < 60) return `${m}m ${String(rest).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** "Errors", "Warnings": the log's tone filter. */
export const TONE_WORD: Record<string, { one: string; many: string; tone: ChipTone }> = {
  bad: { one: "Error", many: "Errors", tone: "bad" },
  warn: { one: "Warning", many: "Warnings", tone: "warn" },
  good: { one: "Success", many: "Successes", tone: "good" },
  info: { one: "Info", many: "Info", tone: "info" },
  quiet: { one: "Note", many: "Notes", tone: "quiet" },
};

/** The log's kinds, named. A kind not listed is printed as it is stored. */
export const KIND_WORD: Record<string, string> = {
  deploy: "Deployment",
  insight: "Article",
  sitemap: "Sitemap",
  page: "Page change",
  crawl: "Crawl",
  incident: "Incident",
  probe: "Probe",
  automation: "Automation",
};

export const kindWord = (kind: string): string => KIND_WORD[kind] ?? kind.replace(/[._-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
