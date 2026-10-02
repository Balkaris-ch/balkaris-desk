import type { ReactNode } from "react";
import type { ActivityItem } from "@/contract/common";
import type { ArticleMeta, ArticlePayload, ArticleSource, ArticleTraffic, ArticleWork, MetaLine, SiteState, SourceFigures } from "@/contract/article";
import type { Range, Reading } from "@/contract/common";
import { AreaChart } from "@/components/charts/AreaChart";
import { Badge, Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card, CardFoot } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { Timeline, activityItems } from "@/components/ui/Timeline";
import { ago, clock, DASH, duration, fullDate, num, rangeLabel, shortDate } from "@/lib/format";
import { ActionForm, type Confirm } from "./ActionForm";
import { Facts, JOB_SAYS, JOB_TONE, kindName, platformName, STATE_SAYS, StateBadge } from "./parts";
import "./article.css";

/** "24 Sep 2026, 12:35", the studio's clock. */
export const when = (iso: string): string => `${fullDate(iso)}, ${clock(iso)}`;

const isLive = (s: SiteState): boolean => s === "unlisted" || s === "listed";

/* ---------- on the site, and the actions ------------------------------------ */

type SiteAction = ArticlePayload["offers"]["site"][number];

function siteAction(a: SiteAction, state: SiteState, url: string): { label: string; explain: string; variant: "primary" | "quiet" | "danger"; confirm: Confirm } {
  switch (a) {
    case "publish":
      return {
        label: "Put it on the site, unlisted",
        variant: "primary",
        explain: "Live at its own address, in no menu, no shelf and no sitemap, and noindex.",
        confirm: {
          title: "Put it on the site, unlisted?",
          body: (
            <>
              <p>The desk commits the article to the website under your name and pushes it. Once the site has rebuilt, in about two minutes, it is live at <b>{url}</b>.</p>
              <p>Anyone with the address can read it. It is in no menu, no shelf and no sitemap, and it says noindex.</p>
            </>
          ),
          yes: "Put it on the site",
        },
      };
    case "list":
      return {
        label: "Publish it properly",
        variant: "primary",
        explain: "Into the menus, the shelves, the sitemap and search; noindex comes off.",
        confirm: {
          title: "Publish it properly?",
          body: <p>It goes into the menus, onto its shelves and into the sitemap, and noindex comes off so search engines may list it. The commit goes out under your name.</p>,
          yes: "Publish it",
        },
      };
    case "unlist":
      return {
        label: "Out of the menus",
        variant: "quiet",
        explain: "Out of the menus, the shelves and the sitemap. The address keeps working and noindex comes back.",
        confirm: {
          title: "Take it out of the menus?",
          body: <p>It leaves the menus, the shelves and the sitemap and says noindex again. Its address keeps working for anyone who has it. The commit goes out under your name.</p>,
          yes: "Take it out of the menus",
        },
      };
    case "takedown":
      return {
        label: "Take it off the site",
        variant: state === "listed" ? "danger" : "quiet",
        explain: "Its file comes off the website and the address stops working. The draft stays here.",
        confirm: {
          title: "Take it off the site?",
          body: <p>The article&rsquo;s file is removed from the website under your name. Once the site has rebuilt, <b>{url}</b> no longer works. The draft stays on the desk and can be put back.</p>,
          yes: "Take it off the site",
        },
      };
  }
}

/** What the branch should hold for each of the desk's states. */
const FILE_FOR: Record<SiteState, "absent" | "unlisted" | "listed"> = { draft: "absent", down: "absent", unlisted: "unlisted", listed: "listed" };
const FILE_SAYS = { absent: "No file", unlisted: "Unlisted file", listed: "Listed file" } as const;

