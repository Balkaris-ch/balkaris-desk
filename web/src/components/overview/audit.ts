/**
 * What the desk said to the last "Run SEO audit" press, as it travels in the
 * Command Center's address: `?audit=<code>.<ms>`. Only a fixed code and the
 * moment of the press go there, never words: the line under Quick actions
 * maps each code to a sentence of its own and reads every detail from the
 * crawl job, so nothing typed into an address is ever printed as the desk's
 * answer.
 *
 *   started  the desk queued the crawl (202)
 *   busy     it is running, or ran or was asked for a moment ago (429)
 *   off      it may not run: switched off, or what it reads is not connected (409)
 *   down     the desk server did not answer
 *   failed   any other refusal
 */
export const AUDIT_CODES = ["started", "busy", "off", "down", "failed"] as const;
export type AuditCode = (typeof AUDIT_CODES)[number];

export interface AuditSaid {
  code: AuditCode;
  /** When the button was pressed, in ms. */
  at: number;
}

/** A code older than this is forgotten: the address may be reloaded or shared long after the press. */
export const AUDIT_FRESH_MS = 10 * 60_000;

/**
 * The code in `?audit=`, or null when there is none, it is not one of ours,
 * or it is stale. A time more than a minute ahead of the server's clock is
 * not a press that happened.
 */
export function readAudit(raw: string | undefined, now = Date.now()): AuditSaid | null {
  const m = raw ? /^([a-z]+)\.(\d{13})$/.exec(raw) : null;
  if (!m) return null;
  const code = AUDIT_CODES.find((c) => c === m[1]);
  const at = Number(m[2]);
  if (!code || !Number.isSafeInteger(at) || at > now + 60_000 || now - at > AUDIT_FRESH_MS) return null;
  return { code, at };
}
