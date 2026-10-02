import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/**
 * The desk's interface.
 *
 * It holds no data of its own. Every number on a screen is read from the desk
 * server beside it (Hono, port 3400), which owns the database, the queue and
 * every credential. This app draws.
 *
 * `standalone`: the box never runs `next build`. It shares 3.7 GB with the
 * engine, so the build happens off the box and what is shipped is a folder
 * that `node server.js` can run with no install step.
 */
const here = dirname(fileURLToPath(import.meta.url));
const DESK = process.env.DESK_API ?? "http://127.0.0.1:3400";

const config: NextConfig = {
  output: "standalone",
  /* web/ sits inside the desk's repo beside another package.json; without
     this Next guesses the root from the nearest lockfile and traces from the
     wrong folder. */
  outputFileTracingRoot: here,
  turbopack: { root: here },
  poweredByHeader: false,
  /* The indicator's default corner is the sidebar's two buttons. */
  devIndicators: { position: "bottom-right" },
  /* The box serves covers and share pictures as they are. */
  images: { unoptimized: true },
  /* On the box Caddy sends these straight to the desk server and Next never
     sees them. This is for a workstation, where there is no Caddy. */
  async rewrites() {
    return ["/api/:path*", "/auth/:path*", "/logout", "/cover/:path*", "/console", "/draft/:path*", "/link/:path*", "/people/:path*", "/people"].map(
      (source) => ({ source, destination: `${DESK}${source}` }),
    );
  },
};

export default config;
