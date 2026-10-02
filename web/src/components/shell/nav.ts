import type { IconName } from "@/components/ui/icons";

/** One of the desk's sections: a row in the sidebar and an entry in the palette. */
export interface Section {
  /** Stable name, also the route's first segment ("" for the Command Center). */
  key: string;
  label: string;
  href: string;
  icon: IconName;
  /** What the section is for, in a few words. Shown in the command palette. */
  hint: string;
}

/** The fifteen sections, in the order the sidebar lists them. */
export const SECTIONS: readonly Section[] = [
  { key: "", label: "Command Center", href: "/", icon: "home", hint: "The website today" },
  { key: "insights", label: "Insights", href: "/insights", icon: "article", hint: "Articles: plan, write, publish" },
  { key: "traffic", label: "Traffic", href: "/traffic", icon: "pulse", hint: "Who visits, and from where" },
  { key: "seo", label: "SEO", href: "/seo", icon: "search", hint: "Search queries, indexing, technical checks" },
  { key: "pages", label: "Pages", href: "/pages", icon: "pages", hint: "Every page of the site" },
  { key: "content", label: "Content", href: "/content", icon: "edit", hint: "Links, drafts and the writing queue" },
  { key: "conversions", label: "Conversions", href: "/conversions", icon: "funnel", hint: "From visitor to enquiry" },
  { key: "leads", label: "Leads", href: "/leads", icon: "inbox", hint: "Enquiries and booked calls" },
  { key: "experiments", label: "Experiments", href: "/experiments", icon: "flask", hint: "Tests on the site" },
  { key: "site-health", label: "Site Health", href: "/site-health", icon: "shield-check", hint: "Uptime, speed, errors" },
  { key: "hosting", label: "Hosting", href: "/hosting", icon: "cloud", hint: "True page views, Vercel builds, the engine" },
  { key: "automations", label: "Automations", href: "/automations", icon: "bolt", hint: "Scheduled jobs" },
  { key: "assets", label: "Assets", href: "/assets", icon: "image", hint: "Pictures, covers, films" },
  { key: "operator", label: "AI Operator", href: "/operator", icon: "sparkles", hint: "Ask about the website" },
  { key: "settings", label: "Settings", href: "/settings", icon: "settings", hint: "Sources, people, access" },
];

/** The section an address belongs to, or undefined when it is none of them. */
export function sectionOf(pathname: string): Section | undefined {
  const first = pathname.split("/")[1] ?? "";
  return SECTIONS.find((s) => s.key === first);
}
