import type { AccessLevel } from "@/contract/common";
import type { IconName } from "@/components/ui/icons";
import { SEO_PAGES } from "@/components/seo/nav/pages";

/** One of the desk's sections: a row in the sidebar and an entry in the palette. */
export interface Section {
  /** Stable name, also the route's first segment ("" for the Command Center). */
  key: string;
  label: string;
  href: string;
  icon: IconName;
  /** What the section is for, in a few words. Shown in the command palette. */
  hint: string;
  /**
   * The section's own pages, when it has several: its sidebar row then opens
   * a submenu of them instead of going to `href` (SideNav.tsx), and the
   * palette finds each by name. SEO's eleven live in components/seo/nav/pages.ts.
   */
  children?: readonly SubSection[];
}

/** One page of a section that has several: a row in its submenu. */
export interface SubSection {
  /** Stable name, the address's second segment ("" for the section's first page). */
  key: string;
  label: string;
  href: string;
  icon: IconName;
  hint: string;
}

/**
 * THE TEAM SECTION'S PAGES: who works the desk and what they do on it. Activity,
 * Access & Roles and Invitations are the owner's alone; everybody given Team
 * sees Members. The server decides (src/grants.ts); the sidebar only follows.
 */
export const TEAM_PAGES: readonly SubSection[] = [
  { key: "", label: "Activity", href: "/team", icon: "pulse", hint: "What the team does on the desk, live" },
  { key: "members", label: "Members", href: "/team/members", icon: "users", hint: "Everyone on the desk, their role and status" },
  { key: "access", label: "Access & Roles", href: "/team/access", icon: "key", hint: "What each person may see and change" },
  { key: "invitations", label: "Invitations", href: "/team/invitations", icon: "mail", hint: "Give somebody access before they sign in" },
];

/** The sixteen sections, in the order the sidebar lists them. */
export const SECTIONS: readonly Section[] = [
  { key: "", label: "Command Center", href: "/", icon: "home", hint: "The website today" },
  { key: "insights", label: "Insights", href: "/insights", icon: "article", hint: "Articles: plan, write, publish" },
  { key: "traffic", label: "Traffic", href: "/traffic", icon: "pulse", hint: "Who visits, and from where" },
  { key: "seo", label: "SEO", href: "/seo", icon: "search", hint: "Search queries, indexing, technical checks", children: SEO_PAGES },
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
  { key: "team", label: "Team", href: "/team", icon: "users", hint: "Members, access, invitations, activity", children: TEAM_PAGES },
];

/** The section an address belongs to, or undefined when it is none of them. */
export function sectionOf(pathname: string): Section | undefined {
  const first = pathname.split("/")[1] ?? "";
  return SECTIONS.find((s) => s.key === first);
}

/** What `Me.access.pages` holds: a level per page key. */
export type PageAccess = Record<string, AccessLevel>;

/**
 * The page an address is, as the server names it (src/grants.ts
 * `pageOfHref`): "/" is "overview", "/seo/pages/view" is "seo/pages".
 */
export function pageKey(href: string): string {
  const parts = href.split(/[?#]/)[0]!.split("/").filter(Boolean);
  if (!parts.length || parts[0] === "activity" || parts[0] === "attention") return "overview";
  if (parts[0] === "seo" || parts[0] === "team") return parts.slice(0, 2).join("/");
  return parts[0]!;
}

/** May this person open the page at `href`? A key the server did not name is left to the server. */
export const mayOpen = (pages: PageAccess | null | undefined, href: string): boolean => !pages || (pages[pageKey(href)] ?? "view") !== "none";

/**
 * The sections this person may open, each with only the pages of it they may
 * open; a section with pages of its own and none left is gone. The sidebar
 * and the palette draw this; the server refuses the rest whatever they draw.
 */
export function visibleSections(pages: PageAccess | null | undefined): Section[] {
  const out: Section[] = [];
  for (const s of SECTIONS) {
    if (s.children?.length) {
      const children = s.children.filter((c) => mayOpen(pages, c.href));
      if (children.length) out.push({ ...s, href: children[0]!.href, children });
    } else if (mayOpen(pages, s.href)) out.push(s);
  }
  return out;
}
