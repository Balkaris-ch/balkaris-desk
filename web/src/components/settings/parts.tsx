import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** One fact in a list of them: what it is on the left, what it says on the right, and a quiet line under it. */
export interface Fact {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
}

/**
 * Label and value rows, as the Site Health board's Infrastructure panel draws
 * them: the label in grey, the value in ink, a hairline between rows.
 */
export function Facts({ items, className }: { items: readonly (Fact | null | false)[]; className?: string }) {
  return (
    <dl className={cx("dk-settings-facts", className)}>
      {items
        .filter((f): f is Fact => !!f)
        .map((f, i) => (
          <div className="dk-settings-fact" key={i}>
            <dt>{f.label}</dt>
            <dd>
              <span className="dk-settings-fact-value">{f.value}</span>
              {f.note ? <span className="dk-settings-fact-note">{f.note}</span> : null}
            </dd>
          </div>
        ))}
    </dl>
  );
}

/** A paragraph of plain explanation inside a panel. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("dk-settings-prose", className)}>{children}</div>;
}

/** A line of machine text (an address, a command) that is read and copied, not edited. */
export function Code({ children }: { children: ReactNode }) {
  return <code className="dk-settings-code">{children}</code>;
}
