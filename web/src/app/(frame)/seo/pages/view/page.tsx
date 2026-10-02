import { redirect } from "next/navigation";

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * SEO › Page Optimization, until the page built to its board replaces this:
 * one page's full detail lives on the Pages screen, so the address goes there.
 */
export default async function SeoPageViewPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const path = Array.isArray(q.path) ? q.path[0] : q.path;
  redirect(path ? `/pages/view?path=${encodeURIComponent(path)}` : "/seo/pages");
}
