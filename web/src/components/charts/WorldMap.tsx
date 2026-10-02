import type { CSSProperties } from "react";
import { cx } from "@/lib/cx";
import { figure } from "@/lib/format";
import type { Unit } from "@/lib/scale";
import { r2 } from "./series";
import { WORLD_DOTS, type WorldDots } from "./world-dots";
import "./charts.css";
import "./world-map.css";

/** One country's figure. */
export interface MapCountry {
  /**
   * ISO 3166-1 alpha-2, as GA4's `countryId` gives it: "CH", "DE". Case does
   * not matter. Null when the source could not place the visitor (GA4's
   * "(not set)"): such a row cannot be drawn and is listed under the map.
   */
  code: string | null;
  value: number;
  /** Its name, for the screen reader's summary and the list under the map. The code is used when it is left out. */
  name?: string;
}

export interface WorldMapProps {
  /** The countries to light. A country with a value of zero or less stays dark. */
  countries: readonly MapCountry[];
  /** What the map shows, for a screen reader: "Visitors by country". */
  label: string;
  /** How the values are printed in the screen reader's summary. */
  unit?: Unit;
  /** Another grid than the world's own. For the kit's specimen; a screen never passes it. */
  dots?: WorldDots;
  className?: string;
}

const n36 = (s: string) => parseInt(s, 36);

interface Parsed {
  /** Every land run as a path, and the runs of each country. */
  all: string;
  byCountry: Map<string, string>;
  centres: Map<string, [number, number]>;
}

/* A run of dots is one horizontal stroke: the stylesheet dashes it into dots.
   The hair past the last dot makes sure the last dash is inside the stroke. */
const run = (col: number, row: number, len: number) => `M${col + 0.5} ${row + 0.5}h${len - 1 + 0.01}`;

function parse(dots: WorldDots): Parsed {
  let all = "";
  const byCountry = new Map<string, string>();
  dots.land.forEach((line, row) => {
    for (let i = 0; i + 6 <= line.length; i += 6) {
      const d = run(n36(line.slice(i, i + 2)), row, n36(line.slice(i + 2, i + 4)));
      const code = line.slice(i + 4, i + 6);
      all += d;
      if (code !== "--") byCountry.set(code, (byCountry.get(code) ?? "") + d);
    }
  });
  const centres = new Map<string, [number, number]>();
  for (let i = 0; i + 6 <= dots.centres.length; i += 6) {
    centres.set(dots.centres.slice(i, i + 2), [n36(dots.centres.slice(i + 2, i + 4)), n36(dots.centres.slice(i + 4, i + 6))]);
  }
  return { all, byCountry, centres };
}

/* The world's own grid is parsed once per process, not once per render. */
let world: Parsed | null = null;

/**
 * The boards' Countries map: the world as dark dots, the countries that have
 * visitors lit in green, each with a glow that grows with its figure.
 *
 *   <WorldMap label="Visitors by country" countries={visitorsByCountry} />
 *
 * where each entry is `{ code, value, name }` from the source (GA4's
 * `countryId`, its visitors, its country name).
 *
 * The glow's size follows the square root of the value, so a country with a
 * hundred times the visitors is ten times the radius, not a blot over a
 * continent. A country too small for a dot of its own is lit at its place. A
 * code the map does not know is listed under the map instead of dropped, so
 * the figures beside the map and the map itself always add up; and if there
 * is no grid to draw on at all, every country is listed with its figure.
 */
export function WorldMap({ countries, label, unit = "count", dots, className }: WorldMapProps) {
  const grid = dots ?? WORLD_DOTS;
  const lit = countries.filter((c) => Number.isFinite(c.value) && c.value > 0).map((c) => ({ ...c, code: c.code?.toUpperCase() ?? "" }));
  const said = (list: typeof lit) => list.map((c) => `${c.name ?? (c.code || "unplaced")} ${figure(c.value, unit)}`).join(", ");

  if (grid.cols === 0 || grid.rows === 0) {
    /* No grid (world-dots.ts not generated): the figures are still true, so they are still given. */
    return (
      <div className={cx("dk-map", "dk-map--none", className)} role="img" aria-label={`${label}: no map to draw on. ${lit.length === 0 ? "No countries yet." : said(lit)}`}>
        <p className="dk-chart-note">The world map has not been generated yet, so no country is drawn on it.</p>
        {lit.length > 0 && <p className="dk-map-off">{said(lit)}</p>}
      </div>
    );
  }

  const parsed = dots ? parse(dots) : (world ??= parse(WORLD_DOTS));
  const top = Math.max(0, ...lit.map((c) => c.value));
  const known = lit.filter((c) => parsed.centres.has(c.code) || parsed.byCountry.has(c.code));
  const unknown = lit.filter((c) => !known.includes(c));

  return (
    <div className={cx("dk-map", className)}>
      <div className="dk-map-plot" style={{ aspectRatio: `${grid.cols} / ${grid.rows}` }} role="img" aria-label={`${label}: ${known.length === 0 ? "no countries yet" : said(known)}`}>
        <svg className="dk-map-svg" viewBox={`0 0 ${grid.cols} ${grid.rows}`} aria-hidden="true" focusable="false">
          <path className="dk-map-land" d={parsed.all} />
          {known.map((c) => {
            const own = parsed.byCountry.get(c.code);
            const centre = parsed.centres.get(c.code);
            const d = own ?? (centre ? run(centre[0], centre[1], 1) : "");
            return <path key={c.code} className="dk-map-lit" d={d} style={{ "--k": r2(Math.sqrt(c.value / top)) } as CSSProperties} />;
          })}
        </svg>
        {known.map((c) => {
          const centre = parsed.centres.get(c.code);
          if (!centre) return null;
          const style = { left: `${r2(((centre[0] + 0.5) / grid.cols) * 100)}%`, top: `${r2(((centre[1] + 0.5) / grid.rows) * 100)}%`, "--k": r2(Math.sqrt(c.value / top)) } as CSSProperties;
          return <i key={c.code} className="dk-map-glow" style={style} />;
        })}
      </div>
      {unknown.length > 0 && <p className="dk-map-off">Not on this map: {said(unknown)}</p>}
    </div>
  );
}