export function SitePanel({ p, back }: { p: ArticlePayload; back: (done: string) => string }) {
  const s = p.site;
  const live = isLive(s.state);
  const path = new URL(s.url).pathname;
  const repo = s.repo;
  const differs = repo.state === "ok" && repo.value.file !== FILE_FOR[s.state];

  return (
    <Card
      title="On the site"
      icon="globe"
      right={<StateBadge state={s.state} />}
      footer={<CardFoot href={`/draft/${p.draftId}`}>Open it on the old console</CardFoot>}
    >
      <p className="dk-article-lead">{STATE_SAYS[s.state]}</p>
      <Facts
        rows={[
          [
            "Address",
            live ? (
              <a className="dk-article-link" href={s.url} target="_blank" rel="noreferrer noopener">
                <span>{path}</span>
                <Icon name="external" size={12} />
              </a>
            ) : (
              <span className="dk-article-mono">{path}</span>
            ),
          ],
          ["First live", s.liveSince ? when(s.liveSince) : null],
          ["Last push", s.publishedSha ? <code className="dk-article-mono">{s.publishedSha}</code> : null],
          ["Website branch", <RepoLine key="repo" repo={repo} />],
        ]}
      />
      {differs && repo.state === "ok" ? (
        <p className="dk-article-flag">
          The website&rsquo;s branch holds {FILE_SAYS[repo.value.file].toLowerCase()} for it, and the desk&rsquo;s record says {s.state === "down" ? "taken down" : s.state}. Somebody may have changed the site by hand, or the branch was fetched before the last push.
        </p>
      ) : null}

      <div className="dk-article-acts">
        {!p.offers.canPublish ? (
          <p className="dk-article-flag">
            Add your Vercel email on the <Go href="/people">people page</Go> before you can publish. The commit goes out under your name, and Vercel refuses it otherwise.
          </p>
        ) : null}
        {p.offers.site.map((a) => {
          const x = siteAction(a, s.state, s.url);
          return <ActionForm key={a} post={`/draft/${p.draftId}/${a}`} back={back(a)} label={x.label} variant={x.variant} explain={x.explain} confirm={x.confirm} />;
        })}
        {live ? (
          <div className="dk-article-act">
            <LinkButton href={s.url} size="sm" iconRight="external">
              Read it on the site
            </LinkButton>
          </div>
        ) : null}
        {p.offers.remove ? (
          <ActionForm
            post={`/draft/${p.draftId}/remove`}
            back={`/insights/link/${p.source.linkId}?done=remove`}
            label="Delete the draft"
            variant="danger"
            icon="trash"
            explain="The words go; the link stays and can be written again."
            confirm={{ title: "Delete this draft?", body: <p>The article is deleted from the desk. The link it was written from stays, and can be written again.</p>, yes: "Delete the draft" }}
          />
        ) : null}
      </div>
    </Card>
  );
}

function RepoLine({ repo }: { repo: ArticlePayload["site"]["repo"] }) {
  if (repo.state !== "ok") return <span className="dk-article-quiet">Not read: {repo.reason}</span>;
  const c = repo.value.lastCommit;
  return (
    <span className="dk-article-repo">
      <span>{FILE_SAYS[repo.value.file]}</span>
      {c ? (
        <span className="dk-article-quiet">
          {" · last changed by "}
          {c.url ? (
            <a className="dk-article-link" href={c.url} target="_blank" rel="noreferrer noopener">
              {c.sha.slice(0, 7)}
            </a>
          ) : (
            <code className="dk-article-mono">{c.sha.slice(0, 7)}</code>
          )}
          {`, ${c.author}, ${fullDate(c.at)}`}
        </span>
      ) : null}
      <Stamp reading={repo} />
    </span>
  );
}

/* ---------- the readers -------------------------------------------------------- */

/**
 * The days the readers were counted over, in words: from the day it went
 * live, from the day GA4 began measuring the website (the range reaches back
 * before it, and those days were never counted), or the range itself.
 */
export function countedOver(t: ArticleTraffic, range: Range): string {
  if (t.fromLive) return `since it went live on ${shortDate(t.start)}`;
  if (t.start > t.rangeStart) return `since GA4 began measuring on ${shortDate(t.start)}`;
  return rangeLabel(range).toLowerCase();
}

