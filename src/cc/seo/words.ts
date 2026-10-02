/**
 * Words, the way the SEO engine compares a search phrase with a page.
 *
 * A phrase "is answered by" a page when every word of the phrase that says
 * what it is about appears in the page's title, its main heading or its
 * address, in the phrase's own language. Small words (and, für, the …) say
 * nothing and are left out; a place (Zürich, Switzerland …) is optional,
 * because a page about web design answers "web design zürich" whether or not
 * its title names the city (the audit names that as its own improvement).
 *
 * The rule is ours and it is simple on purpose: a person can check any
 * mapping by reading the title.
 */

const SMALL = new Set(
  (
    "a an and are as at be by for from how in is it of on or the to what with my your our me i can do does get best " +
    "der die das den dem des und für fuer mit von im in zu zum zur ein eine einen einem einer was wie ist sind auf aus bei " +
    "ich mein meine meinen meiner mich wir unser kann man lassen"
  ).split(" "),
);

/** Places: optional when matching, and what makes a phrase "local". */
export const PLACES = new Set(
  "zurich zuerich zrich schweiz switzerland swiss ch suisse bern basel luzern lucerne winterthur zug geneva genf geneve lausanne st gallen dietlikon wallisellen kloten aargau".split(" "),
);

/** Lower case, accents folded, split on anything that is not a letter or digit, small words dropped. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !SMALL.has(t));
}

/** "zürich" and "zuerich" and "zurich" are one place. */
const place = (t: string): boolean => PLACES.has(t) || PLACES.has(t.replace(/ue/g, "u"));

/** The same word, singular or plural, by the crudest rule that works for both languages here. */
const forms = (t: string): string[] => [t, t.endsWith("s") ? t.slice(0, -1) : `${t}s`, t.endsWith("en") ? t.slice(0, -2) : t, t.endsWith("e") ? t.slice(0, -1) : t];

/** Whether every word of the phrase that is not a place is among `have` (a page's words). */
export function answers(phrase: string, have: ReadonlySet<string>): boolean {
  const need = tokens(phrase).filter((t) => !place(t));
  if (!need.length) return false;
  return need.every((t) => forms(t).some((f) => have.has(f)));
}

/** A page's words: title, heading and the parts of its address. */
export function pageWords(p: { path: string; title: string | null; h1: string | null }): Set<string> {
  const all = tokens(`${p.title ?? ""} ${p.h1 ?? ""} ${p.path.replace(/[/-]+/g, " ")}`);
  const out = new Set<string>();
  for (const t of all) for (const f of forms(t)) out.add(f);
  return out;
}

const GERMAN = new Set(
  "und für fuer mit was wie kosten kostet preis preise agentur erstellen lassen schweiz zürich webseite firma unternehmen kunden mehr hochzeit werbung werbespot imagefilm fotograf videoproduktion gewinnen bekomme mandanten praxis arzt zahnarzt anwalt treuhand handwerker gastronomie sichtbarkeit suche finden gefunden optimieren entwickeln entwicklung beratung der die das ein eine einer meine mein ich wir".split(
    " ",
  ),
);
const ENGLISH = new Set("how to the for my get more clients customers cost costs much price agency company best website design development with what does in of near".split(" "));

/** de, en, or null when the phrase does not say. */
export function langOf(phrase: string): "de" | "en" | null {
  if (/[äöüß]/i.test(phrase)) return "de";
  const raw = phrase.toLowerCase().split(/[^a-zäöüß0-9]+/).filter(Boolean);
  let de = 0;
  let en = 0;
  for (const w of raw) {
    if (GERMAN.has(w)) de++;
    if (ENGLISH.has(w)) en++;
  }
  if (de > en) return "de";
  if (en > de) return "en";
  return null;
}

/** Flags a phrase carries by its words. */
export function flagsOf(phrase: string): { local: boolean; question: boolean; price: boolean } {
  const t = phrase.toLowerCase();
  return {
    local: tokens(phrase).some(place),
    question: /^(how|what|why|which|who|where|when|can|does|is|wie|was|warum|welche|wer|wo|wann|kann|lohnt)\b/.test(t) || t.includes("?"),
    price: /\b(kost|kosten|kostet|preis|preise|price|prices|pricing|cost|costs|how much|tarif|budget|chf)\b/.test(t),
  };
}

/** One phrase, one spelling: lower case, spaces collapsed, no surrounding punctuation. */
export function normal(phrase: string): string {
  return phrase.toLowerCase().replace(/\s+/g, " ").replace(/^[\s"'“”.,;:!?]+|[\s"'“”.,;:!?]+$/g, "").trim().slice(0, 200);
}
