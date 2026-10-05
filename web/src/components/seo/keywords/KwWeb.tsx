"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import type { ResearchMode, SerpAsked, WebLang } from "@/contract/seo/common";
import type { BriefQueued, KeywordChanged, KeywordsActed, KeywordsTracked, Researched, TopicChanged } from "@/contract/seo/keywords";
import { useSend } from "@/components/operator/send";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogActions, DialogClose } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { cx } from "@/lib/cx";
import { API, openHref, researchHref, serpHref, type Place } from "./href";
import { Said, useClusters, useFade } from "./KwAct";
import { INTENT_LABEL, LANG_LABEL } from "./look";

/**
 * SEO › Keywords' buttons that reach the web, the local AI, or refile
 * phrases. Each posts to the desk server (POST /api/v1/seo/keywords/…,
 * contract/seo/keywords.ts) and shows the server's sentence; then the page is
 * drawn again from the server, or the address moves to what was asked (a
 * research, a result page), so it can be shared and survives a reload.
 *
 * Research and "who ranks" ask the open web through the desk's web layer,
 * within its allowances; the AI is the studio workstation's own model,
 * reached through the operator queue. Nothing here changes the website.
 */

const LANGS: WebLang[] = ["de", "en", "fr", "it"];
const langOptions = LANGS.map((l) => ({ value: l, label: LANG_LABEL[l] ?? l }));

/* ---------- research a phrase ---------------------------------------------------------------- */

/** The ways a phrase is researched, as a person names them. "Completions" asks the phrase itself and with words in front. */
const WAYS: { key: string; label: string; modes: ResearchMode[]; title: string }[] = [
  { key: "complete", label: "Completions", modes: ["plain", "front"], title: "What people type after the phrase, and with a word in front of it." },
  { key: "questions", label: "Questions", modes: ["questions"], title: "The phrase after question words: how, what, why, what does it cost…" },
  { key: "modifiers", label: "With a word added", modes: ["modifiers"], title: "The phrase with price, place and intent words after it." },
  { key: "alphabet", label: "A to Z (26 more requests)", modes: ["alphabet"], title: "The phrase followed by each letter: many more suggestions, 26 more requests to Google." },
];

/** The research box: a phrase, its language and what to look for. Researching asks the web and moves the address to the answer. */
export function ResearchBox({ place, seed, lang, modes, kept }: { place: Place; seed: string; lang: WebLang; modes: ResearchMode[]; kept: boolean }) {
  const router = useRouter();
  const { go, busy, message, setMessage } = useSend();
  useFade(message, setMessage);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const fresh = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === "fresh";
    const asked = String(f.get("seed") ?? "").trim();
    const l = (String(f.get("lang") ?? "de") || "de") as WebLang;
    const ways = WAYS.filter((w) => f.get(`way-${w.key}`) === "on").flatMap((w) => w.modes);
    if (!ways.length) return setMessage({ ok: false, text: "Choose at least one thing to look for." });
    void go<Researched>(`${API}/research`, { seed: asked, lang: l, modes: ways, fresh }, (v) => {
      router.push(researchHref(place, asked.toLowerCase().replace(/\s+/g, " "), l, ways), { scroll: false });
      return v.line;
    });
  };
  const on = (w: (typeof WAYS)[number]) => w.modes.every((m) => modes.includes(m));
  return (
    <form className="dk-seo-kw-rbox" onSubmit={submit}>
      <label className="dk-seo-kw-find dk-seo-kw-rbox-seed">
        <Icon name="search" size={14} />
        <input type="search" name="seed" defaultValue={seed} required minLength={2} maxLength={80} placeholder="Any phrase: what would people type?" aria-label="The phrase to research" autoComplete="off" />
      </label>
      <span className="dk-select dk-select--sm">
        <select name="lang" defaultValue={lang} aria-label="Language">
          {langOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={14} />
      </span>
      <span className="dk-seo-kw-rbox-ways" role="group" aria-label="What to look for">
        {WAYS.map((w) => (
          <label key={w.key} className="dk-seo-kw-track-check" title={w.title}>
            <input type="checkbox" name={`way-${w.key}`} className="dk-check" defaultChecked={on(w)} />
            <span>{w.label}</span>
          </label>
        ))}
      </span>
      <Button type="submit" value="research" variant="primary" size="sm" icon={busy ? "refresh" : "search"} disabled={busy} aria-busy={busy}>
        Research
      </Button>
      {kept ? (
        <Button type="submit" value="fresh" variant="ghost" size="sm" disabled={busy} title="Ask the engines again instead of using their answers of the last seven days. Counts on today's allowance.">
          Ask again
        </Button>
      ) : null}
      <Said message={message} />
    </form>
  );
}