export function TrafficPanel({ p }: { p: ArticlePayload }) {
  const t = p.traffic;
  return (
    <Card
      title="Article traffic"
      icon="bar-chart"
      sub={t.state === "ok" ? `Views per day, ${countedOver(t.value, p.range)}` : "Views per day"}
      right={<Stamp reading={t} />}
    >
      <Read reading={t}>
        {(v) => (
          <>
            <AreaChart
              label="Views per day"
              series={v.days}
              unit="count"
              provisional={v.days.filter((d) => d.date >= v.provisionalFrom).length}
              provisionalNote="GA4 is still counting this day; the figure may change."
              zeroNote="Nobody viewed it on any of these days."
            />
            {/* The old console printed this beside the figures, and it belongs to them. */}
            <p className="dk-article-quiet dk-article-note-line">
              This article&rsquo;s own figures. GA4 only counts a visitor who accepted the cookie banner, so they undercount: fair between articles, not an audited figure.
            </p>
          </>
        )}
      </Read>
    </Card>
  );
}

/* ---------- the search listing --------------------------------------------------- */

const META_FROM: Record<ArticleMeta["from"], string> = {
  live: "Read from the live page at the desk's last crawl.",
  approved: "A title or description approved on the desk replaces the article's own.",
  built: "Worked out the way the website builds it: the whole title with the site's name after it, and the excerpt ended where it fits.",
};

function Length({ label, line }: { label: string; line: MetaLine }) {
  const over = line.length > line.limit;
  const none = line.length === 0;
  return (
    <span className="dk-article-length">
      <span className="dk-article-quiet">{label}</span>
      <Badge tone={none ? "bad" : over ? "warn" : "good"}>
        {none ? "none" : `${num(line.length)} / ${num(line.limit)}`}
      </Badge>
    </span>
  );
}

export function ListingPanel({ meta, slug, excerpt }: { meta: Reading<ArticleMeta>; slug: string; excerpt: string }) {
  return (
    <Card title="Search listing" icon="search" sub="The title and description a search result shows, in characters against the desk's yardsticks." right={<Stamp reading={meta} />}>
      <Read reading={meta}>
        {(m) => (
          <>
            <div className="dk-article-serp">
              <p className="dk-article-serp-url">balkaris.ch › insights › {slug}</p>
              <p className="dk-article-serp-title">{m.title.text}</p>
              <p className="dk-article-serp-desc">{m.description.text || DASH}</p>
            </div>
            <div className="dk-article-lengths">
              <Length label="Title" line={m.title} />
              <Length label="Description" line={m.description} />
            </div>
            <p className="dk-article-quiet dk-article-note-line">{META_FROM[m.from]} Google cuts a title by its width, at about 60 characters.</p>
          </>
        )}
      </Read>
      <Facts rows={[["Excerpt", excerpt || null]]} className="dk-article-facts--top" />
    </Card>
  );
}

/* ---------- where it came from ----------------------------------------------------- */

const FIGURES: (keyof SourceFigures)[] = ["views", "likes", "comments", "shares", "saves"];

