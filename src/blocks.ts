/**
 * The shape of an article, and the schema that forces a model into it.
 *
 * Fini, 23 September 2026: *"I need this pages to be formatted properly —
 * can we hard code the format?"* Yes, and this is where.
 *
 * THE ANSWER IS THAT THE MODEL NEVER FORMATS ANYTHING. It emits labelled
 * blocks — a paragraph, a list, a pulled line, a set of steps — and the
 * website decides how each one looks, as it already does for every
 * hand-written article (content/types.ts `PostBlock`,
 * components/blocks/journal.tsx). No markdown is generated and parsed, no
 * HTML is produced, no CSS is invented per piece. An article written by the
 * desk today is still typeset correctly the next time the journal is
 * redesigned, because it was never carrying its own design.
 *
 * Two things make that hold:
 *
 *   1. Ollama's `format` takes a JSON Schema and CONSTRAINS GENERATION to it.
 *      A block that is not in the schema cannot come out of the model — not
 *      "is unlikely to", cannot.
 *   2. Each beat of each template says which kinds it allows (templates.ts).
 *      "What we would do" may use steps; the opening may not use anything but
 *      paragraphs. So every article of a given shape is laid out the same way,
 *      which is what makes thirty of them read as a journal.
 *
 * The wire shape is flat and discriminated — `{kind, ...}` — because a small
 * model satisfies that reliably and satisfies a union of differently-shaped
 * objects badly. `toPostBlocks` turns it into the site's own union, which is
 * the only shape that ever leaves this repo.
 */

/** The site's own union, copied. `npm run check:catalogue` guards the drift. */
export type PostBlock =
  | string
  | { h: string }
  | { list: string[]; ordered?: boolean }
  | { quote: string; who?: string; role?: string }
  | { note: string }
  | { code: string; lang?: string }
  | { steps: { term: string; text: string }[] }
  | { table: { head: string[]; rows: string[][] } };

/** What a beat may use. `p` is always allowed and never has to be listed. */
export type BlockKind = "p" | "list" | "steps" | "note" | "quote" | "table";

interface WireP { kind: "p"; text: string }
interface WireList { kind: "list"; items: string[]; ordered?: boolean }
interface WireSteps { kind: "steps"; steps: { term: string; text: string }[] }
interface WireNote { kind: "note"; text: string }
interface WireQuote { kind: "quote"; text: string; who?: string }
interface WireTable { kind: "table"; head: string[]; rows: string[][] }

export type WireBlock = WireP | WireList | WireSteps | WireNote | WireQuote | WireTable;

/**
 * The schema for one beat.
 *
 * Every property of every allowed kind lives on one flat object, because a
 * schema with `oneOf` makes a 26b model produce the union's first branch
 * whatever it was asked for. `kind` is an enum, which IS enforced, and
 * `validate` below rejects a block missing the fields its kind needs.
 */
export function schemaFor(allow: BlockKind[]): Record<string, unknown> {
  const kinds = Array.from(new Set<BlockKind>(["p", ...allow]));

  const props: Record<string, unknown> = {
    kind: { type: "string", enum: kinds },
    text: { type: "string" },
  };
  if (kinds.includes("list")) {
    props.items = { type: "array", items: { type: "string" } };
    props.ordered = { type: "boolean" };
  }
  if (kinds.includes("steps")) {
    props.steps = {
      type: "array",
      items: {
        type: "object",
        properties: { term: { type: "string" }, text: { type: "string" } },
        required: ["term", "text"],
      },
    };
  }
  if (kinds.includes("quote")) props.who = { type: "string" };
  if (kinds.includes("table")) {
    props.head = { type: "array", items: { type: "string" } };
    props.rows = { type: "array", items: { type: "array", items: { type: "string" } } };
  }

  return {
    type: "object",
    properties: {
      blocks: {
        type: "array",
        items: { type: "object", properties: props, required: ["kind"] },
      },
    },
    required: ["blocks"],
  };
}

/** How each kind is described to the model. Only the allowed ones are shown. */
const HOW: Record<BlockKind, string> = {
  p: `{"kind":"p","text":"one paragraph"}`,
  list: `{"kind":"list","items":["one line","another"],"ordered":false} — for parallel items only, never for prose broken up`,
  steps: `{"kind":"steps","steps":[{"term":"Audit the crawl","text":"one sentence on what it means"}]} — a named thing and what it is`,
  note: `{"kind":"note","text":"an aside the reader can skip"}`,
  quote: `{"kind":"quote","text":"a line worth pulling out","who":"who said it, only if the source names them"}`,
  table: `{"kind":"table","head":["Column","Column"],"rows":[["cell","cell"]]}`,
};

export function howTo(allow: BlockKind[]): string {
  const kinds = Array.from(new Set<BlockKind>(["p", ...allow]));
  return kinds.map((k) => `  ${HOW[k]}`).join("\n");
}

