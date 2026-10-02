import type { Reading } from "@/contract/common";
import type { SeoAutomationSplit } from "@/contract/seo/automations";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import type { ChipTone } from "@/components/ui/Badge";
import { cx } from "@/lib/cx";
import { ago, fullDate, num } from "@/lib/format";
import type { ReactNode } from "react";

/**
 * What the board leaves unsaid and the owner asked to see stated plainly:
 * what the SEO tools do by themselves, what waits for a person's approval,
 * and what only a person can do. Each column's figure is read from the
 * desk's own tables; the sentences are the rules the code keeps
 * (src/cc/seo/engine.ts, src/cc/operator/apply.ts, src/cc/seo/owner.ts).
 */
export function Split({ reading }: { reading: Reading<SeoAutomationSplit> }) {
  return (
    <Card
      title="By itself, or by a person"
      icon="shield-check"
      sub="What the SEO tools do on their own, what waits for a person’s approval, and what only a person can do. Nothing reaches the website without a person’s approval."
      right={<Stamp reading={reading} />}
    >
      <Read reading={reading}>{(s) => <Columns s={s} />}</Read>
    </Card>
  );
}

function Columns({ s }: { s: SeoAutomationSplit }) {
  const a = s.automatic;
  const p = s.approval;
  const who = s.people;
  const runnerTone: ChipTone = p.runner.state === "online" ? "good" : p.runner.state === "articles" ? "warn" : "quiet";
  return (
    <div className="dk-seo-automations-split">
      <Column
        icon="refresh"
        tone="good"
        title="By itself"
        figure={
          <>
            {num(a.on)} <span className="dk-seo-automations-of">of {num(a.of)} jobs on</span>
          </>
        }
      >
        <li>Reads Search Console, URL Inspection, GA4, Google Autocomplete, PageSpeed, the website itself, competitors’ public pages and the studio’s profiles, on the schedules above.</li>
        <li>Finds the opportunities, ranks them, and moves each one along with its operator task.</li>
        <li>
          Writes only to the desk’s own database. It never changes the website, and never queues work for the operator by itself: a person’s press on an opportunity does.
        </li>
        <li>“Run full SEO audit” at the top runs the crawl, Search Console, the snapshot, the readiness check and the engine now, one after another.</li>
        {a.waiting.length ? <li className="dk-seo-automations-split-warn">Waiting for its source: {a.waiting.join(", ")}.</li> : null}
        {a.off.length ? <li className="dk-seo-automations-split-warn">Switched off by the owner: {a.off.join(", ")}.</li> : null}
      </Column>

      <Column
        icon="hourglass"
        tone="warn"
        title="Waits for a person’s approval"
        figure={
          <Go href="/operator?ap=waiting#approvals" className="dk-seo-automations-split-link">
            {num(p.waiting)} <span className="dk-seo-automations-of">proposal{p.waiting === 1 ? "" : "s"} waiting</span>
          </Go>
        }
      >
        <li>
          A new title, description or redirect: the operator proposes it when a person presses an opportunity’s button. It waits in AI Operator › Approvals; when someone who can publish approves it, it becomes one line in the website’s content/desk/overrides.json, committed in their name. Withdrawn, the line goes again.
        </li>
        <li>A brief for a new page or section: the operator writes it; a person writes and publishes the page.</li>
        <li className="dk-num">
          {num(p.applied30)} approved in the last 30 days · {num(p.queued)} operator task{p.queued === 1 ? "" : "s"} queued, {num(p.running)} running · {num(p.inProgress)} opportunit{p.inProgress === 1 ? "y" : "ies"} in progress.
        </li>
        <li className="dk-seo-automations-split-runner">
          <StatusDot tone={runnerTone} />
          <span>
            The operator runs on the studio workstation’s own model, not on the desk. {p.runner.line}
            {p.runner.lastSeen ? ` Last asked ${ago(p.runner.lastSeen)}.` : ""}
          </span>
        </li>
      </Column>

      <Column
        icon="user"
        tone="violet"
        title="Only a person can do"
        figure={
          <Go href="/seo#needs-you" className="dk-seo-automations-split-link">
            {num(who.owner.open)} <span className="dk-seo-automations-of">owner step{who.owner.open === 1 ? "" : "s"} open</span>
          </Go>
        }
      >
        <li>
          Needs you: logins, decisions, profiles and reviews in the studio’s own name. {num(who.owner.open)} open, {num(who.owner.done)} done.
        </li>
        <li>
          In the owner’s browser: {num(who.chrome.open)} step{who.chrome.open === 1 ? "" : "s"} no API offers, listed below{who.chrome.done ? ` (${num(who.chrome.done)} done)` : ""}.
        </li>
        <li>
          AI assistants: asked by hand and recorded, never by a job.{" "}
          {who.aiChecks.rows ? (
            <span className="dk-num">
              {num(who.aiChecks.rows)} answers so far{who.aiChecks.lastDay ? `, the newest on ${fullDate(who.aiChecks.lastDay)}` : ""}.
            </span>
          ) : (
            "None recorded yet."
          )}
        </li>
        <li>
          Monthly exports the owner downloads and imports:{" "}
          {who.imports.map((im, i) => (
            <span key={im.kind}>
              {i ? "; " : ""}
              {im.label}, {im.month ? `last ${im.month}` : "none imported yet"}
            </span>
          ))}
          .
        </li>
        <li>Done is a person’s mark: the desk never marks a step done by itself.</li>
      </Column>
    </div>
  );
}

function Column({ icon, tone, title, figure, children }: { icon: IconName; tone: ChipTone; title: string; figure: ReactNode; children: ReactNode }) {
  return (
    <section className="dk-seo-automations-split-col">
      <h3 className="dk-seo-automations-split-title">
        <span className={cx("dk-seo-automations-split-icon", `dk-tone-${tone}`)} aria-hidden>
          <Icon name={icon} size={16} />
        </span>
        {title}
      </h3>
      <p className="dk-seo-automations-split-figure dk-num">{figure}</p>
      <ul className="dk-seo-automations-split-list">{children}</ul>
    </section>
  );
}
