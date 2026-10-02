import type { OpportunityRow } from "@/contract/seo/common";
import { Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { ago, num } from "@/lib/format";
import { actionEffect, actionLabel, DONE_IT, ownerStep } from "@/components/seo/opportunities/look";
import { ActButton, OwnerStepDone } from "./Act";
import { PathLink, Quiet } from "./bits";

/**
 * The technical opportunities as the opportunity engine keeps them: the
 * crawl's findings, the failed site-wide checks and the audit's technical
 * tasks, each with the action that moves it. A proposal or a brief is an
 * operator task (proposals wait for approval); "code" goes on the to-do list
 * in AI Operator for whoever changes the website's code; a step from the audit
 * done by hand in the owner's browser is marked done by whoever took it. The
 * button words are SEO › Opportunities' own (opportunities/look.ts).
 */

const KIND: Record<OpportunityRow["action"]["kind"], string> = {
  proposal: "Proposal, waits for approval",
  brief: "Brief by the operator",
  owner: "Needs you",
  chrome: "By hand, in the owner's browser",
  code: "Website code",
};

const STATE: Record<OpportunityRow["state"]["state"], { word: string; tone: "quiet" | "info" | "good" | "warn" }> = {
  open: { word: "Open", tone: "quiet" },
  queued: { word: "Queued", tone: "info" },
  "in-progress": { word: "In progress", tone: "warn" },
  done: { word: "Done", tone: "good" },
  dismissed: { word: "Dismissed", tone: "quiet" },
};

const SHOWN = 10;

function Row({ o, owner }: { o: OpportunityRow; owner: boolean }) {
  const s = STATE[o.state.state];
  return (
    <li className="dk-seo-technical-opp">
      <Chip tone={o.priority === "high" ? "bad" : o.priority === "medium" ? "warn" : "quiet"} className="dk-seo-technical-opp-pri">
        {o.priority === "high" ? "High" : o.priority === "medium" ? "Medium" : "Low"}
      </Chip>
      <span className="dk-seo-technical-opp-what">
        <Go href={`/seo/opportunities?open=${encodeURIComponent(o.id)}`} className="dk-seo-technical-opp-title">
          {o.title}
        </Go>
        <span className="dk-seo-technical-opp-sub">
          {o.subject.page ? <PathLink path={o.subject.page.path} /> : <span>the site</span>}
          <span>{KIND[o.action.kind]}</span>
          {o.state.state !== "open" ? (
            <span>
              {s.word}
              {o.state.by ? ` by ${o.state.by}` : ""}
              {o.state.at ? `, ${ago(o.state.at)}` : ""}
            </span>
          ) : null}
        </span>
      </span>
      <Chip tone={s.tone} className="dk-seo-technical-opp-state">
        {s.word}
      </Chip>
      <span className="dk-seo-technical-opp-act">
        <Action o={o} owner={owner} />
      </span>
    </li>
  );
}

/**
 * The row's action, by its kind, each through the door that takes it:
 *   a step from the audit (owner task)   "I have done it" (POST …/owner-task { task });
 *                                        the owner's own steps to the owner only
 *   proposal, brief, code, Request indexing   its own action (POST …/act { id })
 * A row already queued, in progress or decided says so instead of a button.
 */
function Action({ o, owner }: { o: OpportunityRow; owner: boolean }) {
  const a = o.action;
  if (o.state.state !== "open") {
    return o.state.note ? (
      <span className="dk-seo-technical-opp-why" title={o.state.note}>
        {o.state.note}
      </span>
    ) : null;
  }
  if (!a.available) {
    return (
      <span className="dk-seo-technical-opp-why" title={a.why ?? undefined}>
        {a.why ?? "Not now"}
      </span>
    );
  }
  const step = ownerStep(a);
  if (step && a.kind === "owner" && !owner) {
    return (
      <Tooltip text={`${a.step} Only the owner marks it done, once it is done.`}>
        <span tabIndex={0}>
          <Chip tone="warn">Needs you</Chip>
        </span>
      </Tooltip>
    );
  }
  return (
    <>
      {a.href ? (
        <Go href={a.href} className="dk-seo-technical-ext" aria-label={`Where to do it: ${a.label}`} title="Where to do it">
          <Icon name="external" size={14} />
        </Go>
      ) : null}
      <Tooltip text={`${a.step} ${actionEffect(a)}`}>
        <span>{step ? <OwnerStepDone task={step} label={DONE_IT} /> : <ActButton id={o.id} label={actionLabel(a)} title={actionEffect(a)} />}</span>
      </Tooltip>
    </>
  );
}

export function OppsCard({ rows, owner }: { rows: OpportunityRow[]; owner: boolean }) {
  const open = rows.filter((o) => o.state.state === "open").length;
  return (
    <Card
      title="Technical opportunities"
      icon="lightbulb"
      id="opportunities"
      count={num(rows.length)}
      info="What the opportunity engine keeps from the crawl’s findings, the failed site-wide checks and the SEO audit’s technical tasks, highest priority first. A proposal or a brief is written by the operator on the studio workstation and waits for a person; nothing here changes the live site."
      right={
        <LinkButton href="/seo/opportunities?type=technical" size="sm">
          In Opportunities
        </LinkButton>
      }
      flush
      className="dk-seo-technical-opps"
    >
      {rows.length ? (
        <>
          <Quiet className="dk-seo-technical-pad-x">
            {num(open)} open, {num(rows.length - open)} queued, in progress or decided.
          </Quiet>
          <ul className={cx("dk-seo-technical-rows")} aria-label="Technical opportunities">
            {rows.slice(0, SHOWN).map((o) => (
              <Row key={o.id} o={o} owner={owner} />
            ))}
          </ul>
          {rows.length > SHOWN ? (
            <details className="dk-seo-technical-more dk-seo-technical-pad-x">
              <summary>
                {num(rows.length - SHOWN)} more <Icon name="chevron-down" size={12} />
              </summary>
              <ul className="dk-seo-technical-rows" aria-label="More technical opportunities">
                {rows.slice(SHOWN).map((o) => (
                  <Row key={o.id} o={o} owner={owner} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : (
        <Quiet className="dk-seo-technical-pad">The opportunity engine keeps no technical opportunity: it has not run, or it found none.</Quiet>
      )}
    </Card>
  );
}