/** "Research this one": the row's phrase becomes the researched phrase, one level deeper. */
export function ResearchThis({ place, phrase, lang, label = "Research this one", icon = true }: { place: Place; phrase: string; lang: WebLang; label?: string; icon?: boolean }) {
  const router = useRouter();
  const { go, busy, message, setMessage } = useSend();
  useFade(message, setMessage);
  return (
    <span className="dk-seo-kw-act">
      <Button
        size="xs"
        variant="ghost"
        icon={icon ? (busy ? "refresh" : "search") : undefined}
        disabled={busy}
        title={`Research “${phrase}” on the web: what people type around it.`}
        onClick={() =>
          void go<Researched>(`${API}/research`, { seed: phrase, lang }, (v) => {
            router.push(researchHref(place, phrase, lang), { scroll: false });
            return v.line;
          })
        }
      >
        {label}
      </Button>
      <Said message={message} />
    </span>
  );
}

/** "Check who ranks": asks for a result page (Google through the workstation, DuckDuckGo's second opinion), then shows where it stands. */
export function WhoRanks({ place, phrase, lang, id, cluster, fresh, label = "Check who ranks" }: { place: Place; phrase: string; lang: WebLang; id?: number | null; cluster?: string | null; fresh?: boolean; label?: string }) {
  const router = useRouter();
  const { go, busy, message, setMessage } = useSend();
  useFade(message, setMessage);
  return (
    <span className="dk-seo-kw-act">
      <Button
        size="xs"
        variant="ghost"
        icon={busy ? "refresh" : "list"}
        disabled={busy}
        title="Who is on Google's first page for it: queued for the studio workstation, which fetches Google's page from its own line. DuckDuckGo's page comes as a second opinion, labelled so."
        onClick={() =>
          void go<SerpAsked>(`${API}/serp`, { phrase, lang, cluster: cluster ?? undefined, fresh: !!fresh }, (v) => {
            router.push(id ? openHref(place, id) : serpHref(place, phrase, lang), { scroll: false });
            return v.line;
          })
        }
      >
        {label}
      </Button>
      <Said message={message} />
    </span>
  );
}

/* ---------- the research's ticked rows ---------------------------------------------------------- */

const RESEARCH_FORM = "dk-seo-kw-researchform";

interface Ticks {
  ref: RefObject<HTMLFormElement | null>;
  picked: number;
  count: () => void;
}
const TickContext = createContext<Ticks | null>(null);

