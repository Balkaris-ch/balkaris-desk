"use client";

import { Trouble } from "@/components/shell/Trouble";

/**
 * A screen that failed, inside the frame: the sidebar and the top bar stay,
 * so the person can go somewhere else, and the screen's place says what went
 * wrong and offers to ask again.
 */
export default function FrameError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <Trouble error={error} retry={retry} form="panel" />;
}
