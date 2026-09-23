import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signing in with Google, and only at balkaris.ch.
 *
 * Fini, 23 September 2026: *"I don't need login with Telegram. I need login
 * with Gmail, and only domain level can have access to this desk."*
 *
 * So the way in is a Google account on the company's own domain, and the
 * check is made HERE, on the token Google signed, not in the button. A
 * consent screen with `hd=balkaris.ch` only hints at a domain — the account
 * picker still shows every account and a determined person can carry a
 * personal one through it. `verify()` reads the `hd` claim out of the signed
 * id_token and refuses anything that is not ours.
 *
 * WHY THIS REPLACES THE TELEGRAM LOGIN AND NOT MUCH ELSE: the email is now
 * the identity, and the email is exactly what publishing needs — a commit
 * authored by somebody Vercel recognises. So signing in and being allowed to
 * publish stop being two separate facts a person has to keep in step.
 * Telegram keeps its own job: sharing links, and the byline on the article.
 *
 * No library. The whole flow is two HTTPS calls and one JWT to read, and a
 * dependency here would be more surface than the thing it wraps.
 */

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const CERTS = "https://www.googleapis.com/oauth2/v3/certs";

/** The one domain allowed in. Anything else is refused at the callback. */
export const DOMAIN = process.env.DESK_GOOGLE_DOMAIN ?? "balkaris.ch";

export interface GoogleClient {
  id: string;
  secret: string;
  redirect: string;
}

/**
 * The client, read from the file Google gives you when you create it.
 *
 * Straight from the download rather than copied into a second file by hand:
 * one less place for a value to live, and one less transcription to get
 * wrong. The path is the only thing configured.
 */
export function client(): GoogleClient | null {
  const inlineId = process.env.GOOGLE_CLIENT_ID;
  const inlineSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (inlineId && inlineSecret) {
    return { id: inlineId, secret: inlineSecret, redirect: redirectUri() };
  }

  const file = process.env.GOOGLE_OAUTH_FILE;
  if (!file) return null;
  try {
    /* Synchronous on purpose: it happens once per sign-in, and an async read
       here would make every caller async for no benefit. */
    const raw = require("node:fs").readFileSync(file, "utf8") as string;
    const json = JSON.parse(raw) as Record<string, { client_id?: string; client_secret?: string }>;
    const c = json.web ?? json.installed ?? Object.values(json)[0];
    if (!c?.client_id || !c.client_secret) return null;
    return { id: c.client_id, secret: c.client_secret, redirect: redirectUri() };
  } catch {
    return null;
  }
}

export const redirectUri = (): string =>
  `${(process.env.DESK_URL ?? "https://desk.balkaris.ch").replace(/\/$/, "")}/auth/google/callback`;

/* ---------- the round trip ------------------------------------------------- */

/**
 * `state` is a signed, expiring token, not a random string in a table.
 *
 * It only has to prove that the callback answers a request this server
 * actually started, which an HMAC does without any storage to clean up or go
 * stale.
 */
function stateSecret(): string {
  return process.env.DESK_RUNNER_SECRET ?? "";
}

export function mintState(): string {
  const payload = `${randomBytes(12).toString("hex")}.${Date.now() + 10 * 60_000}`;
  const mac = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function checkState(state: string): boolean {
  const [nonce, until, mac] = (state ?? "").split(".");
  if (!nonce || !until || !mac || !stateSecret()) return false;
  if (Number(until) < Date.now()) return false;
  const want = Buffer.from(createHmac("sha256", stateSecret()).update(`${nonce}.${until}`).digest("base64url"));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function authUrl(c: GoogleClient, state: string): string {
  const q = new URLSearchParams({
    client_id: c.id,
    redirect_uri: c.redirect,
    response_type: "code",
    scope: "openid email profile",
    state,
    /* A HINT, and treated as nothing more. It puts the right domain in front
       of the person; the refusal that matters happens on the claim below. */
    hd: DOMAIN,
    prompt: "select_account",
  });
  return `${AUTH}?${q}`;
}

export interface GoogleUser {
  email: string;
  name: string;
  /** The Google Workspace domain the account belongs to. Absent on a personal one. */
  hd: string | null;
  sub: string;
}

/**
 * Exchange the code, and read who it is out of the id_token.
 *
 * The token came over TLS from Google's own endpoint in direct response to
 * our request, carrying our client secret — so its payload is read rather
 * than signature-verified against Google's JWKS. That is the documented
 * shortcut for the authorisation-code flow, and it is the only place in this
 * file where a shortcut is taken; `CERTS` is kept above for the day this
 * needs to accept a token it did not fetch itself.
 */
export async function exchange(c: GoogleClient, code: string): Promise<GoogleUser> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.id,
      client_secret: c.secret,
      redirect_uri: c.redirect,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const why = (await res.text()).slice(0, 200);
    throw new Error(`Google refused the sign-in (${res.status}). ${why}`);
  }

  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("Google did not return an id_token");

  const part = id_token.split(".")[1];
  if (!part) throw new Error("the id_token is not a JWT");
  const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
    email?: string;
    name?: string;
    hd?: string;
    sub?: string;
    email_verified?: boolean;
  };

  if (!claims.email || !claims.sub) throw new Error("Google sent no email");
  if (claims.email_verified === false) throw new Error("that Google address is not verified");

  return {
    email: claims.email.toLowerCase(),
    name: claims.name ?? claims.email.split("@")[0],
    hd: claims.hd ?? null,
    sub: claims.sub,
  };
}

/**
 * Is this person allowed in?
 *
 * BOTH the `hd` claim and the address have to be ours. `hd` is the Workspace
 * domain Google itself asserts, which a personal account simply does not
 * carry; the address check catches the case of a Workspace that owns more
 * than one domain. Neither on its own is enough and together they are cheap.
 */
export function allowed(u: GoogleUser): { ok: true } | { ok: false; why: string } {
  const at = u.email.split("@")[1] ?? "";
  if (u.hd !== DOMAIN || at !== DOMAIN) {
    return {
      ok: false,
      why: `${u.email} is not a ${DOMAIN} account. The desk is for the company's own Google accounts only.`,
    };
  }
  return { ok: true };
}
