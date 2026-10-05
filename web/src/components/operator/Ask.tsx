"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ContextChoice, Depth, NewTask, TaskAnswer, TaskKind } from "@/contract/operator";
import type { Range } from "@/contract/common";
import { Icon, type IconName } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { CONTEXT_OPTIONS, DEPTH_OPTIONS, KIND_DATA, KIND_LOOK } from "./look";
import { useSend } from "./send";

/** What another screen asked for with ?do= &path= &q=, or a suggested prompt. */
export interface Preset {
  kind: TaskKind;
  text: string;
  context?: ContextChoice;
  paths?: string[];
  path?: string;
  /** "keywords": the phrases asked about. */
  ids?: number[];
  /** "serp": the kept result page. */
  serpId?: number;
  schemaType?: "FAQPage" | "Service";
}

/** The seven suggested prompts: each fills the box with what it will run. True to this site. */
const SUGGESTED: (Preset & { label: string })[] = [
  { label: "Analyze our traffic this month", kind: "traffic", text: "Analyze our traffic this month" },
  { label: "Find new content opportunities", kind: "opportunities", text: "Find new content opportunities" },
  { label: "Write a brief for a new insight", kind: "brief", text: "" },
  { label: "Fix broken links", kind: "redirect", text: "Fix broken links: propose redirects for addresses that no longer answer" },
  { label: "Create metadata for pages that need it", kind: "metadata", text: "Create metadata for the pages that need it" },
  { label: "Run a full SEO audit", kind: "audit", text: "Run a full SEO audit" },
  { label: "Show me top converting pages", kind: "ask", text: "Show me top converting pages", context: "traffic" },
];

const PLACEHOLDER: Record<TaskKind, string> = {
  ask: "Ask me anything about your website...",
  traffic: "Analyze our traffic",
  opportunities: "Find new content opportunities",
  metadata: "Create metadata for the pages that need it",
  redirect: "Propose redirects for addresses that no longer answer",
  brief: "What should the brief be about? A topic, or a search query people use...",
  audit: "Run a full SEO audit",
  og: "Write a share card for this page",
  schema: "Draft structured data for this page",
  links: "Find pages that should link to this page",
  alt: "Write alt texts for this page's pictures",
  keywords: "Sort the searches that wait for a judgement",
  serp: "Compare our page with the first results",
};

