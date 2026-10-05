import { z } from "zod";
import type { DeskJsonLdBlock, KeywordJudgement, SerpBrief, SuggestedTodo, TaskKind } from "../../../web/src/contract/operator.ts";
import { ownTitle, type Pack } from "./packs.ts";
import { blockProblem } from "./rules.ts";
import { SITE } from "./tables.ts";

/**
 * The page and search tasks the local model answers, and how each answer is
 * checked on the box: "og", "schema", "links", "alt", "keywords", "serp".
 *
 * The same discipline as kinds.ts: one job per prompt, rules before data,
 * strict JSON (Ollama constrains the answer to the schema), and nothing kept
 * that the data does not hold. A page task writes only from the page's own
 * words, and every figure and name it uses is held against those words. An
 * answer that fails is sent back once with the reason; on the last answer
 * what passes is kept and the rest is named.
 *
 * The helpers that check figures and names live in kinds.ts; they are passed
 * in (`guards`) so the two files do not import each other.
 */

export const SITE_TASKS = ["og", "schema", "links", "alt", "keywords", "serp"] as const;
export type SiteTask = (typeof SITE_TASKS)[number];
export const isSiteTask = (k: TaskKind): k is SiteTask => (SITE_TASKS as readonly string[]).includes(k);

export interface Guards {
  strayFigures: (text: string, own: string) => string[];
  strayNames: (text: string, own: string) => string[];
  parse: (raw: string) => unknown;
  zodWhy: (e: z.ZodError) => string;
  list: (xs: string[], most?: number) => string;
}

export interface SiteKept {
  text: string;
  proposals: { kind: "og" | "schema"; address: string; before: Record<string, unknown>; after: Record<string, unknown>; why: string | null }[];
  keywords?: KeywordJudgement[];
  serp?: SerpBrief;
  todos?: SuggestedTodo[];
  flags: string[];
}

export type SiteChecked = { ok: true; kept: SiteKept } | { ok: false; why: string };

const str = { type: "string" } as const;

const SCHEMA: Record<SiteTask, Record<string, unknown>> = {
  og: { type: "object", properties: { ogTitle: str, ogDescription: str }, required: ["ogTitle", "ogDescription"] },
  schema: {
    type: "object",
    properties: {
      questions: { type: "array", items: { type: "object", properties: { question: str, answer: str }, required: ["question", "answer"] } },
      name: str,
      description: str,
      serviceType: str,
    },
  },
  links: { type: "object", properties: { links: { type: "array", items: { type: "object", properties: { from: str, words: str, why: str }, required: ["from", "words", "why"] } } }, required: ["links"] },
  alt: { type: "object", properties: { alts: { type: "array", items: { type: "object", properties: { src: str, alt: str }, required: ["src", "alt"] } } }, required: ["alts"] },
  keywords: {
    type: "object",
    properties: {
      phrases: {
        type: "array",
        items: {
          type: "object",
          properties: {
            phrase: str,
            judgement: { type: "string", enum: ["relevant", "weak", "irrelevant"] },
            topic: str,
            newTopic: { type: "boolean" },
            intent: { type: "string", enum: ["informational", "commercial", "transactional", "navigational"] },
            why: str,
          },
          required: ["phrase", "judgement", "topic", "newTopic", "intent", "why"],
        },
      },
    },
    required: ["phrases"],
  },
  serp: {
    type: "object",
    properties: {
      theyHave: { type: "array", items: { type: "object", properties: { what: str, seenOn: { type: "array", items: str } }, required: ["what", "seenOn"] } },
      outline: { type: "array", items: str },
      notes: str,
    },
    required: ["theyHave", "outline", "notes"],
  },
};

const VOICE = "In the page's own language. Plain, confident and specific, in sentence case. No hype words, no exclamation marks, no emoji.";
const ONLY_PAGE = "Use only what the page's title, description, headings and text in the DATA say. Do not add numbers, prices, places, clients, awards or claims that are not there.";

