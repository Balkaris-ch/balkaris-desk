import { z } from "zod";
import type { Brief, KeywordJudgement, Opportunity, ProposalKind, ProposalRow, SerpBrief, SuggestedTodo, TaskKind } from "../../../web/src/contract/operator.ts";
import { BRAND, DESCRIPTION_MOST, OWN_TITLE_MOST, ownTitle, PLAIN, shownTitle, TITLE_MOST, type Pack } from "./packs.ts";
import { isSiteTask, siteCheck, sitePrompt, type Guards } from "./sitekinds.ts";

/**
 * What each kind of task asks the model, and how its answer is checked.
 *
 * WRITTEN FOR A SMALL LOCAL MODEL. The workstation runs a 12b or a 26b with a
 * context of a few thousand tokens. So each prompt says the job once, in
 * plain imperative sentences, puts the rules before the data, asks for strict
 * JSON wherever a structure is needed (Ollama constrains generation to the
 * schema sent with it), and never asks for more than one thing.
 *
 * NEVER TRUSTED. Every answer is checked here, on the box, before anything is
 * kept: the JSON against its schema, every address against the ones the desk
 * knows, every length against the website's own limits, and every number in
 * the answer against the numbers in the data it was given. An answer that
 * fails is sent back once with the reason quoted; the second answer is the
 * last. On that last answer what can be kept is kept and the rest is said
 * out loud: a figure the data does not hold is removed from the text and
 * named in the result's flags, an entry that breaks a rule is dropped and
 * named. Nothing a model invents reaches the screen as if it were read.
 */

export const SYSTEM = [
  "You are the operator of the Balkaris desk, the internal workbench of Balkaris, a Swiss creative and digital studio, for its website www.balkaris.ch.",
  "You work only from the DATA in the message, which the desk assembled from its own records. You know nothing else about this website, its visitors or its clients.",
  "Rules you never break:",
  "- Every number you write must appear in the DATA exactly as written there. Do not calculate new figures, percentages, totals or averages. Do not round. Do not estimate.",
  "- Never invent a page, an address, a client, a project, a result, a quote, a statistic or a fact about the studio.",
  "- If the DATA does not hold what is needed, say so in one sentence and name what is missing.",
  "- If a part of the DATA says it is NOT AVAILABLE, do not answer that part; say it is not available and why.",
  "- Plain text only: no HTML, no markdown tables, no code, no emoji, no bold.",
  "- British English. Short sentences. Name pages by their address, for example /services.",
].join("\n");

/** What the runner is handed: the finished prompt and how to run it. */
export interface Prompted {
  system: string;
  prompt: string;
  /** A JSON Schema: with one, Ollama constrains the answer to it. */
  schema: Record<string, unknown> | null;
  /** "quick": the workstation's QUICK_MODEL; "write": its WRITE_MODEL (src/llm.ts). */
  model: "quick" | "write";
  temperature: number;
  timeoutMs: number;
}

const data = (pack: Pack): string => (pack.blocks.length ? pack.blocks.map((b) => b.text).join("\n\n") : "No data was attached to this question.");

const LENGTH = { quick: "Answer in at most 120 words.", deep: "Answer in at most 350 words, in short paragraphs or a short list." } as const;

/* ---------- the schemas sent to Ollama, and checked again here ----------------------- */

const str = { type: "string" } as const;

const SCHEMA: Partial<Record<TaskKind, Record<string, unknown>>> = {
  opportunities: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { title: str, why: str, page: { type: ["string", "null"] }, action: str, from: { type: "string", enum: ["crawl", "search-console", "analytics"] } },
          required: ["title", "why", "page", "action", "from"],
        },
      },
    },
    required: ["items"],
  },
  metadata: {
    type: "object",
    properties: {
      pages: { type: "array", items: { type: "object", properties: { path: str, title: str, description: str }, required: ["path", "title", "description"] } },
    },
    required: ["pages"],
  },
  redirect: {
    type: "object",
    properties: {
      picks: { type: "array", items: { type: "object", properties: { from: str, to: { type: ["string", "null"] }, why: str }, required: ["from", "to", "why"] } },
    },
    required: ["picks"],
  },
  brief: {
    type: "object",
    properties: {
      title: str,
      audience: str,
      question: str,
      outline: { type: "array", items: str },
      links: { type: "array", items: { type: "object", properties: { path: str, why: str }, required: ["path", "why"] } },
      notes: str,
    },
    required: ["title", "audience", "question", "outline", "links", "notes"],
  },
};

