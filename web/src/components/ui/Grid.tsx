import type { CSSProperties, ReactNode } from "react";
import { cx } from "@/lib/cx";
import "./grid.css";

export interface GridProps {
  /**
   * The row's columns at full width, as a grid template: "2fr 1fr 1fr",
   * "1fr 1fr", "1.4fr 1fr". Write the proportions the board draws.
   */
  cols: string;
  /**
   * The columns when the page is too narrow for `cols` (a 1280 screen).
   * Default: two equal columns, and an odd last panel takes the whole row.
   */
  mid?: string;
  children: ReactNode;
  className?: string;
}

/**
 * One row of panels. A screen is a stack of these under its PageHead.
 *
 * It answers to the width it is given, not to the window, so it behaves the
 * same beside the sidebar and under the phone's drawer: `cols` while there is
 * room, `mid` under about 1120px of content, one column under about 700px.
 * Panels in a row are as tall as the tallest.
 */
export function Grid({ cols, mid = "minmax(0, 1fr) minmax(0, 1fr)", children, className }: GridProps) {
  /* A bare "1fr" lets a wide table push its column open; minmax(0, …) does not. */
  const safe = (t: string) => t.replace(/(^|\s)(\d*\.?\d+fr)(?=\s|$)/g, "$1minmax(0, $2)");
  const style = { "--dk-cols": safe(cols), "--dk-mid": safe(mid) } as CSSProperties;
  return (
    <div className={cx("dk-grid", className)}>
      {/* `data-pair`: the middle width has two columns, so an odd last panel takes the row. */}
      <div className="dk-grid-row" style={style} data-pair={tracks(mid) === 2 ? "" : undefined}>
        {children}
      </div>
    </div>
  );
}

/* How many columns a grid template makes: "1fr minmax(0, 2fr)" is 2, "repeat(3, 1fr)" is 3. */
function tracks(template: string): number {
  let depth = 0;
  let word = "";
  let n = 0;
  const end = () => {
    const rep = /^repeat\((\d+),/.exec(word);
    if (word) n += rep ? Number(rep[1]) : 1;
    word = "";
  };
  for (const ch of template.trim()) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) end();
    else word += ch;
  }
  end();
  return n;
}

/** Panels one under another inside a Grid column, with the page's gap between them. */
export function Stack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("dk-stack", className)}>{children}</div>;
}
