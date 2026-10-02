"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import type { ImportAnswer } from "@/contract/seo/common";
import type { ManualImport } from "@/contract/seo/ai-search";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogActions, DialogClose } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { useSend } from "@/components/operator/send";
import { Said } from "@/components/seo/overview/Act";
import "./ai-search.css";

/** The month before this one, "2026-09", in Zurich: a monthly export covers a whole month. */
function lastMonth(): string {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number);
  const yy = m === 1 ? y! - 1 : y!;
  const mm = m === 1 ? 12 : m! - 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

/** Larger than this, the desk refuses it anyway. */
const MOST = 5_000_000;

/**
 * Import one month of a report as exported (POST
 * /api/v1/seo/imports/<kind>, the owner's): pick the CSV file or paste it.
 * The desk keeps it column for column and says what it did.
 */
export function ImportForm({ kind, title, owner, blocked }: { kind: ManualImport["kind"]; title: string; owner: boolean; blocked: string | null }) {
  if (!owner) return <span className="dk-seo-ai-search-quiet dk-seo-ai-search-headnote">Imported by the owner</span>;
  return (
    <Dialog
      title={`Import ${title}`}
      description={blocked ? `Needs first: ${blocked}` : "One month as exported, as CSV. The same file twice changes nothing; a new export of a month replaces the earlier one."}
      trigger={{ label: "Import CSV", size: "sm", variant: "quiet", icon: "upload" }}
    >
      <Form kind={kind} />
    </Dialog>
  );
}

function Form({ kind }: { kind: ManualImport["kind"] }) {
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
    const month = String(new FormData(e.currentTarget).get("month") ?? "");
    if (!/^\d{4}-\d\d$/.test(month)) {
      send.setMessage({ ok: false, text: "Choose the month the export covers." });
      return;
    }
    if (!csv.trim()) {
      send.setMessage({ ok: false, text: "Choose the exported file, or paste its text." });
      return;
    }
    await send.go<ImportAnswer>(`/api/v1/seo/imports/${kind}`, { month, csv }, (v) => v.lines.join(" "));
  };

  return (
    <form className="dk-seo-ai-search-form" onSubmit={(e) => void submit(e)}>
      <Field label="The month the export covers">
        <Input type="month" name="month" defaultValue={lastMonth()} required />
      </Field>
      <Field label="The exported file" hint={file ? `Read: ${file}, ${csv.split(/\r?\n/).filter(Boolean).length} lines.` : "A .csv file as the report exports it."}>
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
