import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type { VitalFigure } from "@/contract/seo/technical";
import { Chip } from "@/components/ui/Badge";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { PanelAbsent } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { duration, num } from "@/lib/format";

/** Small pieces every panel of SEO › Technical uses. */

export type LineTone = "good" | "warn" | "bad" | "info" | "absent";

/** The filled circle before a check: a tick, an exclamation, a cross, a dot for a plain count, a dashed ring for an absent source. */
export function Mark({ tone }: { tone: LineTone }) {
  const said = tone === "good" ? "Passes" : tone === "bad" ? "Fails" : tone === "warn" ? "Needs attention" : tone === "info" ? "A count" : "Not available";
  return (
    <span className={cx("dk-seo-technical-mark", `dk-seo-technical-mark--${tone}`)} role="img" aria-label={said}>
      {tone === "warn" ? <b aria-hidden>!</b> : tone === "info" ? null : <Icon name={tone === "good" ? "check" : tone === "bad" ? "x" : "minus"} size={11} />}
    </span>
  );
}

/** Where a page of the site is looked at closely: SEO › Pages › Page Optimization. */
export const pageView = (path: string): string => `/seo/pages/view?path=${encodeURIComponent(path)}`;

/** A site address, linked to its page in Page Optimization when it is one of the site's pages. */
export function PathLink({ path, plain }: { path: string; plain?: boolean }) {
  if (plain || !path.startsWith("/")) return <span className="dk-seo-technical-path">{path}</span>;
  return (
    <Go href={pageView(path)} className="dk-seo-technical-path dk-seo-technical-path--link" title={`Open ${path} in Page Optimization`}>
      {path}
    </Go>
  );
}

/** A finding's severity as a chip. */
export function Severity({ severity }: { severity: "critical" | "warning" | "opportunity" }) {
  return (
    <Chip tone={severity === "critical" ? "bad" : severity === "warning" ? "warn" : "info"} className="dk-seo-technical-sev">
      {severity === "critical" ? "Critical" : severity === "warning" ? "Warning" : "Opportunity"}
    </Chip>
  );
}

/** A vital's value in its own unit: "1.3s", "82ms", "0.02". */
export const vitalValue = (v: { value: number; unit: "ms" | "score" }): string => (v.unit === "ms" ? duration(v.value) : num(v.value, 2));

export const ratingWord = (r: VitalFigure["rating"]): string => (r === "good" ? "Good" : r === "poor" ? "Poor" : "Needs improvement");
export const ratingTone = (r: VitalFigure["rating"] | null | undefined): "good" | "warn" | "bad" | "quiet" => (r === "good" ? "good" : r === "poor" ? "bad" : r ? "warn" : "quiet");

/** A panel's body, or its absent state with the reason and the step that connects it. */
export function Body<T>({ reading, children }: { reading: Reading<T>; children: (value: T) => ReactNode }) {
  if (reading.state === "ok") return <>{children(reading.value)}</>;
  return (
    <div className="dk-seo-technical-absent">
      <PanelAbsent reading={reading} />
    </div>
  );
}

/** A line of small grey type: what a panel's figures are, where they come from. */
export function Quiet({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("dk-seo-technical-quiet", className)}>{children}</p>;
}

/** A count that is a fault in red or amber, a clean one grey. */
export function Figure({ n, tone, of }: { n: number; tone: "good" | "warn" | "bad" | "info"; of?: number | null }) {
  return (
    <span className={cx("dk-seo-technical-n dk-num", `dk-seo-technical-n--${tone}`)}>
      {num(n)}
      {of != null ? <span className="dk-seo-technical-of"> / {num(of)}</span> : null}
    </span>
  );
}
