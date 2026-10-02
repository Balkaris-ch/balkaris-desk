import type { ProfileState } from "@/contract/seo/backlinks";
import type { DirectoryRow, SeoCompetitorsPayload } from "@/contract/seo/competitors";
import type { ChipTone } from "@/components/ui/Badge";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tooltip } from "@/components/ui/Tooltip";
import { ago, num } from "@/lib/format";
import { ReadNowButton } from "./Buttons";
import { seenAs, shownName, taskWho } from "./look";

const STATE: Record<ProfileState, { label: string; tone: ChipTone }> = {
  exists: { label: "Listed", tone: "good" },
  "not-found": { label: "Not listed", tone: "bad" },
  unknown: { label: "Could not check", tone: "warn" },
  "not-checked": { label: "Not checked", tone: "quiet" },
};

/**
 * "Directories in the results": the platforms Google showed or an AI answer
 * cited for our searches (a directory ranking for one of our searches is a
 * place to be listed), and the studio's own profile there as the registry
 * knows it. Creating a listing is the owner's step: the task says how.
 */
export function Directories({ reading }: { reading: SeoCompetitorsPayload["directories"] }) {
  return (
    <Card
      title="Directories in the results"
      icon="list"
      tone="info"
      className="dk-seo-competitors-dirs"
      info="Directories, networks and other platforms among the observations, best Google position first. Balkaris's own profile comes from the profile registry (SEO › Backlinks), checked weekly where it has an address."
      right={<Stamp reading={reading} />}
    >
      <Read reading={reading}>
        {(rows) =>
          rows.length ? (
            <ul className="dk-seo-competitors-dir-list">
              {rows.map((r) => (
                <DirLine key={r.domain} r={r} />
              ))}
            </ul>
          ) : (
            <p className="dk-seo-competitors-note">No directory or platform was seen in the results for our searches.</p>
          )
        }
      </Read>
    </Card>
  );
}

function DirLine({ r }: { r: DirectoryRow }) {
  const first = r.seen[0];
  const s = r.ours ? STATE[r.ours.state] : null;
  return (
    <li className="dk-seo-competitors-dir">
      <span className="dk-seo-competitors-dir-who">
        <span className="dk-seo-competitors-name">{shownName(r.domain, r.name)}</span>
        <Tooltip text={r.seen.map((x) => `${x.engineLabel}: ${seenAs(x)} for “${x.query}”`).join(". ")}>
          <span className="dk-seo-competitors-dir-seen" tabIndex={0}>
            {first ? `${seenAs(first)} for “${first.query}”` : ""}
            {r.seen.length > 1 ? ` and ${num(r.seen.length - 1)} more` : ""}
          </span>
        </Tooltip>
      </span>
      <span className="dk-seo-competitors-dir-ours">
        {r.ours && s ? (
          <Tooltip text={`${r.ours.name}: ${r.ours.stateWhy}${r.ours.checkedAt ? ` Checked ${ago(r.ours.checkedAt)}.` : ""}`}>
            <span tabIndex={0}>
              <Badge tone={s.tone} dot>
                {s.label}
              </Badge>
            </span>
          </Tooltip>
        ) : (
          <span className="dk-seo-competitors-none" title="The profile registry has no entry for this platform.">
            no profile kept
          </span>
        )}
        {r.task && r.ours?.state !== "exists" ? (
          r.task.href ? (
            <Go href={r.task.href} className="dk-seo-competitors-task-link" title={r.task.title}>
              {taskWho(r.task)}
            </Go>
          ) : (
            <span className="dk-seo-competitors-quiet" title={r.task.title}>
              {taskWho(r.task)}
            </span>
          )
        ) : null}
      </span>
    </li>
  );
}

/** "Their pages": when the desk last read them, when it reads them next, and the button that reads the due ones now. */
export function Refresh({ refresh }: { refresh: SeoCompetitorsPayload["refresh"] }) {
  const why = refresh.registered === false ? "The competitor read is not registered on this desk yet." : refresh.running ? "Reading now." : null;
  return (
    <Card title="Their pages, read weekly" icon="refresh" tone="quiet" className="dk-seo-competitors-refresh">
      <p className="dk-seo-competitors-refresh-line">
        <span className="dk-num">{num(refresh.fetched)}</span> of <span className="dk-num">{num(refresh.pages)}</span> pages read
        {refresh.newestRead ? `, the newest ${ago(refresh.newestRead)}` : ""}.
        {refresh.lastRun ? ` Last run ${ago(refresh.lastRun)}` : " Not run yet"}
        {refresh.lastRun && refresh.lastNote ? `: ${refresh.lastNote.replace(/[.\s]+$/, "")}.` : "."}
        {refresh.nextRun ? ` Next run ${ago(refresh.nextRun)}.` : ""}
      </p>
      <p className="dk-seo-competitors-note">robots.txt is asked first and obeyed, two seconds pass between requests to a site, and every request carries the desk's name. What is kept is what the page says: title, heading, words, language, structured data, a price.</p>
      <ReadNowButton disabled={!!why} why={why} />
    </Card>
  );
}
