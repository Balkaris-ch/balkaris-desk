import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type { SpiderDuplicates } from "@/contract/spider";
import type { Answer } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Stamp } from "@/components/ui/Stamp";
import { num, percent } from "@/lib/format";
import { Body, PathLink } from "./bits";

/**
 * Duplicate content, as the last crawl found it across the site's pages
 * (GET /api/v1/spider/duplicates): the same own text word for word, nearly
 * the same text, the same main heading, the same set of subheadings. Each is
 * also a finding of its rule in Issues by rule; here the pages are put
 * together in their groups and pairs. A kind with nothing in it says "none".
 */

const share = (x: number): string => percent(x * 100, 0);

/** One kind of duplicate: its heading with how many, and its rows. */
function Kind({ title, n, unit, note, children }: { title: string; n: number; unit: [string, string]; note?: string; children: ReactNode }) {
  return (
    <section className="dk-seo-technical-dup-kind" aria-label={title}>
      <h3 className="dk-seo-technical-h3">
        {title}
        <span className="dk-seo-technical-h3-n">{n ? `${num(n)} ${n === 1 ? unit[0] : unit[1]}` : "none"}</span>
      </h3>
      {note ? <p className="dk-seo-technical-dup-note">{note}</p> : null}
      {n ? children : null}
    </section>
  );
}

/** A group's pages, each linked to its page in Page Optimization. */
function Pages({ pages }: { pages: string[] }) {
  return (
    <ul className="dk-seo-technical-dup-pages">
      {pages.map((p) => (
        <li key={p}>
          <PathLink path={p} />
        </li>
      ))}
    </ul>
  );
}

export function DuplicatesCard({ answer }: { answer: Answer<Reading<SpiderDuplicates>> }) {
  const reading = answer.ok ? answer.value : null;
  return (
    <Card
      title="Duplicate content"
      icon="copy"
      id="duplicates"
      info="What the last crawl found repeated across the site’s pages: the same own text word for word, nearly the same text (from the crawl’s threshold up), the same main heading, and the same set of subheadings with the template’s own left out. Each is also a finding of its rule in Issues by rule."
      right={reading?.state === "ok" ? <Stamp reading={reading} /> : null}
      flush
      className="dk-seo-technical-dups"
    >
      {!reading ? (
        <Empty icon="alert" title="The desk did not answer for this panel" compact>
          {answer.ok ? null : answer.message}
        </Empty>
      ) : (
        <Body reading={reading}>
          {(d) => (
            <div className="dk-seo-technical-dup-body">
              <Kind title="Same text, word for word" n={d.exact.length} unit={["group", "groups"]}>
                <ul className="dk-seo-technical-dup-groups" aria-label="Pages with the same text">
                  {d.exact.map((g) => (
                    <li key={g.pages.join("\n")}>
                      <Pages pages={g.pages} />
                    </li>
                  ))}
                </ul>
              </Kind>

              <Kind title="Nearly the same text" n={d.near.length} unit={["pair", "pairs"]} note={`Pairs from ${share(d.threshold)} alike, the threshold the last crawl used.`}>
                <ul className="dk-seo-technical-dup-groups" aria-label="Pages with nearly the same text">
                  {d.near.map((p) => (
                    <li key={`${p.a}\n${p.b}`} className="dk-seo-technical-dup-pair">
                      <span className="dk-seo-technical-dup-two">
                        <PathLink path={p.a} />
                        <span className="dk-seo-technical-dup-and">and</span>
                        <PathLink path={p.b} />
                      </span>
                      <span className="dk-seo-technical-dup-sim dk-num" title="How much of their own text the two pages share, as the crawl measures it">
                        {share(p.similarity)} alike
                      </span>
                    </li>
                  ))}
                </ul>
              </Kind>

              <Kind title="Same main heading" n={d.h1.length} unit={["group", "groups"]}>
                <ul className="dk-seo-technical-dup-groups" aria-label="Pages with the same main heading">
                  {d.h1.map((g) => (
                    <li key={g.pages.join("\n")}>
                      <p className="dk-seo-technical-dup-heading">{g.heading ? `“${g.heading}”` : "An empty <h1>"}</p>
                      <Pages pages={g.pages} />
                    </li>
                  ))}
                </ul>
              </Kind>

              <Kind title="Same set of subheadings" n={d.h2.length} unit={["group", "groups"]}>
                <ul className="dk-seo-technical-dup-groups" aria-label="Pages with the same subheadings">
                  {d.h2.map((g) => (
                    <li key={g.pages.join("\n")}>
                      <Pages pages={g.pages} />
                    </li>
                  ))}
                </ul>
              </Kind>
            </div>
          )}
        </Body>
      )}
    </Card>
  );
}