/** The form the research table's checkboxes (named "pick") belong to. */
export function ResearchTicks({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLFormElement>(null);
  const [picked, setPicked] = useState(0);
  const count = () => setTimeout(() => setPicked(ref.current?.querySelectorAll('input[name="pick"]:checked').length ?? 0), 0);
  return (
    <TickContext.Provider value={{ ref, picked, count }}>
      <form id={RESEARCH_FORM} ref={ref} onChange={count} onSubmit={(e) => e.preventDefault()}>
        {children}
      </form>
    </TickContext.Provider>
  );
}

/**
 * "Track the ticked" (under the topic the desk suggests for each, or one
 * chosen for all) and "Ask the AI to sort these". Outside the form, reading
 * its ticks by id.
 */
export function ResearchActions({ seed, lang, filed }: { seed: string; lang: WebLang; filed: Record<string, string | null> }) {
  const t = useContext(TickContext);
  const clusters = useClusters();
  const { go, busy, message, setMessage } = useSend();
  const [topic, setTopic] = useState("");
  const ticked = (): string[] => {
    const f = document.getElementById(RESEARCH_FORM) as HTMLFormElement | null;
    return f ? new FormData(f).getAll("pick").map(String) : [];
  };
  const track = () => {
    const list = ticked();
    if (!list.length) return setMessage({ ok: false, text: "Tick the phrases to track first." });
    void go<KeywordsTracked>(`${API}/research/track`, { seed, lang, cluster: topic || undefined, phrases: list.map((p) => ({ phrase: p, cluster: filed[p] ?? null })) }, (v) => v.line);
  };
  const sort = () => {
    const list = ticked();
    if (!list.length) return setMessage({ ok: false, text: "Tick the phrases for the AI to sort first." });
    void go<BriefQueued>(`${API}/ai-sort`, { seed, lang, phrases: list }, (v) => v.line);
  };
  return (
    <div className="dk-seo-kw-ractions">
      <span className="dk-seo-kw-said">{t?.picked ? `${t.picked} ticked` : "Tick rows to track them"}</span>
      <span className="dk-select dk-select--sm">
        <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="The topic to file them under">
          <option value="">Under the topic the desk suggests</option>
          {clusters
            .filter((c) => c.lang === lang)
            .map((c) => (
              <option key={c.key} value={c.key}>
                Under {c.name}
              </option>
            ))}
        </select>
        <Icon name="chevron-down" size={14} />
      </span>
      <Button size="sm" variant="good" icon={busy ? "refresh" : "plus"} disabled={busy} onClick={track}>
        Track the ticked
      </Button>
      <Button size="sm" variant="quiet" icon="sparkles" disabled={busy} onClick={sort} title="The studio workstation's own model sorts the ticked phrases into relevant or not and into topics, as an operator task. Nothing is filed until a person does it.">
        Ask the AI to sort these
      </Button>
      {message ? (
        <span className={cx("dk-seo-kw-said", !message.ok && "dk-seo-kw-said--bad")} role={message.ok ? "status" : "alert"}>
          {message.text}
        </span>
      ) : null}
    </div>
  );
}

/* ---------- small posts ----------------------------------------------------------------------- */

/** A button that posts once and says what the server answered. */
function PostButton({ url, body, label, title, icon = "refresh" }: { url: string; body: unknown; label: string; title: string; icon?: "refresh" | "play" }) {
  const { go, busy, message, setMessage } = useSend();
  useFade(message, setMessage);
  return (
    <span className="dk-seo-kw-act">
      <Button size="xs" variant="quiet" icon={busy ? "refresh" : icon} disabled={busy} title={title} onClick={() => void go<{ line: string }>(url, body, (v) => v.line)}>
        {label}
      </Button>
      <Said message={message} />
    </span>
  );
}

/** "Run research now": the desk's daily research of the topics' phrases, ahead of its time. */
export function RunResearch() {
  return <PostButton url={`${API}/research/run`} body={{}} label="Run research now" icon="play" title="Run the desk's daily research now: at most 20 requests to Google's suggestions, within this week's budget." />;
}

/* ---------- refiling a phrase ------------------------------------------------------------------ */

/** "Edit": a phrase's topic, language and intent, kept against every later run and import. */
export function EditKeyword({ id, phrase, cluster, lang, intent }: { id: number; phrase: string; cluster: string | null; lang: string | null; intent: string | null }) {
  return (
    <Dialog title="Edit the keyword" description={`Where “${phrase}” is filed. Your change is kept: no run or import changes it back.`} trigger={{ label: "Edit", variant: "ghost", size: "xs", icon: "pencil" }}>
      <EditForm id={id} cluster={cluster} lang={lang} intent={intent} />
    </Dialog>
  );
}

function EditForm({ id, cluster, lang, intent }: { id: number; cluster: string | null; lang: string | null; intent: string | null }) {
  const clusters = useClusters();
  const { go, busy, message } = useSend();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void go<KeywordChanged>(`${API}/${id}/edit`, { cluster: String(f.get("cluster") ?? ""), lang: String(f.get("lang") ?? ""), intent: String(f.get("intent") ?? "") }, (v) => v.line);
  };
  return (
    <form className="dk-seo-kw-track" onSubmit={submit}>
      <Field label="Topic">
        <Select name="cluster" label="Topic" size="md" defaultValue={cluster ?? ""} options={[{ value: "", label: "No topic" }, ...clusters.map((c) => ({ value: c.key, label: `${c.name}` }))]} />
      </Field>
      <div className="dk-seo-kw-track-row">
        <Field label="Language">
          <Select name="lang" label="Language" size="md" defaultValue={lang ?? ""} options={[{ value: "", label: "Not known" }, ...langOptions]} />
        </Field>
        <Field label="Intent">
          <Select name="intent" label="Intent" size="md" defaultValue={intent ?? ""} options={[{ value: "", label: "Not known" }, ...Object.entries(INTENT_LABEL).map(([value, label]) => ({ value, label }))]} />
        </Field>
      </div>
      <Answer message={message} />
      <DialogActions>
        <DialogClose variant="ghost" size="sm">
          {message?.ok ? "Done" : "Cancel"}
        </DialogClose>
        <Button type="submit" variant="primary" size="sm" icon={busy ? "refresh" : "check"} disabled={busy}>
          Save
        </Button>
      </DialogActions>
    </form>
  );
}

