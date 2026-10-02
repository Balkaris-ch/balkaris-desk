"use client";

import { useActionState, useId } from "react";
import type { SettingsPerson } from "@/contract/settings";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { linkPerson, savePerson, switchPerson, type Said } from "./actions";

/**
 * The owner's "Edit" on one person: their address and byline, whether they
 * may see enquiries, linking a Google sign-in to their Telegram account, and
 * switching them off or on. Each part is its own form, sent to the desk
 * server, which checks again that the owner is asking; its answer is printed
 * under the button that sent it.
 *
 * Only drawn for the owner. For anybody else the people table is read-only
 * and this component is not on the page at all.
 */
export function PersonEdit({ person, linkable }: { person: SettingsPerson; linkable: { id: number; name: string }[] }) {
  /* The dialog is drawn inside a right-aligned, unwrapped table cell, and would inherit both. */
  return (
    <span className="dk-settings-editcell">
      <Dialog
        title={person.name}
        description={person.owner ? "The owner. Ownership itself is not changed here." : "What the desk knows about this person, and what they may do."}
        trigger={{ label: "Edit", size: "xs", variant: "quiet" }}
      >
        <div className="dk-settings-edit">
          <Details person={person} />
          {person.telegram === null ? <Link person={person} linkable={linkable} /> : null}
          {person.owner ? null : <Switch person={person} />}
        </div>
      </Dialog>
    </span>
  );
}

function Answer({ said }: { said: Said | null }) {
  if (!said) return null;
  return (
    <p key={said.at} className={said.ok ? "dk-settings-said dk-settings-said--ok" : "dk-settings-said dk-settings-said--bad"} role={said.ok ? "status" : "alert"}>
      {said.text}
    </p>
  );
}

/**
 * The address, which is two things: what their commits carry, and (for
 * anybody who signs in with Google) how the desk finds them. So it is fixed
 * for the owner and for a switched-off person, and changing it for somebody
 * who signs in with Google takes a box that says what it does.
 */
function Address({ person }: { person: SettingsPerson }) {
  const detach = useId();
  if (person.owner || (person.revoked && person.email)) {
    return (
      <div className="dk-settings-fixed">
        <span className="dk-settings-fixed-label">Address for publishing</span>
        <span className="dk-settings-fixed-value">{person.email ?? "none yet"}</span>
        <span className="dk-settings-fixed-hint">
          {person.owner
            ? "The owner's address is DESK_OWNER in the server's configuration. Changing it here would take ownership away, so it changes there."
            : "They are switched off, and Google sign-in finds a person by this address: changing or removing it would let them back in as a new person. It stays as it is while they are switched off."}
        </span>
      </div>
    );
  }
  if (person.email && person.knownBy !== "telegram") {
    return (
      <>
        <Field
          label="Address for publishing"
          hint="Their commits carry it, so it must be the address on their Vercel account, or Vercel refuses to build what they publish. It is also the address Google sign-in finds them by."
        >
          <Input name="email" type="email" defaultValue={person.email} placeholder="name@balkaris.ch" autoComplete="off" spellCheck={false} />
        </Field>
        <div className="dk-settings-checkrow">
          <input id={detach} className="dk-settings-check" type="checkbox" name="detach" />
          <label htmlFor={detach} className="dk-settings-checktext">
            <span className="dk-settings-checklabel">Detach their Google sign-in</span>
            <span className="dk-settings-checkhint">
              Needed to change or remove the address. This row keeps its byline{person.telegram ? ", Telegram id" : ""} and rights under the new address; their next sign-in as{" "}
              {person.email} makes a new person, with the studio byline and no enquiry right.
            </span>
          </label>
        </div>
      </>
    );
  }
  return (
    <Field label="Address for publishing" hint="Their commits carry it, so it must be the address on their Vercel account, or Vercel refuses to build what they publish. Empty means they cannot publish.">
      <Input name="email" type="email" defaultValue={person.email ?? ""} placeholder="name@balkaris.ch" autoComplete="off" spellCheck={false} />
    </Field>
  );
}

