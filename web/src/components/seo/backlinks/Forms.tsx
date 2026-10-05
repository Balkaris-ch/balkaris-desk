"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import type { BacklinksAnswer, LinksImportAnswer, NapTruth, ProfileLine, ProfileRow } from "@/contract/seo/backlinks";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogActions, DialogClose } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Icon } from "@/components/ui/icons";
import { useSend } from "@/components/operator/send";
import { Said } from "./Act";
import "@/components/ui/select.css";

/**
 * The page's forms, each in a dialog, each posting to the desk server, which
 * checks every field again and answers with a sentence:
 *
 *   Add a profile        POST /api/v1/seo/backlinks/profiles          { name, kind, url? }
 *   Change (a profile)   POST /api/v1/seo/backlinks/profiles/:key     { name, kind, url, stated } or { remove }
 *   The one true …       POST /api/v1/seo/backlinks/nap        OWNER  { name, address, phone }
 *   Import from Search Console  POST /api/v1/seo/backlinks/import OWNER { csv }
 *   Follow a link        POST /api/v1/seo/backlinks/links             { url, note? }
 *
 * What a person enters about a profile is kept as theirs, with their name and
 * the day: it is never shown as something the desk read.
 */

const KIND_CHOICES: { value: ProfileRow["kind"]; label: string }[] = [
  { value: "listing", label: "Map listing (Google, Bing, Apple)" },
  { value: "directory", label: "Directory (Clutch, local.ch …)" },
  { value: "social", label: "Social profile" },
  { value: "register", label: "Register (Zefix, Wikidata …)" },
];

const text = (f: FormData, k: string): string => String(f.get(k) ?? "").trim();

function KindSelect({ value }: { value: ProfileRow["kind"] | "" }) {
  return (
    <span className="dk-select dk-seo-bl-formselect">
      <select name="kind" defaultValue={value} required aria-label="What it is">
        <option value="" disabled>
          Choose…
        </option>
        {KIND_CHOICES.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={14} />
    </span>
  );
}

/* ---------- profiles -------------------------------------------------------------------------- */

/** Add a profile or listing the audit did not know of. */
export function AddProfile() {
  return (
    <Dialog
      title="Add a profile or listing"
      description="A place the studio has (or should have) a profile: a directory, a map listing, a register. The weekly check asks its address once it has one."
      trigger={{ label: "Add a profile", size: "sm", variant: "quiet", icon: "plus" }}
    >
      <AddForm />
    </Dialog>
  );
}

function AddForm() {
  const send = useSend();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await send.go<BacklinksAnswer>("/api/v1/seo/backlinks/profiles", { name: text(f, "name"), kind: text(f, "kind"), url: text(f, "url") || null }, (v) => v.line);
  };
  return (
    <form className="dk-seo-bl-form" onSubmit={(e) => void submit(e)}>
      <Field label="Name" hint="As the place calls itself: “Clutch”, “Bing Places”.">
        <Input name="name" required minLength={2} maxLength={80} />
      </Field>
      <Field label="What it is">
        <KindSelect value="" />
      </Field>
      <Field label="Address of the profile" hint="Leave it empty while the profile does not exist yet.">
        <Input name="url" type="text" inputMode="url" placeholder="https://…" maxLength={500} />
      </Field>
      <Said message={send.message} />
      <DialogActions>
        <DialogClose variant="ghost">Close</DialogClose>
        <Button type="submit" variant="primary" disabled={send.busy} aria-busy={send.busy || undefined}>
          {send.busy ? "Adding…" : "Add"}
        </Button>
      </DialogActions>
    </form>
  );
}

/** Change one row: its name, what it is, its address, and what it states as a person sees it there. */
export function EditProfile({ row }: { row: ProfileLine }) {
  return (
    <Dialog
      title={`Change ${row.name}`}
      description="A new address is asked on the next check (or now, with Check). What you enter it states is kept as yours, with your name and today's date, never as a reading."
      trigger={{ label: "Change", size: "xs", variant: "ghost", icon: "pencil" }}
    >
      <EditForm row={row} />
    </Dialog>
  );
}

