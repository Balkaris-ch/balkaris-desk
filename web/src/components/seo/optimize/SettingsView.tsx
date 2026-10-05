import type { ReactNode } from "react";
import type { ProposalRow } from "@/contract/operator";
import type { PageSettings, SeoPageViewPayload, SettingField, SettingGroup, SettingSide } from "@/contract/seo/page-view";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { cx } from "@/lib/cx";
import { ago, DASH, num } from "@/lib/format";
import { MetaEditor } from "./MetaEditor";
import { AiButtons, Editable, IndexEditor, ProposalActions, SchemaEditor, ShareEditor } from "./SettingForms";

/**
 * "Optimize": the page's settings, each field three ways side by side — what
 * the live page says (the crawl), what the desk has had approved (committed
 * to the website's overrides file) and what waits for approval — with "Edit"
 * (a person writes it), "Ask the AI" (the studio workstation's local model
 * drafts it; it arrives as a proposal) and, on each proposal, approve, reject,
 * withdraw or read back. Nothing changes the live site until a person who can
 * publish approves.
 */

const STATE: Record<ProposalRow["state"], { word: string; tone: "warn" | "good" | "quiet" | "bad" | "info" }> = {
  waiting: { word: "Waiting for approval", tone: "warn" },
  approved: { word: "Approved, not committed", tone: "info" },
  applied: { word: "Live", tone: "good" },
  rejected: { word: "Rejected", tone: "quiet" },
  withdrawn: { word: "Withdrawn", tone: "quiet" },
};

function Side({ side, picture }: { side: SettingSide | null; picture: boolean }) {
  if (!side) return <span className="dk-seo-optimize-quiet">{DASH}</span>;
  return (
    <span className="dk-seo-optimize-set-val">
      {picture && side.picture ? <img src={side.picture} alt="" className="dk-seo-optimize-set-pic" loading="lazy" /> : null}
      <span className={cx("dk-seo-optimize-wrap", picture && "dk-seo-optimize-mono")}>{side.value}</span>
      <span className="dk-seo-optimize-quiet">
        #{side.id} · {side.by ?? "a person"} · {ago(side.at)}
      </span>
    </span>
  );
}

function Live({ f }: { f: SettingField }) {
  if (f.live === null) return <span className="dk-tone-warn">Not set</span>;
  const n = [...f.live].length;
  return (
    <span className="dk-seo-optimize-set-val">
      {f.livePicture ? <img src={f.livePicture} alt="" className="dk-seo-optimize-set-pic" loading="lazy" /> : null}
      <span className={cx("dk-seo-optimize-wrap", (f.key === "ogImage" || f.key === "canonical") && "dk-seo-optimize-mono")}>{f.live}</span>
      {f.limit ? (
        <span className={cx("dk-num", n > f.limit ? "dk-tone-warn" : "dk-seo-optimize-quiet")}>
          {num(n)}/{num(f.limit)}
        </span>
      ) : null}
    </span>
  );
}

