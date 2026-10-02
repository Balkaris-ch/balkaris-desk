import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * A Google access token for the desk's service account, for a given scope.
 *
 * The same sixty lines src/ga4.ts proved in September, lifted out so Search
 * Console can use the account too: a JWT signed with the key, exchanged for a
 * token that lasts an hour. No library.
 *
 * ONE ACCOUNT, READ-ONLY. `balkaris-desk-analytics@…` is a Viewer on the GA4
 * property and (once Fini adds it) a user on the Search Console property. It
 * has no project roles and can change nothing anywhere. The key file is on the
 * box at /opt/balkaris-desk/ga4.json and is never in this repository.
 */

export const SCOPES = {
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
  searchConsole: "https://www.googleapis.com/auth/webmasters.readonly",
} as const;

const KEY_FILE = (): string => process.env.GA4_CREDENTIALS_FILE ?? "/opt/balkaris-desk/ga4.json";

interface Key {
  client_email: string;
  private_key: string;
}

function key(): Key | null {
  try {
    const k = JSON.parse(readFileSync(KEY_FILE(), "utf8")) as Key;
    return k.client_email && k.private_key ? k : null;
  } catch {
    return null;
  }
}

/** True when the key file is present and readable. Says nothing about access. */
export const hasKey = (): boolean => !!key();

/** The account's address: what Fini types into "add user" in a Google console. Not a secret. */
export const accountEmail = (): string | null => key()?.client_email ?? null;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

const tokens = new Map<string, { token: string; until: number }>();

/** A bearer token for `scope`, or null when there is no key file. Throws when Google refuses the key. */
export async function token(scope: string): Promise<string | null> {
  const had = tokens.get(scope);
  if (had && had.until > Date.now() + 60_000) return had.token;

  const k = key();
  if (!k) return null;

  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: k.client_email, scope, aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now };
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
  if (!res.ok) throw new Error(`Google refused the service account key (${res.status})`);

  const { access_token, expires_in } = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!access_token) throw new Error("Google returned no access token");
  tokens.set(scope, { token: access_token, until: Date.now() + (expires_in ?? 3600) * 1000 });
  return access_token;
}
