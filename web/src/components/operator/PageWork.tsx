"use client";

import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import type { NewProposalBody, NewTask, PictureAnswer, ProposalAnswer, SerpChoice, TaskAnswer, UploadedPicture } from "@/contract/operator";
import type { Range } from "@/contract/common";
import { Button } from "@/components/ui/Button";
import { DialogActions } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { Sheet } from "./Sheet";
import { useSend } from "./send";

type HandKind = "og" | "meta" | "index" | "canonical" | "schema";
type PageTask = "og" | "schema-faq" | "schema-service" | "links" | "alt";

const HAND: { value: HandKind; label: string; hint: string }[] = [
  { value: "og", label: "Share card", hint: "The title, text and picture LinkedIn, WhatsApp and X show when the page is shared." },
  { value: "meta", label: "Search title and description", hint: "What Google shows for the page. The website adds “ | Balkaris” to the title itself where it fits." },
  { value: "index", label: "In or out of search", hint: "Out of search: the page stays online, but tells search engines not to list it, and leaves the sitemap." },
  { value: "canonical", label: "Canonical address", hint: "Tell search engines to count another page instead. Only for two pages that say the same thing." },
  { value: "schema", label: "Structured data", hint: "One schema.org block (FAQPage, Service, HowTo…). Every fact in it must be on the page." },
];

const TASKS: { value: PageTask; label: string; hint: string }[] = [
  { value: "og", label: "Write a share card", hint: "A share title and text from what the page says. Becomes a proposal." },
  { value: "schema-faq", label: "Draft a FAQ block", hint: "Questions the page answers, in its own words. Becomes a proposal." },
  { value: "schema-service", label: "Draft a Service block", hint: "The service the page offers, from its own text. Becomes a proposal." },
  { value: "links", label: "Find pages that should link here", hint: "From the crawl's link graph. To-dos for the website's code." },
  { value: "alt", label: "Write alt texts", hint: "For the page's pictures that have none. To-dos for the website's code." },
];

const MOST_KB = 600;

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <span className="dk-select dk-select--md">
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={14} />
    </span>
  );
}

function Said({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p className={cx("dk-operator-said", !message.ok && "dk-operator-said--bad")} role={message.ok ? "status" : "alert"}>
      {message.text}
    </p>
  );
}

const readAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(new Error("The file could not be read."));
    r.readAsDataURL(file);
  });

/**
 * The website's head, changed by a person or asked of the workstation, one
 * page at a time.
 *
 *   Change a page   a form for every kind of change the desk can make
 *                   (share card with its picture, title and description, in or
 *                   out of search, canonical, structured data). It posts a
 *                   proposal directly, with no model involved; the server
 *                   checks the website's rules and says why it refuses.
 *   Ask about a page  the local model's page tasks: share card, FAQ or
 *                   Service block, links to the page, alt texts.
 *   Sort searches, Compare with the first results: the two search tasks.
 *
 * Every change waits under Actions & approvals for a person who can publish.
 */
