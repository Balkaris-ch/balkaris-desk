import type { ReactNode } from "react";
import type { AssetFigure } from "@/contract/assets";
import type { Reading, Share } from "@/contract/common";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Info, Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { weight } from "./weight";

export interface AssetTileProps {
  label: string;
  reading: Reading<AssetFigure>;
  info?: ReactNode;
  /** A colour per part key ("absent": bad); parts not named take the series colours in order. */
  tones?: Readonly<Record<string, "good" | "warn" | "bad" | "quiet">>;
  /** Leave the source line out, when the screen prints it once for the whole row. */
  noStamp?: boolean;
}

const print = (v: number, unit: AssetFigure["unit"]): string => (unit === "bytes" ? weight(v) : num(v));

/**
 * A headline figure of the files, in the Tile's shape, with what the figure
 * is made of under it where the board draws the change against a period. The
 * files are what is on the branch now and have no period before them, so a
 * "—" there would only say that again; the parts say something.
 */
export function AssetTile({ label, reading, info, tones = {}, noStamp }: AssetTileProps) {
  return (
    <article className="dk-assets-tile">
      <h3 className="dk-assets-tile-label">
        <span className="dk-assets-tile-label-text">{label}</span>
        {info ? <Info text={info} /> : null}
      </h3>
      <Read reading={reading} form="tile">
        {(f, r) => (
          <>
            <div className="dk-assets-tile-row">
              <p className="dk-assets-tile-figure dk-num">
                <span className="dk-assets-tile-value">{print(f.value, f.unit)}</span>
                {f.of != null ? <span className="dk-assets-tile-of">/ {num(f.of)}</span> : null}
              </p>
              <Parts parts={f.parts} unit={f.partsUnit} tones={tones} />
            </div>
            {f.sub ? <p className="dk-assets-tile-sub">{f.sub}</p> : null}
            {noStamp ? null : <Stamp reading={r} />}
          </>
        )}
      </Read>
    </article>
  );
}

/** The parts of a whole as one thin bar, each part's share of its width; the numbers are in its tooltip. */
export function Parts({ parts, unit, tones = {} }: { parts: readonly Share[]; unit: AssetFigure["unit"]; tones?: Readonly<Record<string, string>> }) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((s, p) => s + p.value, 0);
  if (!total) return <span className="dk-assets-parts dk-assets-parts--empty" aria-hidden />;
  let slot = 0;
  const segs = shown.map((p) => ({ ...p, cls: tones[p.key] ? `dk-assets-seg--${tones[p.key]}` : `dk-assets-seg--s${(slot++ % 6) + 1}` }));
  const words = segs.map((p) => `${p.label}: ${print(p.value, unit)} (${Math.round((p.value / total) * 100)}%)`);
  return (
    <Tooltip
      text={
        <span className="dk-assets-parts-tip">
          {segs.map((p, i) => (
            <span key={p.key}>
              <i className={cx("dk-assets-dot", p.cls)} aria-hidden />
              {words[i]}
            </span>
          ))}
        </span>
      }
    >
      <span className="dk-assets-parts" role="img" aria-label={words.join(", ")} tabIndex={0}>
        {segs.map((p) => (
          <i key={p.key} className={cx("dk-assets-seg", p.cls)} style={{ flexGrow: p.value }} />
        ))}
      </span>
    </Tooltip>
  );
}
