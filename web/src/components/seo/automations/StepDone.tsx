"use client";

import { useActionState } from "react";
import type { Said } from "@/components/automations/actions";
import { Button } from "@/components/ui/Button";
import { markStep } from "./actions";

/**
 * "Mark done" (or "Open again") on a step in the owner's browser. The desk
 * records the person's name with the mark; a refusal is said under the
 * button.
 */
export function StepDone({ id, title, done }: { id: string; title: string; done: boolean }) {
  const [said, action, pending] = useActionState<Said | null, FormData>(markStep, null);
  return (
    <form action={action} className="dk-seo-automations-step-form">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="done" value={done ? "0" : "1"} />
      <Button type="submit" size="xs" icon={done ? "refresh" : "check"} disabled={pending} aria-label={`${done ? "Open again" : "Mark done"}: ${title}`}>
        {pending ? "Saving…" : done ? "Open again" : "Mark done"}
      </Button>
      {said && !said.ok ? (
        <span className="dk-seo-automations-said dk-seo-automations-said--bad" role="alert">
          {said.message}
        </span>
      ) : null}
    </form>
  );
}
