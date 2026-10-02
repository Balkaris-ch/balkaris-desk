import type { ArticlePayload } from "@/contract/article";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { num } from "@/lib/format";
import { ActionForm } from "./ActionForm";
import { ArticleText } from "./ArticleText";
import { JobState } from "./panels";
import "./article.css";

const JOB_WORDS: Record<string, string> = {
  queued: "A cover is asked for and waits for the workstation.",
  running: "The workstation is drawing a cover now.",
  stuck: "The workstation could not draw a cover and gave up after three tries.",
};

/**
 * The article as it will read on balkaris.ch: the cover the desk drew with
 * its caption and alt text, then the piece itself. The cover's one action,
 * "Draw another cover", sits under the picture as on the old console.
 */
export function ArticleCard({ p, back }: { p: ArticlePayload; back: (done: string) => string }) {
  const a = p.article;
  /* The desk pushes a new picture by itself only for a LISTED article
     (src/server.ts pushCover checks "published" or "listed", and no draft is
     ever "published"); an unlisted one keeps its old picture on the site. */
  const pushes = p.site.state === "listed";
  /* Whether the site plays a clip where the video goes: for a live article, what its file on the
     website's branch says (null when that was not read); before that, whether the desk holds the
     clip the publisher would send. */
  const live = p.site.state === "unlisted" || p.site.state === "listed";
  const sent = !p.video ? null : live ? (p.site.repo.state === "ok" ? p.site.repo.value.clip : null) : p.video.held;
  return (
    <Card
      title="The article"
      icon="article"
      sub="As the website will set it: the same blocks, in the same order."
      right={a.readingTime ? <Chip icon="clock">{`${num(a.readingTime)} min read`}</Chip> : null}
    >
      <div className="dk-article-read">
        {p.cover ? (
          <figure className="dk-article-cover">
            {/* The desk's own copy, served as it was drawn; next/image would add nothing. */}
            <img src={p.cover.src} alt={p.cover.alt} width={1200} height={630} decoding="async" />
            {p.cover.caption ? <figcaption>{p.cover.caption}</figcaption> : null}
            <p className="dk-article-alt">
              <span>Alt text</span> {p.cover.alt}
            </p>
          </figure>
        ) : (
          <div className="dk-article-nocover">
            <Icon name="image" size={20} />
            <p>{p.coverJob ? JOB_WORDS[p.coverJob.state] ?? `A cover job is ${p.coverJob.state}.` : "No cover has been drawn for it. Without one, the journal draws its own plate for the piece."}</p>
          </div>
        )}
        {p.coverJob && p.cover ? (
          <p className="dk-article-coverjob">
            <JobState job={p.coverJob} />
            <span className="dk-article-quiet">{JOB_WORDS[p.coverJob.state] ?? ""}</span>
          </p>
        ) : null}
        {p.coverJob?.error && !p.cover ? <p className="dk-article-job-error">{p.coverJob.error}</p> : null}
        {p.offers.redraw ? (
          <ActionForm
            className="dk-article-act--cover"
            post={`/draft/${p.draftId}/redraw`}
            back={back("redraw")}
            label="Draw another cover"
            icon="refresh"
            explain={
              p.site.state === "unlisted"
                ? "The same idea, a new printing, drawn with a new seed; the words are not touched. It is live but unlisted, and the site keeps its old picture until the article is published again."
                : "The same idea, a new printing: the cover system reads the article again and draws with a new seed. The words are not touched."
            }
            confirm={
              pushes
                ? {
                    title: "Draw another cover?",
                    body: <p>The workstation draws a new one. Because the article is published, the desk pushes the new picture to the site by itself as soon as it is drawn.</p>,
                    yes: "Draw another",
                  }
                : null
            }
          />
        ) : null}

        <header className="dk-article-top">
          {a.topics.length ? <p className="dk-article-kicker">{a.topics.map((t) => t.name).join(" · ")}</p> : null}
          <h2 className="dk-article-title">{a.title}</h2>
          {a.standfirst ? <p className="dk-article-stand">{a.standfirst}</p> : null}
        </header>
        <ArticleText article={a} video={p.video?.plays ? { platform: p.video.platform, clip: sent } : null} />
      </div>
    </Card>
  );
}
