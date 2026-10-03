import Link from "next/link";
import type { TeamActivity, TeamEvent, TeamEventKind, TeamPersonActivity } from "@/contract/team";
import { BarList } from "@/components/charts/BarList";
import { Donut } from "@/components/charts/Donut";
import { Legend, shareTexts } from "@/components/charts/Legend";
import { SparkBars } from "@/components/charts/SparkBars";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, Chip, type ChipTone } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Read } from "@/components/ui/Read";
import { Select } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { Tile, Tiles } from "@/components/ui/Tile";
import { ago, clock, fullDate, longDate, num, shortDate, zurich } from "@/lib/format";
import { Faces, RoleChip } from "./parts";

/**
 * Team › Activity: who is on the desk now, what they open, what they change.
 * Everything here is the desk's own record (src/presence.ts), the Telegram
 * bot's links and the website's git history; nothing is estimated.
 */

export function ActivityTiles({ data }: { data: TeamActivity }) {
  const now = data.tiles.activeNow;
  return (
    <Tiles count={4}>
      <Tile
        label="Active now"
        icon="users"
        delta="none"
        info="Somebody whose browser asked the desk anything in the last three minutes. A tab in the background asks nothing, so it does not count."
        reading={{ state: "ok", value: { value: now.value, previous: null, unit: "count", series: [], sub: `of ${now.of} team member${now.of === 1 ? "" : "s"}` }, source: "desk", asOf: data.at }}
        noStamp
        foot={<Faces names={now.people.map((p) => p.name)} />}
      />
      <Tile
        label="Total actions"
        icon="bolt"
        info="Every change the desk accepted from a person (a publish, a saved comparison, a refresh, an access change), every link shared with the bot, and every website deployment by a team member. Sign-ins are not actions."
        reading={data.tiles.actions}
        chart={(s) => <SparkBars data={s.series} label="Actions per period" />}
      />
      <Tile
        label="Content changes"
        icon="article"
        tone="violet"
        info="Actions in Insights and Content (writing, publishing, retrying) and links shared with the bot."
        reading={data.tiles.content}
        chart={(s) => <SparkBars data={s.series} tone="violet" label="Content changes per period" />}
      />
      <Tile
        label="Deployments"
        icon="cloud"
        tone="info"
        info="Pushes to the website's main branch, each of which Vercel builds and serves: from the desk's read of the website's git history, by anybody."
        reading={data.tiles.deployments}
        chart={(s) => <SparkBars data={s.series} tone="blue" label="Deployments per period" />}
      />
    </Tiles>
  );
}

const KIND_TONE: Record<TeamEventKind, ChipTone> = { action: "good", signin: "quiet", shared: "violet", deploy: "info" };

/** "Today · Saturday, 3 Oct 2026", "Yesterday · …", else the day. */
function dayHead(key: string, now: string): string {
  const today = zurich(now)?.key;
  const yesterday = zurich(new Date(Date.parse(now) - 86_400_000))?.key;
  const long = longDate(key);
  return key === today ? `Today · ${long}` : key === yesterday ? `Yesterday · ${long}` : long;
}

function Row({ e }: { e: TeamEvent }) {
  return (
    <li className="dk-team-ev">
      <time className="dk-team-ev-time dk-num" dateTime={e.at} title={fullDate(e.at)} suppressHydrationWarning>
        {clock(e.at)}
      </time>
      <span className={`dk-team-ev-dot dk-team-ev-dot--${KIND_TONE[e.kind]}`} aria-hidden />
      <Avatar name={e.who.name} size="sm" />
      <span className="dk-team-ev-text">
        <span className="dk-team-ev-line">
          <Link href={`/team?member=${e.who.id}`} prefetch={false} className="dk-team-ev-who">
            {e.who.name}
          </Link>
          <span className="dk-team-ev-what">{e.text}</span>
        </span>
        <span className="dk-team-ev-sub">
          <Chip tone={KIND_TONE[e.kind]}>{e.typeLabel}</Chip>
          {e.detail ? <span className="dk-team-ev-detail">{e.detail}</span> : null}
        </span>
      </span>
      {e.href ? (
        <LinkButton href={e.href} size="xs" variant="quiet" className="dk-team-ev-go">
          View
        </LinkButton>
      ) : (
        <span />
      )}
    </li>
  );
}

