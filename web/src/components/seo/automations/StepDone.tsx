"use client";

import { useActionState } from "react";
import type { Said } from "@/components/automations/actions";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { markStep, noteStep } from "./actions";

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

/**
 * A step's note: what was done and when, in the lead's words ("submitted the
 * first ten addresses"), kept with the step and shown beside it. Saving an
 * empty note clears it; the done mark is left as it is.
 */
export function StepNote({ id, title, note }: { id: string; title: string; note: string | null }) {
  const [said, action, pending] = useActionState<Said | null, FormData>(noteStep, null);
  return (
    <form action={action} className="dk-seo-automations-step-note">
      <input type="hidden" name="id" value={id} />
      <Field label="Note" hint={said ? said.message : "What was done, so the next person knows. Saved with your name in the log."} error={!!said && !said.ok}>
        <Input name="note" defaultValue={note ?? ""} maxLength={500} placeholder="Submitted the first ten addresses" aria-label={`Note on: ${title}`} />
      </Field>
      <Button type="submit" size="xs" variant="ghost" disabled={pending}>
        {pending ? "Saving…" : "Save note"}
      </Button>
    </form>
  );
}
