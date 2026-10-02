import { fullDate, zurich } from "@/lib/format";

/** "Good morning" before noon, "Good afternoon" before six, "Good evening" after, by the studio's clock (Europe/Zurich). */
export function greetingAt(now: Date = new Date()): string {
  const h = zurich(now)?.hour ?? 12;
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** The first word of a person's name: "Fini" from "Fini", "Miron" from "Miron Fini". */
export const firstName = (name: string | null | undefined): string => (name ?? "").trim().split(/\s+/)[0] ?? "";

/** "2 Oct": a day in prose, the year left out. */
export const dayMonth = (when: string): string => fullDate(when).replace(/ \d{4}$/, "");
