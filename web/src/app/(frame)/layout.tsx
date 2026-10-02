import type { ReactNode } from "react";
import { Frame } from "@/components/shell/Frame";

/**
 * Every screen of the command center sits in the same frame: the sidebar, the
 * top bar, and the screen between them. The frame asks the desk server who is
 * looking; a screen that asks again gets the same answer without a second
 * request (lib/api.ts, `askMe`).
 */
export default function FrameLayout({ children }: { children: ReactNode }) {
  return <Frame>{children}</Frame>;
}
