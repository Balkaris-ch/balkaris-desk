import type { BuildState, DrainKind, PlatformStatus } from "@/contract/hosting";

type Tone = "good" | "warn" | "bad" | "info" | "quiet";

/** A production build's state as a chip: Vercel's word, the desk's tone. */
export const BUILD_STATE: Record<BuildState, { tone: Tone; text: string; tip: string }> = {
  READY: { tone: "good", text: "Ready", tip: "Vercel built it and it can serve." },
  ERROR: { tone: "bad", text: "Failed", tip: "Vercel's build failed." },
  BUILDING: { tone: "info", text: "Building", tip: "Vercel is building it now." },
  QUEUED: { tone: "quiet", text: "Queued", tip: "Waiting for Vercel to start the build." },
  INITIALIZING: { tone: "info", text: "Starting", tip: "Vercel is preparing the build." },
  CANCELED: { tone: "quiet", text: "Canceled", tip: "The build was canceled, usually by a newer push." },
  BLOCKED: { tone: "warn", text: "Blocked", tip: "Vercel blocked the build." },
  DELETED: { tone: "quiet", text: "Deleted", tip: "The deployment was deleted." },
};

/** A status page component's state as a tone. */
export function componentTone(status: string): Tone {
  if (status === "operational") return "good";
  if (status === "degraded_performance" || status === "under_maintenance") return "warn";
  if (status === "partial_outage" || status === "major_outage") return "bad";
  return "quiet";
}

/** Statuspage's words as a person says them. */
export function componentWord(status: string): string {
  return (
    {
      operational: "Operational",
      degraded_performance: "Degraded",
      partial_outage: "Partial outage",
      major_outage: "Major outage",
      under_maintenance: "Maintenance",
    }[status] ?? status
  );
}

/** The watched parts in one word: the worst of them. */
export function platformWord(p: PlatformStatus): string {
  const order = ["major_outage", "partial_outage", "degraded_performance", "under_maintenance", "operational"];
  const worst = [...p.components].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))[0];
  return worst ? componentWord(worst.status) : "Unknown";
}

/** Each kind of record by name, as the counting panel lists it. */
export const KIND_NAME: Record<DrainKind, string> = {
  view: "Page loads",
  navigation: "In-site navigations",
  prefetch: "Prefetches",
  rsc: "Router requests, unproved",
  file: "Files",
  api: "API calls",
  bot: "Robots",
  notFound: "404s",
  redirect: "Redirects",
  serverError: "Server errors",
  otherStatus: "Other answers",
  otherHost: "Other hosts",
  method: "Not GET",
  noRequest: "Not a request",
  duplicate: "Duplicates",
};
