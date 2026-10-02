import vm from "node:vm";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { JSDOM } from "jsdom";
import { parsePage, type Parsed } from "./parse.ts";

/**
 * Custom extraction: the owner's own questions, asked of every page.
 *
 * A rule names something to pull out of a page ("the price", "every
 * nofollow link", "the og:type") in one of three ways, and the crawl asks it
 * of every page in its scope (crawl.ts keeps the rules and the answers):
 *
 *   css     a CSS selector, run with querySelectorAll on the parsed page.
 *           Each match gives its text, or the attribute the rule names.
 *   regex   a regular expression, run on the HTML exactly as it was served
 *           (scripts included, so JSON in the page can be read). Each match
 *           gives the whole match, or the capture group the rule names (a
 *           number or a group name).
 *   xpath   a deliberately small part of XPath 1.0, evaluated with jsdom's
 *           own document.evaluate (see `xpathLite` for exactly what is
 *           accepted). Each match gives its text, or an attribute.
 *
 * WHAT IS KEPT per page and rule: the first `EXTRACT.matches` values, each
 * cut at `EXTRACT.chars` characters, how many matches there were in all
 * (counting stops at `EXTRACT.count`), and how long the rule took there.
 *
 * WHAT IS REFUSED when a rule is added, with the reason. First what can be
 * seen in the rule itself (`validateRule`, cheap, in the desk's thread): a
 * selector the parser rejects, an XPath outside the subset, a regular
 * expression that does not compile, uses back-references or nests unbounded
 * quantifiers ("(a+)+"). Then how long it takes (`trialRule`, in the
 * extraction thread, never the desk's own, under a deadline): a selector or
 * XPath that takes more than `EXTRACT.trialMs` on the desk's test page (see
 * `specimenHtml`: deeper than any page of the site, where a chain of
 * descendant selectors meets its worst case), a regular expression that
 * takes more than twice `EXTRACT.regexMs` on any test string built to make
 * a backtracking engine stall, or more than `EXTRACT.regexTrialMs` on all of
 * them together.
 *
 * AND WHATEVER SLIPS PAST THAT IS STILL BOUNDED WHERE IT RUNS. Every regular
 * expression runs in a `vm` context with a timeout of `EXTRACT.regexMs` per
 * page, on at most `EXTRACT.regexInput` characters of HTML. A selector or
 * XPath cannot be interrupted once jsdom runs it, so every page has a
 * deadline instead (`EXTRACT.pageMs`, wall clock from when the thread begins
 * it): past it the thread is ended, the rule that was running is named (the
 * thread says which rule it is starting before it starts it), the page is
 * read again without that rule, and the pages queued behind it go to a fresh
 * thread. The crawl then stops asking that rule for the rest of the crawl,
 * and switches it off when it overruns in two crawls running (crawl.ts).
 *
 * WHERE IT RUNS. In a thread of its own with a ceiling on its memory, like
 * parser.ts's, and in the same pass as parse.ts's facts: when any rule is
 * on, the crawl parses every page here instead (`parseWithRules`), so a page
 * is never parsed twice. The one-address audit (audit.ts) parses here too,
 * with no rules, under the same deadline. This file opens no database: the
 * thread loads it.
 */

export type ExtractKind = "css" | "regex" | "xpath";

/** What running a rule needs. crawl.ts keeps the rest (who added it, when, whether it is on). */
export interface ExtractRuleDef {
  id: number;
  kind: ExtractKind;
  /** The selector, the pattern ("price: (\d+)" or "/price: (\d+)/i"), or the XPath. */
  expression: string;
  /**
   * css and xpath: the attribute to read from each match instead of its
   * text (null: the text). regex: the capture group to keep ("1", "price";
   * null: the whole match).
   */
  attribute: string | null;
}

/** What one rule found on one page. */
export interface ExtractFound {
  rule: number;
  /** The first values, in document order. */
  matches: string[];
  /** Matches in all, up to EXTRACT.count. */
  count: number;
  /** Why the rule could not run on this page (a regular expression that ran out of time, a selector stopped at the page's deadline). */
  error?: string;
  /** Milliseconds the rule took on this page. Absent for a rule that was not run. */
  ms?: number;
}

export const EXTRACT = {
  /** Values kept per page and rule. */
  matches: 20,
  /** Characters kept per value. */
  chars: 300,
  /** Matches counted per page and rule, at most. */
  count: 10_000,
  /** Characters in an expression. */
  expression: 300,
  /** Milliseconds a regular expression may run on one page (and on the test strings when it is added). */
  regexMs: 50,
  /** Characters of HTML a regular expression is run on. */
  regexInput: 2_000_000,
  /** Rules on at once. */
  enabled: 20,
  /**
   * Milliseconds one page may take in the thread, wall clock from when the
   * thread begins it: the parse and every rule together. A page of the site
   * takes a few hundred.
   */
  pageMs: 10_000,
  /** Milliseconds a CSS selector or an XPath may take on the desk's test page to be kept. */
  trialMs: 250,
  /** Milliseconds a regular expression may take over all the test strings together to be kept. */
  regexTrialMs: 500,
  /** Wall clock for one rule's whole trial in the thread; past it the rule is refused and the thread ended. */
  trialWallMs: 3_000,
} as const;

