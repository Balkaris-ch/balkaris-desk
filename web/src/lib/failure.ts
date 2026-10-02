/**
 * The ways the desk server can fail to answer, named once so the code that
 * throws (lib/api.ts, server only) and the screens that explain (error.tsx,
 * in the browser) agree without importing each other.
 *
 *   signed-out  401. Nobody is signed in.
 *   off         403 because this account was switched off.
 *   forbidden   403 for one part only: the account is in, but may not see this
 *               (enquiries, the owner's settings).
 *   down        The server did not answer at all, or its gateway said so.
 *   missing     404. The server has nothing at this path.
 *   error       Anything else: a 500, or an answer that is not JSON.
 */
export type Failure = "signed-out" | "off" | "forbidden" | "down" | "missing" | "error";

/** A failure that is shown rather than redirected. */
export type ShownFailure = Exclude<Failure, "signed-out">;

/**
 * What a thrown `DeskError` carries as its `digest`. In production Next strips
 * a server error's message before it reaches the browser but keeps a digest
 * that was already set, so this is the one thing an error screen can read.
 */
export const DIGEST: Record<ShownFailure, string> = {
  down: "DESK_DOWN",
  off: "DESK_OFF",
  forbidden: "DESK_FORBIDDEN",
  missing: "DESK_MISSING",
  error: "DESK_ERROR",
};

/** The failure a digest stands for, or null when the error is not the desk's. */
export function failureOf(digest: string | undefined): ShownFailure | null {
  const hit = (Object.keys(DIGEST) as ShownFailure[]).find((k) => DIGEST[k] === digest);
  return hit ?? null;
}
