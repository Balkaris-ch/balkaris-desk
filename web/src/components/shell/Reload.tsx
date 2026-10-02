"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button, type ButtonLook } from "@/components/ui/Button";

/**
 * "Try again" for a screen the server drew: asks the server for the same
 * address again without throwing away what the browser already has.
 */
export function Reload({ children = "Try again", ...look }: ButtonLook & { children?: string }) {
  const router = useRouter();
  const [busy, go] = useTransition();
  return (
    <Button icon="refresh" {...look} disabled={busy} onClick={() => go(() => router.refresh())}>
      {busy ? "Asking…" : children}
    </Button>
  );
}