const Opportunities = z.object({
  items: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(120),
        why: z.string().trim().min(3).max(400),
        page: z.string().trim().nullable(),
        action: z.string().trim().min(3).max(240),
        from: z.enum(["crawl", "search-console", "analytics"]),
      }),
    )
    .min(1, "give at least one opportunity")
    .max(8, "give at most eight opportunities"),
});

const Metadata = z.object({
  pages: z.array(z.object({ path: z.string().trim(), title: z.string(), description: z.string() })).min(1, "give one entry per page"),
});

const Redirects = z.object({
  picks: z.array(z.object({ from: z.string().trim(), to: z.string().trim().nullable(), why: z.string().trim().max(300) })),
});

const BriefShape = z.object({
  title: z.string().trim().min(3).max(140),
  audience: z.string().trim().min(3).max(400),
  question: z.string().trim().min(3).max(300),
  outline: z.array(z.string().trim().min(2).max(200)).min(3, "the outline needs at least three sections").max(9, "the outline has at most eight sections"),
  links: z.array(z.object({ path: z.string().trim(), why: z.string().trim().max(200) })).max(8),
  notes: z.string().trim().max(600),
});

/* ---------- the prompts -------------------------------------------------------------- */

export function buildPrompt(kind: TaskKind, question: string, pack: Pack, retryNote: string | null): Prompted {
  const deep = pack.depth === "deep";
  const base = { system: SYSTEM, model: deep ? ("write" as const) : ("quick" as const), timeoutMs: 300_000 };
  if (isSiteTask(kind)) {
    const s = sitePrompt(kind, pack, data(pack));
    const again = retryNote ? `

YOUR LAST ANSWER WAS REFUSED: ${retryNote}
Answer again, fixing only that.` : "";
    return { ...base, prompt: s.prompt + again, schema: s.schema, temperature: s.temperature };
  }
  let prompt: string;
  let temperature = 0.3;

  switch (kind) {
    case "traffic":
      prompt = [
        "TASK: Summarise what changed in the website's traffic in the period given in the DATA, and what stands out.",
        "- Start with one sentence naming the period and its visitors and sessions.",
        "- Then up to five short points on what changed against the period before and what stands out: channels, pages, enquiries sent, meetings booked.",
        "- Compare only where the DATA gives the period before. Where it says the period before was not measured, do not compare at all.",
        "- Quote each figure exactly as the DATA writes it, with what it counts.",
        "- End with one sentence on what to look at next.",
        LENGTH[pack.depth],
        "",
        "DATA:",
        data(pack),
      ].join("\n");
      break;

    case "audit":
      prompt = [
        "TASK: Summarise the desk's SEO audit of the website from the DATA, which holds the crawl's findings.",
        "- Start with one sentence: the site score and how many findings of each severity the DATA states.",
        "- Then the most important findings, worst first, grouped by rule, at most six points, each naming the pages concerned.",
        "- Then up to three next steps, in order of importance.",
        LENGTH[pack.depth],
        "",
        "DATA:",
        data(pack),
      ].join("\n");
      break;

    case "opportunities":
      temperature = 0.2;
      prompt = [
        "TASK: Find up to six opportunities to improve the website, using the DATA only.",
        "Look for: findings worth fixing on pages that matter; Search Console queries where a page shows on Google's first two pages without being at the top (only if the DATA has Search Console rows); pages that get views but carry findings.",
        "For each opportunity give:",
        '- "title": a short name for it;',
        '- "why": what in the DATA shows it, quoting its figures exactly;',
        '- "page": the address it concerns, written exactly as in the DATA, or null;',
        '- "action": the one thing to do;',
        '- "from": "crawl", "search-console" or "analytics", the part of the DATA it comes from.',
        "Answer with JSON only.",
        "",
        "DATA:",
        data(pack),
      ].join("\n");
      break;

    case "metadata":
      temperature = 0.4;
      prompt = [
        "TASK: Write a better search title and description for each page in the DATA.",
        "Rules:",
        `- "title": the page's own part only, at most ${OWN_TITLE_MOST} characters. The website adds "${BRAND.trim()}" after a title by itself where the whole still fits in ${TITLE_MOST} characters, so never write Balkaris in a title. "description": between 70 and ${DESCRIPTION_MOST} characters. Count the characters.`,
        "- Write in the page's own language.",
        "- In the studio's voice: plain, confident and specific, in sentence case. No hype words, no exclamation marks, no emoji.",
        "- A page whose current title is the question it answers keeps that question as its title: it is what people search. Shorten it only if it is over the limit, and keep its words.",
        "- Keep a price or a figure the current title already gives.",
        "- Change nothing factual. Use only what the page's current title, heading, share text and the start of its text say. Do not add numbers, prices, places, clients, awards or claims that are not there.",
        "- Every title must differ from the other pages' titles.",
        `Answer with JSON only: {"pages":[{"path":"...","title":"...","description":"..."}]}, one entry for each page, with "path" exactly as given.`,
        "",
        "DATA:",
        data(pack),
      ].join("\n");
      break;

    case "redirect":
      temperature = 0.1;
      prompt = [
        "TASK: Each address in the DATA no longer answers. For each, choose where a visitor or a link should be sent instead.",
        "- Choose ONLY from that address's own candidates, written exactly as listed.",
        "- Choose the candidate that is about the same thing. If none is, choose null: a wrong redirect is worse than none.",
        '- "why": one short sentence on why it is about the same thing.',
        `Answer with JSON only: {"picks":[{"from":"...","to":"..." or null,"why":"..."}]}, one entry for each address.`,
        "",
        "DATA:",
        data(pack),
      ].join("\n");
      break;

    case "brief":
      temperature = 0.5;
      prompt = [
        `TASK: Write a brief for a new page or article on the website about: ${question}`,
        "It is for the studio's writers. Give:",
        '- "title": a working title;',
        '- "audience": who it is for, in one sentence;',
        '- "question": the one question it answers for them;',
        '- "outline": four to seven sections, one line each;',
        '- "links": up to five existing pages it should link to, each "path" written exactly as in the DATA, with "why";',
        '- "notes": what to avoid, including anything that would repeat an existing article in the DATA.',
        'Do not invent anything about clients, projects, results or figures. Where an example is needed, write "use a real example from the studio here".',
        "Answer with JSON only.",
        "",
        "DATA:",
        data(pack),
      ].join("\n");
      break;

    default:
      prompt = [`QUESTION: ${question}`, "", "Answer the question from the DATA.", LENGTH[pack.depth], "", "DATA:", data(pack)].join("\n");
  }

  if (retryNote) prompt += `\n\nYOUR LAST ANSWER WAS REFUSED: ${retryNote}\nAnswer again, fixing only that.`;
  return { ...base, prompt, schema: SCHEMA[kind] ?? null, temperature };
}

