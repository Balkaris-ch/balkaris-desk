"use client";

import { Trouble } from "@/components/shell/Trouble";

/**
 * Something failed above the screens: the frame itself, or a page outside it
 * such as /kit. There is no sidebar to keep, so the gate fills the window.
 */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <Trouble error={error} retry={retry} form="page" />;
}
