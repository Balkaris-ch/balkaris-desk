import { notFound } from "next/navigation";
import type { SeoList, SeoListName } from "@/contract/seo";
import { api } from "@/lib/api";
import { parseRange } from "@/lib/format";
import { PageHead } from "@/components/shell/PageHead";
import { LinkButton } from "@/components/ui/Button";
import { SpecimenRibbon } from "@/components/seo/bits";
import { LIST_TITLES, ListView } from "@/components/seo/ListView";
import { AuditsList } from "@/components/seo/nav/Audits";
import { TasksList } from "@/components/seo/nav/Tasks";
import "@/components/seo/seo.css";

/** The earlier SEO screen's four lists ("View all" on /seo/legacy). */
const EARLIER = Object.keys(LIST_TITLES) as SeoListName[];

/**
 * The SEO section's own lists, under the SEO head (components/seo/nav/pages.ts,
 * LISTS): every SEO task, and every full audit with what it found.
 */
const OWN = {
  tasks: { title: "SEO tasks", draw: TasksList },
  audits: { title: "SEO audits", draw: AuditsList },
} as const;
type OwnName = keyof typeof OWN;
const isOwn = (name: string): name is OwnName => name === "tasks" || name === "audits";

type Props = { params: Promise<{ name: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/*
 * ONLY THESE NAMES. Any other /seo/list/<name> is a 404 decided before the
 * page streams: a notFound() in the page itself comes after the frame's
 * loading screen has begun the answer, which then goes out as a 200.
 */
export const dynamicParams = false;
export function generateStaticParams(): { name: string }[] {
  return [...EARLIER, ...Object.keys(OWN)].map((name) => ({ name }));
}

export async function generateMetadata({ params }: Props) {
  const { name } = await params;
  if (isOwn(name)) return { title: `${OWN[name].title} · SEO` };
  return { title: EARLIER.includes(name as SeoListName) ? `SEO · ${LIST_TITLES[name as SeoListName].title}` : "SEO" };
}

/**
 * /seo/list/<name>. The section's own lists (tasks, audits) draw under the
 * SEO head and its tabs. The earlier screen's lists are "View all" from a
 * panel of /seo/legacy: the whole list for the same range, and back to that
 * screen, which is the only one that links to them.
 */
export default async function SeoListPage({ params, searchParams }: Props) {
  const { name } = await params;
  const q = await searchParams;
  if (isOwn(name)) {
    const Draw = OWN[name].draw;
    return <Draw q={q} />;
  }
  if (!EARLIER.includes(name as SeoListName)) notFound();
  const range = parseRange(q.range);
  const specimen = (Array.isArray(q.specimen) ? q.specimen[0] : q.specimen) === "1";
  const list = await api<SeoList>(`/api/v1/seo/list/${name}`, { range, specimen: specimen ? "1" : undefined });
  const back = new URLSearchParams();
  if (range !== "30d") back.set("range", range);
  if (list.specimen) back.set("specimen", "1");

  return (
    <>
      {list.specimen ? <SpecimenRibbon realHref={`/seo/list/${name}${range === "30d" ? "" : `?range=${range}`}`} /> : null}
      <PageHead
        eyebrow="SEO"
        title={LIST_TITLES[list.name].title}
        subtitle={LIST_TITLES[list.name].sub}
        ranges
        action={
          <LinkButton href={`/seo/legacy${back.size ? `?${back}` : ""}`} size="sm" icon="arrow-left">
            Earlier SEO screen
          </LinkButton>
        }
      />
      <ListView list={list} />
    </>
  );
}
