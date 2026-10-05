import type { ChipTone } from "@/components/ui/Badge";
import type { EngineInput, SeoOpportunitiesPayload } from "@/contract/seo/opportunities";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { StatusDot } from "@/components/ui/StatusDot";
import { ago, fullDate } from "@/lib/format";

const SAID: Record<EngineInput["state"], string> = { read: "read whole", partial: "read in part", unread: "not read", off: "not connected" };

/** A source that read nothing because something failed (it has a reading's date) is amber; one that has not run yet is quiet. */
const toneOf = (i: EngineInput): ChipTone => (i.state === "read" ? "good" : i.state === "partial" ? "warn" : i.state === "unread" && i.asOf ? "warn" : "quiet");

const when = (asOf: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(asOf) ? fullDate(asOf) : ago(asOf));

/**
 * "What the list is made from": each source the rules read, and whether it
 * could give all of it last time (src/cc/seo/engine.ts, engineInputs). A
 * source read in part or not at all clears nothing, so a short list is never
 * mistaken for work done. Closed, it says only what is not whole.
 */
export function Inputs({ reading }: { reading: SeoOpportunitiesPayload["inputs"] }) {
  if (reading.state !== "ok") {
    return (
      <div className="dk-seo-opps-inputs">
        <Absent reading={reading} form="inline" />
      </div>
    );
  }
  const v = reading.value;
  const short = v.inputs.filter((i) => i.state !== "read");
  return (
    <details className="dk-seo-opps-inputs">
      <summary>
        <Icon name="layers" size={14} />
        <span className="dk-seo-opps-inputs-head">What the list is made from</span>
        <span className="dk-seo-opps-inputs-sum">
          {short.length
            ? short.map((i) => (
                <span key={i.key}>
                  <StatusDot tone={toneOf(i)} />
                  {i.label} {SAID[i.state]}
                </span>
              ))
            : "every source read whole"}
        </span>
        <Icon name="chevron-down" size={14} />
      </summary>
      <ul className="dk-seo-opps-inputs-list">
        {v.inputs.map((i) => (
          <li key={i.key}>
            <StatusDot tone={toneOf(i)} />
            <span>
              <b>{i.label}</b>
              <span className="dk-seo-opps-quiet">
                {" "}
                · {SAID[i.state]}
                {i.asOf ? ` · ${when(i.asOf)}` : ""}
              </span>
              <em>{i.line}</em>
              {i.step ? <em className="dk-seo-opps-inputs-step">The owner’s step: {i.step}</em> : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="dk-seo-opps-note">{v.ranAt ? `The engine last ran whole ${ago(v.ranAt)}: ${v.line ?? "no line kept."}` : "The engine has not run whole yet."}</p>
    </details>
  );
}
