import { Fragment, type ReactNode } from "react";
import type { ArticleBlock, ArticleText as Text } from "@/contract/article";
import { Icon } from "@/components/ui/icons";
import { platformName } from "./parts";
import "./article.css";

/**
 * The article as the website will set it: the same blocks in the same order,
 * drawn the way the site's own renderer draws them
 * (balkaris-web-infrastructure, components/blocks/article.tsx `Prose`,
 * `Takeaways`, `Faq`): numbered sections, steps as a numbered list with the
 * term in bold, a quote with who said it, a note set aside, code with its
 * language, a table whose first cell names the row.
 *
 * A block this does not know is drawn as a visible complaint and never
 * skipped, as on the old console: a preview that silently leaves part of the
 * article out is worse than none.
 */
export function ArticleText({ article, video }: { article: Text; video: { platform: string | null; clip: boolean | null } | null }) {
  /* Where the site puts an attached video: after the opening, before the first heading; at the end when there is none. */
  const first = article.body.findIndex((b) => typeof b === "object" && b !== null && "h" in b);
  const at = video ? (first === -1 ? article.body.length : first) : -1;
  /* The site's block plays the silent clip it was sent and draws nothing without one (`clip`: sent, not sent, not known). */
  const name = video && platformName(video.platform) ? `${platformName(video.platform)} ` : "";
  const watch = video ? (
    <p className="dk-article-watch">
      <Icon name="play" size={14} />
      <span>
        {video.clip === true
          ? `The ${name}video goes here on the site, credited to its source.`
          : video.clip === false
            ? `The ${name}video would go here, but there is no silent clip for the site to play, so it shows nothing (see Video).`
            : `The ${name}video goes here on the site if the site was sent its clip, which is not known here (see Video).`}
      </span>
    </p>
  ) : null;

  return (
    <div className="dk-article-prose">
      {article.body.map((b, i) => (
        <Fragment key={i}>
          {i === at ? watch : null}
          {block(b, i)}
        </Fragment>
      ))}
      {at === article.body.length ? watch : null}

      {article.takeaways.length ? (
        <section className="dk-article-keys">
          <h3>Key takeaways</h3>
          <ul>
            {article.takeaways.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {article.faq.length ? (
        <section className="dk-article-faq">
          <h3>Frequently asked</h3>
          {article.faq.map((f, i) => (
            <details key={i} className="dk-article-q" open={i === 0}>
              <summary>
                <span>{f.q}</span>
                <Icon name="chevron-down" size={14} />
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </section>
      ) : (
        <p className="dk-article-missing">No questions section. The site&rsquo;s article template has one, so this piece will show none.</p>
      )}
    </div>
  );
}

function block(b: ArticleBlock, i: number): ReactNode {
  if (typeof b === "string") return <p key={i}>{b}</p>;
  if (typeof b !== "object" || b === null) return unknown(b, i);
  if ("h" in b) return <h3 key={i} className="dk-article-h">{b.h}</h3>;
  if ("steps" in b) {
    return (
      <ol key={i} className="dk-article-steps">
        {b.steps.map((s, n) => (
          <li key={n}>
            <b>{s.term}</b>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
    );
  }
  if ("list" in b) {
    const items = b.list.map((row, n) => <li key={n}>{row}</li>);
    return b.ordered ? (
      <ol key={i} className="dk-article-list dk-article-list--num">
        {items}
      </ol>
    ) : (
      <ul key={i} className="dk-article-list">
        {items}
      </ul>
    );
  }
  if ("quote" in b) {
    return (
      <blockquote key={i} className="dk-article-quote">
        <p>{b.quote}</p>
        {b.who ? (
          <cite>
            <b>— {b.who}</b>
            {b.role ? <span>{b.role}</span> : null}
          </cite>
        ) : null}
      </blockquote>
    );
  }
  if ("note" in b) {
    return (
      <aside key={i} className="dk-article-note">
        <p>{b.note}</p>
      </aside>
    );
  }
  if ("code" in b) {
    return (
      <pre key={i} className="dk-article-code">
        {b.lang ? <span className="dk-article-lang">{b.lang}</span> : null}
        <code>{b.code}</code>
      </pre>
    );
  }
  if ("table" in b) {
    return (
      <div key={i} className="dk-article-tablewrap">
        <table className="dk-article-table">
          <thead>
            <tr>
              {b.table.head.map((h, n) => (
                <th key={n} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.table.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, n) =>
                  n === 0 ? (
                    <th key={n} scope="row">
                      {cell}
                    </th>
                  ) : (
                    <td key={n}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return unknown(b, i);
}

function unknown(b: unknown, i: number): ReactNode {
  return (
    <p key={i} className="dk-article-missing">
      A block this preview does not know how to draw: {JSON.stringify(b).slice(0, 120)}
    </p>
  );
}
