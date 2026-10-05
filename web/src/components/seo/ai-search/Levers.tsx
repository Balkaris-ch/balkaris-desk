import type { Reading } from "@/contract/common";
import type { AiLever } from "@/contract/seo/ai-search";
import { Chip, type ChipTone } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { AiOwnerMark } from "./Act";
import "./ai-search.css";

const STATE: Record<AiLever["state"], { tone: ChipTone; icon: IconName; word: string }> = {
  good: { tone: "good", icon: "check-circle", word: "In place" },
  warn: { tone: "warn", icon: "alert", word: "Partly" },
  bad: { tone: "bad", icon: "x-circle", word: "Missing" },
  unknown: { tone: "quiet", icon: "help", word: "Not read yet" },
};

export const WHO: Record<AiLever["step"]["who"], { word: string; tone: ChipTone }> = {
  owner: { word: "Needs you", tone: "warn" },
  "lead-chrome": { word: "In the owner's browser", tone: "info" },
  content: { word: "Content", tone: "violet" },
  code: { word: "Website code", tone: "quiet" },
  desk: { word: "The desk", tone: "good" },
};

/**
 * WHAT MOVES THE SHARE. Each lever is something that decides whether an AI
 * answer can find, trust and quote Balkaris, with what the desk read about it
 * today and the one step that moves it: an owner task with its done mark (a
 * person's, never the desk's), or the page where the work is listed. The
 * sentence on why it matters is reasoning, said as such in the panel's (i).
 */
export function Levers({ reading }: { reading: Reading<AiLever[]> }) {
  const levers = reading.state === "ok" ? reading.value : [];
  const missing = levers.filter((l) => l.state === "bad").length;
  return (
    <Card
      title="What moves the share"
      icon="target"
      className="dk-seo-ai-search-panel"
      info="What decides whether an AI assistant can find, trust and quote Balkaris, each with what the desk read today (Google's URL Inspection, the profiles, the readiness check, the crawl, the keyword table) and the step that moves it. Why each matters is reasoning, not a measurement: the share itself is only ever the recorded answers."
      sub={reading.state === "ok" ? `${num(missing)} missing · ${num(levers.filter((l) => l.state === "warn").length)} partly in place · ${num(levers.filter((l) => l.state === "good").length)} in place` : undefined}
      right={reading.state === "ok" ? <Stamp reading={reading} /> : null}
    >
      {reading.state === "ok" ? (
        <ol className="dk-seo-ai-search-levers">
          {levers.map((l) => {
            const s = STATE[l.state];
            const who = WHO[l.step.who];
            return (
              <li key={l.key} className="dk-seo-ai-search-lever">
                <details className="dk-seo-ai-search-lever-text">
                  <summary>
                    <span className={cx("dk-seo-ai-search-lever-mark", `dk-tone-${s.tone}`)} title={s.word}>
                      <Icon name={s.icon} size={16} />
                      <span className="dk-sr">{s.word}: </span>
                    </span>
                    <span className="dk-seo-ai-search-lever-head">
                      <span className="dk-seo-ai-search-lever-title">{l.title}</span>
                      <span className={cx("dk-seo-ai-search-lever-figure", `dk-tone-${s.tone}`)}>{l.figure ?? "Not read yet"}</span>
                    </span>
                    <Icon name="chevron-down" size={14} className="dk-seo-ai-search-lever-chev" />
                  </summary>
                  <div className="dk-seo-ai-search-lever-body">
                    <p className="dk-seo-ai-search-lever-why">{l.why}</p>
                    <p className="dk-seo-ai-search-lever-detail">{l.detail}</p>
                    <p className="dk-seo-ai-search-lever-step">
                      <Icon name="arrow-right" size={13} />
                      <span>
                        {l.step.text}
                        {l.step.ownerTask ? (
                          <>
                            {" "}
                            <span className="dk-seo-ai-search-quiet">
                              (Task: {l.step.ownerTask.title}
                              {l.step.ownerTask.done ? `, marked done${l.step.ownerTask.doneBy ? ` by ${l.step.ownerTask.doneBy}` : ""}` : ""})
                            </span>
                          </>
                        ) : null}
                      </span>
                    </p>
                  </div>
                </details>
                <div className="dk-seo-ai-search-lever-act">
                  <Chip tone={who.tone}>{who.word}</Chip>
                  {l.step.ownerTask ? (
                    <AiOwnerMark id={l.step.ownerTask.id} done={l.step.ownerTask.done} />
                  ) : l.step.opportunities && l.step.opportunitiesHref ? (
                    <LinkButton href={l.step.opportunitiesHref} size="xs" variant="quiet">
                      {`${num(l.step.opportunities)} to do`}
                    </LinkButton>
                  ) : l.step.href ? (
                    <LinkButton href={l.step.href} size="xs" variant="quiet">
                      Open
                    </LinkButton>
                  ) : null}
                  {/* With an owner task, the opportunities that carry the step open their own list; the page where the work is followed is "Details". */}
                  {l.step.ownerTask && l.step.opportunities && l.step.opportunitiesHref ? (
                    <Go href={l.step.opportunitiesHref} className="dk-seo-ai-search-link dk-seo-ai-search-lever-more">
                      {`${num(l.step.opportunities)} open`}
                    </Go>
                  ) : null}
                  {l.step.href && (l.step.ownerTask || (l.step.opportunities && l.step.opportunitiesHref && l.step.href !== l.step.opportunitiesHref)) ? (
                    <Go href={l.step.href} className="dk-seo-ai-search-link dk-seo-ai-search-lever-more">
                      Details
                    </Go>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <PanelAbsent reading={reading} />
      )}
    </Card>
  );
}