/* ---------- checking figures ----------------------------------------------------------- */

/** A number as written in prose, not inside a word, an address or a name ("gemma4", "/case-study-2024"). */
const NUM = /(?<![\w/.\-[])\d+(?:[.,']\d+)*(?![\w/\-%]*[a-z])/gi;

/** "1,234" and "1234" and "01" are the same figure; "12.50" is 12.5. */
export function norm(n: string): string {
  let s = n;
  if (/^\d{1,3}(?:[,']\d{3})+(?:\.\d+)?$/.test(s)) s = s.replace(/[,']/g, "");
  s = s.replace(/,/g, ".");
  const v = Number(s);
  return Number.isFinite(v) ? String(v) : s;
}

/**
 * The figures a text holds, kept in two sets.
 *
 *   whole  every number as written, whole: "1,234" is 1234 and never 1 or
 *          234, "12.5" is 12.5 and never 12 or 5.
 *   dates  the parts of the dates and times in it (2026-09-21T18:02 gives
 *          2026, 9, 21, 18, 2). They count only for a figure the answer
 *          itself writes as part of a date or a time ("21 September",
 *          "18:02"): a pack carries several dates, so every number from 1 to
 *          31 would otherwise pass as "present", which is exactly the range
 *          of this site's small counts.
 */
export interface Figures {
  whole: Set<string>;
  dates: Set<string>;
}

const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g;

export function figuresIn(...texts: string[]): Figures {
  const whole = new Set<string>();
  const dates = new Set<string>();
  for (const t of texts) {
    const rest = t.replace(ISO_DATE, (...m: (string | undefined)[]) => {
      for (const part of m.slice(1, 7)) if (typeof part === "string" && part) dates.add(norm(part));
      return " ";
    });
    for (const m of rest.matchAll(/\d+(?:[.,']\d+)*/g)) whole.add(norm(m[0]));
  }
  return { whole, dates };
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";

/** Where an answer writes a date or a time: the figures inside are checked against the dates' parts. */
const DATE_SPANS: RegExp[] = [
  /\b\d{4}-\d{1,2}-\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?/g,
  new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})\\.?(?:,?\\s+\\d{4})?`, "gi"),
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:,?\\s+\\d{4})?\\b`, "gi"),
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{4}\\b`, "gi"),
  /\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/g,
  /\b\d{1,2}:\d{2}\b/g,
  /\b(?:19|20)\d{2}\b/g,
];

function dateSpans(s: string): [number, number][] {
  const out: [number, number][] = [];
  for (const re of DATE_SPANS) for (const m of s.matchAll(re)) out.push([m.index, m.index + m[0].length]);
  return out;
}

/**
 * Figures in an answer that the data does not hold. A list's own numbering
 * ("1. ", "2) ") is not a figure. A figure written as part of a date or a
 * time may be any part of a date the data holds; any other figure must be
 * one of the data's whole figures. `clean` is the text with each stray
 * figure replaced by "[?]", for the last attempt.
 */
export function strayFigures(text: string, allowed: Figures): { stray: string[]; clean: string } {
  const stray = new Set<string>();
  const clean = text
    .split("\n")
    .map((line) => {
      const m = /^(\s*(?:\d{1,2}[.)]\s+)?)([\s\S]*)$/.exec(line)!;
      const raw = m[2] ?? "";
      const spans = dateSpans(raw);
      const body = raw.replace(NUM, (n: string, at: number) => {
        const v = norm(n);
        const inDate = spans.some(([a, b]) => at >= a && at < b);
        if (allowed.whole.has(v) || (inDate && allowed.dates.has(v))) return n;
        stray.add(n);
        return "[?]";
      });
      return (m[1] ?? "") + body;
    })
    .join("\n");
  return { stray: [...stray], clean };
}

/**
 * Names a new title or description brings in that the page does not say: a
 * capitalised word (a place, a client, a product) that is not the first word
 * of its sentence or clause and appears nowhere in the page's own words. A
 * small model reaches for a city or a sector to sound specific; on a live
 * page that is an invented fact.
 */
export function strayNames(text: string, own: string): string[] {
  const known = own.toLowerCase();
  const out = new Set<string>();
  for (const clause of text.split(/[.!?:;|—–]\s*|\s-\s/)) {
    const words = clause.trim().split(/\s+/).slice(1);
    for (const raw of words) {
      const w = raw.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "").replace(/['’]s$/u, "");
      if (w.length < 3 || !/^\p{Lu}/u.test(w)) continue;
      if (w === "Balkaris" || known.includes(w.toLowerCase())) continue;
      out.add(w);
    }
  }
  return [...out];
}

/** Plain text, whatever the model sent: no markup, no bold, no headings, no runaway blank lines. */
export function plain(text: string): string {
  return text
    .replace(/<[^>]{0,200}>/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[*•]\s+/gm, "- ")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ---------- checking an answer --------------------------------------------------------- */

/** A change the answer proposes, before it is a row. */
export interface NewProposal {
  kind: ProposalKind;
  address: string;
  before: ProposalRow["before"];
  after: ProposalRow["after"];
  why: string | null;
}

export interface Kept {
  text: string;
  opportunities?: Opportunity[];
  brief?: Brief;
  keywords?: KeywordJudgement[];
  serp?: SerpBrief;
  todos?: SuggestedTodo[];
  proposals: NewProposal[];
  /** What was refused or changed, said plainly. */
  flags: string[];
}

export type Checked = { ok: true; kept: Kept } | { ok: false; why: string };

const parse = (raw: string): unknown => {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch (e) {
    throw new Error(`the answer is not valid JSON (${(e instanceof Error ? e.message : String(e)).slice(0, 120)}). Send JSON only, nothing before or after it.`);
  }
};

const zodWhy = (e: z.ZodError): string => {
  const i = e.issues[0];
  return i ? `${i.path.length ? `"${i.path.join(".")}": ` : ""}${i.message}` : "it does not match the shape asked for";
};

const list = (xs: string[], most = 4): string => (xs.length <= most ? xs.join(", ") : `${xs.slice(0, most).join(", ")} and ${xs.length - most} more`);

/** The figure and name guards, handed to the page tasks' checks (sitekinds.ts). */
const GUARDS: Guards = {
  strayFigures: (text, own) => strayFigures(text, figuresIn(own)).stray,
  strayNames,
  parse,
  zodWhy,
  list,
};

/**
 * Check one answer. `final` is the second answer: then what can be kept is
 * kept and the rest named, instead of asking again.
 */
export function check(kind: TaskKind, question: string, pack: Pack, raw: string, final: boolean, liveTitles: Map<string, string | null>): Checked {
  const allowed = figuresIn(...pack.blocks.map((b) => b.text), question);
  const known = new Set(pack.known);
  if (isSiteTask(kind)) {
    try {
      const r = siteCheck(kind, pack, raw, final, GUARDS);
      if (!r.ok) return r;
      const k = r.kept;
      return {
        ok: true,
        kept: { text: k.text, proposals: k.proposals as NewProposal[], flags: k.flags, ...(k.keywords ? { keywords: k.keywords } : {}), ...(k.serp ? { serp: k.serp } : {}), ...(k.todos ? { todos: k.todos } : {}) },
      };
    } catch (e) {
      return { ok: false, why: e instanceof Error ? e.message : String(e) };
    }
  }

  try {
    switch (kind) {
      case "opportunities": {
        const got = Opportunities.safeParse(parse(raw));
        if (!got.success) return { ok: false, why: zodWhy(got.error) };
        const searchOn = pack.blocks.some((b) => b.name === "search" && b.state === "ok");
        const problems: string[] = [];
        const kept: Opportunity[] = [];
        const flags: string[] = [];
        for (const it of got.data.items) {
          const page = it.page && it.page !== "null" ? it.page : null;
          if (page && !known.has(page)) {
            problems.push(`"${page}" is not an address in the DATA`);
            continue;
          }
          if (it.from === "search-console" && !searchOn) {
            problems.push(`"${it.title}" says it comes from Search Console, which is not connected`);
            continue;
          }
          const s = strayFigures(`${it.title}\n${it.why}\n${it.action}`, allowed);
          if (s.stray.length) {
            if (!final) {
              problems.push(`"${it.title}" quotes ${list(s.stray)}, which the DATA does not hold`);
              continue;
            }
            flags.push(`Removed ${list(s.stray)} from "${it.title}": the data it was given does not hold ${s.stray.length === 1 ? "that figure" : "those figures"}.`);
            const [title, why, action] = s.clean.split("\n");
            kept.push({ title: title ?? it.title, why: why ?? it.why, page, action: action ?? it.action, from: it.from });
            continue;
          }
          kept.push({ title: it.title, why: it.why, page, action: it.action, from: it.from });
        }
        if (problems.length && !final) return { ok: false, why: problems.join("; ") };
        if (problems.length) flags.push(`Dropped ${problems.length} of the answer's opportunities: ${problems.join("; ")}.`);
        if (!kept.length) return { ok: false, why: "no opportunity survived the checks" };
        const text = [`${kept.length} ${kept.length === 1 ? "opportunity" : "opportunities"}, from the desk's own data:`, ...kept.map((o, i) => `${i + 1}. ${o.title}${o.page ? ` (${o.page})` : ""}. ${o.why} Next: ${o.action}`)].join("\n");
        return { ok: true, kept: { text, opportunities: kept, proposals: [], flags } };
      }

      case "metadata": {
        const got = Metadata.safeParse(parse(raw));
        if (!got.success) return { ok: false, why: zodWhy(got.error) };
        const targets = new Map((pack.meta ?? []).map((t) => [t.path, t]));
        const problems: string[] = [];
        const proposals: NewProposal[] = [];
        /* Titles are compared as the site shows them, the brand included: that is what a duplicate is in a search result. */
        const titles = new Map<string, string>();
        for (const [path, title] of liveTitles) if (title) titles.set(title.trim().toLowerCase(), path);
        const seen = new Set<string>();
        for (const e of got.data.pages) {
          const t = targets.get(e.path);
          if (!t) {
            problems.push(`"${e.path}" is not one of the pages given`);
            continue;
          }
          if (seen.has(e.path)) continue;
          seen.add(e.path);
          /* The site appends the brand itself: a model that wrote it anyway has it taken off, never doubled. */
          const title = ownTitle(e.title.replace(/\s+/g, " ").trim());
          const shown = shownTitle(title);
          const description = e.description.replace(/\s+/g, " ").trim();
          const ownText = [t.shown, t.description, t.h1, t.ogTitle, t.ogDescription, t.excerpt].filter(Boolean).join("\n");
          const own = figuresIn(ownText);
          const wrong: string[] = [];
          if (title.length < 10 || shown.length > TITLE_MOST) {
            wrong.push(`its title is ${title.length} characters; the title must be 10 to ${OWN_TITLE_MOST} characters`);
          }
          if (description.length < 70 || description.length > DESCRIPTION_MOST) wrong.push(`its description is ${description.length} characters; it must be 70 to ${DESCRIPTION_MOST}`);
          if (/[<>]/.test(title + description)) wrong.push("it contains < or >");
          if (/!/.test(title + description)) wrong.push("it uses an exclamation mark");
          const stray = [...strayFigures(title, own).stray, ...strayFigures(description, own).stray];
          if (stray.length) wrong.push(`it adds ${list(stray)}, which the page does not say`);
          const names = strayNames(`${title}. ${description}`, ownText);
          if (names.length) wrong.push(`it names ${list(names)}, which the page does not mention`);
          const twin = titles.get(shown.toLowerCase());
          if (twin && twin !== e.path) wrong.push(`its title is the same as ${twin}'s`);
          if (wrong.length) {
            problems.push(`${e.path}: ${wrong.join("; ")}`);
            continue;
          }
          titles.set(shown.toLowerCase(), e.path);
          const after: NewProposal["after"] = {};
          /* What the page shows now against what it would show: a title that would render the same is no change. */
          if (shown !== (t.shown ?? "")) after.title = title;
          if (description !== (t.description ?? "")) after.description = description;
          if (!Object.keys(after).length) continue;
          proposals.push({
            kind: "meta",
            address: e.path,
            /* Before is what the live page shows, the brand included, as the crawl read it. */
            before: { title: t.shown, description: t.description },
            after,
            why: t.findings.length ? t.findings.join(" ") : "A person asked for new metadata for this page.",
          });
        }
        const missing = [...targets.keys()].filter((p) => !seen.has(p));
        if (missing.length && !final) problems.push(`no entry for ${list(missing)}`);
        if (problems.length && !final) return { ok: false, why: problems.join("; ") };
        const flags = problems.length ? [`Not proposed: ${problems.join("; ")}.`] : [];
        if (missing.length && final) flags.push(`The answer had no entry for ${list(missing)}.`);
        if (!proposals.length) return { ok: false, why: problems.length ? `nothing could be proposed: ${problems.join("; ")}` : "every entry repeats what the page already says" };
        const text = `Proposed new metadata for ${proposals.length} ${proposals.length === 1 ? "page" : "pages"}: ${proposals.map((p) => p.address).join(", ")}. ${
          proposals.length === 1 ? "It waits" : "They wait"
        } for a person who can publish, under Actions & approvals. Nothing changes on the site until one is approved.`;
        return { ok: true, kept: { text, proposals, flags } };
      }

      case "redirect": {
        const got = Redirects.safeParse(parse(raw));
        if (!got.success) return { ok: false, why: zodWhy(got.error) };
        const targets = new Map((pack.redirects ?? []).map((t) => [t.from, t]));
        const problems: string[] = [];
        const proposals: NewProposal[] = [];
        const none: string[] = [];
        const seen = new Set<string>();
        for (const p of got.data.picks) {
          const t = targets.get(p.from);
          if (!t) {
            problems.push(`"${p.from}" is not one of the addresses given`);
            continue;
          }
          if (seen.has(p.from)) continue;
          seen.add(p.from);
          const to = p.to && p.to !== "null" ? p.to : null;
          if (to === null) {
            none.push(p.from);
            continue;
          }
          if (!t.candidates.some((c) => c.path === to)) {
            problems.push(`${p.from}: "${to}" is not one of its candidates`);
            continue;
          }
          if (!PLAIN.test(to) && to !== "/") {
            problems.push(`${p.from}: "${to}" is not a plain address`);
            continue;
          }
          proposals.push({ kind: "redirect", address: p.from, before: { to: null }, after: { to }, why: `${t.why}. ${p.why}`.slice(0, 400) });
        }
        if (problems.length && !final) return { ok: false, why: problems.join("; ") };
        const flags = problems.length ? [`Not proposed: ${problems.join("; ")}.`] : [];
        if (none.length) flags.push(`No fitting page for ${list(none)}: no redirect is proposed for ${none.length === 1 ? "it" : "them"}.`);
        if (!proposals.length && !none.length) return { ok: false, why: problems.join("; ") || "the answer held no picks" };
        const text = proposals.length
          ? `Proposed ${proposals.length} ${proposals.length === 1 ? "redirect" : "redirects"}: ${proposals.map((p) => `${p.address} → ${p.after.to}`).join("; ")}. ${
              proposals.length === 1 ? "It waits" : "They wait"
            } for a person who can publish, under Actions & approvals.${none.length ? ` No fitting page for ${list(none)}.` : ""}`
          : `No redirect proposed: none of the candidates is about the same thing as ${list(none)}.`;
        return { ok: true, kept: { text, proposals, flags } };
      }

      case "brief": {
        const got = BriefShape.safeParse(parse(raw));
        if (!got.success) return { ok: false, why: zodWhy(got.error) };
        const b = got.data;
        const problems: string[] = [];
        const flags: string[] = [];
        const links = b.links.filter((l) => {
          if (known.has(l.path)) return true;
          problems.push(`"${l.path}" is not an address in the DATA`);
          return false;
        });
        const body = [b.title, b.audience, b.question, ...b.outline, ...links.map((l) => l.why), b.notes].join("\n");
        const s = strayFigures(body, allowed);
        if (s.stray.length) problems.push(`it quotes ${list(s.stray)}, which the DATA does not hold`);
        if (problems.length && !final) return { ok: false, why: problems.join("; ") };
        let brief: Brief = { title: b.title, audience: b.audience, question: b.question, outline: b.outline, links, notes: b.notes };
        if (s.stray.length) {
          const fix = (x: string) => strayFigures(x, allowed).clean;
          brief = { title: fix(brief.title), audience: fix(brief.audience), question: fix(brief.question), outline: brief.outline.map(fix), links: brief.links.map((l) => ({ ...l, why: fix(l.why) })), notes: fix(brief.notes) };
          flags.push(`Removed ${list(s.stray)}: the data it was given does not hold ${s.stray.length === 1 ? "that figure" : "those figures"}.`);
        }
        if (problems.length && links.length < b.links.length) flags.push(`Dropped links to addresses the desk does not know.`);
        const text = [
          `Working title: ${brief.title}`,
          `For: ${brief.audience}`,
          `It answers: ${brief.question}`,
          "Outline:",
          ...brief.outline.map((o, i) => `${i + 1}. ${o}`),
          ...(brief.links.length ? ["Link to:", ...brief.links.map((l) => `- ${l.path}: ${l.why}`)] : []),
          ...(brief.notes ? [`Notes: ${brief.notes}`] : []),
        ].join("\n");
        return { ok: true, kept: { text, brief, proposals: [], flags } };
      }

      default: {
        const text = plain(raw);
        if (text.length < 2) return { ok: false, why: "the answer was empty" };
        const s = strayFigures(text, allowed);
        if (s.stray.length && !final) {
          return { ok: false, why: `it quotes ${list(s.stray, 8)}, which the DATA does not hold. Quote only figures that appear in the DATA, exactly as written.` };
        }
        if (s.stray.length) {
          return {
            ok: true,
            kept: { text: s.clean, proposals: [], flags: [`Removed ${list(s.stray, 8)} (shown as [?]): the data it was given does not hold ${s.stray.length === 1 ? "that figure" : "those figures"}.`] },
          };
        }
        return { ok: true, kept: { text, proposals: [], flags: [] } };
      }
    }
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
}