function SourceFiguresGrid({ f }: { f: SourceFigures }) {
  return (
    <dl className="dk-article-figs">
      {FIGURES.map((k) => (
        <div key={k} className="dk-article-fig">
          <dt>{k}</dt>
          <dd className="dk-num" title={f[k] === null ? "The platform does not publish this figure." : undefined}>
            {f[k] === null ? DASH : num(f[k])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SourcePanel({ source: s }: { source: ArticleSource }) {
  let host: string | null = null;
  try {
    host = new URL(s.url).hostname.replace(/^www\./, "");
  } catch {
    host = null;
  }
  /* A social post is its account's (@handle on TikTok); an article is its site's, with its author as a fact below. */
  const social = s.kind !== "article";
  const who = social && s.author ? `@${s.author}` : (s.site ?? host ?? s.url);
  const on = social && s.author ? platformName(s.platform) : null;
  return (
    <Card
      title="Where it came from"
      icon="link"
      sub={s.sharedBy ? `Shared by ${s.sharedBy}, ${ago(s.sharedAt)}` : `Shared ${ago(s.sharedAt)}; the desk did not record by whom`}
      right={s.figures ? <Stamp reading={s.figures} /> : null}
    >
      <a className="dk-article-source" href={s.url} target="_blank" rel="noreferrer noopener">
        <span className="dk-article-source-who">
          {who}
          {on ? ` on ${on}` : ""}
          <Icon name="external" size={12} />
        </span>
        {s.title ? <span className="dk-article-source-title">{s.title}</span> : null}
        <span className="dk-article-source-url">{s.url}</span>
      </a>
      {s.figures ? (
        <div className="dk-article-figs-wrap">
          <Read reading={s.figures}>
            {(f, r) => (
              <>
                <SourceFiguresGrid f={f} />
                <p className="dk-article-quiet dk-article-note-line">{r.note}</p>
              </>
            )}
          </Read>
        </div>
      ) : null}
      <Facts
        rows={[
          ["Kind", kindName(s.kind)],
          ["Author", !social && s.author ? s.author : null],
          ["Posted", s.postedAt ? fullDate(s.postedAt) : null],
          ["Read by the desk", s.capturedAt ? when(s.capturedAt) : null],
          ["Length", s.durationS ? duration(s.durationS * 1000) : s.slides ? `${num(s.slides)} slides` : null],
          ["Words read", s.words ? num(s.words) : null],
          ["Shelf", s.topic?.name ?? null],
          ["Services", s.services.length ? <ChipRow key="svc" items={s.services.map((x) => x.name)} /> : null],
          ["Said beside the link", s.note],
        ]}
      />
    </Card>
  );
}

export function ChipRow({ items, tone = "quiet" }: { items: string[]; tone?: "quiet" | "violet" | "good" }) {
  return (
    <span className="dk-article-chips">
      {items.map((t) => (
        <Chip key={t} tone={tone} pill>
          {t}
        </Chip>
      ))}
    </span>
  );
}

/* ---------- how it was written -------------------------------------------------- */

export function WritingPanel({ p }: { p: ArticlePayload }) {
  const w = p.writing;
  return (
    <Card title="How it was written" icon="pencil" sub={`On the workstation, ${ago(w.writtenAt)}`}>
      <Facts
        rows={[
          ["Format", w.format ? w.format.name : "Nobody chose, so the standard way"],
          ["Template", w.template.name ? `${w.template.name} (${w.template.id})` : w.template.id],
          ["Model", w.model ?? "Not recorded"],
          ["Writing took", w.ms ? duration(w.ms) : "Not recorded"],
          ["Ending", w.closing ? w.closing.name : "Not recorded"],
          ["Reading time", p.article.readingTime ? `${num(p.article.readingTime)} min` : null],
          ["Shelves", p.article.topics.length ? <ChipRow key="t" items={p.article.topics.map((t) => t.name)} /> : null],
          ["Services", p.article.services.length ? <ChipRow key="s" items={p.article.services.map((s) => s.name)} tone="violet" /> : null],
          ["Written", when(w.writtenAt)],
        ]}
      />
      {w.echo ? (
        <div className="dk-article-flag">
          <b>Ends like another article.</b> {w.echo}
        </div>
      ) : null}
    </Card>
  );
}

/* ---------- the video ------------------------------------------------------------------ */

export function VideoPanel({ p, back }: { p: ArticlePayload; back: (done: string) => string }) {
  const v = p.video;
  if (!v) return null;
  /* The attach handler republishes, and a new clip is pushed by itself, only
     for a LISTED article: src/server.ts checks "published" or "listed", and
     no draft is ever "published". An unlisted one changes on the desk only. */
  const live = p.site.state === "listed";
  const later = p.site.state === "unlisted" ? " It is live but unlisted, so the site keeps the old setting until the article is published again." : "";
  const on = platformName(v.platform) ?? "platform";
  /* Whether the LIVE page plays a clip is what its file on the website's
     branch says, not what the desk holds: the desk's copy may be gone (or
     never made on this machine) while the site keeps the one it was sent.
     Null when it is not live, or the branch was not read. */
  const repo = p.site.repo;
  const onBranch = isLive(p.site.state) && repo.state === "ok" ? repo.value.clip : null;
  /* What the site's video block does (balkaris-web-infrastructure, components/blocks/watch.tsx): it
     plays the clip it was sent, muted until asked, and draws nothing when it was sent none. */
  const plays = `muted until a reader turns the sound on. No ${on} player, no recommendations, no cookies.`;
  const says = !v.attached
    ? "It reads as prose. The video is credited but not shown."
    : !v.plays
      ? "Set to attach, but the site will show no video: the publisher does not recognise this address as a video it can play."
      : !isLive(p.site.state)
        ? v.held
          ? `Once it is on the site, the video plays in the article from the desk's own copy, ${plays}`
          : "Set to play in the article, but the desk holds no copy of the video, so the site would have nothing to play. Cutting the clip again makes one."
        : onBranch === true
          ? `The live article plays a silent excerpt of the video from the site's own copy, ${plays}`
          : onBranch === false
            ? `The live article's file names no silent clip, so its page shows no video; the source is still credited. ${v.held ? "The desk holds one, and it goes out with the article's next push." : "The desk holds none either: cutting the clip again makes one."}`
            : `Whether the live page plays a clip is on the website's branch, which was not read. ${v.held ? "The desk holds one for it." : "The desk holds no copy of the video."}`;
  const length = v.clip ? (v.clip.whole ? `${num(v.clip.seconds)} seconds, the whole video` : `The first ${num(v.clip.seconds)} seconds of the video`) : null;
  return (
    <Card title="Video" icon="video" right={<Badge tone={v.attached ? "good" : "quiet"}>{v.attached ? "Attached" : "Just the text"}</Badge>}>
      <p className="dk-article-lead">{says}</p>
      <Facts
        rows={[
          ["The desk's clip", v.held ? (length ?? "Held; its length was not recorded") : "None held"],
          ["On the live page", onBranch === null ? null : onBranch ? "Its file names the silent clip" : "Its file names no clip"],
          ["Clip job", v.clipJob ? <JobState key="cj" job={v.clipJob} /> : null],
        ]}
      />
      <div className="dk-article-acts">
        <ActionForm
          post={`/draft/${p.draftId}/attach`}
          back={back("attach")}
          label={v.attached ? "Just the text, no video" : "Attach the video"}
          explain={`${v.attached ? "The article reads as prose; the video is credited but not shown." : "A silent excerpt of the video plays in the article."}${later}`}
          confirm={
            live
              ? {
                  title: v.attached ? "Take the video out of the live article?" : "Put the video in the live article?",
                  body: p.offers.canPublish ? (
                    <p>The desk changes the setting and republishes the article under your name, so the live page changes once the site has rebuilt, in about two minutes.</p>
                  ) : (
                    <p>The setting changes on the desk. Your account has no email, so the article is not republished: the live page keeps the old setting until somebody who can publish pushes it.</p>
                  ),
                  yes: v.attached ? "Just the text" : "Attach the video",
                }
              : null
          }
        />
        <ActionForm
          post={`/draft/${p.draftId}/clip`}
          back={back("clip")}
          label="Cut the silent clip again"
          explain={`The workstation cuts the excerpt from the video again. It never touches the words.${later}`}
          confirm={
            live
              ? {
                  title: "Cut the silent clip again?",
                  body: <p>The workstation cuts a new excerpt. Because the article is published, the desk pushes the new clip to the site by itself as soon as it is cut.</p>,
                  yes: "Cut it again",
                }
              : null
          }
        />
      </div>
    </Card>
  );
}

/* ---------- the workstation ------------------------------------------------------------- */

export function JobState({ job }: { job: { state: string; error: string | null } }) {
  return (
    <span className="dk-article-jobstate">
      <Chip tone={JOB_TONE[job.state] ?? "quiet"}>{job.state}</Chip>
      {job.error ? <span className="dk-article-quiet">{job.error}</span> : null}
    </span>
  );
}

const VISIBLE_JOBS = 6;

function JobRows({ jobs }: { jobs: ArticleWork["jobs"] }) {
  return (
    <ul className="dk-article-jobs">
      {jobs.map((j) => {
        const held = j.state === "queued" && j.notBefore && Date.parse(j.notBefore) > Date.now();
        return (
          <li key={j.id} className="dk-article-job">
            <div className="dk-article-job-row">
              <span className="dk-article-job-what">
                {JOB_SAYS[j.kind] ?? j.kind}
                <span className="dk-article-quiet"> · job {j.id}</span>
              </span>
              <Chip tone={JOB_TONE[j.state] ?? "quiet"}>{j.state}</Chip>
            </div>
            <p className="dk-article-quiet">
              {`${num(j.attempts)} ${j.attempts === 1 ? "attempt" : "attempts"} · asked ${ago(j.createdAt)}`}
              {j.finishedAt ? ` · finished ${ago(j.finishedAt)}` : j.takenAt ? ` · taken ${ago(j.takenAt)}` : ""}
              {held ? ` · held until ${clock(j.notBefore!)} while the bot waits for an answer` : ""}
            </p>
            {j.error ? <p className="dk-article-job-error">{j.error}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function WorkPanel({ work, extra }: { work: ArticleWork; extra?: ReactNode }) {
  const ws = work.workstation;
  const open = work.jobs.filter((j) => j.state !== "done").length;
  return (
    <Card
      title="Workstation"
      icon="cpu"
      count={work.jobs.length || undefined}
      sub={ws.lastSeen ? `Last asked for work ${ago(ws.lastSeen)}` : "No workstation has ever asked for work."}
      right={<StatusDot tone={ws.awake ? "good" : "quiet"}>{ws.awake ? "Awake" : "Asleep"}</StatusDot>}
    >
      {extra}
      {work.jobs.length ? (
        <>
          {open ? null : <p className="dk-article-quiet dk-article-note-line">Every job for this link has finished.</p>}
          <JobRows jobs={work.jobs.slice(0, VISIBLE_JOBS)} />
          {work.jobs.length > VISIBLE_JOBS ? (
            <details className="dk-article-more">
              <summary>
                {`${work.jobs.length - VISIBLE_JOBS} older ${work.jobs.length - VISIBLE_JOBS === 1 ? "job" : "jobs"}`}
                <Icon name="chevron-down" size={14} />
              </summary>
              <JobRows jobs={work.jobs.slice(VISIBLE_JOBS)} />
            </details>
          ) : null}
        </>
      ) : (
        <Empty compact icon="cpu" title="No jobs">
          Nothing has been asked of the workstation for this link.
        </Empty>
      )}
    </Card>
  );
}

/* ---------- the history ------------------------------------------------------------------- */

const VISIBLE_EVENTS = 14;

export function HistoryPanel({ history, className }: { history: ActivityItem[]; className?: string }) {
  const now = new Date();
  return (
    <Card title="History" icon="clock" count={history.length || undefined} sub="Everything the desk logged about this link, newest first." className={className}>
      {history.length ? (
        <>
          <Timeline label="History" items={activityItems(history.slice(0, VISIBLE_EVENTS), now)} />
          {history.length > VISIBLE_EVENTS ? (
            <details className="dk-article-more">
              <summary>
                {`${history.length - VISIBLE_EVENTS} earlier`}
                <Icon name="chevron-down" size={14} />
              </summary>
              <Timeline label="Earlier history" items={activityItems(history.slice(VISIBLE_EVENTS), now)} />
            </details>
          ) : null}
        </>
      ) : (
        <Empty compact icon="clock" title="Nothing logged">
          The desk has logged nothing about this link.
        </Empty>
      )}
    </Card>
  );
}
