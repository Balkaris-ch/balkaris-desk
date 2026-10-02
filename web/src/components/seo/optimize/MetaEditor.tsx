"use client";

import { useState } from "react";
import type { ProposalAnswer, TaskAnswer } from "@/contract/operator";
import { useSend } from "@/components/operator/send";
import { buttonClass } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import "@/components/ui/field.css";

/** The brand the website appends to every title itself (src/cc/operator/packs.ts, BRAND). */
const BRAND = " | Balkaris";
/** The page's own part of a title, as the website's overrides store it. */
const ownOf = (t: string | null): string => (t ?? "").replace(/(?:\s*\|\s*|\s+[–—:-]\s+)Balkaris\s*$/i, "").trim();
const chars = (s: string): number => [...s].length;

/**
 * "Optimize": a person's own title and description for the page, with the
 * result they would make, their lengths against the desk's yardsticks, and
 * "Propose for approval". Saving never changes the live site: it becomes a
 * proposal in AI Operator › Approvals (POST /api/v1/seo/optimize/propose),
 * applied only when someone who can publish approves it. Or the operator
 * writes them instead (a metadata task), and they wait the same way.
 */
export function MetaEditor({ path, url, title, description, titleLimit, descriptionLimit, answers200 }: { path: string; url: string; title: string | null; description: string | null; titleLimit: number; descriptionLimit: number; answers200: boolean }) {
  const { go, busy, message } = useSend();
  const ask = useSend();
  const [own, setOwn] = useState(ownOf(title));
  const [desc, setDesc] = useState(description ?? "");
  const [why, setWhy] = useState("");
  const [made, setMade] = useState<number | null>(null);
  const [task, setTask] = useState<number | null>(null);
  const shown = `${own.trim()}${BRAND}`;
  const changed = own.trim() !== ownOf(title) || desc.trim() !== (description ?? "").trim();
  const tLen = chars(shown);
  const dLen = chars(desc.trim());
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();

  return (
    <div className="dk-seo-optimize-editor">
      <form
        className="dk-seo-optimize-editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!changed) return;
          void go<ProposalAnswer>("/api/v1/seo/optimize/propose", { path, title: own, description: desc, why: why.trim() || undefined }, (v) => {
            setMade(v.proposal.id);
            return null;
          });
        }}
      >
        <label className="dk-field">
          <span className="dk-field-label">
            Title <span className="dk-seo-optimize-quiet">(the website adds “{BRAND.trim()}”)</span>
          </span>
          <input className="dk-input" value={own} maxLength={110} onChange={(e) => setOwn(e.target.value)} disabled={!answers200} />
          <span className={cx("dk-field-hint dk-num", tLen > titleLimit && "dk-tone-warn")}>
            {num(tLen)} of {num(titleLimit)} characters as shown{tLen > titleLimit ? ": cut in results" : ""}
          </span>
        </label>
        <label className="dk-field">
          <span className="dk-field-label">Description</span>
          <textarea className="dk-input" rows={3} value={desc} maxLength={300} onChange={(e) => setDesc(e.target.value)} disabled={!answers200} />
          <span className={cx("dk-field-hint dk-num", dLen > descriptionLimit && "dk-tone-warn")}>
            {num(dLen)} of {num(descriptionLimit)} characters{dLen > descriptionLimit ? ": cut in results" : ""}
          </span>
        </label>
        <label className="dk-field">
          <span className="dk-field-label">Why (optional, for whoever approves)</span>
          <input className="dk-input" value={why} maxLength={400} onChange={(e) => setWhy(e.target.value)} disabled={!answers200} />
        </label>
        <div className="dk-seo-optimize-editor-actions">
          <button type="submit" className={buttonClass({ variant: "primary", size: "sm" })} disabled={busy || !changed || !answers200}>
            <Icon name="check" size={14} />
            <span>{busy ? "Proposing…" : "Propose for approval"}</span>
          </button>
          <button
            type="button"
            className={buttonClass({ variant: "quiet", size: "sm" })}
            disabled={ask.busy || !answers200}
            onClick={() =>
              void ask.go<TaskAnswer>("/api/v1/operator/tasks", { kind: "metadata", paths: [path], depth: "deep" }, (v) => {
                setTask(v.task.id);
                return null;
              })
            }
          >
            <Icon name="sparkles" size={14} />
            <span>Let the operator write them</span>
          </button>
          <button
            type="button"
            className={buttonClass({ variant: "ghost", size: "sm" })}
            disabled={!changed}
            onClick={() => {
              setOwn(ownOf(title));
              setDesc(description ?? "");
            }}
          >
            Reset
          </button>
        </div>
        <p className={cx("dk-seo-optimize-said", ((message && !message.ok) || (ask.message && !ask.message.ok)) && "dk-seo-optimize-said--bad")} aria-live="polite">
          {message && !message.ok ? (
            message.text
          ) : ask.message && !ask.message.ok ? (
            ask.message.text
          ) : made ? (
            <>
              Proposal #{made} waits for approval; the live page is unchanged until someone who can publish approves it.{" "}
              <Go href="/operator?ap=waiting#approvals" className="dk-seo-optimize-link">
                Approvals
              </Go>
            </>
          ) : task ? (
            <>
              Asked as operator task #{task}: it writes a title and description on the studio workstation, and they wait for approval.{" "}
              <Go href={`/operator?result=${task}#response`} className="dk-seo-optimize-link">
                Follow it
              </Go>
            </>
          ) : answers200 ? (
            "Nothing here changes the live site: what you propose waits in AI Operator › Approvals."
          ) : (
            "The page does not answer 200 at the last crawl, so it has no title to change."
          )}
        </p>
      </form>
      <div className="dk-seo-optimize-editor-preview" aria-label="The result it would make">
        <p className="dk-seo-optimize-editor-label">As a Google result</p>
        <article className="dk-seo-optimize-result">
          <span className="dk-seo-optimize-result-site">
            <span className="dk-seo-optimize-result-mark" aria-hidden>
              B
            </span>
            <span>
              <span className="dk-seo-optimize-result-host">{host.replace(/^www\./, "")}</span>
              <span className="dk-seo-optimize-result-url">{url}</span>
            </span>
          </span>
          <span className="dk-seo-optimize-result-title">{own.trim() ? shown : "(no title)"}</span>
          <span className="dk-seo-optimize-result-desc">{desc.trim() || "(no description)"}</span>
        </article>
        {changed ? <p className="dk-seo-optimize-note">Changed from what the crawl read on the live page.</p> : <p className="dk-seo-optimize-note">What the crawl read on the live page.</p>}
      </div>
    </div>
  );
}