function EditForm({ row }: { row: ProfileLine }) {
  const send = useSend();
  const remove = useSend();
  const website = row.kind === "website";
  const seen = row.napSeen;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const stated = { name: text(f, "sname") || null, address: text(f, "saddress") || null, phone: text(f, "sphone") || null };
    await send.go<BacklinksAnswer>(
      `/api/v1/seo/backlinks/profiles/${encodeURIComponent(row.key)}`,
      website ? { name: text(f, "name"), stated } : { name: text(f, "name"), kind: text(f, "kind"), url: text(f, "url") || null, stated },
      (v) => v.line,
    );
  };
  return (
    <form className="dk-seo-bl-form" onSubmit={(e) => void submit(e)}>
      <Field label="Name">
        <Input name="name" defaultValue={row.name} required minLength={2} maxLength={80} />
      </Field>
      {website ? (
        <p className="dk-seo-bl-quiet">The website's address is the desk's own setting; what it states is read from its pages every week.</p>
      ) : (
        <>
          <Field label="What it is">
            <KindSelect value={row.kind} />
          </Field>
          <Field label="Address of the profile" hint={row.url ? "Empty it to say the profile has no address (it was deleted)." : "Give it once the profile exists."}>
            <Input name="url" type="text" inputMode="url" defaultValue={row.url ?? ""} placeholder="https://…" maxLength={500} />
          </Field>
        </>
      )}
      <fieldset className="dk-seo-bl-fieldset">
        <legend>What it states, as you see it there{seen ? ` (last entered ${seen.by && seen.by !== "audit" ? `by ${seen.by}` : "by the audit"}, ${seen.day})` : ""}</legend>
        <Field label="Name it states">
          <Input name="sname" defaultValue={seen?.name ?? ""} maxLength={120} />
        </Field>
        <Field label="Address it states">
          <Input name="saddress" defaultValue={seen?.address ?? ""} maxLength={200} />
        </Field>
        <Field label="Phone it states">
          <Input name="sphone" defaultValue={seen?.phone ?? ""} maxLength={40} />
        </Field>
      </fieldset>
      <Said message={remove.message ?? send.message} />
      <DialogActions>
        {row.source === "person" ? (
          <Button
            variant="danger"
            icon="trash"
            disabled={remove.busy}
            onClick={() => void remove.go<BacklinksAnswer>(`/api/v1/seo/backlinks/profiles/${encodeURIComponent(row.key)}`, { remove: true }, (v) => v.line)}
            title="Take this row off the list: only a row somebody added on the desk can go"
          >
            {remove.busy ? "Removing…" : "Remove"}
          </Button>
        ) : null}
        <DialogClose variant="ghost">Close</DialogClose>
        <Button type="submit" variant="primary" disabled={send.busy} aria-busy={send.busy || undefined}>
          {send.busy ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </form>
  );
}

/* ---------- the one true name, address and phone ---------------------------------------------- */

/** The owner records the decision; every profile is then compared with it. A field left empty stays open; all three empty takes it back. */
export function NapTruthForm({ truth, owner }: { truth: NapTruth | null; owner: boolean }) {
  if (!owner) return null;
  return (
    <Dialog
      title="The one true name, address and phone"
      description="What the website and every profile should state, word for word. Every profile is then marked as the same or different."
      trigger={{ label: truth ? "Change the agreed" : "Record the decision", size: "sm", variant: truth ? "ghost" : "good", icon: "flag" }}
    >
      <TruthForm truth={truth} />
    </Dialog>
  );
}

function TruthForm({ truth }: { truth: NapTruth | null }) {
  const send = useSend();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await send.go<BacklinksAnswer>("/api/v1/seo/backlinks/nap", { name: text(f, "name"), address: text(f, "address"), phone: text(f, "phone") }, (v) => v.line);
  };
  return (
    <form className="dk-seo-bl-form" onSubmit={(e) => void submit(e)}>
      <Field label="Name">
        <Input name="name" defaultValue={truth?.name ?? ""} maxLength={120} />
      </Field>
      <Field label="Address" hint="Street and number, postcode and town, as every listing should write it.">
        <Input name="address" defaultValue={truth?.address ?? ""} maxLength={200} />
      </Field>
      <Field label="Phone">
        <Input name="phone" defaultValue={truth?.phone ?? ""} maxLength={40} />
      </Field>
      <Said message={send.message} />
      <DialogActions>
        <DialogClose variant="ghost">Close</DialogClose>
        <Button type="submit" variant="primary" disabled={send.busy} aria-busy={send.busy || undefined}>
          {send.busy ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </form>
  );
}

