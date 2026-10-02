import type { ChipTone } from "@/components/ui/Badge";
import type { IconName } from "@/components/ui/icons";
import type { ContextChoice, Depth, TaskKind } from "@/contract/operator";

/** How each kind of task is drawn: its icon and the tone of its tile. */
export const KIND_LOOK: Record<TaskKind, { icon: IconName; tone: ChipTone; name: string }> = {
  ask: { icon: "message", tone: "good", name: "Answer" },
  traffic: { icon: "bar-chart", tone: "good", name: "Traffic analysis" },
  opportunities: { icon: "lightbulb", tone: "bad", name: "Key opportunities" },
  metadata: { icon: "tag", tone: "info", name: "New metadata" },
  redirect: { icon: "link", tone: "warn", name: "Redirects" },
  brief: { icon: "file-text", tone: "warn", name: "Brief" },
  audit: { icon: "search", tone: "good", name: "SEO audit" },
};

export const CONTEXT_OPTIONS: { value: ContextChoice; label: string }[] = [
  { value: "website", label: "Use website context" },
  { value: "pages", label: "Pages only" },
  { value: "traffic", label: "Traffic only" },
  { value: "issues", label: "Issues only" },
  { value: "insights", label: "Insights only" },
  { value: "none", label: "No context" },
];

export const DEPTH_OPTIONS: { value: Depth; label: string; hint: string }[] = [
  { value: "deep", label: "Deep analysis", hint: "The workstation's larger model, the fuller context, an answer of up to about 350 words." },
  { value: "quick", label: "Quick answer", hint: "The workstation's smaller model, about half the context, an answer of up to about 120 words." },
];

/** What a kind other than a question is given, said in the place of the context select. */
export const KIND_DATA: Record<Exclude<TaskKind, "ask">, string> = {
  traffic: "Uses GA4 traffic",
  opportunities: "Uses findings and traffic; Search Console when connected",
  metadata: "Uses the pages that need it",
  redirect: "Uses broken links and gone pages",
  brief: "Uses pages and articles",
  audit: "Runs the crawl, then its findings",
};
