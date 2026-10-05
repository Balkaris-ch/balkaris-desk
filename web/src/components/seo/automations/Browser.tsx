import type { OwnerTaskRow, Priority } from "@/contract/seo/common";
import type { ChipTone } from "@/components/ui/Badge";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { fullDate, num } from "@/lib/format";
import { StepDone, StepNote } from "./StepDone";

const IMPACT: Record<Priority, { label: string; tone: ChipTone }> = {
  high: { label: "High", tone: "bad" },
  medium: { label: "Medium", tone: "warn" },
  low: { label: "Low", tone: "quiet" },
};

/**
 * Steps no API offers (Request indexing, Validate fix, the Generative AI
 * export, a search engine's submit form): the lead does them by hand in the
 * owner's browser, then marks them done here. Not automations, and listed on
 * this page so that it is plain they are not: no job does them. Each opens
 * the screen it is done on, and keeps a note of what was done.
 */
export function Browser({ tasks, at, links }: { tasks: OwnerTaskRow[]; at: string; links: Record<string, { label: string; href: string }[]> }) {
  const open = tasks.filter((t) => !t.done).length;
  return (
    <Card
      title="Done by hand"
      icon="user"
      count={tasks.length ? `${num(open)} open` : undefined}
      sub="No job can do these: no API offers them. The lead does each one in the owner’s browser, then marks it done here."
      info="The steps come from the SEO audit. Done is a person’s mark, recorded with their name; the desk never sets it. The links open the screen each step is done on, signed in as whoever uses the browser."
    >
      {tasks.length ? (
        <ol className="dk-seo-automations-steps">
          {tasks.map((t) => (
            <li key={t.id} className="dk-seo-automations-steprow" data-done={t.done || undefined}>
              <div className="dk-seo-automations-steprow-head">
                <Badge tone={t.done ? "good" : IMPACT[t.impact].tone}>{t.done ? "Done" : IMPACT[t.impact].label}</Badge>
                <span className="dk-seo-automations-steprow-title">{t.title}</span>
                <StepDone id={t.id} title={t.title} done={t.done} />
              </div>
              {links[t.id]?.length ? (
                <p className="dk-seo-automations-steprow-links">
                  {links[t.id]!.map((l) => (
                    <Go key={l.href} href={l.href} className="dk-seo-automations-steprow-link">
                      <Icon name="external" size={12} />
                      {l.label}
                    </Go>
                  ))}
                </p>
              ) : null}
              {t.note ? <p className="dk-seo-automations-steprow-note">{t.note}</p> : null}
              <details className="dk-seo-automations-steprow-more">
                <summary>The step, and why</summary>
                <p>{t.step}</p>
                {t.why ? <p className="dk-seo-automations-quiet">{t.why}</p> : null}
                <p className="dk-seo-automations-quiet">
                  From {t.from}
                  {t.effort ? ` · takes ${t.effort}` : ""}
                  {t.opportunities ? ` · ${num(t.opportunities)} opportunit${t.opportunities === 1 ? "y waits" : "ies wait"} on it` : ""}
                  {t.done && t.doneBy ? ` · done by ${t.doneBy}${t.doneAt ? ` on ${fullDate(t.doneAt)}` : ""}` : ""}
                </p>
                <StepNote id={t.id} title={t.title} note={t.note} />
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <Empty icon="inbox" title="No steps recorded" compact>
          The browser steps come in with the SEO audit&apos;s import (scripts/seo-import.ts, or the owner&apos;s import on the desk). As of {fullDate(at)} none is on this desk.
        </Empty>
      )}
    </Card>
  );
}