/* ---------- Search Console's Links export ------------------------------------------------------ */

/** Larger than this, the desk refuses it anyway. */
const MOST = 5_000_000;

/** Import one table of Search Console's Links report, as exported. Which table it is, the desk tells from its cells. */
export function ImportLinks({ owner, href }: { owner: boolean; href: string }) {
  if (!owner) return <span className="dk-seo-bl-quiet">Imported by the owner</span>;
  return (
    <Dialog
      title="Import Search Console's links"
      description={
        <>
          Open{" "}
          <a href={href} target="_blank" rel="noreferrer" className="dk-seo-bl-link">
            Links in Search Console
          </a>
          , press Export on Top linking sites, Top linked pages or Latest links (More, then Export), choose “Download CSV”, and give the file here. Any of the four tables; each import replaces the one before of its kind.
        </>
      }
      trigger={{ label: "Import from Search Console", size: "sm", variant: "quiet", icon: "upload" }}
    >
      <ImportForm />
    </Dialog>
  );
}

function ImportForm() {
  const send = useSend();
  const [csv, setCsv] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MOST) {
      send.setMessage({ ok: false, text: "The file is larger than 5 MB." });
      return;
    }
    setCsv(await f.text());
    setFile(f.name);
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!csv.trim()) {
      send.setMessage({ ok: false, text: "Choose the exported file, or paste its text." });
      return;
    }
    await send.go<LinksImportAnswer>("/api/v1/seo/backlinks/import", { csv }, (v) => v.line);
  };
  return (
    <form className="dk-seo-bl-form" onSubmit={(e) => void submit(e)}>
      <Field label="The exported file" hint={file ? `Read: ${file}, ${csv.split(/\r?\n/).filter(Boolean).length} lines.` : "A .csv file as Search Console exports it. A .zip must be unpacked first."}>
        <Input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void pick(e)} />
      </Field>
      <Field label="Or paste its text">
        <Textarea
          rows={5}
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setFile(null);
          }}
          spellCheck={false}
        />
      </Field>
      <Said message={send.message} />
      <DialogActions>
        <DialogClose variant="ghost">Close</DialogClose>
        <Button type="submit" variant="primary" disabled={send.busy} aria-busy={send.busy || undefined}>
          {send.busy ? "Importing…" : "Import"}
        </Button>
      </DialogActions>
    </form>
  );
}

/* ---------- following a link ---------------------------------------------------------------------- */

/** Follow a page by hand: a client's credit, a directory profile, a page that promised a link. */
export function FollowLink() {
  return (
    <Dialog
      title="Follow a link"
      description="The page that links, or should link, to the website: a client's credits, a directory profile, an article. The desk reads it once a week, after its robots.txt allowed it, and says when the link appears or goes."
      trigger={{ label: "Follow a link", size: "sm", variant: "quiet", icon: "plus" }}
    >
      <FollowForm />
    </Dialog>
  );
}

function FollowForm() {
  const send = useSend();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await send.go<BacklinksAnswer>("/api/v1/seo/backlinks/links", { url: text(f, "url"), note: text(f, "note") || null }, (v) => v.line);
  };
  return (
    <form className="dk-seo-bl-form" onSubmit={(e) => void submit(e)}>
      <Field label="Address of the page">
        <Input name="url" type="text" inputMode="url" required placeholder="https://…" maxLength={2000} />
      </Field>
      <Field label="Note" hint="Why it is followed: “credit promised by the client, 3 Oct”. At most 200 characters.">
        <Input name="note" maxLength={200} />
      </Field>
      <Said message={send.message} />
      <DialogActions>
        <DialogClose variant="ghost">Close</DialogClose>
        <Button type="submit" variant="primary" disabled={send.busy} aria-busy={send.busy || undefined}>
          {send.busy ? "Adding…" : "Follow"}
        </Button>
      </DialogActions>
    </form>
  );
}
