import type { Job } from "../scheduler.ts";
import { jobs as seoJobs } from "./jobs.ts";
/* The web layer's paid source registers itself here, so Settings lists DataForSEO (off, with its step) from the start. */
import "./web/dataforseo.ts";

/**
 * The SEO engine as a collector: what src/cc/index.ts loads beside GA4, the
 * website, search and Vercel, with `import()` so that an engine that fails to
 * load costs the SEO jobs and nothing else.
 *
 * Loading it creates the engine's tables (tables.ts, through the jobs'
 * imports) and hands over its scheduled jobs (jobs.ts). The SEO section's
 * screens are mounted separately, by src/cc/routes/seo.ts, and read the same
 * modules.
 */
export const jobs: Job[] = seoJobs;
