/**
 * GET /api/v1/seo/automations — the jobs the SEO section runs on, the SEO
 * engine's own and the desk's it depends on, each with what it does, its
 * schedule, its last run and its budget.
 *
 * Switching one off or on is the owner's: POST /api/v1/jobs/:name/enabled
 * { enabled } (src/cc/api.ts). Running one now: POST /api/v1/jobs/:name/run.
 *
 * Types only.
 */
import type { ActivityItem } from "../common";
import type { OwnerTaskRow, SeoHead, SeoJob } from "./common";

export interface SeoAutomationsPayload {
  head: SeoHead;
  jobs: SeoJob[];
  /** Running now or asked for, of these jobs. */
  running: number;
  /** The next run of any of them. */
  nextRun: string | null;
  /** What the SEO jobs wrote to the log lately. */
  recent: ActivityItem[];
  /** Work for the lead in the owner's browser (Search Console steps no API offers). */
  chromeTasks: OwnerTaskRow[];
}
