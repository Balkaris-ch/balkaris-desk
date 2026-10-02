import type { Given, TaskResult } from "@/contract/operator";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { ago, sourceLabel } from "@/lib/format";
import { cx } from "@/lib/cx";

/**
 * The model's words, drawn as text and never as markup: a paragraph per
 * blank line, a list where its lines start with "- " or "1. ". React writes
 * every string as text, so nothing a model says can become HTML here.
 */
export function AnswerText({ text, className }: { text: string; className?: string }) {
  const blocks: { list: "ul" | "ol" | null; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      blocks.push({ list: null, lines: [] });
      continue;
    }
    const bullet = /^\s*[-•]\s+(.*)$/.exec(line);
    const number = /^\s*\d{1,2}[.)]\s+(.*)$/.exec(line);
    const kind = bullet ? "ul" : number ? "ol" : null;
    const body = (bullet?.[1] ?? number?.[1] ?? line).trim();
    const last = blocks[blocks.length - 1];
    if (last && last.list === kind && (kind !== null || last.lines.length)) last.lines.push(body);
    else blocks.push({ list: kind, lines: [body] });
  }
  return (
    <div className={cx("dk-operator-text", className)}>
      {blocks
        .filter((b) => b.lines.length)
        .map((b, i) =>
          b.list === "ul" ? (
            <ul key={i}>
              {b.lines.map((l, j) => (
                <li key={j}>{l}</li>
              ))}
            </ul>
          ) : b.list === "ol" ? (
            <ol key={i}>
              {b.lines.map((l, j) => (
                <li key={j}>{l}</li>
              ))}
            </ol>
          ) : (
            <p key={i}>{b.lines.join(" ")}</p>
          ),
        )}
    </div>
  );
}

/** "Given: Traffic (GA4) as of 11:22 · The crawl's findings as of 10:15", and what was missing. */
export function GivenLine({ given, className, inline }: { given: Given[]; className?: string; inline?: boolean }) {
  const Tag = inline ? "span" : "p";
  if (!given.length) return <Tag className={cx("dk-operator-given", className)}>Given no data: it answered from the question alone.</Tag>;
  return (
    <Tag className={cx("dk-operator-given", className)}>
      <span>Given: </span>
      {given.map((g, i) => (
        <span key={`${g.name}-${i}`} className={cx(g.state !== "ok" && "dk-operator-given-off")} title={g.note}>
          {i ? " · " : ""}
          {g.label}
          {g.state === "ok" && g.asOf ? ` (${sourceLabel(g.source)}, read ${ago(g.asOf)})` : g.state === "ok" ? "" : " (not available)"}
        </span>
      ))}
    </Tag>
  );
}

/** What the desk refused or changed in an answer. */
export function Flags({ result }: { result: TaskResult }) {
  if (!result.flags.length) return null;
  return (
    <ul className="dk-operator-flags">
      {result.flags.map((f, i) => (
        <li key={i}>
          <Icon name="alert" size={14} />
          <span>{f}</span>
        </li>
      ))}
    </ul>
  );
}

/** Links to the proposals an answer made. */
export function ProposalLinks({ result }: { result: TaskResult }) {
  if (!result.proposals.length) return null;
  return (
    <p className="dk-operator-given">
      {result.proposals.length} {result.proposals.length === 1 ? "proposal" : "proposals"}:{" "}
      {result.proposals.map((p, i) => (
        <span key={p.id}>
          {i ? ", " : ""}
          <Go href={`/operator?ap=${p.state === "waiting" ? "waiting" : p.state === "applied" || p.state === "approved" ? "approved" : "completed"}#approvals`} className="dk-operator-link">
            {p.address}
          </Go>{" "}
          ({p.state})
        </span>
      ))}
    </p>
  );
}
