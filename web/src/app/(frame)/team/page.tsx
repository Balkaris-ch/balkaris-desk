import { redirect } from "next/navigation";
import type { Range } from "@/contract/common";
import type { TeamActivity } from "@/contract/team";
import { PageHead } from "@/components/shell/PageHead";
import { ActivityTiles, ByMemberCard, ByTypeCard, DeploysCard, NowCard, PersonCard, TimelineCard } from "@/components/team/Activity";
import { TeamTabs } from "@/components/team/parts";
import { Grid, Stack } from "@/components/ui/Grid";
import { api, me } from "@/lib/api";
import { parseRange } from "@/lib/format";
import "@/components/team/team.css";

export const metadata = { title: "Team activity" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const RANGES: readonly Range[] = ["24h", "7d", "30d", "90d"];

/**
 * Team › Activity, the owner's alone: who is on the desk now and on which
 * page, what everybody opened and changed, links shared with the bot, and the
 * website's deployments. One request (GET /api/v1/team/activity); ?range=,
 * ?member= and ?type= filter it, and the address keeps them.
 *
 * Anybody else opening /team is sent to the team list, which is theirs to see
 * when the owner gave them Team; the server refuses the activity regardless.
 */
export default async function TeamActivityPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range, RANGES, "7d");
  const who = await me();
  if (!who.owner) redirect("/team/members");

  const data = await api<TeamActivity>("/api/v1/team/activity", { range, member: one(q.member), type: one(q.type) });

  return (
    <>
      <PageHead
        eyebrow="Team"
        title="Team Activity"
        subtitle="See who's working on what, what they open and change, and how much time they spend on the desk, as the desk recorded it."
        ranges={RANGES}
        rangeFallback="7d"
      />
      <TeamTabs me={who} active="" />
      <ActivityTiles data={data} />
      {data.person ? <PersonCard p={data.person} at={data.at} range={data.range} /> : null}
      <Grid cols="1.65fr 1fr" mid="minmax(0, 1fr)">
        <TimelineCard data={data} />
        <Stack className="dk-team-side">
          <NowCard data={data} />
          <ByMemberCard data={data} />
          <ByTypeCard data={data} />
          <DeploysCard data={data} />
        </Stack>
      </Grid>
    </>
  );
}
