import type { OverviewAttention } from "@/contract/overview";
import { PageHead } from "@/components/shell/PageHead";
import { Card } from "@/components/ui/Card";
import { Grid } from "@/components/ui/Grid";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { AttentionRows, NothingFound, RuleList } from "@/components/overview/Attention";
import { SpecimenRibbon } from "@/components/overview/Ribbon";
import { api } from "@/lib/api";
import { parseRange } from "@/lib/format";
import "@/components/overview/overview.css";

export const metadata = { title: "Attention required" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Every row "Attention required" found, worst first, and every rule behind
 * them: what it compares, whether it could look, and what would connect it.
 * Opened from the Command Center's "View all (n)".
 */
export default async function AttentionPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range);
  const specimen = (Array.isArray(q.specimen) ? q.specimen[0] : q.specimen) === "1";
  const data = await api<OverviewAttention>("/api/v1/overview/attention", { range, ...(specimen ? { specimen: "1" } : {}) });

  return (
    <>
      <PageHead eyebrow="Command Center" title="Attention required" subtitle="Every row the rules found, worst first, and the rules themselves." ranges />
      {data.specimen ? <SpecimenRibbon /> : null}
      <Read reading={data.attention}>
        {(a, r) => (
          <Grid cols="1.5fr 1fr" mid="1fr">
            <Card title="Found" icon="alert" tone="bad" count={a.total} divided>
              {a.items.length ? <AttentionRows items={a.items} /> : <NothingFound rules={a.rules} />}
              <p className="dk-overview-foot">
                <Stamp reading={r} showNote />
              </p>
            </Card>
            <Card title="The rules" icon="list" sub="A row exists only because one of these found it." divided>
              <RuleList rules={a.rules} />
            </Card>
          </Grid>
        )}
      </Read>
    </>
  );
}