export function sitePrompt(kind: SiteTask, pack: Pack, data: string): { prompt: string; schema: Record<string, unknown>; temperature: number } {
  let lines: string[];
  let temperature = 0.3;
  switch (kind) {
    case "og":
      temperature = 0.4;
      lines = [
        "TASK: Write the share card for the page in the DATA: the title and the short text LinkedIn, WhatsApp and X show when somebody shares the page.",
        '- "ogTitle": 20 to 70 characters. It may promise more than the search title, but it must not repeat it word for word. Never write Balkaris in it.',
        '- "ogDescription": 50 to 200 characters, one or two sentences on what a reader gets from the page. Not the same as the page\'s description.',
        `- ${ONLY_PAGE}`,
        `- ${VOICE}`,
        'Answer with JSON only: {"ogTitle":"...","ogDescription":"..."}',
      ];
      break;
    case "schema":
      temperature = 0.2;
      lines =
        pack.schemaType === "Service"
          ? [
              "TASK: Describe the service the page in the DATA offers, for a schema.org Service block.",
              '- "name": the service\'s name as the page says it, at most 80 characters.',
              '- "description": one or two sentences from the page\'s own text, at most 300 characters.',
              '- "serviceType": two to four words naming the kind of service, taken from the page.',
              `- ${ONLY_PAGE}`,
              'Answer with JSON only: {"name":"...","description":"...","serviceType":"..."}',
            ]
          : [
              "TASK: Write two to six questions a reader of the page in the DATA would ask, each with the answer the page itself gives.",
              '- "question": a real question, ending with "?", at most 120 characters.',
              '- "answer": one to three sentences, at most 300 characters, using the page\'s own words. Only questions the page answers; never one it does not.',
              `- ${ONLY_PAGE}`,
              'Answer with JSON only: {"questions":[{"question":"...","answer":"..."}]}',
            ];
      break;
    case "links":
      temperature = 0.2;
      lines = [
        "TASK: The TARGET page in the DATA needs links from other pages of the site. Choose up to five CANDIDATES that should link to it, and the words of each link.",
        '- "from": a candidate\'s path, written exactly as listed. Only a candidate whose subject really leads to the target.',
        '- "words": the link\'s words, two to seven words, saying what the target page is about. Not "click here", not "read more".',
        '- "why": one short sentence on why a reader of that page would follow the link.',
        "- Do not invent pages. If no candidate fits, answer with an empty list.",
        'Answer with JSON only: {"links":[{"from":"/...","words":"...","why":"..."}]}',
      ];
      break;
    case "alt":
      temperature = 0.3;
      lines = [
        "TASK: Write an alt text for each picture in the DATA that has none. You cannot see the pictures: only their file names and the page they are on.",
        '- "src": the picture exactly as listed.',
        '- "alt": 5 to 125 characters saying what the picture most likely shows, from its file name and the page\'s subject. Do not start with "image of" or "picture of".',
        "- If the file name says nothing about what it shows, describe its role on the page plainly instead (for example the page's subject).",
        `- ${ONLY_PAGE}`,
        'Answer with JSON only: {"alts":[{"src":"...","alt":"..."}]}, one entry for each picture.',
      ];
      break;
    case "keywords":
      temperature = 0.1;
      lines = [
        "TASK: Judge each search phrase in the DATA for THE AGENCY described there: would somebody typing it be a likely client?",
        '- "phrase": written exactly as listed.',
        '- "judgement": "relevant" (a likely client looking for what the agency offers), "weak" (related, but rarely a client) or "irrelevant".',
        '- "topic": the name of one of the TOPICS, written exactly as listed, that the phrase belongs to; or, when none fits, a short new topic name of one to four words with "newTopic": true.',
        '- "intent": "informational", "commercial", "transactional" or "navigational".',
        '- "why": one short sentence.',
        'Answer with JSON only: {"phrases":[{"phrase":"...","judgement":"...","topic":"...","newTopic":false,"intent":"...","why":"..."}]}, one entry for each phrase.',
      ];
      break;
    case "serp":
      temperature = 0.3;
      lines = [
        "TASK: Compare the FIRST RESULTS for the search in the DATA, and their pages as the desk read them, with OUR PAGE. Say what the first results have that our page lacks, as a brief for the studio's writers.",
        '- "theyHave": up to six points, each "what" (one sentence) and "seenOn" (the result addresses that show it, written exactly as listed).',
        '- "outline": three to seven lines: what to add or change on our page, most important first.',
        '- "notes": one or two sentences on what not to copy.',
        "- Quote figures only as the DATA writes them. Never invent what a page says.",
        'Answer with JSON only: {"theyHave":[{"what":"...","seenOn":["https://..."]}],"outline":["..."],"notes":"..."}',
      ];
      break;
  }
  return { prompt: [...lines, "", "DATA:", data].join("\n"), schema: SCHEMA[kind], temperature };
}