export function PageWork({ range, specimen, serps }: { range: Range; specimen: boolean; serps: SerpChoice[] }) {
  const [open, setOpen] = useState<"hand" | "ai" | "serp" | null>(null);
  const [kind, setKind] = useState<HandKind>("og");
  const [task, setTask] = useState<PageTask>("og");
  const [noindex, setNoindex] = useState(true);
  const [picture, setPicture] = useState<UploadedPicture | null>(null);
  const [serp, setSerp] = useState<string>(serps[0] ? String(serps[0].id) : "");
  const form = useSend();
  const upload = useSend();
  const quick = useSend();

  const close = () => {
    setOpen(null);
    setPicture(null);
    form.setMessage(null);
    upload.setMessage(null);
  };
  const blocked = (s: ReturnType<typeof useSend>) => {
    if (!specimen) return false;
    s.setMessage({ ok: false, text: "Specimen data is showing: nothing is sent from this view." });
    return true;
  };

  const pick = async (e: ChangeEvent<HTMLInputElement>, address: string) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || blocked(upload)) return;
    if (!/^\/([a-z0-9][a-z0-9/_-]*)?$/.test(address)) return upload.setMessage({ ok: false, text: "Write the page's address first, for example /seo: the picture is named after it." });
    if (file.size > MOST_KB * 1024) return upload.setMessage({ ok: false, text: `The picture is ${Math.round(file.size / 1024)} KB; the desk takes at most ${MOST_KB} KB. Save it smaller (1200 by 630 as a JPEG is plenty).` });
    const r = await upload.go<PictureAnswer>("/api/v1/operator/pictures", { address, data: await readAsBase64(file), filename: file.name }, (v) => v.line);
    if (r.ok) setPicture(r.value.picture);
  };

  const submitHand = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (blocked(form)) return;
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    const address = s("address");
    const why = s("why") || undefined;
    let body: NewProposalBody;
    switch (kind) {
      case "og":
        body = { kind, address, ...(s("ogTitle") ? { ogTitle: s("ogTitle") } : {}), ...(s("ogDescription") ? { ogDescription: s("ogDescription") } : {}), ...(picture ? { ogImage: picture.sitePath } : s("ogImage") ? { ogImage: s("ogImage") } : {}), why };
        break;
      case "meta":
        body = { kind, address, ...(s("title") ? { title: s("title") } : {}), ...(s("description") ? { description: s("description") } : {}), why };
        break;
      case "index":
        body = { kind, address, noindex, why };
        break;
      case "canonical":
        body = { kind, address, canonical: s("canonical"), why };
        break;
      default:
        body = { kind: "schema", address, jsonLd: s("jsonLd"), why };
    }
    const r = await form.go<ProposalAnswer>("/api/v1/operator/proposals", body, (v) => v.line ?? "Proposed. It waits for approval.");
    if (r.ok) {
      close();
      quick.setMessage({ ok: true, text: r.value.line ?? "Proposed. It waits for approval under Actions & approvals." });
    }
  };

  const queued = (v: TaskAnswer) => `Queued: ${v.task.title}${v.task.ahead ? `, behind ${v.task.ahead} other${v.task.ahead === 1 ? "" : "s"}` : ""}. The workstation answers when it is on.`;

  const submitTask = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (blocked(form)) return;
    const path = String(new FormData(e.currentTarget).get("path") ?? "").trim();
    const body: NewTask =
      task === "schema-faq" || task === "schema-service" ? { kind: "schema", path, schemaType: task === "schema-faq" ? "FAQPage" : "Service", range } : { kind: task, path, range };
    const r = await form.go<TaskAnswer>("/api/v1/operator/tasks", body, queued);
    if (r.ok) {
      close();
      quick.setMessage({ ok: true, text: queued(r.value) });
    }
  };

  const run = async (body: NewTask) => {
    if (blocked(quick)) return;
    const r = await quick.go<TaskAnswer>("/api/v1/operator/tasks", { ...body, range }, queued);
    if (r.ok) close();
  };

  const handHint = HAND.find((h) => h.value === kind)?.hint;
  const fields: Record<HandKind, ReactNode> = {
    og: (
      <>
        <Field label="Share title" hint="Up to 110 characters; 60 or fewer reads best. Leave empty to keep it.">
          <Input name="ogTitle" maxLength={110} />
        </Field>
        <Field label="Share text" hint="Up to 300 characters; about 200 reads best. Leave empty to keep it.">
          <Textarea name="ogDescription" rows={2} maxLength={300} />
        </Field>
        <Field label="Share picture" hint={`PNG, JPEG or WebP, at most ${MOST_KB} KB, at least 600 by 315. It is made upright and 1200 by 630.`}>
          <input type="file" accept="image/png,image/jpeg,image/webp" className="dk-input" disabled={upload.busy} onChange={(e) => void pick(e, String((e.currentTarget.form?.elements.namedItem("address") as HTMLInputElement | null)?.value ?? "").trim())} />
        </Field>
        {picture ? (
          <figure className="dk-operator-diff-pic">
            <img src={picture.url} alt="The uploaded share picture" />
            <figcaption className="dk-operator-aside">
              {picture.width} by {picture.height}, {Math.round(picture.bytes / 1024)} KB, as {picture.sitePath}
            </figcaption>
          </figure>
        ) : (
          <Field label="Or a picture already on the site" hint="Its address, for example /og/about.jpg.">
            <Input name="ogImage" maxLength={200} pattern="/[a-z0-9][a-z0-9/._\-]*\.(png|jpg|jpeg|webp)" placeholder="/og/about.jpg" />
          </Field>
        )}
        <Said message={upload.message} />
      </>
    ),
    meta: (
      <>
        <Field label="Title" hint="The page's own part, at most 110 characters (60 with the brand reads whole). Leave empty to keep it.">
          <Input name="title" maxLength={110} />
        </Field>
        <Field label="Description" hint="At most 300 characters; 158 or fewer shows whole in a search result. Leave empty to keep it.">
          <Textarea name="description" rows={3} maxLength={300} />
        </Field>
      </>
    ),
    index: (
      <fieldset className="dk-operator-radios">
        <legend className="dk-field-label">Search</legend>
        <label>
          <input type="radio" name="noindex" checked={noindex} onChange={() => setNoindex(true)} /> Take it out of search (noindex). It leaves the sitemap; the page stays online.
        </label>
        <label>
          <input type="radio" name="noindex" checked={!noindex} onChange={() => setNoindex(false)} /> Put it back in search (only a page the desk took out).
        </label>
      </fieldset>
    ),
    canonical: (
      <Field label="Count this page instead" hint="A page of the site that answers and is in the sitemap. The page above leaves the sitemap.">
        <Input name="canonical" required maxLength={200} pattern="/([a-z0-9][a-z0-9/_\-]*)?" placeholder="/the-page-to-count" />
      </Field>
    ),
    schema: (
      <Field label="The block, as JSON" hint='One object with "@context": "https://schema.org" and an "@type" such as FAQPage, Service or HowTo; at most 8 KB.'>
        <Textarea name="jsonLd" rows={8} required className="dk-operator-code" placeholder={'{\n  "@context": "https://schema.org",\n  "@type": "FAQPage",\n  "mainEntity": []\n}'} />
      </Field>
    ),
  };

  return (
    <div className="dk-operator-pagework">
      <p className="dk-operator-label">One page, one search</p>
      <div className="dk-operator-pagework-row">
        <Button size="sm" icon="pencil" onClick={() => setOpen("hand")}>
          Change a page
        </Button>
        <Button size="sm" icon="sparkles" onClick={() => setOpen("ai")}>
          Ask about a page
        </Button>
        <Button size="sm" icon="target" disabled={quick.busy} onClick={() => void run({ kind: "keywords" })} title="The workstation judges the tracked searches nobody has judged yet">
          Sort waiting searches
        </Button>
        <Button size="sm" icon="list" disabled={!serps.length} onClick={() => setOpen("serp")} title={serps.length ? "What the first results have that our page lacks" : "The desk keeps no result page yet: check a search on Keywords first"}>
          Compare with the first results
        </Button>
      </div>
      <Said message={quick.message} />

      <Sheet open={open === "hand"} onClose={close} title="Change a page" description="Written by you, no model involved. The desk checks it against the website's own rules, then it waits for a person who can publish.">
        <form onSubmit={(e) => void submitHand(e)}>
          <Field label="Page" hint="Its address as the site writes it: lower case, no trailing slash. / is the home page.">
            <Input name="address" required maxLength={200} pattern="/([a-z0-9][a-z0-9/_\-]*)?" placeholder="/seo" autoFocus />
          </Field>
          <Field label="What changes" hint={handHint}>
            <Choice label="What changes" value={kind} options={HAND} onChange={(v) => { setKind(v); setPicture(null); upload.setMessage(null); }} />
          </Field>
          {fields[kind]}
          <Field label="Why" hint="Optional: what a reviewer should know.">
            <Input name="why" maxLength={400} />
          </Field>
          <Said message={form.message} />
          <DialogActions>
            <Button variant="quiet" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" icon="send" disabled={form.busy || upload.busy}>
              Propose for approval
            </Button>
          </DialogActions>
        </form>
      </Sheet>

      <Sheet open={open === "ai"} onClose={close} title="Ask about a page" description="The studio workstation's own model answers from the page's own text when it is on. Every answer is checked on the desk before anything is kept.">
        <form onSubmit={(e) => void submitTask(e)}>
          <Field label="Page">
            <Input name="path" required maxLength={200} pattern="/([a-z0-9][a-z0-9/_\-]*)?" placeholder="/seo" autoFocus />
          </Field>
          <Field label="Task" hint={TASKS.find((t) => t.value === task)?.hint}>
            <Choice label="Task" value={task} options={TASKS} onChange={setTask} />
          </Field>
          <Said message={form.message} />
          <DialogActions>
            <Button variant="quiet" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" icon="sparkles" disabled={form.busy}>
              Queue it
            </Button>
          </DialogActions>
        </form>
      </Sheet>

      <Sheet open={open === "serp"} onClose={close} title="Compare with the first results" description="The workstation reads a result page the desk kept, the competitor pages it read for that search, and our page, and says what the first results have that ours lacks.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run({ kind: "serp", serpId: Number(serp) });
          }}
        >
          <Field label="Search">
            <Choice label="Search" value={serp} options={serps.map((s) => ({ value: String(s.id), label: `${s.phrase}${s.ownPosition ? ` (we are ${s.ownPosition})` : ""}${s.doneAt ? `, ${s.doneAt.slice(0, 10)}` : ""}` }))} onChange={setSerp} />
          </Field>
          <Said message={quick.message} />
          <DialogActions>
            <Button variant="quiet" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" icon="list" disabled={quick.busy || !serp}>
              Queue it
            </Button>
          </DialogActions>
        </form>
      </Sheet>
    </div>
  );
}
