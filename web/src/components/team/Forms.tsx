"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { inviteMember, saveNewcomers, withdrawInvite } from "./actions";
import { Answer } from "./parts";

/**
 * The owner's small forms on the Team pages. Each is sent to the desk
 * server, which checks again that the owner is asking; its answer is printed
 * beside the button that sent it.
 */

/** What somebody who signs in with a studio account, uninvited, starts with. */
export function NewcomersForm({ value, presets }: { value: string; presets: { key: string; label: string }[] }) {
  const [said, act, busy] = useActionState(saveNewcomers, null);
  return (
    <form action={act} className="dk-team-form">
      <Field
        label="Somebody who signs in uninvited starts with"
        hint="Anybody with a studio Google account can sign in. An invitation decides what that person gets; this decides for everybody else. People already on the desk keep what they have."
      >
        <Select
          key={value}
          name="newcomers"
          label="What a newcomer starts with"
          size="md"
          defaultValue={value}
          options={[
            { value: "full", label: "Every area, as before (Administrator)" },
            ...presets.filter((p) => p.key !== "administrator").map((p) => ({ value: p.key, label: `The ${p.label} template` })),
            { value: "nothing", label: "Nothing until I give them access" },
          ]}
        />
      </Field>
      <div className="dk-team-formfoot">
        <Answer said={said} />
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Saving" : "Save"}
        </Button>
      </div>
    </form>
  );
}

/** Give somebody access before they ever sign in: their name, their studio address, a template. */
export function InviteForm({ domain, presets, preset }: { domain: string; presets: { key: string; label: string; about: string }[]; preset?: string }) {
  const [said, act, busy] = useActionState(inviteMember, null);
  const chosen = presets.some((p) => p.key === preset) ? preset : (presets.find((p) => p.key === "content-editor") ?? presets[0])?.key;
  return (
    <form action={act} className="dk-team-form">
      <Field label="Name" hint="As the team list should show it. Their Google name replaces it when they first sign in.">
        <Input name="name" placeholder="Jane Doe" autoComplete="off" required maxLength={80} />
      </Field>
      <Field label="Email" hint={`Their @${domain} Google account: the only kind that can sign in.`}>
        <Input name="email" type="email" placeholder={`name@${domain}`} autoComplete="off" spellCheck={false} required />
      </Field>
      <Field label="Role" hint="What they may see and change from their first sign-in. You can change any of it later, area by area.">
        <Select key={chosen} name="preset" label="Role" size="md" defaultValue={chosen} options={presets.map((p) => ({ value: p.key, label: `${p.label}: ${p.about}` }))} />
      </Field>
      <div className="dk-team-formfoot">
        <Answer said={said} />
        <Button type="submit" variant="primary" size="sm" icon="plus" disabled={busy}>
          {busy ? "Adding" : "Add to the team"}
        </Button>
      </div>
    </form>
  );
}

/** Take back an invitation nobody has used yet. */
export function WithdrawButton({ id, name }: { id: number; name: string }) {
  const [said, act, busy] = useActionState(withdrawInvite, null);
  return (
    <form
      action={act}
      className="dk-team-inline"
      onSubmit={(e) => {
        if (!window.confirm(`Withdraw the invitation for ${name}? If they sign in afterwards, they arrive as a newcomer.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      {said && !said.ok ? <Answer said={said} /> : null}
      <Button type="submit" size="xs" variant="ghost" icon="x" disabled={busy}>
        {busy ? "Withdrawing" : "Withdraw"}
      </Button>
    </form>
  );
}
