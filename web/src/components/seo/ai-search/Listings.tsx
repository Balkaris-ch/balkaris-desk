import type { Reading } from "@/contract/common";
import type { AiListings, AiSearchAsked, CitedListing } from "@/contract/seo/ai-search";
import { Badge, Chip, type ChipTone } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card, CardFoot } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";
import { Tooltip } from "@/components/ui/Tooltip";
import { PanelAbsent } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { AiOwnerMark } from "./Act";
import { BASE, competitorHref, exportHref, hrefWith, paramsOf } from "./look";
import "@/components/ui/table.css";
import "./ai-search.css";

const THERE: Record<NonNullable<CitedListing["profile"]>["state"] | "none", { word: string; tone: ChipTone }> = {
  exists: { word: "Listed", tone: "good" },
  "not-found": { word: "Not listed", tone: "bad" },
  unknown: { word: "Not confirmed", tone: "warn" },
  "not-checked": { word: "Not checked", tone: "quiet" },
  none: { word: "No profile known", tone: "bad" },
};

/**
 * WHERE THE ANSWERS LOOK. The directories, listings and platforms the
 * recorded answers cited, most cited first, with whether Balkaris is there
 * (the desk's profile record) and the owner step that puts it there. Being
 * listed where the answers look is the most direct way into them.
 */
