"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/cx";
import { Icon, type IconName } from "./icons";
import "./thumb.css";

export interface ThumbProps {
  /** The picture's address, or null when the page or article has none. */
  src: string | null | undefined;
  /** What the picture shows. Empty when the row's title already says it. */
  alt?: string;
  /** sm is a table row (48×32), md a list (56×40), lg a card (88×60). */
  size?: "sm" | "md" | "lg";
  /** What the neutral fallback draws: a page, an article, a film. */
  icon?: IconName;
  className?: string;
}

/**
 * A page's or an article's picture, small. When there is no picture, or it
 * does not load, the frame stays and holds a neutral mark: the row keeps its
 * shape and nothing pretends to be a picture.
 */
export function Thumb({ src, alt = "", size = "sm", icon = "image", className }: ThumbProps) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);

  /* A picture that failed before React was listening never fires `error` again. */
  useEffect(() => {
    setFailed(false);
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, [src]);

  return (
    <span className={cx("dk-thumb", `dk-thumb--${size}`, className)}>
      {src && !failed ? (
        // The pictures are the website's own covers, already sized; next/image would add nothing here.
        <img ref={img} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <Icon name={icon} size={size === "lg" ? 20 : 14} title={alt || undefined} />
      )}
    </span>
  );
}
