import { NextResponse, type NextRequest } from "next/server";

/**
 * What every page of the desk is sent with.
 *
 * The desk shows the studio's analytics and, to the people allowed, its
 * enquiries. So the browser is told, per request, exactly what a desk page may
 * do: run only the scripts this response names (a fresh nonce each time, and
 * whatever those scripts load themselves), talk only to its own origin, and
 * never be framed. Nothing from another site is needed by any screen: fonts
 * are served from here (next/font), there is no analytics script and no CDN.
 *
 * Next reads the nonce back out of the request's Content-Security-Policy
 * header while it renders and puts it on its own scripts, which is why the
 * header is set on the request as well as on the response, and why every page
 * is rendered per request (see the root layout).
 *
 *   style-src 'unsafe-inline'   bars, dots and plots are placed with inline
 *                               style attributes, which cannot carry a nonce.
 *   img-src https:              covers and page pictures come from the website.
 *   'unsafe-eval' (dev only)    React rebuilds server error stacks with eval
 *                               in development; production never needs it.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";

  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "same-origin");
  return response;
}

export const config = {
  matcher: [
    {
      /*
       * Every page of this app. Not its static files, and not the paths the
       * desk server answers itself (next.config.ts rewrites them on a
       * workstation, Caddy on the box): the classic console writes its own
       * inline styles and scripts and would be broken by a policy made for
       * these pages.
       */
      source: "/((?!(?:api|auth|logout|cover|console|draft|link|people)(?:/|$)|_next/static|_next/image|favicon\\.ico).*)",
      /* A prefetch is not a page view; it gets no nonce spent on it. */
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
