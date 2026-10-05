import { db } from "../../../db.ts";
import { clusters } from "../keywords.ts";
import { langOf, normal, pageWords, PLACES, tokens } from "../words.ts";

/**
 * Which cluster a phrase belongs to, by the desk's own rule: the same rule
 * the Competitors page states for a search (src/cc/routes/seo/competitors.ts,
 * `filer`), here so the web layer files research and result pages the same
 * way without importing a page's route.
 *
 *   A phrase the keyword table files under a cluster keeps that cluster
 *   ("table"). Any other is filed under the cluster of its own language whose
 *   examples or relevant phrases share the most of its words, places and
 *   small words aside, when that is at least two words and at least half of
 *   them ("words"); a phrase two clusters fit equally, or none fits, stays
 *   unfiled.
 */

export interface Filed {
  key: string;
  name: string;
  filed: "table" | "words";
}

const place = (t: string): boolean => PLACES.has(t) || PLACES.has(t.replace(/ue/g, "u"));
const formsOf = (t: string): Set<string> => pageWords({ path: "", title: t, h1: null });

/** A filer over the table as it is now: build once, ask for many phrases. */
export function filer(): (phrase: string, lang?: string | null) => Filed | null {
  const list = clusters();
  const names = new Map(list.map((c) => [c.key, c.name]));
  const known = new Map<string, string>();
  for (const r of db.prepare("SELECT phrase, cluster FROM cc_seo_keywords WHERE cluster IS NOT NULL").all() as { phrase: string; cluster: string }[]) known.set(r.phrase, r.cluster);
  const byCluster = new Map<string, { lang: string; sets: Set<string>[] }>();
  for (const c of list) byCluster.set(c.key, { lang: c.lang, sets: c.examples.map((e) => pageWords({ path: "", title: e, h1: null })) });
  for (const r of db.prepare("SELECT phrase, cluster FROM cc_seo_keywords WHERE cluster IS NOT NULL AND status = 'relevant'").all() as { phrase: string; cluster: string }[]) {
    byCluster.get(r.cluster)?.sets.push(pageWords({ path: "", title: r.phrase, h1: null }));
  }
  return (raw, lang) => {
    const phrase = normal(raw);
    const stored = known.get(phrase);
    if (stored) return { key: stored, name: names.get(stored) ?? stored, filed: "table" };
    const need = tokens(phrase).filter((t) => !place(t));
    if (!need.length) return null;
    const forms = need.map(formsOf);
    const language = lang ?? langOf(phrase);
    const scores: { key: string; score: number }[] = [];
    for (const [key, c] of byCluster) {
      if (language && c.lang !== language) continue;
      let best = 0;
      for (const set of c.sets) {
        const n = forms.filter((fs) => [...fs].some((f) => set.has(f))).length;
        if (n > best) best = n;
      }
      if (best) scores.push({ key, score: best });
    }
    scores.sort((a, b) => b.score - a.score);
    const top = scores[0];
    const tie = top && scores[1]?.score === top.score;
    return top && !tie && top.score >= 2 && top.score * 2 >= need.length ? { key: top.key, name: names.get(top.key) ?? top.key, filed: "words" } : null;
  };
}

/** One phrase's cluster by the rule, or null. Builds the filer each time: for many phrases use `filer()`. */
export const fileUnder = (phrase: string, lang?: string | null): Filed | null => filer()(phrase, lang);
