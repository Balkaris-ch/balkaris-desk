import type { NewTask } from "@/contract/operator";
import type { OwnerTaskRow } from "@/contract/seo/common";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { fullDate, num } from "@/lib/format";
import { MarkDone, QueueTask } from "./Act";
import { taskAnchor, taskTitle } from "./look";

const IMPACT = { high: { label: "High impact", tone: "bad" }, medium: { label: "Medium impact", tone: "warn" }, low: { label: "Low impact", tone: "quiet" } } as const;

/** Turns the addresses in a step into links, so "https://business.google.com" can be opened. */
function Step({ text }: { text: string }) {
  return (
    <div className="dk-seo-bl-need-step">
      {text.split(/\n+/).map((line, n) => (
        <p key={n}>
          {line.split(/(https?:\/\/[^\s)"'<>]+[^\s)"'<>.,;:])/g).map((part, i) =>
            /^https?:\/\//.test(part) ? (
              <a key={i} href={part} target="_blank" rel="noreferrer" className="dk-seo-bl-link">
                {part}
              </a>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}

/** The operator task behind "Draft profile texts", answered from the website's pages: words only, nothing that only the owner can decide. */
const DRAFT: NewTask = {
  kind: "ask",
  context: "website",
  depth: "deep",
  prompt:
    "Write a short, factual description of the studio for agency directories and map listings (Clutch, Sortlist, DesignRush, GoodFirms, local.ch, Bing Places, Apple Business): one of about 50 words and one of about 150, each in English and in Swiss German (de-CH), and the list of services as the website names them. Use only what the website states: no figures, no client claims beyond its case studies. Leave name, address, phone, founding year and team size blank: the owner decides those.",
};

/**
 * "Needs you": the steps about the studio's presence that only the owner can
 * take (a login, a decision, a profile), the decision every listing copies
 * first, each with its exact step, its impact and effort as the audit judged
 * them, and "Mark done", which a person presses when it is done. Never a
 * button that pretends to take the step. ?task= opens one.
 */
export function NeedsYou({ tasks, open }: { tasks: OwnerTaskRow[]; open: string | null }) {
  const todo = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  return (
    <Card
      id="needs-you"
      title="Needs you"
      icon="user"
      tone="warn"
      count={num(todo.length)}
      sub="Profiles to create or fix, reviews and credits to ask for: steps behind your logins and decisions"
      info="These come from the SEO audit, each with its exact step. Done is a person's mark: the desk never marks one by itself, even when the weekly check later finds the new profile. The operator can draft the profile texts; it cannot sign in anywhere."
      className="dk-seo-bl-needs"
      right={
        <QueueTask
          task={DRAFT}
          label="Draft profile texts"
          title="Queue a task for the AI Operator (the studio workstation's local model): a short and a long studio description in English and German for the directory profiles, with name, address and phone left blank for you."
        />
      }
    >
      {tasks.length ? (
        todo.length ? (
          <ol className="dk-seo-bl-needlist">
            {[...todo, ...done].map((t) => (
              <li key={t.id} id={taskAnchor(t.id)} className={cx("dk-seo-bl-need", t.done && "dk-seo-bl-need--done")}>
                <details open={open === t.id}>
                  <summary className="dk-seo-bl-need-row">
                    <Icon name="chevron-right" size={14} className="dk-seo-bl-need-chev" />
                    <span className="dk-seo-bl-need-title">{taskTitle(t.title)}</span>
                    <span className="dk-seo-bl-need-meta">
                      {t.done ? <Chip tone="good">Done</Chip> : <Chip tone={IMPACT[t.impact].tone}>{IMPACT[t.impact].label}</Chip>}
                      {t.effort ? <span className="dk-seo-bl-quiet">{t.effort}</span> : null}
                    </span>
                  </summary>
                  <div className="dk-seo-bl-need-body">
                    <Step text={t.step} />
                    {t.why ? <p className="dk-seo-bl-need-why">Why: {t.why}</p> : null}
                    <p className="dk-seo-bl-quiet">
                      {t.from}
                      {t.opportunities ? ` · ${num(t.opportunities)} opportunit${t.opportunities === 1 ? "y waits" : "ies wait"} on it` : ""}
                      {t.done && t.doneBy ? ` · marked done by ${t.doneBy}${t.doneAt ? `, ${fullDate(t.doneAt)}` : ""}` : ""}
                    </p>
                  </div>
                </details>
                <MarkDone id={t.id} done={t.done} />
              </li>
            ))}
          </ol>
        ) : (
          <Empty icon="check-circle" title="Nothing about profiles waits for you" compact>
            Every step here is marked done. The weekly check keeps reading the profiles.
          </Empty>
        )
      ) : (
        <Empty icon="inbox" title="No owner step is recorded yet" compact>
          The steps come in with the SEO audit’s import.
        </Empty>
      )}
    </Card>
  );
}