/* ---------- checks ----------------------------------------------------------------------- */

const OgShape = z.object({ ogTitle: z.string(), ogDescription: z.string() });
const FaqShape = z.object({ questions: z.array(z.object({ question: z.string().trim(), answer: z.string().trim() })).min(2, "give at least two questions").max(8) });
const ServiceShape = z.object({ name: z.string().trim().min(3).max(80), description: z.string().trim().min(20).max(300), serviceType: z.string().trim().min(3).max(60) });
const LinksShape = z.object({ links: z.array(z.object({ from: z.string().trim(), words: z.string().trim(), why: z.string().trim().max(240) })).max(8) });
const AltShape = z.object({ alts: z.array(z.object({ src: z.string().trim(), alt: z.string().trim() })).min(1, "give one entry per picture") });
const KwShape = z.object({
  phrases: z
    .array(
      z.object({
        phrase: z.string().trim(),
        judgement: z.enum(["relevant", "weak", "irrelevant"]),
        topic: z.string().trim(),
        newTopic: z.boolean(),
        intent: z.enum(["informational", "commercial", "transactional", "navigational"]),
        why: z.string().trim().max(240),
      }),
    )
    .min(1, "give one entry per phrase"),
});
const SerpShape = z.object({
  theyHave: z.array(z.object({ what: z.string().trim().min(5).max(300), seenOn: z.array(z.string().trim()).min(1, "each point names where it is seen") })).min(1, "name at least one thing they have").max(8),
  outline: z.array(z.string().trim().min(3).max(240)).min(2, "the outline needs at least two lines").max(8),
  notes: z.string().trim().max(500),
});

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();
const same = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && !!b && clean(a).toLowerCase() === clean(b).toLowerCase();

/** Words of three letters or more, lower case. */
const wordsOf = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3);

/** How much of an answer the page itself says: the share of its longer words found in the page's words. */
function support(text: string, own: string): number {
  const known = new Set(wordsOf(own));
  const ws = wordsOf(text);
  if (!ws.length) return 1;
  return ws.filter((w) => known.has(w) || known.has(w.replace(/s$/, ""))).length / ws.length;
}

/** The least share of an FAQ answer's words the page must say itself. */
const SUPPORT = 0.6;

