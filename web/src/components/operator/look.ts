import type { ChipTone } from "@/components/ui/Badge";
import type { IconName } from "@/components/ui/icons";
import type { ContextChoice, Depth, ProposalRow, TaskKind } from "@/contract/operator";

/** How each kind of task is drawn: its icon and the tone of its tile. */
export const KIND_LOOK: Record<TaskKind, { icon: IconName; tone: ChipTone; name: string }> = {
  ask: { icon: "message", tone: "good", name: "Answer" },
  traffic: { icon: "bar-chart", tone: "good", name: "Traffic analysis" },
  opportunities: { icon: "lightbulb", tone: "bad", name: "Key opportunities" },
  metadata: { icon: "tag", tone: "info", name: "New metadata" },
  redirect: { icon: "link", tone: "warn", name: "Redirects" },
  brief: { icon: "file-text", tone: "warn", name: "Brief" },
  audit: { icon: "search", tone: "good", name: "SEO audit" },
  og: { icon: "image", tone: "info", name: "Share card" },
  schema: { icon: "code", tone: "violet", name: "Structured data" },
  links: { icon: "link", tone: "info", name: "Internal links" },
  alt: { icon: "eye", tone: "warn", name: "Alt texts" },
  keywords: { icon: "target", tone: "good", name: "Keyword judgements" },
  serp: { icon: "list", tone: "violet", name: "Search results brief" },
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
  og: "Uses the page's own text",
  schema: "Uses the page's own text",
  links: "Uses the crawl's link graph",
  alt: "Uses the page and its file names",
  keywords: "Uses tracked searches and topics",
  serp: "Uses a kept result page and their pages",
};

/** One line on what a proposal changes, for a list row. */
export function proposalLine(p: ProposalRow): { title: string; sub: string } {
  const waiting = p.state === "waiting";
  switch (p.kind) {
    case "redirect":
      return { title: waiting ? "Create redirect" : "Redirect", sub: `${p.address} → ${p.after.to}` };
    case "og": {
      const parts = [p.after.ogTitle !== undefined ? "title" : null, p.after.ogDescription !== undefined ? "description" : null, p.after.ogImage !== undefined ? "picture" : null].filter(Boolean).join(", ");
      return { title: waiting ? "Update share card" : "Share card", sub: `${p.address}: new ${parts}` };
    }
    case "index":
      return { title: p.after.noindex ? "Out of search" : "Back in search", sub: `${p.address}${p.after.noindex ? ": noindex, leaves the sitemap" : ": listed again"}` };
    case "canonical":
      return { title: waiting ? "Set canonical" : "Canonical", sub: `${p.address} → ${p.after.canonical}` };
    case "schema":
      return { title: waiting ? "Add structured data" : "Structured data", sub: `${p.address}: ${p.after.jsonLd?.["@type"] ?? "block"}` };
    default: {
      const fields = p.after.title !== undefined && p.after.description !== undefined ? "title and description" : p.after.title !== undefined ? "title" : "description";
      return { title: waiting ? "Update metadata" : "Metadata", sub: `${p.address}: new ${fields}` };
    }
  }
}