export function TimelineCard({ data }: { data: TeamActivity }) {
  const days = new Map<string, TeamEvent[]>();
  for (const e of data.timeline) {
    const key = zurich(e.at)?.key ?? e.at.slice(0, 10);
    (days.get(key) ?? days.set(key, []).get(key)!).push(e);
  }
  const filtered = data.person !== null || data.timeline.length < 200;
  return (
    <Card
      title="Team activity timeline"
      icon="pulse"
      count={data.timeline.length || undefined}
      sub={data.since ? `Kept since ${fullDate(data.since)}. Newest first${data.timeline.length === 200 ? ", the latest 200" : ""}.` : "Nothing kept yet."}
      right={
        <span className="dk-team-filters">
          <Select param="type" label="Activity type" options={[{ value: "", label: "All activity types" }, ...data.types.map((t) => ({ value: t.key, label: t.label }))]} />
          <Select param="member" label="Member" options={[{ value: "", label: "All members" }, ...data.members.map((m) => ({ value: String(m.id), label: m.name }))]} />
        </span>
      }
      flush
    >
      {data.timeline.length ? (
        <div className="dk-team-days">
          {[...days.entries()].map(([key, list]) => (
            <section key={key} className="dk-team-day" aria-label={dayHead(key, data.at)}>
              <h3 className="dk-team-day-head">{dayHead(key, data.at)}</h3>
              <ol className="dk-team-evs">
                {list.map((e) => (
                  <Row key={e.id} e={e} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : (
        <Empty icon="clock" title={filtered ? "Nothing in this period" : "Nothing recorded yet"} compact>
          The desk writes down every change it accepts from a person, every sign-in and every link shared with the bot. A wider period or another filter may show more.
        </Empty>
      )}
    </Card>
  );
}

export function NowCard({ data }: { data: TeamActivity }) {
  return (
    <Card title={`Active now (${data.now.length})`} icon="users" sub="A request in the last three minutes, and the page they are on.">
      {data.now.length ? (
        <ul className="dk-team-now">
          {data.now.map((n) => (
            <li key={n.id} className="dk-team-now-row">
              <Avatar name={n.name} size="md" />
              <span className="dk-team-who-text">
                <span className="dk-team-who-name">{n.name}</span>
                <span className="dk-team-who-sub">{n.place ? <>On {n.place.label}</> : "On the desk"}</span>
              </span>
              <span className="dk-team-now-right">
                {n.place ? (
                  <LinkButton href={n.place.href} size="xs" variant="quiet">
                    View
                  </LinkButton>
                ) : null}
                <time className="dk-team-who-sub" dateTime={n.last} suppressHydrationWarning>
                  {ago(n.last, data.at)}
                </time>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon="users" title="Nobody right now" compact>
          Whoever opens the desk appears here within seconds.
        </Empty>
      )}
    </Card>
  );
}

export function ByMemberCard({ data }: { data: TeamActivity }) {
  const max = Math.max(1, ...data.byMember.map((m) => m.actions));
  return (
    <Card title="Activity by member" icon="bar-chart" sub="Actions in the period, with minutes of attention.">
      <BarList
        label="Actions by member"
        max={max}
        items={data.byMember.map((m) => ({
          key: String(m.id),
          label: m.name,
          value: m.actions,
          text: `${num(m.actions)} action${m.actions === 1 ? "" : "s"}`,
          second: m.minutes ? `${num(m.minutes)} min` : undefined,
          href: `/team?member=${m.id}`,
        }))}
        emptyNote="Nobody did anything the desk records in this period."
      />
    </Card>
  );
}

export function ByTypeCard({ data }: { data: TeamActivity }) {
  const total = data.byType.reduce((s, t) => s + t.value, 0);
  const slices = data.byType.slice(0, 6).map((t) => ({ key: t.key, label: t.label, value: t.value }));
  const rest = data.byType.slice(6).reduce((s, t) => s + t.value, 0);
  if (rest) slices.push({ key: "rest", label: "The rest", value: rest });
  const shares = total < 30 ? slices.map((x) => num(x.value)) : shareTexts(slices.map((x) => x.value));
  return (
    <Card title="Activity by type" icon="pie" sub="Which part of the desk the actions were in.">
      {total ? (
        <div className="dk-team-donut">
          <Donut label="Actions by type" slices={slices} figure={num(total)} caption="Total actions" />
          <Legend layout="column" items={slices.map((x, i) => ({ label: x.label, share: shares[i] }))} />
        </div>
      ) : (
        <Empty icon="pie" title="No actions in this period" compact />
      )}
    </Card>
  );
}

export function DeploysCard({ data }: { data: TeamActivity }) {
  return (
    <Card title="Recent deployments" icon="cloud" right={<Stamp reading={data.deployments} />} footer={null}>
      <Read reading={data.deployments}>
        {(list) => (
          <ul className="dk-team-deploys">
            {list.map((d) => (
              <li key={d.sha} className="dk-team-deploy">
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noreferrer" className="dk-team-sha dk-num">
                    {d.sha.slice(0, 7)}
                  </a>
                ) : (
                  <span className="dk-team-sha dk-num">{d.sha.slice(0, 7)}</span>
                )}
                <span className="dk-team-deploy-text" title={d.subject}>
                  {d.subject}
                </span>
                <span className="dk-team-who-sub" suppressHydrationWarning>
                  {d.member ?? d.author} · {ago(d.at, data.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Read>
    </Card>
  );
}

/** One person, when the activity is filtered to them: their minutes by day and the pages they spend them on. */
export function PersonCard({ p, at }: { p: TeamPersonActivity; at: string }) {
  const maxPage = Math.max(1, ...p.pages.map((x) => x.minutes * 3 + x.opens));
  return (
    <Card
      title={p.name}
      icon="user"
      sub={<>What {p.name.split(/\s+/)[0]} did on the desk in the period.</>}
      right={
        <span className="dk-team-person-right">
          <RoleChip role={p.role} />
          {p.online ? (
            <Badge tone="good" dot>
              Online{p.place ? ` · ${p.place.label}` : ""}
            </Badge>
          ) : p.lastActive ? (
            <Badge tone="quiet" dot>
              <span suppressHydrationWarning>Last here {ago(p.lastActive, at)}</span>
            </Badge>
          ) : (
            <Badge tone="quiet">Not seen yet</Badge>
          )}
        </span>
      }
    >
      <div className="dk-team-person">
        <dl className="dk-team-person-facts">
          <div>
            <dt>Minutes of attention</dt>
            <dd className="dk-num">{num(p.totalMinutes)}</dd>
          </div>
          <div>
            <dt>Screens opened</dt>
            <dd className="dk-num">{num(p.opens)}</dd>
          </div>
          <div>
            <dt>Days on the desk</dt>
            <dd className="dk-num">{num(p.daysActive)}</dd>
          </div>
          <div>
            <dt>Actions</dt>
            <dd className="dk-num">{num(p.actions)}</dd>
          </div>
        </dl>
        <div className="dk-team-person-chart">
          <p className="dk-team-mini-head">Minutes per day</p>
          {p.minutes.length <= 14 ? (
            <BarList
              label="Minutes of attention per day"
              max={Math.max(1, ...p.minutes.map((d) => d.value))}
              items={[...p.minutes].reverse().map((d) => ({ key: d.date, label: shortDate(d.date), value: d.value, text: `${num(d.value)} min` }))}
            />
          ) : (
            <SparkBars data={p.minutes.map((d) => ({ date: d.date, value: d.value }))} size="tile" fade={false} label="Minutes of attention per day" />
          )}
        </div>
        <div className="dk-team-person-pages">
          <p className="dk-team-mini-head">Where the time went</p>
          <BarList
            label="Pages by attention"
            max={maxPage}
            items={p.pages.map((x) => ({
              key: x.key,
              label: x.label,
              value: x.minutes * 3 + x.opens,
              text: x.minutes ? `${num(x.minutes)} min` : `${num(x.opens)} open${x.opens === 1 ? "" : "s"}`,
              second: x.minutes ? `${num(x.opens)} open${x.opens === 1 ? "" : "s"}` : undefined,
              href: x.href,
            }))}
            emptyNote="No screen opened in this period."
          />
        </div>
      </div>
    </Card>
  );
}
