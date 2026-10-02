import type { AssetKind } from "@/contract/assets";
import { num } from "@/lib/format";

/**
 * A file's weight in kB and MB of 1000, as the desk server writes its limits
 * ("over 400 kB is heavy for a picture"), so a figure and the limit it is
 * compared with are printed the same way.
 */
export function weight(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${n < 10_000 ? (n / 1000).toFixed(1) : Math.round(n / 1000)} kB`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  return `${(n / 1_000_000_000).toFixed(2)} GB`;
}

export const KIND_LABEL: Record<AssetKind, string> = {
  image: "Image",
  video: "Video",
  font: "Font",
  scene: "3D scene",
  audio: "Audio",
  document: "Document",
  other: "Other",
};

/** "3 files", "1 file". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;

/** "1200 × 630", or null when the file has no measured size. */
export const pixels = (w: number | null, h: number | null): string | null => (w && h ? `${w} × ${h}` : null);