export function Directories({ reading, asked, range }: { reading: Reading<AiListings>; asked: AiSearchAsked; range: string }) {
  const v = reading.state === "ok" ? reading.value : null;
  const there = v ? v.directories.filter((d) => d.profile?.state === "exists").length : 0;
  /* Where a profile of Balkaris belongs: one the desk records, or one an owner task would create. */
  const belongs = v ? v.directories.filter((d) => d.profile || d.ownerTask).length : 0;
  /* Each owner task once, however many directories wait on it. */
  const tasks = v ? [...new Map(v.directories.filter((d) => d.ownerTask && d.profile?.state !== "exists").map((d) => [d.ownerTask!.id, d.ownerTask!])).values()] : [];
  return (
    <Card
      title="Where the answers look"
      icon="map-pin"
      flush
      className="dk-seo-ai-search-panel"
      info="Directories, listings and platforms the recorded answers cited as their sources, with whether Balkaris has a profile there (the desk's record, checked weekly where an address is known). An assistant that names studios names the ones its sources list."
      sub={v ? `${num(there)} of the ${num(belongs)} where it belongs list Balkaris · ${num(v.directories.length)} cited in ${num(v.withSources)} answers with sources` : undefined}
      right={
        <span className="dk-seo-ai-search-head-acts">
          <LinkButton href="/seo/backlinks" size="sm">
            Profiles
          </LinkButton>
          <LinkButton href={exportHref("directories")} size="sm" icon="download" title="Every directory cited, as CSV">
            CSV
          </LinkButton>
        </span>
      }
      footer={v ? <CardFoot href={hrefWith(paramsOf(range, asked), { named: "sites", who: undefined }, "named")}>{`${num(v.sitesTotal)} companies' own sites cited, ${num(v.namedTotal)} companies named`}</CardFoot> : undefined}
    >
      {v ? (
        <>
          <div className="dk-table-wrap">
            <table className="dk-table dk-table--dense dk-table--caps dk-seo-ai-search-dirs">
              <caption className="dk-sr">Directories the answers cited, and whether Balkaris is listed there</caption>
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col" className="dk-table-right">
                    Cited
                  </th>
                  <th scope="col">Balkaris there</th>
                  <th scope="col">Step</th>
                </tr>
              </thead>
              <tbody>
                {v.directories.map((d) => {
                  const t = d.profile ? THERE[d.profile.state] : d.ownerTask ? THERE.none : { word: THERE.none.word, tone: "quiet" as ChipTone };
                  return (
                    <tr key={d.source}>
                      <td>
                        <Tooltip text={`${d.engines.join(", ")}: ${d.questions.map((q) => `“${q}”`).join(" ")}`}>
                          <span className="dk-seo-ai-search-dir" tabIndex={0}>
                            <span className="dk-seo-ai-search-strong">{d.source}</span>
                            <span className="dk-seo-ai-search-quiet">{d.engines.join(", ")}</span>
                          </span>
                        </Tooltip>
                      </td>
                      <td className="dk-table-right dk-num">{num(d.answers)}</td>
                      <td>
                        <Tooltip text={d.profile ? `${d.profile.name}: ${d.profile.why || "the desk's profile record"}` : "The desk knows no profile of Balkaris there."}>
                          <span tabIndex={0}>
                            <Badge tone={t.tone} dot>
                              {t.word}
                            </Badge>
                          </span>
                        </Tooltip>
                      </td>
                      <td>
                        {d.profile?.state === "exists" ? (
                          <span className="dk-seo-ai-search-quiet">Keep it current</span>
                        ) : d.ownerTask ? (
                          <Tooltip text={d.ownerTask.title}>
                            <span tabIndex={0}>
                              <Chip tone={d.ownerTask.done ? "good" : "warn"}>{d.ownerTask.done ? "Marked done" : "Needs you"}</Chip>
                            </span>
                          </Tooltip>
                        ) : (
                          <span className="dk-seo-ai-search-quiet">No task recorded</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!v.directories.length ? (
                  <tr className="dk-table-none">
                    <td colSpan={4}>The recorded answers cited no directory or listing.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {tasks.length ? (
            <ul className="dk-seo-ai-search-tasks" aria-label="The owner's steps that put Balkaris there">
              {tasks.map((t) => (
                <li key={t.id} className="dk-seo-ai-search-task">
                  <span>{t.title}</span>
                  <AiOwnerMark id={t.id} done={t.done} />
                </li>
              ))}
            </ul>
          ) : null}
          <p className={cx("dk-seo-ai-search-pad", "dk-seo-ai-search-line")}>
            {v.own.answers ? (
              <>
                balkaris.ch itself was cited in <b>{num(v.own.answers)}</b> answer{v.own.answers === 1 ? "" : "s"} ({v.own.engines.join(", ")}).
              </>
            ) : (
              "No recorded answer cited balkaris.ch itself."
            )}{" "}
            <Stamp reading={reading} />
          </p>
        </>
      ) : reading.state !== "ok" ? (
        <div className="dk-seo-ai-search-pad">
          <PanelAbsent reading={reading} />
        </div>
      ) : null}
    </Card>
  );
}

const VIEWS: { key: AiSearchAsked["named"]; label: string }[] = [
  { key: "top", label: "Most named" },
  { key: "all", label: "Every company" },
  { key: "sites", label: "Their sites cited" },
];
const FIND = "dk-seo-ai-search-find-named";

/**
 * The companies the answers named instead of (or beside) Balkaris, most named
 * first: the first ten, every one, or the companies' own sites the answers
 * cited, with a search over the names. Each company opens Competitors
 * searched for it. All of it is in the address.
 */
export function Named({ reading, asked, range }: { reading: Reading<AiListings>; asked: AiSearchAsked; range: string }) {
  const v = reading.state === "ok" ? reading.value : null;
  const base = paramsOf(range, asked);
  const sites = asked.named === "sites";
  return (
    <>
      <form id={FIND} method="get" action={BASE} hidden>
        {Object.entries(base)
          .filter(([k]) => k !== "who")
          .map(([k, val]) => (
            <input key={k} type="hidden" name={k} value={val} />
          ))}
      </form>
      <Card
        id="named"
        title="Named instead"
        icon="users"
        flush
        className="dk-seo-ai-search-panel"
        info="The companies the recorded answers named, as the recorder wrote them down, by how many answers named each; or the companies' own sites the answers cited. Balkaris is left out. They are the studios an assistant knows for these questions: Competitors shows what their pages have."
        sub={v ? (sites ? `${num(v.sitesTotal)} companies' own sites cited` : `${num(v.namedTotal)} companies in ${num(v.answers)} answers`) : undefined}
        right={
          <LinkButton href={exportHref("named")} size="sm" icon="download" title="Every company named, as CSV">
            CSV
          </LinkButton>
        }
      >
        {v ? (
          <>
            <div className="dk-seo-ai-search-filters dk-seo-ai-search-pad-x" role="group" aria-label="Which list">
              {VIEWS.map((x) => (
                <Go
                  key={x.key}
                  href={hrefWith(base, { named: x.key === "top" ? undefined : x.key }, "named")}
                  scroll={false}
                  replace
                  className={cx("dk-seo-ai-search-filter", asked.named === x.key && "dk-seo-ai-search-filter--on")}
                  aria-current={asked.named === x.key ? "true" : undefined}
                >
                  {x.label}
                </Go>
              ))}
            </div>
            <div className="dk-seo-ai-search-toolbar dk-seo-ai-search-pad-x">
              <label className="dk-seo-ai-search-find">
                <Icon name="search" size={14} />
                <input form={FIND} type="search" name="who" defaultValue={asked.who} placeholder={sites ? "Search sites…" : "Search companies…"} aria-label={sites ? "Search the sites cited" : "Search the companies named"} maxLength={80} />
              </label>
              {asked.who ? (
                <Go href={hrefWith(base, { who: undefined }, "named")} scroll={false} replace className="dk-seo-ai-search-link">
                  Clear
                </Go>
              ) : null}
            </div>
            <div className="dk-table-wrap">
              <table className="dk-table dk-table--dense dk-table--caps">
                <caption className="dk-sr">{sites ? "Companies' own sites the answers cited" : "Companies the answers named"}</caption>
                <thead>
                  <tr>
                    <th scope="col">{sites ? "Site" : "Company"}</th>
                    <th scope="col" className="dk-table-right">
                      Answers
                    </th>
                    <th scope="col">Assistants</th>
                  </tr>
                </thead>
                <tbody>
                  {(sites ? v.sites.map((x) => ({ name: x.source, answers: x.answers, engines: x.engines })) : v.named).map((n) => (
                    <tr key={n.name}>
                      <td className="dk-seo-ai-search-clip">
                        <Go href={competitorHref(n.name)} className="dk-seo-ai-search-strong dk-seo-ai-search-company" title={`${n.name} on Competitors`}>
                          {n.name}
                        </Go>
                      </td>
                      <td className="dk-table-right dk-num">{num(n.answers)}</td>
                      <td className="dk-seo-ai-search-quiet dk-seo-ai-search-wrap">{n.engines.join(", ")}</td>
                    </tr>
                  ))}
                  {!(sites ? v.sites.length : v.named.length) ? (
                    <tr className="dk-table-none">
                      <td colSpan={3}>
                        {asked.who ? `Nothing ${sites ? "cited" : "named"} matches “${asked.who}”.` : sites ? "The recorded answers cited no company's own site." : "The recorded answers named no company."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {!sites && asked.named === "top" && !asked.who && v.namedTotal > v.named.length ? (
              <Go href={hrefWith(base, { named: "all" }, "named")} scroll={false} replace className="dk-seo-ai-search-more">
                {`Show all ${num(v.namedTotal)} companies`}
                <Icon name="chevron-down" size={14} />
              </Go>
            ) : null}
          </>
        ) : reading.state !== "ok" ? (
          <div className="dk-seo-ai-search-pad">
            <PanelAbsent reading={reading} />
          </div>
        ) : null}
      </Card>
    </>
  );
}
