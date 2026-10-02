import type { LeadsPayload } from "@/contract/leads";
import { LeadsScreen } from "@/components/leads/LeadsScreen";
import { PageHead } from "@/components/shell/PageHead";
import { api } from "@/lib/api";
import { parseRange } from "@/lib/format";

export const metadata = { title: "Leads" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Leads: the enquiries the engine keeps from balkaris.ch, read from the engine.
 * One request for the whole screen; the range, the list's filters and the
 * open enquiry travel as search params, and ?specimen=1 is passed on as it is
 * (the desk server alone decides whether it may be honoured).
 */
export default async function LeadsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const one = (k: string): string => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const range = parseRange(sp.range);
  const specimen = one("specimen") === "1";

  const data = await api<LeadsPayload>("/api/v1/leads", {
    range,
    q: one("q").slice(0, 100),
    stage: one("stage"),
    group: one("group"),
    call: one("call"),
    open: one("open").slice(0, 120),
    specimen: specimen ? "1" : null,
  });

  return (
    <>
      <PageHead
        eyebrow="Leads"
        title="Leads"
        subtitle="The enquiries the engine keeps from balkaris.ch: where each stands and the call it booked."
        ranges
      />
      <LeadsScreen
        data={data}
        query={{
          range: one("range") ? range : null,
          specimen: data.specimen,
          ...(data.list.state === "ok" ? data.list.value.filters : { q: one("q"), stage: one("stage"), group: one("group"), call: one("call") }),
        }}
      />
    </>
  );
}
