/**
 * What the "run the crawl" action answered, as a code in the address
 * (`?crawl=started`). The address carries only one of these codes and the
 * screen prints the fixed sentence for it, so a link someone else writes
 * cannot make the desk show words of theirs. An unknown code shows nothing.
 *
 * A plain module (not "use server", not a client one): the action writes the
 * code, the two screens read it.
 */

export const CRAWL_CODES = ["started", "running", "wait", "off", "failed"] as const;
export type CrawlCode = (typeof CRAWL_CODES)[number];

const SAID: Record<CrawlCode, { text: string; good: boolean }> = {
  started: { text: "The crawl has started. It reads every page in about a minute; reload then to see the screen follow.", good: true },
  running: { text: "The crawl is running now. Reload in a minute to see what it found.", good: true },
  wait: { text: "The crawl ran or was asked for a moment ago, so it was not started again. It can be asked for again in a few minutes.", good: false },
  off: { text: "The crawl cannot be started from here: it is switched off or not ready. Automations says why.", good: false },
  failed: { text: "The desk server did not take the request. Try again in a moment.", good: false },
};

/** The sentence for a code from the address, or null for none or anything unknown. */
export function crawlSaid(code: string | undefined): { text: string; good: boolean } | null {
  const known = CRAWL_CODES.find((c) => c === code);
  return known ? SAID[known] : null;
}
