import type { IconName } from "@/components/ui/icons";

/**
 * THE SEO SECTION'S PAGES, in one list: the sidebar's SEO submenu, the tab
 * strip under the SEO head and the command palette all read this, so a page
 * is added, renamed or moved here and nowhere else. The desk server keeps the
 * same names for its search box (src/cc/find.ts, SEO_PAGES); keep the two in
 * step.
 *
 * No client code here and nothing that runs on import beyond the constants,
 * so a server component, a client component and nav.ts can all import it.
 */
export interface SeoPage {
  /** Stable name: the address's second segment ("" for the Overview). */
  key: string;
  label: string;
  href: string;
  /** The small icon in the sidebar's submenu. */
  icon: IconName;
  /** What the page is for, in a few words: the command palette's second line. */
  hint: string;
}

/** The eleven, in the order the tabs and the submenu list them. */
export const SEO_PAGES: readonly SeoPage[] = [
  { key: "", label: "Overview", href: "/seo", icon: "grid", hint: "Every SEO tool, the running tasks and what was done" },
  { key: "opportunities", label: "Opportunities", href: "/seo/opportunities", icon: "lightbulb", hint: "What to fix or write next, ranked" },
  { key: "pages", label: "Pages", href: "/seo/pages", icon: "pages", hint: "Every page with its search figures" },
  { key: "keywords", label: "Keywords", href: "/seo/keywords", icon: "tag", hint: "The searches Google shows the site for" },
  { key: "content-gaps", label: "Content Gaps", href: "/seo/content-gaps", icon: "layers", hint: "Searches no page answers yet" },
  { key: "backlinks", label: "Backlinks", href: "/seo/backlinks", icon: "link", hint: "Links and listings that point to the site" },
  { key: "technical", label: "Technical", href: "/seo/technical", icon: "wrench", hint: "Indexing, sitemap, markup and speed" },
  { key: "search-console", label: "Search Console", href: "/seo/search-console", icon: "line-chart", hint: "Google's own search figures" },
  { key: "competitors", label: "Competitors", href: "/seo/competitors", icon: "users", hint: "Who ranks for the searches we want" },
  { key: "ai-search", label: "AI Search", href: "/seo/ai-search", icon: "robot", hint: "Whether AI assistants name Balkaris" },
  { key: "automations", label: "Automations", href: "/seo/automations", icon: "clock", hint: "The SEO jobs the desk runs by itself" },
];

/** What the head over an SEO page says. */
export interface SeoHeadText {
  /** The breadcrumb over the title, parent first. The last is the page's parent, never the page. */
  crumbs: readonly { label: string; href: string }[];
  title: string;
  sub: string;
}

/** The head every SEO page shares (board 103). */
export const SEO_HEAD: SeoHeadText = {
  crumbs: [{ label: "SEO", href: "/seo" }],
  title: "SEO Operations",
  sub: "Find opportunities, fix issues, optimize pages and grow organic traffic.",
};

/**
 * Page Optimization keeps a head of its own (board 115). Its own words, not
 * the board's: the board says the changes are then deployed, and on this desk
 * nothing reaches the site before a person approves it.
 */
export const PAGE_OPTIMIZATION_HEAD: SeoHeadText = {
  crumbs: [
    { label: "SEO", href: "/seo" },
    { label: "Pages", href: "/seo/pages" },
  ],
  title: "Page Optimization",
  sub: "Improve one page at a time. Every change waits for a person’s approval.",
};

/** Where an address sits in the SEO section. */
export interface SeoPlace {
  /** The tab and submenu row that is lit. */
  page: SeoPage;
  head: SeoHeadText;
}

/**
 * The SEO page an address belongs to, or null when it is none of the eleven:
 * outside /seo, or one of the earlier screen's own addresses (/seo/legacy,
 * /seo/report, /seo/list/…), which keep the heads they had.
 *
 * /seo/pages/view (Page Optimization) lights Pages and has its own head.
 */
export function seoPlace(pathname: string): SeoPlace | null {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts[0] !== "seo") return null;
  const second = parts[1] ?? "";
  const page = SEO_PAGES.find((p) => p.key === second);
  if (!page) return null;
  if (page.key === "pages" && parts[2] === "view" && parts.length === 3) return { page, head: PAGE_OPTIMIZATION_HEAD };
  /* Anything deeper than a page's own address belongs to that page's builder; it keeps the shared head. */
  return { page, head: SEO_HEAD };
}

/** Whether an address is inside the SEO section at all, the earlier screen's addresses included. */
export const underSeo = (pathname: string): boolean => pathname === "/seo" || pathname.startsWith("/seo/");

/**
 * The scheduled jobs a full SEO audit is made of, for the head's button when
 * it finds one already running as the page is drawn. After a press, the button
 * watches the jobs the desk said it started instead. "seo-" names are the SEO
 * engine's own jobs.
 */
export const AUDIT_JOBS: readonly string[] = ["crawl", "gsc-daily", "gsc-inspect"];
export const isAuditJob = (name: string): boolean => AUDIT_JOBS.includes(name) || name.startsWith("seo-");
