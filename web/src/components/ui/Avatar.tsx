import { cx } from "@/lib/cx";
import { initials } from "@/lib/format";
import "./avatar.css";

export interface AvatarProps {
  /** The person's name. Its initials are what is drawn. */
  name: string;
  /** sm sits in a table row (22px), md in the top bar (30px), lg in a profile (40px). */
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * A person as their initials in a circle. The desk holds no photographs of
 * people, so there is no picture to load and none is pretended.
 */
export function Avatar({ name, size = "md", className }: AvatarProps) {
  return (
    <span className={cx("dk-avatar", `dk-avatar--${size}`, className)} role="img" aria-label={name}>
      <span aria-hidden>{initials(name)}</span>
    </span>
  );
}