const squash = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
const cut = (s: string): string => (s.length > EXTRACT.chars ? `${s.slice(0, EXTRACT.chars - 1)}…` : s);
const ATTRIBUTE = /^[A-Za-z_:][-A-Za-z0-9_:.]{0,59}$/;

/* ---------- regular expressions ----------------------------------------------- */

/** "/pattern/flags" or a bare pattern, as a pattern and flags. Only i, m, s and u may be asked for; g is always added. */
export function splitRegex(expression: string): { pattern: string; flags: string } | { reason: string } {
  const slashed = /^\/([\s\S]+)\/([a-z]*)$/.exec(expression);
  const pattern = slashed ? (slashed[1] as string) : expression;
  const flags = slashed ? (slashed[2] as string) : "";
  const bad = [...new Set(flags)].filter((f) => !"imsu".includes(f));
  if (bad.length) return { reason: `The flag${bad.length > 1 ? "s" : ""} ${bad.join(", ")} cannot be used; i, m, s and u can.` };
  return { pattern, flags: [...new Set(flags)].join("") };
}

/**
 * Unbounded quantifiers inside a group that is itself repeated: "(a+)+",
 * "(\w*\s?)*", "(x+y){2,}". The classic shape of a pattern whose matching
 * time doubles with every character. Returns the group, or null.
 */
function nestedQuantifier(pattern: string): string | null {
  /** The quantifier starting at `i`: *, +, {n}, {n,} or {n,m}; null when none does. */
  const quantifierAt = (i: number): string | null => /^(?:\*|\+|\{\d+(?:,\d*)?\})/.exec(pattern.slice(i))?.[0] ?? null;
  /** Whether a quantifier lets the length vary: *, +, {n,}, {n,m} with m above n. */
  const varies = (q: string): boolean => {
    if (q === "*" || q === "+") return true;
    const m = /^\{(\d+)(?:,(\d*))?\}$/.exec(q);
    if (!m || m[2] === undefined) return false;
    return m[2] === "" || Number(m[2]) > Number(m[1]);
  };
  /* For each open group: where it starts, and whether a varying quantifier stands inside it. */
  const open: { at: number; varies: boolean }[] = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") {
      inClass = true;
    } else if (c === "(") {
      open.push({ at: i, varies: false });
    } else if (c === ")") {
      const g = open.pop();
      if (!g) continue;
      /* The group itself repeated without bound, with a varying part inside. */
      const q = quantifierAt(i + 1);
      if (g.varies && q && (q === "*" || q === "+" || /^\{\d+,\}$/.test(q))) return pattern.slice(g.at, i + 1) + q;
      /* What varies inside a closed group still varies inside the groups around it. */
      if (g.varies) for (const outer of open) outer.varies = true;
    } else {
      const q = quantifierAt(i);
      if (q && varies(q)) for (const outer of open) outer.varies = true;
    }
  }
  return null;
}

let regexContext: vm.Context | null = null;
const REGEX_RUN = new vm.Script(`(() => {
  const re = new RegExp(P, F);
  const out = [];
  let n = 0;
  for (const m of S.matchAll(re)) {
    n++;
    if (out.length < M) {
      const v = G === null ? m[0] : /^\\d+$/.test(G) ? m[Number(G)] : (m.groups ? m.groups[G] : undefined);
      out.push(v === undefined ? "" : String(v));
    }
    if (n >= C) break;
  }
  return JSON.stringify({ out, n });
})()`);

/**
 * Run a regular expression on `input` with a time limit. Throws a sentence
 * when it runs out of time. The pattern is compiled inside the context, so
 * nothing it does can reach the desk's own objects.
 */
