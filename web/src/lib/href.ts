/**
 * Where an address leads, so a link is drawn as the right element.
 *
 *   app       a screen of this interface: next/link, no page load.
 *   server    a page the desk server still draws itself (the classic console,
 *             a draft, sign-in). Next has no route for it, so it must be a
 *             plain <a>: a client-side navigation would ask Next for a screen
 *             that does not exist before falling back to a page load.
 *   external  another site: a plain <a> in a new tab.
 */
export type HrefKind = "app" | "server" | "external";

/* The same list next.config.ts rewrites to the desk server. */
const SERVER = /^\/(api|auth|logout|cover|console|draft|link|people)(\/|$|\?)/;

export function hrefKind(href: string): HrefKind {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return "external";
  return SERVER.test(href) ? "server" : "app";
}
