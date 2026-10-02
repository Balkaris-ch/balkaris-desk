import type { CSSProperties } from "react";
import { cx } from "@/lib/cx";
import "./skeleton.css";

export interface SkeletonProps {
  /** A CSS length. Default: the width of what holds it. */
  width?: number | string;
  /** A CSS length. Default: one line of body text. */
  height?: number | string;
  /** Round ends: a chip, an avatar. */
  round?: boolean;
  className?: string;
}

const px = (v: number | string | undefined) => (typeof v === "number" ? `${v}px` : v);

/**
 * A grey block where something is about to be: for loading.tsx. It shows a
 * shape, never a figure, so nothing on it can be mistaken for data.
 */
export function Skeleton({ width, height, round, className }: SkeletonProps) {
  const style: CSSProperties = { width: px(width), height: px(height) };
  return <span className={cx("dk-skel", round && "dk-skel--round", className)} style={style} aria-hidden />;
}

/** A tile's outline while its figure loads: label, figure, change. */
export function SkeletonTile() {
  return (
    <div className="dk-skel-tile" aria-hidden>
      <Skeleton width={72} height={11} />
      <Skeleton width={104} height={26} />
      <Skeleton width={56} height={12} />
    </div>
  );
}

/** A panel's outline while it loads: a title and `lines` rows. */
export function SkeletonCard({ lines = 4, height }: { lines?: number; height?: number | string }) {
  return (
    <div className="dk-skel-card" style={{ minHeight: px(height) }} aria-hidden>
      <Skeleton width={148} height={14} />
      <div className="dk-skel-lines">
        {Array.from({ length: lines }, (_, i) => (
          /* Rows of uneven length read as text; equal ones read as a table that failed. */
          <Skeleton key={i} width={`${[92, 78, 86, 64, 81, 70][i % 6]}%`} height={11} />
        ))}
      </div>
    </div>
  );
}
