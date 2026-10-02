import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import "./icons.css";

/**
 * The desk's icons: drawn by hand on a 20 grid, one 1.6 stroke, round ends,
 * the colour of the text around them. No icon package.
 *
 *   <Icon name="arrow-up" />            18px, the size beside body text
 *   <Icon name="alert" size={20} />     a panel's title
 *   <Icon name="external" size={14} />  inside a chip or a small button
 *
 * An icon beside a label is decoration and hidden from screen readers. An
 * icon that stands alone gets `title`, which names it.
 */

const p = (d: string) => <path d={d} />;
const c = (cx: number, cy: number, r: number) => <circle cx={cx} cy={cy} r={r} />;
/* A dot is the one filled shape: a 1.6 stroke cannot draw a point that reads. */
const dot = (cx: number, cy: number, r = 1) => <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;
const r = (x: number, y: number, w: number, h: number, rx = 1.5) => <rect x={x} y={y} width={w} height={h} rx={rx} />;

const ICONS = {
  /* ---- the fourteen sections ---- */
  home: p("M3.5 9.2 10 3.5l6.5 5.7V16a1 1 0 0 1-1 1H12v-4.5H8V17H4.5a1 1 0 0 1-1-1z"),
  article: (
    <>
      {r(4, 3, 12, 14)}
      {p("M7 7h6M7 10h6M7 13h3.5")}
    </>
  ),
  pulse: p("M2.5 10.5h3l2-5.5 3.6 10 2.4-7 1.2 2.5h2.8"),
  search: (
    <>
      {c(9, 9, 5.5)}
      {p("M13.2 13.2 17 17")}
    </>
  ),
  pages: (
    <>
      {p("M7.5 3h7A1.5 1.5 0 0 1 16 4.5v9")}
      {r(4, 6, 9, 11)}
    </>
  ),
  edit: (
    <>
      {p("M9.5 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-4")}
      {p("M14.6 3.4a1.4 1.4 0 0 1 2 2l-6.1 6.1L8 12l.5-2.5z")}
    </>
  ),
  funnel: p("M3.5 4h13l-5 6.2V15l-3 1.5v-6.3z"),
  inbox: (
    <>
      {p("M3 11.5 5.2 5a1.5 1.5 0 0 1 1.4-1h6.8a1.5 1.5 0 0 1 1.4 1L17 11.5V15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15z")}
      {p("M3 11.5h3.8l.9 2h4.6l.9-2H17")}
    </>
  ),
  flask: (
    <>
      {p("M8 3h4M8.5 3v5l-3.9 6.6A1.6 1.6 0 0 0 6 17h8a1.6 1.6 0 0 0 1.4-2.4L11.5 8V3")}
      {p("M6.4 12h7.2")}
    </>
  ),
  "shield-check": (
    <>
      {p("M10 2.8 15.5 5v4.6c0 3.4-2.3 6.3-5.5 7.6-3.2-1.3-5.5-4.2-5.5-7.6V5z")}
      {p("M7.6 9.9l1.7 1.7 3.2-3.4")}
    </>
  ),
  bolt: p("M11 2.5 4.5 11.5H10l-1 6 6.5-9H10z"),
  image: (
    <>
      {r(3, 4, 14, 12)}
      {p("M3.3 13.6 7 10l3.2 3 2.3-2.1 4.2 3.7")}
      {c(12.8, 7.6, 1.2)}
    </>
  ),
  sparkles: (
    <>
      {p("M8.5 3.5 9.8 7.2l3.7 1.3-3.7 1.3-1.3 3.7-1.3-3.7-3.7-1.3 3.7-1.3z")}
      {p("M14.8 12.2l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6z")}
    </>
  ),
  settings: (
    <>
      {p("M10 2.8l1.2 1.9 2.2-.5.6 2.2 2 1-1 2.6 1 2.6-2 1-.6 2.2-2.2-.5-1.2 1.9-1.2-1.9-2.2.5-.6-2.2-2-1 1-2.6-1-2.6 2-1 .6-2.2 2.2.5z")}
      {c(10, 10, 2.4)}
    </>
  ),

  /* ---- arrows and chevrons ---- */
  "arrow-up": p("M10 16V4M5 9l5-5 5 5"),
  "arrow-down": p("M10 4v12M5 11l5 5 5-5"),
  "arrow-right": p("M4 10h12M11 5l5 5-5 5"),
  "arrow-left": p("M16 10H4M9 5l-5 5 5 5"),
  "arrow-up-right": p("M6 14l8-8M7.5 6H14v6.5"),
  "trending-up": p("M3 14l4.5-4.5 3 3L17 6M12.5 6H17v4.5"),
  "trending-down": p("M3 6l4.5 4.5 3-3L17 14M12.5 14H17V9.5"),
  external: (
    <>
      {p("M11.5 4H16v4.5M16 4l-6.5 6.5")}
      {p("M13.5 11.5v3A1.5 1.5 0 0 1 12 16H5.5A1.5 1.5 0 0 1 4 14.5V8a1.5 1.5 0 0 1 1.5-1.5h3")}
    </>
  ),
  redirect: p("M4 5v4a3 3 0 0 0 3 3h9M12.5 8.5 16 12l-3.5 3.5"),
  "chevron-down": p("M5.5 8l4.5 4.5L14.5 8"),
  "chevron-up": p("M5.5 12.5 10 8l4.5 4.5"),
  "chevron-right": p("M8 5.5l4.5 4.5L8 14.5"),
  "chevron-left": p("M12 5.5 7.5 10l4.5 4.5"),
  sort: p("M7 4v12M4 13l3 3 3-3M13 16V4M10 7l3-3 3 3"),

  /* ---- states ---- */
  info: (
    <>
      {c(10, 10, 7)}
      {p("M10 9.2v4.3")}
      {dot(10, 6.6, 0.9)}
    </>
  ),
  help: (
    <>
      {c(10, 10, 7)}
      {p("M7.9 8a2.2 2.2 0 1 1 3.3 1.9c-.8.5-1.2 1-1.2 1.8")}
      {dot(10, 14, 0.9)}
    </>
  ),
  alert: (
    <>
      {p("M10 3.2 17.4 16H2.6z")}
      {p("M10 8v3.6")}
      {dot(10, 13.7, 0.9)}
    </>
  ),
  "check-circle": (
    <>
      {c(10, 10, 7)}
      {p("M6.8 10.2 9 12.4l4.2-4.6")}
    </>
  ),
  "x-circle": (
    <>
      {c(10, 10, 7)}
      {p("M7.5 7.5l5 5M12.5 7.5l-5 5")}
    </>
  ),
  check: p("M4.5 10.5 8 14l7.5-8"),
  x: p("M5 5l10 10M15 5 5 15"),
  plus: p("M10 4v12M4 10h12"),
  minus: p("M4 10h12"),
  circle: c(10, 10, 6.5),
  dot: dot(10, 10, 3.5),
  clock: (
    <>
      {c(10, 10, 7)}
      {p("M10 6v4.2l2.8 1.6")}
    </>
  ),
  hourglass: (
    <>
      {p("M5.5 3h9M5.5 17h9")}
      {p("M6.5 3v2.6c0 1.2.5 2.2 1.5 2.9L10 10l2-1.5c1-.7 1.5-1.7 1.5-2.9V3")}
      {p("M6.5 17v-2.6c0-1.2.5-2.2 1.5-2.9L10 10l2 1.5c1 .7 1.5 1.7 1.5 2.9V17")}
    </>
  ),
  calendar: (
    <>
      {r(3, 5, 14, 12)}
      {p("M3 8.5h14M7 3v3.5M13 3v3.5")}
    </>
  ),

  /* ---- the top bar and controls ---- */
  bell: (
    <>
      {p("M5.5 13.5V9a4.5 4.5 0 0 1 9 0v4.5L16 15H4z")}
      {p("M8.5 17a1.6 1.6 0 0 0 3 0")}
    </>
  ),
  menu: p("M3.5 5.5h13M3.5 10h13M3.5 14.5h13"),
  filter: p("M3.5 5.5h13M6 10h8M8.5 14.5h3"),
  sliders: (
    <>
      {p("M3.5 6h5M13 6h3.5M3.5 14h3M11 14h5.5")}
      {c(10.6, 6, 2)}
      {c(8.6, 14, 2)}
    </>
  ),
  more: (
    <>
      {dot(4.5, 10, 1.3)}
      {dot(10, 10, 1.3)}
      {dot(15.5, 10, 1.3)}
    </>
  ),
  "more-vertical": (
    <>
      {dot(10, 4.5, 1.3)}
      {dot(10, 10, 1.3)}
      {dot(10, 15.5, 1.3)}
    </>
  ),
  grid: (
    <>
      {r(3.5, 3.5, 5.5, 5.5, 1.2)}
      {r(11, 3.5, 5.5, 5.5, 1.2)}
      {r(3.5, 11, 5.5, 5.5, 1.2)}
      {r(11, 11, 5.5, 5.5, 1.2)}
    </>
  ),
  list: (
    <>
      {p("M7.5 5.5h9M7.5 10h9M7.5 14.5h9")}
      {dot(4, 5.5, 0.9)}
      {dot(4, 10, 0.9)}
      {dot(4, 14.5, 0.9)}
    </>
  ),
  layout: (
    <>
      {r(3, 4, 14, 12)}
      {p("M3 8h14M8 8v8")}
    </>
  ),
  logout: (
    <>
      {p("M8 17H5.5A1.5 1.5 0 0 1 4 15.5v-11A1.5 1.5 0 0 1 5.5 3H8")}
      {p("M13 6.5l3.5 3.5-3.5 3.5M16.5 10H8")}
    </>
  ),
  terminal: (
    <>
      {r(3, 4, 14, 12)}
      {p("M6 8l2.5 2L6 12M10.5 12.5H14")}
    </>
  ),

  /* ---- things ---- */
  link: (
    <>
      {p("M8.6 11.4a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1")}
      {p("M11.4 8.6a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1")}
    </>
  ),
  shield: p("M10 2.8 15.5 5v4.6c0 3.4-2.3 6.3-5.5 7.6-3.2-1.3-5.5-4.2-5.5-7.6V5z"),
  "heart-pulse": (
    <>
      {p("M10 16.5S3.5 12.6 3.5 8.2A3.4 3.4 0 0 1 10 6.6a3.4 3.4 0 0 1 6.5 1.6c0 4.4-6.5 8.3-6.5 8.3z")}
      {p("M6 10.2h2.2l1.1-1.9 1.6 3.2 1-1.3H14")}
    </>
  ),
  globe: (
    <>
      {c(10, 10, 7)}
      {p("M3 10h14")}
      {p("M10 3c2.2 2 3.2 4.4 3.2 7s-1 5-3.2 7c-2.2-2-3.2-4.4-3.2-7s1-5 3.2-7z")}
    </>
  ),
  "map-pin": (
    <>
      {p("M10 17.5s5.5-4.9 5.5-9.3a5.5 5.5 0 0 0-11 0c0 4.4 5.5 9.3 5.5 9.3z")}
      {c(10, 8.2, 2)}
    </>
  ),
  file: (
    <>
      {p("M6 3h5.5l4 4v8.5A1.5 1.5 0 0 1 14 17H6a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 6 3z")}
      {p("M11.5 3v4h4")}
    </>
  ),
  "file-text": (
    <>
      {p("M6 3h5.5l4 4v8.5A1.5 1.5 0 0 1 14 17H6a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 6 3z")}
      {p("M11.5 3v4h4M7.5 10.5h5M7.5 13.5h5")}
    </>
  ),
  video: (
    <>
      {r(3, 5.5, 10, 9)}
      {p("M13 8.8l4-2.3v7l-4-2.3")}
    </>
  ),
  tag: (
    <>
      {p("M3.5 4.5a1 1 0 0 1 1-1h5.2l6.8 6.8a1.2 1.2 0 0 1 0 1.7L12 16.5a1.2 1.2 0 0 1-1.7 0L3.5 9.7z")}
      {c(7, 7, 1.1)}
    </>
  ),
  wrench: p("M12.8 3.3a4 4 0 0 0-4.9 5.2l-4.3 4.3a1.9 1.9 0 0 0 2.7 2.7l4.3-4.3a4 4 0 0 0 5.2-4.9l-2.6 2.6-2.2-.6-.6-2.2z"),
  play: p("M6.5 4.2v11.6L16 10z"),
  stop: r(5.5, 5.5, 9, 9),
  pause: p("M7 4.5v11M13 4.5v11"),
  refresh: (
    <>
      {p("M16 10a6 6 0 1 1-2-4.5")}
      {p("M14.4 2.6v3.2h-3.2")}
    </>
  ),
  download: p("M10 3.5v9M6 9l4 4 4-4M4 16.5h12"),
  upload: p("M10 13V4M6 7.5l4-4 4 4M4 16.5h12"),
  users: (
    <>
      {c(7.5, 7, 2.6)}
      {p("M2.8 16c.3-2.6 2.2-4.2 4.7-4.2s4.4 1.6 4.7 4.2")}
      {p("M13 4.6a2.6 2.6 0 0 1 0 4.8M14.6 12.1c1.5.6 2.4 2 2.6 3.9")}
    </>
  ),
  user: (
    <>
      {c(10, 7, 3)}
      {p("M4 16.5c.5-3 2.9-4.8 6-4.8s5.5 1.8 6 4.8")}
    </>
  ),
  target: (
    <>
      {c(10, 10, 7)}
      {c(10, 10, 3.6)}
      {dot(10, 10, 0.9)}
    </>
  ),
  "bar-chart": p("M4 16.5V11M8 16.5V7M12 16.5V9.5M16 16.5V4"),
  "line-chart": p("M3 3.5v13h14M6 12.5 9 9l2.5 2L16 6"),
  pie: (
    <>
      {p("M9 4.1A7 7 0 1 0 15.9 11H9z")}
      {p("M12 3a6 6 0 0 1 5 5h-5z")}
    </>
  ),
  gauge: (
    <>
      {p("M4.2 14.5a7 7 0 1 1 11.6 0")}
      {p("M10 11.5l3-4")}
      {dot(10, 11.5, 1)}
    </>
  ),
  sitemap: (
    <>
      {r(8, 3, 4, 3.5, 0.8)}
      {r(3, 13.5, 4, 3.5, 0.8)}
      {r(13, 13.5, 4, 3.5, 0.8)}
      {p("M10 6.5V10M5 13.5V10h10v3.5")}
    </>
  ),
  robot: (
    <>
      {r(4, 7, 12, 9, 2)}
      {p("M10 7V4.5M7.6 11v1M12.4 11v1M2.5 10.5v3M17.5 10.5v3")}
      {dot(10, 3.5, 1)}
    </>
  ),
  code: p("M7 6l-4 4 4 4M13 6l4 4-4 4M11.2 4.5 8.8 15.5"),
  database: (
    <>
      <ellipse cx={10} cy={5} rx={6} ry={2.3} />
      {p("M4 5v10c0 1.3 2.7 2.3 6 2.3s6-1 6-2.3V5")}
      {p("M4 10c0 1.3 2.7 2.3 6 2.3s6-1 6-2.3")}
    </>
  ),
  server: (
    <>
      {r(3.5, 3.5, 13, 5.5)}
      {r(3.5, 11, 13, 5.5)}
      {dot(6.5, 6.25, 0.9)}
      {dot(6.5, 13.75, 0.9)}
    </>
  ),
  cloud: p("M6 15.5a3.5 3.5 0 0 1-.5-7 4.8 4.8 0 0 1 9.2 1.1 3 3 0 0 1-.2 5.9z"),
  cpu: (
    <>
      {r(5.5, 5.5, 9, 9)}
      {r(8.2, 8.2, 3.6, 3.6, 0.5)}
      {p("M8 3v2.5M12 3v2.5M8 14.5V17M12 14.5V17M3 8h2.5M3 12h2.5M14.5 8H17M14.5 12H17")}
    </>
  ),
  package: (
    <>
      {p("M10 2.8l6.5 3.6v7.2L10 17.2l-6.5-3.6V6.4z")}
      {p("M3.7 6.5 10 10l6.3-3.5M10 10v7")}
    </>
  ),
  branch: (
    <>
      {c(6, 5, 1.8)}
      {c(6, 15, 1.8)}
      {c(14, 7, 1.8)}
      {p("M6 6.8v6.4M14 8.8c0 2.6-2 3.4-4.5 3.6-1.6.1-2.6.5-3.2 1.2")}
    </>
  ),
  layers: (
    <>
      {p("M10 3l7 3.8-7 3.8-7-3.8z")}
      {p("M3.4 10.4 10 14l6.6-3.6M3.4 13.6 10 17.2l6.6-3.6")}
    </>
  ),
  key: (
    <>
      {c(7, 13, 3)}
      {p("M9.2 10.8 16 4M13.2 6.8l2 2M11 9l1.6 1.6")}
    </>
  ),
  lock: (
    <>
      {r(4.5, 9, 11, 8)}
      {p("M7 9V6.5a3 3 0 0 1 6 0V9")}
    </>
  ),
  eye: (
    <>
      {p("M2.5 10S5.2 4.8 10 4.8 17.5 10 17.5 10s-2.7 5.2-7.5 5.2S2.5 10 2.5 10z")}
      {c(10, 10, 2.3)}
    </>
  ),
  pencil: (
    <>
      {p("M13.6 3.6a1.7 1.7 0 0 1 2.4 2.4L7 15l-3.4.9.9-3.4z")}
      {p("M12 5.2l2.6 2.6")}
    </>
  ),
  bookmark: p("M6 3.5h8a1 1 0 0 1 1 1V17l-5-3.2L5 17V4.5a1 1 0 0 1 1-1z"),
  send: p("M17 3 8.8 11.2M17 3l-5.2 14-3-5.8L3 8.2z"),
  mail: (
    <>
      {r(3, 4.5, 14, 11)}
      {p("M3.5 6.2 10 11l6.5-4.8")}
    </>
  ),
  message: p("M4.5 4h11A1.5 1.5 0 0 1 17 5.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3h-.5A1.5 1.5 0 0 1 3 12.5v-7A1.5 1.5 0 0 1 4.5 4z"),
  paperclip: p("M15.5 9.5 10 15a3.5 3.5 0 0 1-5-5l6-6a2.4 2.4 0 0 1 3.4 3.4l-5.9 5.9a1.2 1.2 0 0 1-1.7-1.7l5.2-5.2"),
  trash: (
    <>
      {p("M4 5.5h12M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5")}
      {p("M5.5 5.5l.7 10a1.5 1.5 0 0 0 1.5 1.4h4.6a1.5 1.5 0 0 0 1.5-1.4l.7-10M8.4 8.5V14M11.6 8.5V14")}
    </>
  ),
  copy: (
    <>
      {r(7, 7, 9.5, 9.5)}
      {p("M4.5 13h-.2A1.3 1.3 0 0 1 3 11.7V4.3A1.3 1.3 0 0 1 4.3 3h7.4A1.3 1.3 0 0 1 13 4.3v.2")}
    </>
  ),
  star: p("M10 3l2.1 4.4 4.8.6-3.5 3.3.9 4.7L10 13.7 5.7 16l.9-4.7L3.1 8l4.8-.6z"),
  flag: p("M5 17V3.5M5 4h9.5l-2 3.2 2 3.3H5"),
  lightbulb: (
    <>
      {p("M10 3a4.8 4.8 0 0 0-2.9 8.6c.5.4.8 1 .8 1.6v1.3h4.2v-1.3c0-.6.3-1.2.8-1.6A4.8 4.8 0 0 0 10 3z")}
      {p("M8.2 17h3.6")}
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

/** Every icon's name, for the specimen page and for a prop that must be one. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps {
  name: IconName;
  /** Pixels. 18 beside body text, 20 in a panel's title, 14 in a chip. */
  size?: number;
  /** Names the icon for a screen reader. Leave out when a label sits beside it. */
  title?: string;
  className?: string;
}

/** One line icon from the desk's own set, in the colour of the text around it. */
export function Icon({ name, size = 18, title, className }: IconProps) {
  return (
    <svg
      className={cx("dk-icon", className)}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {ICONS[name]}
    </svg>
  );
}
