"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DialogActions, DialogClose } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Icon } from "@/components/ui/icons";
import { removeComparison, saveComparison, type Said } from "./actions";

/**
 * The parts of the Experiments screen the pointer drives: the comparison's
 * "change or date" pair, and the two forms that write (save, remove), whose
 * refusals come back as their own state.
 */

/**
 * The comparison's change, as a commit OR a typed date, never both: picking
 * a commit clears the date, typing a date sets the list back to "pick". The
 * desk server would let a date win over a commit, so a form that sent both
 * would compare around something the person had just replaced.
 */
export function ChangeOrDate({ choices, empty, change, date }: { choices: { sha: string; label: string }[]; empty: string; change: string; date: string }) {
  const [sha, setSha] = useState(change);
  const [day, setDay] = useState(date);
  return (
    <>
      <Field label="Change" className="dk-experiments-field-change">
        <span className="dk-experiments-select">
          <select
            name="change"
            aria-label="Change"
            value={sha}
            onChange={(e) => {
              setSha(e.target.value);
              if (e.target.value) setDay("");
            }}
          >
            <option value="">{empty}</option>
            {choices.map((x) => (
              <option key={x.sha} value={x.sha}>
                {x.label}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={14} />
        </span>
      </Field>
      <Field label="Or a date" className="dk-experiments-field-date">
        <Input
          type="date"
          name="date"
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            if (e.target.value) setSha("");
          }}
        />
      </Field>
    </>
  );
}

function Refusal({ said }: { said: Said | null }) {
  if (!said) return null;
  return (
    <p key={said.at} className="dk-experiments-refused" role="alert">
      <Icon name="alert" size={14} />
      <span>The desk refused that: {said.text}</span>
    </p>
  );
}

/** "Save this comparison": a name and a note, and what is asked, carried in hidden fields. */
export function SaveForm({ suggested, carry }: { suggested: string; carry: Record<string, string> }) {
  const [said, act, busy] = useActionState(saveComparison, null);
  return (
    <form action={act} className="dk-experiments-save">
      <Field label="Name" hint="What the change was meant to do, in a few words.">
        <Input name="name" required maxLength={80} defaultValue={suggested} />
      </Field>
      <Field label="Note" hint="Optional. What to look for when it is opened again.">
        <Textarea name="note" maxLength={500} rows={3} />
      </Field>
      {Object.entries(carry).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Refusal said={said} />
      <DialogActions>
        <DialogClose />
        <Button type="submit" variant="primary" icon="bookmark" disabled={busy}>
          Save
        </Button>
      </DialogActions>
    </form>
  );
}

/** "Remove": the confirmation's form. */
export function RemoveForm({ id, back }: { id: number; back: string }) {
  const [said, act, busy] = useActionState(removeComparison, null);
  return (
    <form action={act}>
      <input type="hidden" name="id" value={String(id)} />
      <input type="hidden" name="back" value={back} />
      <Refusal said={said} />
      <DialogActions>
        <DialogClose />
        <Button type="submit" variant="danger" icon="trash" disabled={busy}>
          Remove
        </Button>
      </DialogActions>
    </form>
  );
}