/**
 * Wire blocks to the site's union, with every shape checked.
 *
 * A block whose kind promises fields it did not send is dropped rather than
 * repaired: a list with no items is not a list, and a half-built one in an
 * article is worse than a paragraph. The count of what was dropped comes back
 * so the runner can say so rather than shipping a quietly thinner piece.
 */
export function toPostBlocks(
  wire: unknown,
  allow: BlockKind[],
): { blocks: PostBlock[]; dropped: string[] } {
  const raw = (wire as { blocks?: unknown })?.blocks;
  if (!Array.isArray(raw)) throw new Error(`answer with {"blocks":[…]}`);

  const ok = new Set<BlockKind>(["p", ...allow]);
  const blocks: PostBlock[] = [];
  const dropped: string[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  for (const b of raw as Record<string, unknown>[]) {
    const kind = str(b?.kind) as BlockKind;
    if (!ok.has(kind)) {
      dropped.push(`${kind || "(no kind)"}: not allowed in this section`);
      continue;
    }

    if (kind === "p") {
      const text = str(b.text);
      if (text) blocks.push(text);
      else dropped.push("p: empty");
      continue;
    }

    if (kind === "list") {
      const items = Array.isArray(b.items) ? b.items.map(str).filter(Boolean) : [];
      if (items.length >= 2) blocks.push({ list: items, ...(b.ordered === true ? { ordered: true } : {}) });
      else dropped.push(`list: ${items.length} item(s), needs at least two`);
      continue;
    }

    if (kind === "steps") {
      const steps = Array.isArray(b.steps)
        ? (b.steps as Record<string, unknown>[])
            .map((s) => ({ term: str(s?.term), text: str(s?.text) }))
            .filter((s) => s.term && s.text)
        : [];
      if (steps.length >= 2) blocks.push({ steps });
      else dropped.push(`steps: ${steps.length} complete step(s), needs at least two`);
      continue;
    }

    if (kind === "note") {
      const text = str(b.text);
      if (text) blocks.push({ note: text });
      else dropped.push("note: empty");
      continue;
    }

    if (kind === "quote") {
      const text = str(b.text);
      const who = str(b.who);
      if (text) blocks.push({ quote: text, ...(who ? { who } : {}) });
      else dropped.push("quote: empty");
      continue;
    }

    if (kind === "table") {
      const head = Array.isArray(b.head) ? b.head.map(str) : [];
      const rows = Array.isArray(b.rows)
        ? (b.rows as unknown[][]).map((r) => (Array.isArray(r) ? r.map(str) : [])).filter((r) => r.length)
        : [];
      /* A table whose rows do not match its header is not a table. */
      if (head.length >= 2 && rows.length && rows.every((r) => r.length === head.length)) {
        blocks.push({ table: { head, rows } });
      } else {
        dropped.push(`table: ${head.length} columns, ${rows.length} rows — ragged or empty`);
      }
      continue;
    }
  }

  return { blocks: mend(blocks), dropped };
}

/**
 * A sentence cut in two is one paragraph.
 *
 * The first long read off this pipeline (2 October 2026) came back with
 * "…When you prioritise volume over depth, you create" as one paragraph and
 * "commodity content that AI models can easily bypass…" as the next: the
 * model had closed a block in the middle of a sentence. The longer a section
 * is allowed to be, the more often it happens, and nothing downstream could
 * know — two strings are two paragraphs.
 *
 * So a paragraph that does not end the way a sentence ends is joined to the
 * paragraph after it. A colon counts as an ending, because a paragraph that
 * introduces the list below it is the one legitimate way to stop there.
 */
function mend(blocks: PostBlock[]): PostBlock[] {
  const out: PostBlock[] = [];
  for (const b of blocks) {
    const before = out.at(-1);
    if (typeof b === "string" && typeof before === "string" && !/[.!?:…"”’)\]]$/.test(before.trimEnd())) {
      out[out.length - 1] = `${before.trimEnd()} ${b.trimStart()}`;
    } else {
      out.push(b);
    }
  }
  return out;
}

/** The words in a run of blocks, for the budgets the beats are held to. */
export function countWords(blocks: PostBlock[]): number {
  let text = "";
  for (const b of blocks) {
    if (typeof b === "string") text += ` ${b}`;
    else if ("list" in b) text += ` ${b.list.join(" ")}`;
    else if ("steps" in b) text += ` ${b.steps.map((s) => `${s.term} ${s.text}`).join(" ")}`;
    else if ("note" in b) text += ` ${b.note}`;
    else if ("quote" in b) text += ` ${b.quote}`;
    else if ("table" in b) text += ` ${b.table.head.join(" ")} ${b.table.rows.flat().join(" ")}`;
  }
  return text.split(/\s+/).filter(Boolean).length;
}

/** Just the prose, for the plagiarism guard and the reading time. */
export function proseOf(blocks: PostBlock[]): string {
  return blocks
    .map((b) => {
      if (typeof b === "string") return b;
      if ("list" in b) return b.list.join(" ");
      if ("steps" in b) return b.steps.map((s) => `${s.term}. ${s.text}`).join(" ");
      if ("note" in b) return b.note;
      if ("quote" in b) return b.quote;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}
