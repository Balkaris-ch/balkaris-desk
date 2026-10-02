import type { ExperimentsPayload } from "@/contract/experiments";
import { PageHead } from "@/components/shell/PageHead";
import { Grid } from "@/components/ui/Grid";
import { Tile, Tiles } from "@/components/ui/Tile";
import { SparkBars } from "@/components/charts/SparkBars";
import { ChangesCard } from "@/components/experiments/ChangesCard";
import { CompareCard } from "@/components/experiments/CompareCard";
import { NeedsCard } from "@/components/experiments/NeedsCard";
import { SavedCard } from "@/components/experiments/SavedCard";
import { here } from "@/components/experiments/href";
import { api } from "@/lib/api";
import { parseRange } from "@/lib/format";
import "@/components/experiments/experiments.css";

export const metadata = { title: "Experiments" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Experiments. There is no board: it is drawn in the boards' language.
 *
 * The website has no split testing, and at its traffic a test on enquiries
 * would take many months, so this screen never calls anything a test result.
 * What it shows is true today: the changes pushed to the website, a before /
 * after comparison around any one of them (or a typed date) for the whole
 * site or one page, the comparisons people saved, and what a real experiment
 * would need. One request to the desk server draws all of it.
 *
 * Composed as the Conversions board is: the tiles, then a row of a wide panel
 * and a narrow one, then another. With nothing compared, Recent changes leads
 * and the comparison's form stands beside it; once a comparison is open it is
 * the screen's purpose, so it takes the first row whole and the list follows.
 */
export default async function ExperimentsPage({ searchParams }: { searchParams: Search }) {
  const now = here(await searchParams);
  const range = parseRange(now.range);
  const data = await api<ExperimentsPayload>("/api/v1/experiments", { ...now, range });
  const t = data.tiles;

  return (
    <>
      <PageHead
        eyebrow="Experiments"
        title="Experiments"
        subtitle="Every change shipped to balkaris.ch, and the days before and after it compared."
        ranges
      />

      <Tiles count={4}>
        <Tile
          label="Changes shipped"
          reading={t.shipped}
          info="Commits to the website's main branch in the range, each on the day it was committed. Each starts a production build on Vercel; whether the build succeeded is not known here."
          chart={(s) => <SparkBars data={s.series} label="Changes shipped per day" fade={false} />}
        />
        <Tile
          label="Pages changed"
          reading={t.pagesChanged}
          info="Addresses whose own page file, a file in their folder, or their article's file changed in the range. Shared components, styles and pictures are not counted against a page."
          chart={(s) => <SparkBars data={s.series} label="Pages changed per day" tone="blue" fade={false} />}
        />
        <Tile label="Comparisons saved" reading={t.saved} info="Before / after comparisons saved on this screen, all time. Only the question is kept; the figures are worked out again when one is opened." />
        <Tile label="Days measured" reading={t.measured} info="Finished days GA4 has measured the website, from its first day up to yesterday. A change made before measurement began has nothing to be compared with." />
      </Tiles>

      {data.comparison ? (
        <>
          <Grid cols="1fr" mid="1fr">
            <CompareCard data={data} now={now} />
          </Grid>
          <Grid cols="1fr" mid="1fr">
            <ChangesCard data={data} now={now} />
          </Grid>
        </>
      ) : (
        <Grid cols="2fr 1fr" mid="1fr">
          <ChangesCard data={data} now={now} />
          <CompareCard data={data} now={now} />
        </Grid>
      )}

      <Grid cols="2fr 1fr" mid="1fr">
        <SavedCard data={data} now={now} />
        <NeedsCard data={data} />
      </Grid>
    </>
  );
}
