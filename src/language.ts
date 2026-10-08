/**
 * Is it in English?
 *
 * Fini, 8 October 2026: the journal is written from English sources only. A
 * link in another language is refused when it is shared, before anything is
 * queued, so the workstation never starts on it. Two telegraf.rs links in
 * Serbian had come in from the desk that day; one was published as an English
 * article about something it did not say.
 *
 * WHY NOT A MODEL CALL. The answer is needed the moment the link is shared, on
 * the server, and the local models live on the studio workstation, which may be
 * asleep. Counting the commonest little words of each language decides this
 * reliably for any text of a few dozen words, costs nothing and never waits.
 * A video's language is told by the workstation's own model instead: Whisper
 * names the language it heard (social/pipeline.ts).
 */

const WORDS: Record<string, { name: string; words: string[] }> = {
  en: { name: "English", words: ["the", "and", "of", "to", "in", "is", "that", "for", "it", "with", "as", "on", "are", "this", "be", "by", "was", "from", "or", "have", "an", "they", "which", "you", "not", "but", "at", "we", "their", "has", "can", "will", "more", "its", "what", "about", "how", "when", "than", "would"] },
  de: { name: "German", words: ["der", "die", "und", "das", "ist", "nicht", "ein", "eine", "zu", "den", "mit", "von", "sich", "auf", "für", "auch", "dem", "es", "im", "wie", "oder", "sie", "wir", "aber", "werden", "bei", "nach", "noch", "kann", "einen"] },
  fr: { name: "French", words: ["le", "la", "les", "et", "des", "est", "une", "un", "du", "que", "pour", "dans", "en", "qui", "pas", "sur", "au", "avec", "ce", "plus", "par", "sont", "mais", "nous", "vous", "aux", "cette", "ou", "leur", "être"] },
  it: { name: "Italian", words: ["il", "la", "di", "che", "e", "è", "per", "un", "una", "non", "in", "con", "del", "della", "le", "gli", "si", "sono", "al", "da", "come", "più", "ma", "anche", "questo", "nel", "dei", "alla", "ha", "essere"] },
  es: { name: "Spanish", words: ["el", "la", "de", "que", "y", "los", "las", "en", "un", "una", "por", "con", "para", "es", "del", "se", "no", "al", "lo", "como", "más", "pero", "sus", "su", "este", "esta", "son", "también", "fue", "ha"] },
  pt: { name: "Portuguese", words: ["o", "a", "os", "as", "de", "que", "e", "do", "da", "em", "um", "uma", "para", "com", "não", "por", "mais", "dos", "das", "se", "na", "no", "como", "mas", "foi", "ao", "ele", "isso", "são", "também"] },
  nl: { name: "Dutch", words: ["de", "het", "een", "en", "van", "is", "dat", "op", "te", "in", "zijn", "voor", "met", "niet", "aan", "er", "ook", "als", "maar", "om", "bij", "worden", "door", "wordt", "deze", "naar", "dan", "nog", "kan", "wij"] },
  sr: { name: "Serbian, Croatian or Bosnian", words: ["je", "i", "u", "na", "se", "da", "za", "su", "od", "sa", "koji", "što", "šta", "kao", "ali", "ili", "nije", "će", "biti", "iz", "o", "to", "ova", "ovo", "koja", "koje", "kako", "bi", "smo", "ste", "godine", "više", "samo", "kada", "već"] },
  pl: { name: "Polish", words: ["i", "w", "na", "nie", "się", "z", "do", "to", "że", "jest", "o", "jak", "ale", "po", "co", "tak", "za", "od", "przez", "są", "dla", "jego", "tym", "może", "tylko"] },
};

const CYRILLIC = /[Ѐ-ӿ]/g;
const LATIN = /[a-zA-ZÀ-ž]/g;

export interface Language {
  /** "en", one of the codes above, "cyrillic" for a Cyrillic script, or null when the text is too short to tell. */
  code: string | null;
  /** The language's name, for a sentence. */
  name: string;
  english: boolean;
}

/** The language a text is in, by its commonest words. Under about 25 words it does not guess, and lets the text through. */
export function languageOf(text: string): Language {
  const cyr = (text.match(CYRILLIC) ?? []).length;
  const lat = (text.match(LATIN) ?? []).length;
  if (cyr > 40 && cyr > lat) return { code: "cyrillic", name: "a Cyrillic-script language (Serbian, Russian, Bulgarian…)", english: false };

  const words = text.toLowerCase().match(/[a-zà-žß]+/g) ?? [];
  if (words.length < 25) return { code: null, name: "too short to tell", english: true };

  const sample = words.slice(0, 1500);
  let best = "en";
  let bestScore = -1;
  const score: Record<string, number> = {};
  for (const [code, { words: common }] of Object.entries(WORDS)) {
    const set = new Set(common);
    score[code] = sample.filter((w) => set.has(w)).length / sample.length;
    if (score[code] > bestScore) {
      best = code;
      bestScore = score[code];
    }
  }
  /* English wins unless another language clearly beats it: a quoted German
     sentence in an English article must not turn the article away. */
  const english = best === "en" || score.en >= bestScore * 0.8;
  return english ? { code: "en", name: "English", english: true } : { code: best, name: WORDS[best].name, english: false };
}

/** Whisper's language code for a video, as a Language. Unknown or missing counts as English: the writer's own checks follow. */
export function spokenLanguage(code: string | null | undefined): Language {
  const c = (code ?? "").toLowerCase();
  if (!c || c === "en" || c === "english") return { code: "en", name: "English", english: true };
  const known: Record<string, string> = { de: "German", fr: "French", it: "Italian", es: "Spanish", pt: "Portuguese", nl: "Dutch", sr: "Serbian", hr: "Croatian", bs: "Bosnian", pl: "Polish", ru: "Russian", tr: "Turkish", ar: "Arabic", zh: "Chinese", ja: "Japanese", ko: "Korean", hi: "Hindi" };
  return { code: c, name: known[c] ?? c, english: false };
}

/** The sentence a person sees when a link is refused for its language. */
export const notEnglish = (lang: Language): string =>
  `it is in ${lang.name}, not English. The Balkaris journal is written from English sources only, so nothing was started`;