/** The three columns, one row a field. */
function Fields({ fields }: { fields: SettingField[] }) {
  return (
    <div className="dk-seo-optimize-scroll">
      <table className="dk-seo-optimize-set-table">
        <thead>
          <tr>
            <th scope="col">Setting</th>
            <th scope="col">Live page now</th>
            <th scope="col">Approved by the desk</th>
            <th scope="col">Waiting for approval</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.key}>
              <th scope="row">{f.label}</th>
              <td>
                <Live f={f} />
              </td>
              <td>
                <Side side={f.approved} picture={f.key === "ogImage"} />
              </td>
              <td>
                <Side side={f.waiting} picture={f.key === "ogImage"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The group's proposals that wait or are live, each with its own buttons. */
function Proposals({ rows }: { rows: ProposalRow[] }) {
  if (!rows.length) return null;
  return (
    <ul className="dk-seo-optimize-props">
      {rows.map((p) => (
        <li key={p.id}>
          <span className="dk-seo-optimize-props-top">
            <Badge tone={STATE[p.state].tone} dot>
              {STATE[p.state].word}
            </Badge>
            <span className="dk-seo-optimize-quiet">
              #{p.id} · {p.source === "operator" ? `the local model (task #${p.taskId ?? "?"})` : (p.proposedBy ?? "a person")} · {ago(p.createdAt)}
            </span>
          </span>
          {p.changes.map((c) => (
            <span key={c.label} className="dk-seo-optimize-props-line">
              <b>{c.label}</b>{" "}
              {c.look === "code" ? (
                <code className="dk-seo-optimize-mono">{(c.after ?? "").slice(0, 160)}</code>
              ) : (
                <>
                  <span className="dk-seo-optimize-quiet">{c.before ?? "(none)"}</span> <Icon name="arrow-right" size={12} /> {c.after ?? "(removed)"}
                </>
              )}
            </span>
          ))}
          <span className="dk-seo-optimize-props-line dk-seo-optimize-quiet">{p.consequence}</span>
          {p.why ? <span className="dk-seo-optimize-props-line dk-seo-optimize-quiet">Why: {p.why}</span> : null}
          {p.drift ? <span className="dk-seo-optimize-props-line dk-tone-warn">The page has changed since it was proposed: ask again.</span> : null}
          {p.readBack ? <span className={cx("dk-seo-optimize-props-line", p.readBack.ok ? "dk-tone-good" : "dk-tone-warn")}>{p.readBack.line}</span> : null}
          {p.error ? <span className="dk-seo-optimize-props-line dk-tone-bad">{p.error}</span> : null}
          <ProposalActions p={p} />
        </li>
      ))}
    </ul>
  );
}

function Group({ title, info, group, edit, locked, children }: { title: string; info: string; group: SettingGroup; edit: ReactNode; locked: string | null; children?: ReactNode }) {
  const waiting = group.proposals.filter((p) => p.state === "waiting").length;
  return (
    <Card title={title} count={waiting || undefined} className="dk-seo-optimize-panel dk-seo-optimize-set" info={info}>
      {group.fields.length ? <Fields fields={group.fields} /> : null}
      {children}
      <div className="dk-seo-optimize-set-bar">
        <Editable locked={locked}>{edit}</Editable>
        <AiButtons drafts={group.ai} />
      </div>
      <Proposals rows={group.proposals} />
    </Card>
  );
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function SettingsView({ data }: { data: SeoPageViewPayload }) {
  const path = data.path!;
  const r = data.settings;
  const page = data.page.state === "ok" ? data.page.value : null;
  const c = data.crawl.state === "ok" ? data.crawl.value : null;
  if (r.state !== "ok" || !page || !c || !data.serp)
    return (
      <Card title="This page's settings" className="dk-seo-optimize-panel">
        <Absent reading={r.state !== "ok" ? r : { state: "waiting", source: "crawl", reason: "The crawl has no title for this page." }} />
      </Card>
    );
  const s: PageSettings = r.value;
  const host = hostOf(page.url);
  const og = (k: "ogTitle" | "ogDescription" | "ogImage") => s.sharing.fields.find((f) => f.key === k);
  const idx = data.index.state === "ok" ? data.index.value.now : null;
  const metaPending = s.search.ai[0] && !s.search.ai[0].available ? s.search.ai[0].unavailable : null;
  return (
    <>
      {s.locked ? <p className="dk-seo-optimize-note dk-tone-warn">{s.locked}</p> : null}
      <Group
        title="Search: title and description"
        info="What Google shows for the page. The website appends “ | Balkaris” to a title where the whole still fits in 60 characters."
        group={s.search}
        locked={s.locked}
        edit={<MetaEditor key={path} path={path} url={page.url} title={c.title} description={c.description} titleLimit={data.serp.titleLimit} descriptionLimit={data.serp.descriptionLimit} answers200={c.status === 200} askedAlready={metaPending} />}
      />
      <Group
        title="Sharing: the card a shared link shows"
        info="What LinkedIn, WhatsApp, Slack and others show when someone shares the page: og:title, og:description and og:image. A share title and text must not copy the page's title or description."
        group={s.sharing}
        locked={s.locked}
        edit={
          <ShareEditor
            key={path}
            path={path}
            host={host.replace(/^www\./, "")}
            live={{ title: og("ogTitle")?.live ?? null, description: og("ogDescription")?.live ?? null, picture: og("ogImage")?.live ?? null, pictureUrl: og("ogImage")?.livePicture ?? null }}
            pictures={s.sharePictures}
            fallbackTitle={c.title}
            fallbackDescription={c.description}
          />
        }
      >
        <p className="dk-seo-optimize-note">
          {c.og.image && s.defaultPicture && c.og.image === s.defaultPicture ? "The page shares the site’s default picture: it has none of its own." : c.og.image ? "The page shares a picture of its own." : "The page names no share picture."}{" "}
          {s.twitterCard ? `Twitter card: ${s.twitterCard}.` : "No Twitter card."}
        </p>
      </Group>
      <Group
        title="Index: in search, and the canonical"
        info="Whether search engines may list the page, and which address they should credit. Taking a page out of search also takes it out of the sitemap, the feed and llms.txt."
        group={s.index}
        locked={s.locked}
        edit={<IndexEditor key={path} path={path} host={host} noindexLive={/noindex/i.test(c.robots ?? "")} canonicalLive={c.canonical} noindexRefused={s.noindexRefused} />}
      >
        <p className="dk-seo-optimize-note">
          {idx ? (
            <>
              Google’s URL Inspection of {idx.day}:{" "}
              <b className={idx.indexed ? "dk-tone-good" : "dk-tone-warn"}>{idx.indexed ? "indexed" : "not indexed"}</b>
              {idx.coverage ? ` (${idx.coverage})` : ""}
              {idx.googleCanonical ? `; Google’s canonical ${idx.googleCanonical}` : ""}.
            </>
          ) : data.index.state !== "ok" ? (
            `Google’s index state: ${data.index.reason}`
          ) : null}
        </p>
      </Group>
      <Group
        title="Structured data"
        info="JSON-LD blocks that tell search engines what the page is (a service, its questions and answers…). The desk adds blocks of its own beside what the website's code prints; the company's Organization stays in the code."
        group={s.schema}
        locked={s.locked}
        edit={<SchemaEditor key={path} path={path} url={page.url} printed={s.schemaTypes} />}
      >
        <dl className="dk-seo-optimize-facts">
          <dt>The page prints</dt>
          <dd>{s.schemaTypes.length ? s.schemaTypes.join(", ") : <span className="dk-tone-warn">No structured data</span>}</dd>
          <dt>The crawl’s rules</dt>
          <dd>{s.schemaProblems.length ? <span className="dk-tone-warn">{s.schemaProblems.join(" ")}</span> : "Nothing found wrong with what it prints."}</dd>
        </dl>
        {s.schemaBlocks.map((b) => (
          <details key={b.id} className="dk-seo-optimize-set-block">
            <summary>
              {b.type} · #{b.id} · {STATE[b.state].word}
              {b.problem ? <span className="dk-tone-warn"> · would be refused now</span> : null}
            </summary>
            {b.problem ? <p className="dk-seo-optimize-note dk-tone-warn">{b.problem}</p> : null}
            <pre className="dk-seo-optimize-mono dk-seo-optimize-set-code">{b.json}</pre>
          </details>
        ))}
      </Group>
      <Stamp reading={r} />
      <p className="dk-seo-optimize-note">
        Every change waits in{" "}
        <Go href="/operator?ap=waiting#approvals" className="dk-seo-optimize-link">
          AI Operator › Approvals
        </Go>{" "}
        until someone who can publish approves it; then the desk commits it to the website’s overrides file and the next deploy shows it.
      </p>
    </>
  );
}