function Pick<T extends string>({ icon, label, value, options, onChange, title }: { icon: IconName; label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; title?: string }) {
  return (
    <span className="dk-operator-pick" title={title}>
      <Icon name={icon} size={16} />
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

/**
 * The prompt box. A question, or a task chosen from the suggestions, the
 * cards below or another screen, becomes a task in the workstation's queue
 * when the green button is pressed. The context select chooses which of the
 * desk's records go with a question; the depth select chooses the
 * workstation's smaller or larger model and how much it is given.
 */
export function Ask({ preset, range, specimen }: { preset: Preset | null; range: Range; specimen: boolean }) {
  const [kind, setKind] = useState<TaskKind>(preset?.kind ?? "ask");
  const [text, setText] = useState(preset?.text ?? "");
  const [chosen, setChosen] = useState<string>(preset?.text ?? "");
  const [context, setContext] = useState<ContextChoice>(preset?.context ?? "website");
  const [depth, setDepth] = useState<Depth>("deep");
  const [paths, setPaths] = useState<string[] | undefined>(preset?.paths);
  const [path, setPath] = useState<string | undefined>(preset?.path);
  const box = useRef<HTMLTextAreaElement>(null);
  const { go, busy, message, setMessage } = useSend();

  /* A preset from another screen arrives with the address: focus the box so Enter runs it.
     The page remounts this component when the preset changes (its key). */
  const arrived = preset !== null;
  useEffect(() => {
    if (arrived) box.current?.focus();
  }, [arrived]);

  const choose = (p: Preset) => {
    setKind(p.kind);
    setText(p.text);
    setChosen(p.text);
    setContext(p.context ?? "website");
    setPaths(p.paths);
    setPath(p.path);
    setMessage(null);
    box.current?.focus();
  };

  const clear = () => choose({ kind: "ask", text: "" });

  const edit = (v: string) => {
    setText(v);
    /* Rewriting a suggestion makes it a question of one's own; a brief's box is its topic. */
    if (kind !== "ask" && kind !== "brief" && v.trim() !== chosen.trim()) {
      setKind("ask");
      setPaths(undefined);
    }
  };

  const submit = async () => {
    if (busy) return;
    const body: NewTask = {
      kind,
      prompt: text.trim(),
      depth,
      range,
      ...(kind === "ask" ? { context } : {}),
      ...(paths?.length ? { paths } : {}),
      ...(path ? { path } : {}),
      ...(preset?.kind === kind && preset.ids?.length ? { ids: preset.ids } : {}),
      ...(preset?.kind === kind && preset.serpId ? { serpId: preset.serpId } : {}),
      ...(preset?.kind === kind && preset.schemaType ? { schemaType: preset.schemaType } : {}),
    };
    if (specimen) {
      setMessage({ ok: false, text: "Specimen data is showing: nothing is queued from this view. Open the screen without ?specimen=1 to ask." });
      return;
    }
    const r = await go<TaskAnswer>("/api/v1/operator/tasks", body, (v) =>
      v.task.stage === "crawl"
        ? "Queued. The crawl runs first; the workstation summarises it when it is on."
        : `Queued${v.task.ahead ? ` behind ${v.task.ahead} other${v.task.ahead === 1 ? "" : "s"}` : ""}. The workstation answers when it is on.`,
    );
    if (r.ok) {
      setText("");
      setChosen("");
      setKind("ask");
      setPaths(undefined);
      setPath(undefined);
      /* What another screen asked for is done: the address stops asking for it, so a reload does not fill the box again. */
      if (arrived) {
        const u = new URL(window.location.href);
        for (const k of ["do", "path", "q", "ids", "serp", "type"]) u.searchParams.delete(k);
        window.history.replaceState(window.history.state, "", `${u.pathname}${u.search}${u.hash}`);
      }
    }
  };

  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const depthHint = DEPTH_OPTIONS.find((d) => d.value === depth)?.hint;
  const ready = kind === "ask" || kind === "brief" ? text.trim().length >= 3 : true;

  return (
    <section className="dk-operator-ask" aria-label="Ask the operator">
      <div className="dk-operator-box">
        <textarea
          ref={box}
          className="dk-operator-input"
          value={text}
          onChange={(e) => edit(e.target.value)}
          onKeyDown={keys}
          placeholder={PLACEHOLDER[kind]}
          rows={2}
          maxLength={1000}
          aria-label="Your question or task"
        />
        <div className="dk-operator-controls">
          {kind === "ask" ? (
            <Pick icon="globe" label="Context" value={context} options={CONTEXT_OPTIONS} onChange={setContext} title="Which of the desk's records go with the question" />
          ) : (
            <span className="dk-operator-pick dk-operator-pick--fixed" title={KIND_DATA[kind]}>
              <Icon name="globe" size={16} />
              <span>{KIND_DATA[kind]}</span>
            </span>
          )}
          <Pick icon="sparkles" label="Depth" value={depth} options={DEPTH_OPTIONS} onChange={setDepth} title={depthHint} />
          {kind !== "ask" || path ? (
            <button type="button" className="dk-operator-mode" onClick={clear} title="Back to a plain question">
              <span>{kind === "ask" ? `Page: ${path}` : paths?.length ? `${KIND_LOOK[kind].name}: ${paths.join(", ")}` : path ? `${KIND_LOOK[kind].name}: ${path}` : KIND_LOOK[kind].name}</span>
              <Icon name="x" size={12} />
            </button>
          ) : null}
          <button type="button" className="dk-operator-send" onClick={() => void submit()} disabled={busy || !ready} aria-label="Queue it for the workstation" title="Queue it for the workstation">
            <Icon name="arrow-right" size={18} />
          </button>
        </div>
      </div>
      {message ? (
        <p className={cx("dk-operator-said", !message.ok && "dk-operator-said--bad")} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      ) : null}
      <p className="dk-operator-label">Suggested prompts</p>
      <ul className="dk-operator-chips">
        {SUGGESTED.map((s) => (
          <li key={s.label}>
            <button type="button" className={cx("dk-operator-chip", kind === s.kind && (s.kind !== "ask" || text === s.text) && "dk-operator-chip--on")} onClick={() => choose(s)}>
              <span>{s.label}</span>
              <Icon name="arrow-up-right" size={14} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