function Answer({ message }: { message: { ok: boolean; text: string } | null }) {
  return message ? (
    <p className={cx("dk-seo-kw-said", !message.ok && "dk-seo-kw-said--bad")} role={message.ok ? "status" : "alert"}>
      {message.text}
    </p>
  ) : null;
}

/** "Add many": a list of phrases, one per line, tracked at once. */
export function AddMany() {
  return (
    <Dialog title="Add many phrases" description="One search per line. Each joins the keyword table as added by you, judged relevant; nothing on the website changes." trigger={{ label: "Add many", variant: "quiet", size: "sm", icon: "list" }}>
      <ManyForm />
    </Dialog>
  );
}

function ManyForm() {
  const clusters = useClusters();
  const { go, busy, message } = useSend();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void go<KeywordsActed>(`${API}/many`, { phrases: String(f.get("phrases") ?? ""), lang: String(f.get("lang") ?? "") || null, cluster: String(f.get("cluster") ?? "") || null }, (v) => {
      const bad = v.results.filter((r) => !r.ok).length;
      const fresh = v.results.filter((r) => r.ok && r.line.startsWith("Tracking")).length;
      return `${fresh} new, ${v.results.length - fresh - bad} already in the table${bad ? `, ${bad} not kept` : ""}.`;
    });
  };
  return (
    <form className="dk-seo-kw-track" onSubmit={submit}>
      <Field label="The phrases, one per line (at most 200)">
        <Textarea name="phrases" rows={8} required placeholder={"webdesign zürich\nwebsite erstellen lassen kosten"} />
      </Field>
      <div className="dk-seo-kw-track-row">
        <Field label="Language">
          <Select name="lang" label="Language" size="md" defaultValue="" options={[{ value: "", label: "Let the desk tell" }, ...langOptions]} />
        </Field>
        <Field label="Topic (optional)">
          <Select name="cluster" label="Topic" size="md" defaultValue="" options={[{ value: "", label: "No topic" }, ...clusters.map((c) => ({ value: c.key, label: c.name }))]} />
        </Field>
      </div>
      <Answer message={message} />
      <DialogActions>
        <DialogClose variant="ghost" size="sm">
          {message?.ok ? "Done" : "Cancel"}
        </DialogClose>
        <Button type="submit" variant="primary" size="sm" icon={busy ? "refresh" : "plus"} disabled={busy}>
          Track them
        </Button>
      </DialogActions>
    </form>
  );
}

/** "Topics": create a topic, or rename one. */
export function Topics() {
  return (
    <Dialog title="Topics" description="A topic groups the searches one page should answer, in one language." trigger={{ label: "Topics", variant: "quiet", size: "sm", icon: "layers" }}>
      <TopicForms />
    </Dialog>
  );
}