function Details({ person }: { person: SettingsPerson }) {
  const [said, act, busy] = useActionState(savePerson, null);
  const check = useId();
  return (
    <form action={act} className="dk-settings-form">
      <input type="hidden" name="id" value={person.id} />
      <Address person={person} />
      <Field label="Byline" hint={'Whose name goes on an article they share: a key of the website\'s authors, such as "fini", "damir", "tihomir" or "balkaris" for the studio. An unknown key falls back to the studio.'}>
        <Input name="byline" defaultValue={person.byline} autoComplete="off" spellCheck={false} />
      </Field>
      {person.owner ? (
        <div className="dk-settings-fixed">
          <span className="dk-settings-fixed-label">May see enquiries</span>
          <span className="dk-settings-fixed-value">Always, as the owner</span>
        </div>
      ) : (
        <div className="dk-settings-checkrow">
          <input type="hidden" name="leads-shown" value="1" />
          <input id={check} className="dk-settings-check" type="checkbox" name="leads" defaultChecked={person.leadsGranted} />
          <label htmlFor={check} className="dk-settings-checktext">
            <span className="dk-settings-checklabel">May see enquiries</span>
            <span className="dk-settings-checkhint">
              Shows them the names, contact details and messages of people who wrote through the website. Without it they see counts only.
              {person.revoked ? " They are switched off, so it takes effect only once they are let in again." : ""}
            </span>
          </label>
        </div>
      )}
      <div className="dk-settings-formfoot">
        <Answer said={said} />
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? "Saving" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function Link({ person, linkable }: { person: SettingsPerson; linkable: { id: number; name: string }[] }) {
  const [said, act, busy] = useActionState(linkPerson, null);
  return (
    <form action={act} className="dk-settings-form dk-settings-form--part">
      <input type="hidden" name="id" value={person.id} />
      <p className="dk-settings-parthead">Link to their Telegram account</p>
      <p className="dk-settings-parttext">
        They signed in with Google and the bot knows them separately. Linking makes them one person: the Telegram id is kept, and the address, byline and rights come across from
        here.
      </p>
      {linkable.length ? (
        <div className="dk-settings-formfoot">
          <Answer said={said} />
          <span className="dk-settings-linkpick">
            <Select name="telegram" label="Telegram account" size="sm" options={linkable.map((p) => ({ value: String(p.id), label: `${p.name} (${p.id})` }))} />
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Linking" : "Link"}
            </Button>
          </span>
        </div>
      ) : (
        <p className="dk-settings-parttext dk-settings-quiet">
          Nobody has written to the bot without an address yet, so there is no Telegram account to link. Once they write to the bot, their account appears here.
        </p>
      )}
    </form>
  );
}

function Switch({ person }: { person: SettingsPerson }) {
  const [said, act, busy] = useActionState(switchPerson, null);
  return (
    <form action={act} className="dk-settings-form dk-settings-form--part">
      <input type="hidden" name="id" value={person.id} />
      <input type="hidden" name="on" value={person.revoked ? "1" : "0"} />
      <p className="dk-settings-parthead">{person.revoked ? "Switched off" : "Access"}</p>
      <p className="dk-settings-parttext">
        {person.revoked
          ? "They can sign in, and every page and the API refuse them. Letting them in again gives back what they had."
          : "Switching them off refuses them on every page and in the API at once, whatever their session. Nothing they did is undone, and it can be reversed here."}
        {!person.revoked && !person.email
          ? " They carry no address, and Google sign-in finds people by address: if they sign in with Google, they arrive as a new person, to be switched off there."
          : ""}
      </p>
      <div className="dk-settings-formfoot">
        <Answer said={said} />
        <Button type="submit" size="sm" variant={person.revoked ? "good" : "danger"} disabled={busy}>
          {person.revoked ? "Let them in again" : `Switch ${person.name.split(/\s+/)[0]} off`}
        </Button>
      </div>
    </form>
  );
}
