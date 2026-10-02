import { notFound } from "next/navigation";
import type { SeoList, SeoListName } from "@/contract/seo";
import { api } from "@/lib/api";
import { parseRange } from "@/lib/format";
import { PageHead } from "@/components/shell/PageHead";
import { LinkButton } from "@/components/ui/Button";
import { SpecimenRibbon } from "@/components/seo/bits";
import { LIST_TITLES, ListView } from "@/components/seo/ListView";
import "@/components/seo/seo.css";

const NAMES = Object.keys(LIST_TITLES) as SeoListName[];

type Props = { params: Promise<{ name: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props) {
  const { name } = await params;
  return { title: NAMES.includes(name as SeoListName) ? `SEO · ${LIST_TITLES[name as SeoListName].title}` : "SEO" };
}

/** "View all" from a panel of the SEO screen: the whole list, for the same range. */
export default async function SeoListPage({ params, searchParams }: Props) {
  const { name } = await params;
  if (!NAMES.includes(name as SeoListName)) notFound();
  const q = await searchParams;
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
          <LinkButton href={`/seo${back.size ? `?${back}` : ""}`} size="sm" icon="arrow-left">
            SEO
          </LinkButton>
        }
      />
      <ListView list={list} />
    </>
  );
}