export function siteCheck(kind: SiteTask, pack: Pack, raw: string, final: boolean, g: Guards): SiteChecked {
  const page = pack.page;
  const own = page?.own ?? "";
  const loose = (text: string, extra = ""): string[] => [...g.strayFigures(text, own + extra).map((f) => `the figure ${f}`), ...g.strayNames(text, own + extra).map((n) => `the name ${n}`)];

  switch (kind) {
    case "og": {
      if (!page) return { ok: false, why: "the task lost its page" };
      const got = OgShape.safeParse(g.parse(raw));
      if (!got.success) return { ok: false, why: g.zodWhy(got.error) };
      const ogTitle = ownTitle(clean(got.data.ogTitle));
      const ogDescription = clean(got.data.ogDescription);
      const wrong: string[] = [];
      if (ogTitle.length < 20 || ogTitle.length > 70) wrong.push(`the share title is ${ogTitle.length} characters; it must be 20 to 70`);
      if (ogDescription.length < 50 || ogDescription.length > 200) wrong.push(`the share description is ${ogDescription.length} characters; it must be 50 to 200`);
      if (same(ogTitle, page.title)) wrong.push("the share title repeats the page's title");
      if (same(ogDescription, page.description)) wrong.push("the share description repeats the page's description");
      if (/[!<>]/.test(ogTitle + ogDescription)) wrong.push("it uses !, < or >");
      const stray = loose(`${ogTitle}. ${ogDescription}`);
      if (stray.length) wrong.push(`it uses ${g.list(stray)}, which the page does not say`);
      if (wrong.length) return { ok: false, why: wrong.join("; ") };
      const after: Record<string, unknown> = {};
      if (!same(ogTitle, page.ogTitle)) after.ogTitle = ogTitle;
      if (!same(ogDescription, page.ogDescription)) after.ogDescription = ogDescription;
      if (!Object.keys(after).length) return { ok: false, why: "it repeats the share card the page already has" };
      return {
        ok: true,
        kept: {
          text: `Proposed a share card for ${page.path}: “${ogTitle}”, “${ogDescription}”. It waits for a person who can publish, under Actions & approvals.`,
          proposals: [{ kind: "og", address: page.path, before: { ogTitle: page.ogTitle, ogDescription: page.ogDescription }, after, why: "A share card written from what the page says." }],
          flags: [],
        },
      };
    }

    case "schema": {
      if (!page) return { ok: false, why: "the task lost its page" };
      const parsed = g.parse(raw);
      let block: DeskJsonLdBlock;
      const flags: string[] = [];
      if (pack.schemaType === "Service") {
        const got = ServiceShape.safeParse(parsed);
        if (!got.success) return { ok: false, why: g.zodWhy(got.error) };
        const s = got.data;
        const stray = loose(`${s.name}. ${s.description}. ${s.serviceType}`);
        if (stray.length) return { ok: false, why: `it uses ${g.list(stray)}, which the page does not say` };
        block = {
          "@context": "https://schema.org",
          "@type": "Service",
          name: clean(s.name),
          description: clean(s.description),
          serviceType: clean(s.serviceType),
          url: `${SITE}${page.path === "/" ? "" : page.path}`,
          provider: { "@id": `${SITE}/#organization` },
        };
      } else {
        const got = FaqShape.safeParse(parsed);
        if (!got.success) return { ok: false, why: g.zodWhy(got.error) };
        const problems: string[] = [];
        const kept: { q: string; a: string }[] = [];
        for (const { question, answer } of got.data.questions) {
          const q = clean(question);
          const a = clean(answer);
          if (!q.endsWith("?") || q.length > 120 || q.length < 8) {
            problems.push(`"${q.slice(0, 60)}" is not a question of 8 to 120 characters ending with "?"`);
            continue;
          }
          if (a.length < 20 || a.length > 300) {
            problems.push(`the answer to "${q.slice(0, 60)}" is ${a.length} characters; it must be 20 to 300`);
            continue;
          }
          const stray = loose(`${q} ${a}`);
          if (stray.length) {
            problems.push(`"${q.slice(0, 60)}" uses ${g.list(stray)}, which the page does not say`);
            continue;
          }
          if (support(a, own) < SUPPORT) {
            problems.push(`the answer to "${q.slice(0, 60)}" is not in the page's own words`);
            continue;
          }
          kept.push({ q, a });
        }
        if (problems.length && !final) return { ok: false, why: problems.join("; ") };
        if (kept.length < 2) return { ok: false, why: problems.length ? `fewer than two questions passed: ${problems.join("; ")}` : "give at least two questions" };
        if (problems.length) flags.push(`Left out ${problems.length} of the answer's questions: ${problems.join("; ")}.`);
        block = {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: kept.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })),
        };
      }
      const bad = blockProblem(block);
      if (bad) return { ok: false, why: bad };
      return {
        ok: true,
        kept: {
          text: `Proposed a ${block["@type"]} block for ${page.path}, from the page's own text. It waits for a person who can publish, under Actions & approvals.`,
          proposals: [{ kind: "schema", address: page.path, before: { schemaTypes: page.schemaTypes }, after: { jsonLd: block }, why: `${block["@type"]} drafted from the page's own text.` }],
          flags,
        },
      };
    }

    case "links": {
      if (!page) return { ok: false, why: "the task lost its page" };
      const got = LinksShape.safeParse(g.parse(raw));
      if (!got.success) return { ok: false, why: g.zodWhy(got.error) };
      const cands = new Map((pack.linkFrom ?? []).map((c) => [c.path, c]));
      const problems: string[] = [];
      const todos: SuggestedTodo[] = [];
      const seen = new Set<string>();
      for (const l of got.data.links) {
        const c = cands.get(l.from);
        if (!c) {
          problems.push(`"${l.from}" is not one of the candidates`);
          continue;
        }
        if (seen.has(l.from)) continue;
        const words = clean(l.words);
        const n = words.split(" ").length;
        if (n < 2 || n > 8 || words.length > 60 || /^(click here|read more|here|more)$/i.test(words)) {
          problems.push(`the words "${words}" for ${l.from} are not two to seven words that name the page`);
          continue;
        }
        const stray = loose(words, `\n${c.title ?? ""}`);
        if (stray.length) {
          problems.push(`the words for ${l.from} use ${g.list(stray)}, which neither page says`);
          continue;
        }
        seen.add(l.from);
        todos.push({ title: `Link ${l.from} to ${page.path}`, note: `In the text of ${l.from}, link the words “${words}” to ${page.path}. ${clean(l.why)}`.slice(0, 600), page: l.from });
      }
      if (problems.length && !final) return { ok: false, why: problems.join("; ") };
      const flags = problems.length ? [`Left out: ${problems.join("; ")}.`] : [];
      const text = todos.length
        ? `${todos.length} ${todos.length === 1 ? "page should" : "pages should"} link to ${page.path}:\n${todos.map((t) => `- ${t.note}`).join("\n")}\nThe desk cannot edit a page's text: these are to-dos for the website's code.`
        : `No candidate page fits as a link to ${page.path}.`;
      return { ok: true, kept: { text, proposals: [], todos, flags } };
    }

    case "alt": {
      if (!page) return { ok: false, why: "the task lost its page" };
      const got = AltShape.safeParse(g.parse(raw));
      if (!got.success) return { ok: false, why: g.zodWhy(got.error) };
      const srcs = new Set((pack.images ?? []).map((i) => i.src));
      const problems: string[] = [];
      const todos: SuggestedTodo[] = [];
      const seen = new Set<string>();
      for (const a of got.data.alts) {
        if (!srcs.has(a.src)) {
          problems.push(`"${a.src}" is not one of the pictures`);
          continue;
        }
        if (seen.has(a.src)) continue;
        const alt = clean(a.alt);
        if (alt.length < 5 || alt.length > 125 || /^(image|picture|photo) of\b/i.test(alt) || /[<>"]/.test(alt)) {
          problems.push(`the alt text for ${a.src} must be 5 to 125 characters, without quotes, and not start with "image of"`);
          continue;
        }
        const stray = loose(alt, `\n${a.src.replace(/[-_/.]+/g, " ")}`);
        if (stray.length) {
          problems.push(`the alt text for ${a.src} uses ${g.list(stray)}, which neither the page nor the file name says`);
          continue;
        }
        seen.add(a.src);
        todos.push({ title: `Alt text for ${a.src.split("/").pop()} on ${page.path}`, note: `On ${page.path}, give the picture ${a.src} the alt text “${alt}”. Written from its file name and the page; check it against the picture.`, page: page.path });
      }
      const missing = [...srcs].filter((s) => !seen.has(s));
      if ((problems.length || missing.length) && !final) return { ok: false, why: [...problems, ...(missing.length ? [`no entry for ${g.list(missing)}`] : [])].join("; ") };
      if (!todos.length) return { ok: false, why: problems.join("; ") || "no alt text passed the checks" };
      const flags = [...(problems.length ? [`Left out: ${problems.join("; ")}.`] : []), ...(missing.length ? [`No alt text for ${g.list(missing)}.`] : [])];
      const text = `Alt texts for ${todos.length} ${todos.length === 1 ? "picture" : "pictures"} on ${page.path}, written from file names and the page (the model cannot see pictures):\n${todos.map((t) => `- ${t.note.split(", give the picture ")[1] ?? t.note}`).join("\n")}\nThe desk cannot edit a page's code: these are to-dos for the website.`;
      return { ok: true, kept: { text, proposals: [], todos, flags } };
    }

    case "keywords": {
      const got = KwShape.safeParse(g.parse(raw));
      if (!got.success) return { ok: false, why: g.zodWhy(got.error) };
      const byPhrase = new Map((pack.phrases ?? []).map((p) => [clean(p.phrase).toLowerCase(), p]));
      const topics = new Map((pack.topics ?? []).map((t) => [t.toLowerCase(), t]));
      const problems: string[] = [];
      const out: KeywordJudgement[] = [];
      const seen = new Set<number>();
      for (const k of got.data.phrases) {
        const p = byPhrase.get(clean(k.phrase).toLowerCase());
        if (!p) {
          problems.push(`"${k.phrase}" is not one of the phrases given`);
          continue;
        }
        if (seen.has(p.id)) continue;
        let topic: string | null = clean(k.topic) || null;
        let fresh = k.newTopic;
        if (topic && topics.has(topic.toLowerCase())) {
          topic = topics.get(topic.toLowerCase())!;
          fresh = false;
        } else if (topic && !fresh) {
          problems.push(`"${k.phrase}": "${topic}" is not one of the topics; mark a new topic with "newTopic": true`);
          continue;
        } else if (topic && (topic.length > 40 || topic.split(" ").length > 5)) {
          problems.push(`"${k.phrase}": a new topic's name is one to four words`);
          continue;
        }
        seen.add(p.id);
        out.push({ id: p.id, phrase: p.phrase, judgement: k.judgement, topic, topicKey: topic && !fresh ? (pack.topicKeys?.[topic] ?? null) : null, newTopic: !!topic && fresh, intent: k.intent, why: clean(k.why) });
      }
      const missing = (pack.phrases ?? []).filter((p) => !seen.has(p.id)).map((p) => p.phrase);
      if ((problems.length || missing.length) && !final) return { ok: false, why: [...problems, ...(missing.length ? [`no entry for ${g.list(missing)}`] : [])].join("; ") };
      if (!out.length) return { ok: false, why: problems.join("; ") || "no judgement passed the checks" };
      const flags = [...(problems.length ? [`Left out: ${problems.join("; ")}.`] : []), ...(missing.length ? [`Not judged: ${g.list(missing)}.`] : [])];
      const count = (j: string) => out.filter((o) => o.judgement === j).length;
      const text = `Judged ${out.length} ${out.length === 1 ? "phrase" : "phrases"}: ${count("relevant")} relevant, ${count("weak")} weak, ${count("irrelevant")} irrelevant. Nothing changes on the Keywords screen until a person applies them.`;
      return { ok: true, kept: { text, proposals: [], keywords: out, flags } };
    }

    case "serp": {
      const s = pack.serp;
      if (!s) return { ok: false, why: "the task lost its result page" };
      const got = SerpShape.safeParse(g.parse(raw));
      if (!got.success) return { ok: false, why: g.zodWhy(got.error) };
      const urls = new Set(s.urls);
      const data = pack.blocks.map((b) => b.text).join("\n");
      const problems: string[] = [];
      const theyHave: SerpBrief["theyHave"] = [];
      for (const t of got.data.theyHave) {
        const seenOn = t.seenOn.filter((u) => urls.has(u));
        if (!seenOn.length) {
          problems.push(`"${t.what.slice(0, 60)}" names no result address from the DATA`);
          continue;
        }
        const stray = g.strayFigures(t.what, data);
        if (stray.length) {
          problems.push(`"${t.what.slice(0, 60)}" quotes ${g.list(stray)}, which the DATA does not hold`);
          continue;
        }
        theyHave.push({ what: clean(t.what), seenOn });
      }
      const outlineStray = g.strayFigures(got.data.outline.join("\n") + "\n" + got.data.notes, data);
      if (outlineStray.length) problems.push(`the outline quotes ${g.list(outlineStray)}, which the DATA does not hold`);
      if (problems.length && !final) return { ok: false, why: problems.join("; ") };
      if (!theyHave.length) return { ok: false, why: problems.join("; ") || "nothing they have was named" };
      const brief: SerpBrief = { phrase: s.phrase, checkId: s.checkId, checkedAt: s.checkedAt, page: page?.path ?? null, theyHave, outline: got.data.outline.map(clean), notes: clean(got.data.notes) };
      const flags = problems.length ? [`Left out: ${problems.join("; ")}.`] : [];
      const text = [
        `What the first results for “${s.phrase}” have${brief.page ? ` that ${brief.page} lacks` : ""}:`,
        ...theyHave.map((t) => `- ${t.what} (${t.seenOn.length} of the results)`),
        "What to do:",
        ...brief.outline.map((o, i) => `${i + 1}. ${o}`),
        ...(brief.notes ? [`Notes: ${brief.notes}`] : []),
      ].join("\n");
      return { ok: true, kept: { text, proposals: [], serp: brief, flags } };
    }
  }
}