export function runRegex(pattern: string, flags: string, input: string, group: string | null, ms: number = EXTRACT.regexMs): { values: string[]; count: number } {
  regexContext ??= vm.createContext({});
  const ctx = regexContext as Record<string, unknown>;
  ctx.P = pattern;
  ctx.F = `${flags}g`;
  ctx.S = input.length > EXTRACT.regexInput ? input.slice(0, EXTRACT.regexInput) : input;
  ctx.G = group;
  ctx.M = EXTRACT.matches;
  ctx.C = EXTRACT.count;
  try {
    const said = JSON.parse(REGEX_RUN.runInContext(regexContext, { timeout: ms }) as string) as { out: string[]; n: number };
    return { values: said.out, count: said.n };
  } catch (e) {
    /* A context whose run was cut short is not used again. */
    regexContext = null;
    if ((e as { code?: string }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT") throw new Error(`the regular expression ran for more than ${ms} ms on this page and was stopped`);
    throw e;
  } finally {
    ctx.S = "";
  }
}

/** Strings built to make a backtracking engine stall on a bad pattern, from the pattern's own characters and the usual suspects. */
function trapStrings(pattern: string): string[] {
  const literal = [...new Set(pattern.replace(/\\[dDwWsSbB]/g, "").replace(/[\\^$.*+?()[\]{}|]/g, ""))].slice(0, 12);
  const seeds = [...new Set(["a", " ", "0", "<", "x", ...literal])];
  const out: string[] = [];
  for (const s of seeds) out.push(`${s.repeat(5000)}!`, `${s.repeat(5000)}\n`);
  out.push(`${"ab".repeat(2500)}!`, `${"<div> ".repeat(800)}!`, `${"a ".repeat(2500)}!`);
  return out;
}

/* ---------- XPath, a small part of it ------------------------------------------ */

const NAME = "[A-Za-z_][\\w.-]*";
const STR = `'[^']*'|"[^"]*"`;
const PREDICATE = new RegExp(
  `^\\[\\s*(?:\\d{1,3}|last\\(\\)|@${NAME}|@${NAME}\\s*=\\s*(?:${STR})|(?:contains|starts-with)\\(\\s*(?:@${NAME}|text\\(\\)|\\.)\\s*,\\s*(?:${STR})\\s*\\)|(?:text\\(\\)|\\.)\\s*=\\s*(?:${STR}))\\s*\\]`,
);

/**
 * The XPath the desk accepts, which is also the documentation of it:
 *
 *   an absolute path        starting with "/" (from the root) or "//"
 *                           (anywhere), its steps joined by "/" (a child)
 *                           or "//" (a descendant), at most 12 steps;
 *   a step                  an element name or "*", with up to three
 *                           predicates;
 *   a predicate             [3]  [last()]  [@rel]  [@rel='nofollow']
 *                           [contains(@class,'price')]
 *                           [starts-with(@href,'https:')]
 *                           [contains(text(),'CHF')]  [contains(.,'CHF')]
 *                           [text()='Price']  [.='Price'];
 *   the last step may be    @name    the attribute's value
 *                           text()   the element's own text nodes.
 *
 * Nothing else: no axes ("ancestor::", ".."), no other functions, no
 * "and"/"or", no unions, no paths inside predicates. That keeps every
 * expression a single pass over the page. Element and attribute names are
 * matched in lower case, as HTML stores them.
 */
export function xpathLite(expression: string): { ok: true; xpath: string; takes: "element" | "attribute" | "text" } | { ok: false; reason: string } {
  const x = expression.trim();
  if (!x.startsWith("/")) return { ok: false, reason: "An XPath here starts with / or //: the desk reads absolute paths only." };
  let rest = x;
  let out = "";
  let steps = 0;
  let takes: "element" | "attribute" | "text" = "element";
  while (rest.length) {
    const sep = rest.startsWith("//") ? "//" : rest.startsWith("/") ? "/" : null;
    if (!sep) return { ok: false, reason: `"${rest.slice(0, 30)}" is outside the XPath the desk reads: steps are joined by / or //.` };
    rest = rest.slice(sep.length);
    if (++steps > 12) return { ok: false, reason: "At most 12 steps." };
    const attr = new RegExp(`^@(${NAME})$`).exec(rest);
    if (attr) {
      out += `${sep}@${(attr[1] as string).toLowerCase()}`;
      takes = "attribute";
      break;
    }
    if (rest === "text()") {
      out += `${sep}text()`;
      takes = "text";
      break;
    }
    const step = new RegExp(`^(\\*|${NAME})`).exec(rest);
    if (!step) return { ok: false, reason: `"${rest.slice(0, 30)}" is outside the XPath the desk reads: a step is an element name or *, and only the last step may be @attribute or text().` };
    if (rest.slice(step[0].length).startsWith("::") || rest.slice(step[0].length).startsWith("(")) {
      return { ok: false, reason: `"${rest.slice(0, 30)}" is outside the XPath the desk reads: no axes and no functions but those inside predicates.` };
    }
    out += sep + (step[0] === "*" ? "*" : step[0].toLowerCase());
    rest = rest.slice(step[0].length);
    let preds = 0;
    while (rest.startsWith("[")) {
      const p = PREDICATE.exec(rest);
      if (!p) return { ok: false, reason: `The predicate "${rest.slice(0, 40)}" is outside the XPath the desk reads: [n], [last()], [@a], [@a='v'], [contains(@a|text()|.,'v')], [starts-with(…,'v')], [text()='v'].` };
      if (++preds > 3) return { ok: false, reason: "At most three predicates on a step." };
      out += p[0].replace(new RegExp(`@(${NAME})`, "g"), (_m, n: string) => `@${n.toLowerCase()}`);
      rest = rest.slice(p[0].length);
    }
  }
  if (!steps) return { ok: false, reason: "The XPath names no step." };
  return { ok: true, xpath: out, takes };
}

/* ---------- validating a rule ------------------------------------------------------ */

/** A rule as a person sends it. */
export interface ExtractRuleInput {
  name: string;
  kind: ExtractKind;
  expression: string;
  attribute?: string | null;
}

/**
 * Check a rule before it is kept, by what can be seen in it: cheap, and safe
 * in the desk's own thread (the one document it touches has three
 * elements). Returns the rule tidied (the XPath in the form it will run in),
 * or the reason it is refused. How long the rule takes is `trialRule`'s
 * question, asked in the extraction thread; a rule is kept only when both
 * say yes (crawl.ts `addExtractRule`).
 */
export function validateRule(input: ExtractRuleInput): { ok: true; rule: { name: string; kind: ExtractKind; expression: string; attribute: string | null } } | { ok: false; reason: string } {
  const name = squash(input.name);
  const expression = (input.expression ?? "").trim();
  const attribute = input.attribute === undefined || input.attribute === null || squash(input.attribute) === "" ? null : squash(input.attribute);
  if (!name || name.length > 80) return { ok: false, reason: "A rule needs a name of 1 to 80 characters." };
  if (!expression) return { ok: false, reason: "A rule needs an expression." };
  if (expression.length > EXTRACT.expression) return { ok: false, reason: `The expression is ${expression.length} characters; at most ${EXTRACT.expression}.` };

  if (input.kind === "regex") {
    const split = splitRegex(expression);
    if ("reason" in split) return { ok: false, reason: split.reason };
    try {
      new RegExp(split.pattern, `${split.flags}g`);
    } catch (e) {
      return { ok: false, reason: `The regular expression does not compile: ${(e instanceof Error ? e.message : String(e)).replace(/^Invalid regular expression: /, "")}.` };
    }
    if (/\\[1-9]|\\k</.test(split.pattern)) return { ok: false, reason: "Back-references (\\1, \\k<name>) are refused: they can make matching take exponential time." };
    const nested = nestedQuantifier(split.pattern);
    if (nested) return { ok: false, reason: `“${nested}” repeats a group that itself repeats: on a page that almost matches, the time it takes can double with every character (catastrophic backtracking). Write it without the nesting.` };
    if (attribute !== null) {
      if (/^\d+$/.test(attribute)) {
        const groups = new RegExp(`${split.pattern}|`, split.flags).exec("")?.length ?? 1;
        if (Number(attribute) >= groups) return { ok: false, reason: `The pattern has ${groups - 1} capture group${groups === 2 ? "" : "s"}; group ${attribute} does not exist.` };
      } else if (!/^[A-Za-z_$][\w$]*$/.test(attribute) || !split.pattern.includes(`(?<${attribute}>`)) {
        return { ok: false, reason: `The pattern has no group named “${attribute}”.` };
      }
    }
    /* Its time on the trap strings is tried in the thread (trialRule). */
    return { ok: true, rule: { name, kind: "regex", expression, attribute } };
  }

  if (attribute !== null && !ATTRIBUTE.test(attribute)) return { ok: false, reason: `“${attribute}” is not an attribute name.` };

  if (input.kind === "xpath") {
    const x = xpathLite(expression);
    if (!x.ok) return x;
    if (x.takes !== "element" && attribute !== null) return { ok: false, reason: "The XPath already ends in @attribute or text(); leave the attribute empty." };
    const dom = new JSDOM("<!doctype html><html><body><p>specimen</p></body></html>");
    try {
      dom.window.document.evaluate(x.xpath, dom.window.document, null, 7, null);
    } catch (e) {
      return { ok: false, reason: `The XPath does not evaluate: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}.` };
    } finally {
      dom.window.close();
    }
    return { ok: true, rule: { name, kind: "xpath", expression: x.xpath, attribute } };
  }

  if (input.kind === "css") {
    const dom = new JSDOM("<!doctype html><html><body><p>specimen</p></body></html>");
    try {
      dom.window.document.querySelectorAll(expression);
    } catch (e) {
      return { ok: false, reason: `The CSS selector is not valid: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}.` };
    } finally {
      dom.window.close();
    }
    return { ok: true, rule: { name, kind: "css", expression, attribute } };
  }

  return { ok: false, reason: "The kind is css, regex or xpath." };
}

/* ---------- running the rules on a page ------------------------------------------ */

/**
 * Run `rules` on a parsed page. `html` is the page as served (the regular
 * expressions read it). Never throws: a rule that fails says so in its own
 * answer. `before` is told each rule's id just before it starts: in the
 * thread that is how the desk knows which rule a page's deadline stopped.
 */
export function runRules(doc: Document, html: string, rules: readonly ExtractRuleDef[], before?: (rule: number) => void): ExtractFound[] {
  return rules.map((r) => {
    before?.(r.id);
    const t0 = performance.now();
    const took = (): number => Math.round(performance.now() - t0);
    try {
      if (r.kind === "regex") {
        const split = splitRegex(r.expression);
        if ("reason" in split) throw new Error(split.reason);
        const hit = runRegex(split.pattern, split.flags, html, r.attribute);
        return { rule: r.id, matches: hit.values.map((v) => cut(squash(v))), count: hit.count, ms: took() };
      }
      if (r.kind === "css") {
        const nodes = doc.querySelectorAll(r.expression);
        const matches: string[] = [];
        for (const el of nodes) {
          if (matches.length >= EXTRACT.matches) break;
          matches.push(cut(squash(r.attribute ? el.getAttribute(r.attribute) : el.textContent)));
        }
        return { rule: r.id, matches, count: Math.min(nodes.length, EXTRACT.count), ms: took() };
      }
      const x = xpathLite(r.expression);
      if (!x.ok) throw new Error(x.reason);
      const snap = doc.evaluate(x.xpath, doc, null, 7, null);
      const matches: string[] = [];
      for (let i = 0; i < snap.snapshotLength && matches.length < EXTRACT.matches; i++) {
        const n = snap.snapshotItem(i);
        if (!n) continue;
        const v = n.nodeType === 2 ? (n as Attr).value : n.nodeType === 3 ? n.nodeValue : r.attribute ? (n as Element).getAttribute(r.attribute) : n.textContent;
        matches.push(cut(squash(v)));
      }
      return { rule: r.id, matches, count: Math.min(snap.snapshotLength, EXTRACT.count), ms: took() };
    } catch (e) {
      return { rule: r.id, matches: [], count: 0, error: (e instanceof Error ? e.message : String(e)).slice(0, 200), ms: took() };
    }
  });
}

/* ---------- timing a rule before it is kept ------------------------------------- */

const SPECIMEN_LEVELS = 30;
const SPECIMEN_LEAVES = 40;
/** The test page in words, for a refusal. */
const SPECIMEN_SAYS = `${SPECIMEN_LEVELS} levels of nested elements, about 1,500 in all`;

/**
 * THE DESK'S TEST PAGE, on which a CSS selector or an XPath is timed before
 * it is kept: 30 levels of nested <div>s, each holding 40 of the things
 * pages are made of beside the next level (spans with a class and a data
 * attribute, links, some nofollow, paragraphs, list items, pictures):
 * about 1,500 elements, deeper than any page of the site. jsdom matches a
 * selector right to left, and when its leftmost part matches nothing it
 * tries every way of picking the ancestors in between: "x div div div div
 * span" costs, for every span, the ways of choosing four of its thirty
 * ancestors. That worst case is on this page. Made-up words only.
 */
export function specimenHtml(): string {
  let inner = "";
  for (let d = SPECIMEN_LEVELS - 1; d >= 0; d--) {
    const leaves = Array.from({ length: SPECIMEN_LEAVES }, (_, i) => {
      switch (i % 5) {
        case 0:
          return `<span class="s${i % 7}" data-n="${d}-${i}">specimen ${i}</span>`;
        case 1:
          return `<a href="/specimen-${d}-${i}"${i % 3 ? "" : ' rel="nofollow"'}>link ${i}</a>`;
        case 2:
          return `<p class="p${i % 4}">text ${i}</p>`;
        case 3:
          return `<ul><li>item ${i}</li></ul>`;
        default:
          return `<img src="/specimen-${i}.webp" alt="">`;
      }
    }).join("");
    inner = `<div class="level l${d}" id="level-${d}">${leaves}${inner}</div>`;
  }
  return `<!doctype html><html lang="en"><head><title>Specimen</title><meta property="og:type" content="specimen"></head><body><main>${inner}</main></body></html>`;
}

/** The test page, parsed once per thread and kept while the thread lives. */
let specimen: JSDOM | null = null;
const specimenDoc = (): Document => (specimen ??= new JSDOM(specimenHtml())).window.document;

/** A rule's trial: how long it took, or why it is refused. */
export type Trial = { ok: true; ms: number } | { ok: false; reason: string };

/** Why a rule was refused for its time: `ms` it took, or null when the trial's own deadline stopped it. */
const tooSlow = (kind: ExtractKind, ms: number | null): string =>
  `${ms === null ? `It ran for more than ${EXTRACT.trialWallMs / 1000} seconds on the desk's test page (${SPECIMEN_SAYS}) and was stopped` : `It took ${ms} ms on the desk's test page (${SPECIMEN_SAYS})`}; a rule may take ${EXTRACT.trialMs} ms there, and on every page of a crawl it would cost about as much. ${
    kind === "css"
      ? 'A chain of descendant selectors ("a b c d e") costs more with every link, most when its first part matches nothing: anchor it on a class or an id, use ">" for a direct child, or drop links.'
      : "Use fewer // steps, or anchor the path on an attribute."
  }`;

/** Time one rule here, in this thread. Called inside the extraction thread (and for a regular expression, in place when there is no thread). */
function trialHere(rule: { kind: ExtractKind; expression: string }): Trial {
  if (rule.kind === "regex") {
    const split = splitRegex(rule.expression);
    if ("reason" in split) return { ok: false, reason: split.reason };
    let total = 0;
    for (const trap of [...trapStrings(split.pattern), specimenHtml()]) {
      const t0 = performance.now();
      try {
        runRegex(split.pattern, split.flags, trap, null, EXTRACT.regexMs * 2);
      } catch {
        return { ok: false, reason: `It took more than ${EXTRACT.regexMs * 2} ms on a ${trap.length.toLocaleString("en-GB")}-character test string (“${trap.slice(0, 6).replace(/\n/g, "\\n")}…”); on a real page it could hang the crawl. Make its repetitions unambiguous.` };
      }
      total += performance.now() - t0;
      if (total > EXTRACT.regexTrialMs) {
        return { ok: false, reason: `It took more than ${EXTRACT.regexTrialMs} ms over the desk's test strings together (a few thousand characters each; a page can have two million): on real pages it would run out of its ${EXTRACT.regexMs} ms again and again. Make it more specific.` };
      }
    }
    return { ok: true, ms: Math.round(total) };
  }
  const doc = specimenDoc();
  const t0 = performance.now();
  if (rule.kind === "css") doc.querySelectorAll(rule.expression);
  else {
    const x = xpathLite(rule.expression);
    if (!x.ok) return { ok: false, reason: x.reason };
    doc.evaluate(x.xpath, doc, null, 7, null);
  }
  const ms = performance.now() - t0;
  if (ms > EXTRACT.trialMs) return { ok: false, reason: tooSlow(rule.kind, Math.round(ms)) };
  return { ok: true, ms: Math.round(ms) };
}

/* ---------- the thread ------------------------------------------------------------ */

/** What the thread says it is doing with a message, before it does it. */
type Stage = "parse" | "rule" | "trial";

interface PageAsk {
  kind: "page";
  html: string;
  url: string;
  host?: string;
  rules: ExtractRuleDef[];
}
interface TrialAsk {
  kind: "trial";
  rule: { kind: ExtractKind; expression: string };
}
type Ask = PageAsk | TrialAsk;
type Asked = Ask & { id: number };

/** From the thread: what it is starting (`stage`), or the answer. */
interface Reply {
  id: number;
  stage?: Stage;
  rule?: number;
  parsed?: Parsed;
  found?: ExtractFound[];
  trial?: Trial;
  error?: string;
}

/** One page, parsed, with what the rules found on it. */
export interface ParsedWithRules {
  parsed: Parsed;
  found: ExtractFound[];
  /** The rules that ran past the page's deadline and were stopped here (their `found` says so). Absent when none did. */
  overran?: number[];
}

/** A message ran past its deadline: the thread was ended. `rule` is the rule it had begun, when it was running one. */
export class Overran extends Error {
  constructor(
    readonly stage: Stage,
    readonly rule: number | null,
    readonly ms: number,
  ) {
    super(stage === "rule" && rule !== null ? `rule ${rule} ran for more than ${ms / 1000} seconds and was stopped` : `the ${stage === "trial" ? "trial" : "page"} took more than ${ms / 1000} seconds and was stopped`);
  }
}

function parseHere(m: PageAsk, say?: (stage: Stage, rule?: number) => void): { parsed: Parsed; found: ExtractFound[] } {
  let found: ExtractFound[] = [];
  const parsed = parsePage(m.html, m.url, {
    ...(m.host ? { host: m.host } : {}),
    visit: (doc) => {
      found = m.rules.length ? runRules(doc, m.html, m.rules, say ? (rule) => say("rule", rule) : undefined) : [];
      /* Closing the window is part of the page, not of the last rule. */
      if (m.rules.length) say?.("parse");
    },
  });
  return { parsed, found };
}

const ROLE = "cc-extract";

/* Inside the thread: one message is one page or one trial, handled one at a
   time. Before each step it says what it is starting, so the desk can name
   what a deadline stopped. */
if (!isMainThread && (workerData as { role?: string } | null)?.role === ROLE) {
  const port = parentPort;
  port?.on("message", (m: Asked) => {
    const say = (stage: Stage, rule?: number): void => port.postMessage({ id: m.id, stage, ...(rule === undefined ? {} : { rule }) });
    try {
      if (m.kind === "trial") {
        say("trial");
        port.postMessage({ id: m.id, trial: trialHere(m.rule) });
      } else {
        say("parse");
        port.postMessage({ id: m.id, ...parseHere(m, say) });
      }
    } catch (e) {
      port.postMessage({ id: m.id, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    }
  });
}

/* The same ceiling as parser.ts's thread, for the same reasons (see there). */
const LIMITS = { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 };
/** An idle thread is ended after this long, so an audit does not keep one alive. */
const IDLE_MS = 30_000;

interface Pending {
  ask: Ask;
  /** Its deadline, from when the thread begins it. */
  ms: number;
  thread: Worker | null;
  /** What the thread last said it is doing with it; null before it begins. */
  doing: { stage: Stage; rule: number | null } | null;
  timer: NodeJS.Timeout | null;
  resolve: (r: Reply) => void;
  reject: (e: Error) => void;
}

let current: Worker | null = null;
let inPlace = false;
let seq = 0;
let idle: NodeJS.Timeout | null = null;
const pending = new Map<number, Pending>();
const heldBy = (w: Worker): [number, Pending][] => [...pending].filter(([, p]) => p.thread === w).sort((a, b) => a[0] - b[0]);
const stopTimer = (p: Pending): void => {
  if (p.timer) clearTimeout(p.timer);
  p.timer = null;
};

function thread(): Worker {
  if (current) return current;
  let w: Worker;
  try {
    w = new Worker(new URL(import.meta.url), { workerData: { role: ROLE }, resourceLimits: LIMITS });
  } catch (e) {
    inPlace = true;
    console.warn(`cc extract: the thread could not be made (${e instanceof Error ? e.message : String(e)}); pages are parsed in the desk's own thread instead.`);
    throw new Error("in place");
  }
  let answered = false;
  w.on("message", (m: Reply) => {
    answered = true;
    const p = pending.get(m.id);
    /* A message from a thread that was ended, or about a page since sent elsewhere. */
    if (!p || p.thread !== w) return;
    if (m.stage) {
      p.doing = { stage: m.stage, rule: m.rule ?? null };
      /* The deadline runs from when the thread begins the message, not from when it was queued. */
      if (!p.timer) {
        p.timer = setTimeout(() => overran(m.id, w), p.ms);
        p.timer.unref();
      }
      return;
    }
    pending.delete(m.id);
    stopTimer(p);
    settle(w);
    if (m.error !== undefined) p.reject(new Error(m.error));
    else p.resolve(m);
  });
  w.on("error", (e) => {
    if (current === w) current = null;
    const held = heldBy(w);
    for (const [id, p] of held) {
      pending.delete(id);
      stopTimer(p);
    }
    const outOfMemory = (e as NodeJS.ErrnoException).code === "ERR_WORKER_OUT_OF_MEMORY";
    if (!answered && !outOfMemory) {
      inPlace = true;
      console.warn(`cc extract: the thread would not start (${e.message}); pages are parsed in the desk's own thread instead.`);
      for (const [, p] of held) p.reject(new Error("in place"));
      return;
    }
    const [first, ...rest] = held;
    first?.[1].reject(new Error(outOfMemory ? "the page is too large to parse inside the parser's memory ceiling" : `the parser stopped: ${e.message}`));
    for (const [id, p] of rest) resend(id, p);
  });
  w.on("exit", () => {
    if (current === w) current = null;
    for (const [id, p] of heldBy(w)) {
      pending.delete(id);
      stopTimer(p);
      p.reject(new Error("the parser stopped"));
    }
  });
  w.unref();
  current = w;
  return w;
}

/**
 * A message ran past its deadline. A selector cannot be interrupted, so the
 * thread is ended; what was queued behind the message goes to a fresh
 * thread, in order, and the message itself fails with `Overran`, naming the
 * rule the thread said it had begun.
 */
function overran(id: number, w: Worker): void {
  const p = pending.get(id);
  if (!p || p.thread !== w) return;
  pending.delete(id);
  p.timer = null;
  if (current === w) current = null;
  for (const [oid, q] of heldBy(w)) resend(oid, q);
  void w.terminate();
  p.reject(new Overran(p.doing?.stage ?? (p.ask.kind === "trial" ? "trial" : "parse"), p.doing?.rule ?? null, p.ms));
}

/** An idle thread lets the process go, and is ended after IDLE_MS. */
function settle(w: Worker): void {
  if (heldBy(w).length) return;
  w.unref();
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => {
    idle = null;
    if (current === w && !heldBy(w).length) void closeExtractor();
  }, IDLE_MS);
  idle.unref();
}

function send(id: number, p: Pending): void {
  const w = thread();
  if (idle) {
    clearTimeout(idle);
    idle = null;
  }
  stopTimer(p);
  p.thread = w;
  p.doing = null;
  pending.set(id, p);
  w.ref();
  w.postMessage({ id, ...p.ask });
}

/** Send again to the current thread (a fresh one when needed); a message that cannot be sent fails, never throws into a timer or an event. */
function resend(id: number, p: Pending): void {
  try {
    send(id, p);
  } catch (e) {
    pending.delete(id);
    p.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

/** One message to the thread, answered or failed. */
function ask(a: Ask, ms: number): Promise<Reply> {
  const id = ++seq;
  return new Promise<Reply>((resolve, reject) => {
    try {
      send(id, { ask: a, ms, thread: null, doing: null, timer: null, resolve, reject });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

async function parseOnce(a: PageAsk, ms: number): Promise<{ parsed: Parsed; found: ExtractFound[] }> {
  if (!inPlace) {
    try {
      const reply = await ask(a, ms);
      if (!reply.parsed) throw new Error("the parser gave no answer");
      return { parsed: reply.parsed, found: reply.found ?? [] };
    } catch (e) {
      if (!inPlace) throw e;
    }
  }
  /* No thread on this machine: parsed here, with no deadline (nothing can stop jsdom in the desk's own thread). */
  const done = parseHere(a);
  await new Promise((r) => setImmediate(r));
  return done;
}

/**
 * parse.ts's facts for one page, and what `rules` find on it, in one parse,
 * in the capped thread, within `ms` (EXTRACT.pageMs) from when the thread
 * begins it. `host`: the page belongs to another site (audit.ts).
 *
 * A rule that runs past the deadline is stopped, its answer says so, and
 * the page is read again without it (`overran` names it); at most once per
 * rule, so a page costs at most (rules + 1) deadlines. A page whose parse
 * itself runs past the deadline fails with the reason.
 */
export async function parseWithRules(html: string, url: string, rules: readonly ExtractRuleDef[], host?: string, ms: number = EXTRACT.pageMs): Promise<ParsedWithRules> {
  let left = [...rules];
  const stopped: ExtractFound[] = [];
  for (;;) {
    let r: { parsed: Parsed; found: ExtractFound[] };
    try {
      r = await parseOnce({ kind: "page", html, url, rules: left, ...(host ? { host } : {}) }, ms);
    } catch (e) {
      const rule = e instanceof Overran && e.stage === "rule" ? e.rule : null;
      if (rule !== null && left.some((x) => x.id === rule)) {
        stopped.push({ rule, matches: [], count: 0, error: `ran for more than ${ms / 1000} seconds on this page and was stopped`, ms });
        left = left.filter((x) => x.id !== rule);
        continue;
      }
      if (e instanceof Overran) throw new Error(`the page took more than ${ms / 1000} seconds to read and was stopped`);
      throw e;
    }
    return { parsed: r.parsed, found: [...r.found, ...stopped], ...(stopped.length ? { overran: stopped.map((s) => s.rule) } : {}) };
  }
}

/**
 * Time a rule before it is kept, in the extraction thread (never the
 * desk's own), within EXTRACT.trialWallMs: a selector or XPath on the
 * desk's test page (`specimenHtml`), a regular expression on the trap
 * strings and the test page. Run `validateRule` first; this assumes a rule
 * that passed it.
 */
export async function trialRule(rule: { kind: ExtractKind; expression: string }): Promise<Trial> {
  const wall = EXTRACT.trialWallMs;
  if (!inPlace) {
    try {
      const reply = await ask({ kind: "trial", rule: { kind: rule.kind, expression: rule.expression } }, wall);
      return reply.trial ?? { ok: false, reason: "It could not be tried: the extraction thread gave no answer." };
    } catch (e) {
      if (e instanceof Overran) return { ok: false, reason: tooSlow(rule.kind, null) };
      if (!inPlace) return { ok: false, reason: `It could not be tried on the desk's test page: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}.` };
    }
  }
  /* No thread on this machine. A regular expression is bounded by its own
     time limit and is tried here; a selector cannot be stopped once it runs,
     so it is not kept. */
  if (rule.kind === "regex") return trialHere(rule);
  return { ok: false, reason: "The extraction thread cannot be started on this machine, so a selector cannot be timed without risk to the desk; it was not kept." };
}

/**
 * End the thread and give its memory back. The next `parseWithRules` starts
 * a new one. A thread still holding a page (an audit asked while a crawl
 * ended) is left to finish it and is ended when idle (IDLE_MS).
 */
export async function closeExtractor(): Promise<void> {
  const w = current;
  if (w && heldBy(w).length) return;
  if (idle) {
    clearTimeout(idle);
    idle = null;
  }
  current = null;
  if (w) await w.terminate();
}