function TopicForms() {
  const clusters = useClusters();
  const made = useSend();
  const renamed = useSend();
  const create = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void made.go<TopicChanged>(`${API}/topics`, { name: String(f.get("name") ?? ""), lang: String(f.get("lang") ?? "de"), intent: String(f.get("intent") ?? "") || null }, (v) => v.line);
  };
  const rename = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const key = String(f.get("key") ?? "");
    if (!key) return renamed.setMessage({ ok: false, text: "Choose the topic to rename." });
    void renamed.go<TopicChanged>(`${API}/topics/${encodeURIComponent(key)}`, { name: String(f.get("name") ?? "") }, (v) => v.line);
  };
  return (
    <div className="dk-seo-kw-track">
      <form className="dk-seo-kw-track" onSubmit={create}>
        <p className="dk-seo-kw-map-head">A new topic</p>
        <Field label="Its name">
          <Input name="name" required minLength={2} maxLength={80} placeholder="Webdesign prices" autoComplete="off" />
        </Field>
        <div className="dk-seo-kw-track-row">
          <Field label="Language">
            <Select name="lang" label="Language" size="md" defaultValue="de" options={langOptions} />
          </Field>
          <Field label="Intent">
            <Select name="intent" label="Intent" size="md" defaultValue="" options={[{ value: "", label: "Not known" }, ...Object.entries(INTENT_LABEL).map(([value, label]) => ({ value, label }))]} />
          </Field>
        </div>
        <Answer message={made.message} />
        <div className="dk-seo-kw-map-actions">
          <Button type="submit" variant="primary" size="sm" icon={made.busy ? "refresh" : "plus"} disabled={made.busy}>
            Create the topic
          </Button>
        </div>
      </form>
      <form className="dk-seo-kw-track" onSubmit={rename}>
        <p className="dk-seo-kw-map-head">Rename a topic</p>
        <Field label="The topic">
          <Select name="key" label="Topic" size="md" defaultValue="" options={[{ value: "", label: "Choose a topic…" }, ...clusters.map((c) => ({ value: c.key, label: `${c.name} (${c.lang})` }))]} />
        </Field>
        <Field label="Its new name">
          <Input name="name" required minLength={2} maxLength={80} autoComplete="off" />
        </Field>
        <Answer message={renamed.message} />
        <DialogActions>
          <DialogClose variant="ghost" size="sm">
            Close
          </DialogClose>
          <Button type="submit" variant="primary" size="sm" icon={renamed.busy ? "refresh" : "check"} disabled={renamed.busy}>
            Rename
          </Button>
        </DialogActions>
      </form>
    </div>
  );
}

/* ---------- demand figures --------------------------------------------------------------------- */

/** Text of a Keyword Planner export: Google writes it as UTF-16 with a byte-order mark, or as UTF-8. */
async function exportText(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
  return new TextDecoder("utf-8").decode(buf);
}

/** The owner's Keyword Planner import: monthly searches for phrases of the table, named as the Planner's. */
export function PlannerImport() {
  const { go, busy, message } = useSend();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get("file");
    const csv = file instanceof File && file.size ? await exportText(file) : "";
    void go<{ line: string }>(`${API}/planner`, { csv, lang: String(f.get("lang") ?? "") || undefined, addMissing: f.get("add") === "on" }, (v) => v.line);
  };
  return (
    <form className="dk-seo-kw-planner" onSubmit={(e) => void submit(e)}>
      <input type="file" name="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" required aria-label="The Keyword Planner export" />
      <span className="dk-select dk-select--sm">
        <select name="lang" defaultValue="" aria-label="The export's language">
          <option value="">Language of each phrase</option>
          {langOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={14} />
      </span>
      <label className="dk-seo-kw-track-check">
        <input type="checkbox" name="add" className="dk-check" />
        <span>Add phrases the table does not hold</span>
      </label>
      <Button type="submit" size="xs" variant="quiet" icon={busy ? "refresh" : "upload"} disabled={busy}>
        Import Keyword Planner export
      </Button>
      <Answer message={message} />
    </form>
  );
}
