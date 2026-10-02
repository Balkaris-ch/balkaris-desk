import { DASH, num } from "@/lib/format";

/** GA4's device words as a person writes them: "desktop" is "Desktop", "smart tv" is "Smart TV". */
export function deviceLabel(key: string): string {
  if (!key || key.startsWith("(")) return "Unknown";
  if (key.toLowerCase() === "smart tv") return "Smart TV";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * A share of sessions that were engaged. Under thirty sessions a percentage is
 * noise, so it is the two counts: "3 of 5". From thirty on, "62%".
 */
export function engagedText(engaged: number, sessions: number): string {
  if (sessions <= 0) return DASH;
  if (sessions < 30) return `${num(engaged)} of ${num(sessions)}`;
  return `${Math.round((engaged / sessions) * 100)}%`;
}

/** The value an engaged column sorts by: its rate, or null with no sessions. */
export const engagedSort = (engaged: number, sessions: number): number | null => (sessions > 0 ? engaged / sessions : null);

/** GA4's placeholders as words: "(not set)" is a session GA4 could not place, "(direct)" a visit with no referrer. */
export function gaWord(value: string, unknown = "Unknown"): string {
  if (!value || value === "(not set)") return unknown;
  if (value === "(direct)") return "Direct";
  if (value === "(none)") return "none";
  return value;
}
