import type { SourceStatus } from "../../web/src/contract/common.ts";

/**
 * Every source the command center reads, and whether it is answering.
 *
 * Each collector registers one function that reports on itself. Settings
 * lists them, and the top bar's light is green only when none is failing.
 *
 * `off` is not a failure. A source nobody has connected yet says what would
 * connect it and is otherwise left out of the light: the desk must not show
 * red for a credential that was never meant to exist yet.
 */
type Report = () => SourceStatus;

const reports: Report[] = [];

export function registerSource(...list: Report[]): void {
  reports.push(...list);
}

/**
 * A thing the top bar's light vouches for: "the website answers", "the last
 * crawl finished". A collector registers the checks only it can make. The
 * light can only vouch for what is checked, so when it is not green it names
 * the check that failed.
 */
export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checkers: (() => Check | null)[] = [];

/** Return null while there is nothing to say yet (no first run). */
export function registerCheck(...list: (() => Check | null)[]): void {
  checkers.push(...list);
}

export function checks(): Check[] {
  const out: Check[] = [];
  for (const c of checkers) {
    try {
      const r = c();
      if (r) out.push(r);
    } catch (e) {
      out.push({ name: "A check that could not run", ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export function sources(): SourceStatus[] {
  return reports.map((r) => {
    try {
      return r();
    } catch (e) {
      return {
        id: "none",
        name: "A source that could not report",
        state: "failing",
        feeds: "",
        lastOk: null,
        error: e instanceof Error ? e.message : String(e),
      } satisfies SourceStatus;
    }
  });
}
