"use client";

import { useState } from "react";
import type { ProposalAnswer, ProposalChange, ProposalRow } from "@/contract/operator";
import { Button, buttonClass, type ButtonVariant } from "@/components/ui/Button";
import { DialogActions } from "@/components/ui/Dialog";
import { Go } from "@/components/ui/Go";
import { ago, fullDate } from "@/lib/format";
import { cx } from "@/lib/cx";
import { Sheet } from "./Sheet";
import { useSend } from "./send";

type Mode = "review" | "approve" | "withdraw";

/** A picture's address as the browser can load it: the desk's own upload, or the live site's file. */
const shown = (src: string): string => src;

/** One field, before and after, as the live page shows it: words, a picture drawn as a picture, or structured data drawn as code. */
function Change({ c, stored }: { c: ProposalChange; stored?: string }) {
  return (
    <div className="dk-operator-diff">
      <p className="dk-operator-diff-label">{c.label}</p>
      {c.look === "picture" ? (
        <div className="dk-operator-diff-pics">
          <figure className="dk-operator-diff-pic">
            <figcaption className="dk-operator-diff-tag">Now</figcaption>
            {c.before ? <img src={shown(c.before)} alt="The share picture the page names now" loading="lazy" /> : <em>none</em>}
          </figure>
          <figure className="dk-operator-diff-pic">
            <figcaption className="dk-operator-diff-tag">After</figcaption>
            {c.after ? <img src={shown(c.after)} alt="The share picture after approval" loading="lazy" /> : <em>none</em>}
          </figure>
        </div>
      ) : (
        <>
          <p className="dk-operator-diff-before">
            <span className="dk-operator-diff-tag">Now</span>
            <span className="dk-operator-diff-was">{c.before ? c.before : <em>none</em>}</span>
            {c.before && c.look === "text" ? <span className="dk-operator-diff-n dk-num">{c.before.length} characters</span> : null}
          </p>
          <div className="dk-operator-diff-after">
            <span className="dk-operator-diff-tag">After</span>
            {c.look === "code" ? <pre className="dk-operator-code">{c.after}</pre> : <span>{c.after ?? <em>none</em>}</span>}
            {c.after && c.look === "text" ? <span className="dk-operator-diff-n dk-num">{c.after.length} characters</span> : null}
          </div>
        </>
      )}
      {stored !== undefined && stored !== c.after ? <p className="dk-operator-aside">The desk stores “{stored}”; the website adds the brand after it itself, as it does on every page.</p> : null}
    </div>
  );
}

/** What a proposal changes, and why, and what approving it does: the body of every dialog about one. */
function Body({ p }: { p: ProposalRow }) {
  return (
    <>
      {p.changes.map((c, i) => (
        <Change key={i} c={c} stored={p.kind === "meta" && c.label === "Title" ? p.after.title : undefined} />
      ))}
      {p.picture ? (
        <p className="dk-operator-aside">
          The picture is {p.picture.width} by {p.picture.height} pixels, {Math.round(p.picture.bytes / 1024)} KB. Approving commits it to the site as {p.picture.sitePath}, in the same commit as the card.
        </p>
      ) : null}
      {p.drift ? (
        <p className="dk-operator-said dk-operator-said--bad">
          The page changed since this was proposed. At the last crawl it shows
          {p.drift.title !== undefined ? ` the title “${p.drift.title ?? "(none)"}”` : ""}
          {p.drift.title !== undefined && p.drift.description !== undefined ? " and" : ""}
          {p.drift.description !== undefined ? ` the description “${p.drift.description ?? "(none)"}”` : ""}, not what “Now” says. Approving would replace newer words, so it is
          refused: ask the operator again for this page.
        </p>
      ) : null}
      {p.why ? <p className="dk-operator-aside">Why: {p.why}</p> : null}
      <p className="dk-operator-aside">
        {p.source === "operator" ? (
          <>
            Proposed by the operator
            {p.taskId ? (
              <>
                {" "}
                (
                <Go href={`/operator/results/${p.taskId}`} className="dk-operator-link">
                  task #{p.taskId}
                </Go>
                )
              </>
            ) : null}
          </>
        ) : (
          <>Proposed by {p.proposedBy ?? "a person"}</>
        )}{" "}
        {ago(p.createdAt)}
        {p.decidedBy ? `; ${p.state === "rejected" ? "rejected" : "approved"} by ${p.decidedBy} on ${fullDate(p.decidedAt ?? p.createdAt)}` : ""}
        {p.sha ? (
          <>
            {"; commit "}
            {p.shaUrl ? (
              <Go href={p.shaUrl} className="dk-operator-link">
                {p.sha}
              </Go>
            ) : (
              p.sha
            )}
          </>
        ) : null}
        .
      </p>
      {p.readBack ? (
        <p className={cx("dk-operator-said", !p.readBack.ok && "dk-operator-said--bad")}>
          Read back from the live page {ago(p.readBack.at)}: {p.readBack.line}
        </p>
      ) : null}
      {p.note ? <p className="dk-operator-aside">{p.note}</p> : null}
      {p.error ? <p className="dk-operator-said dk-operator-said--bad">The last attempt failed: {p.error}</p> : null}
    </>
  );
}

/** The dialog's title, by what the proposal does. */
function titleOf(p: ProposalRow, withdrawing: boolean): string {
  const a = p.address;
  switch (p.kind) {
    case "redirect":
      return withdrawing ? `Withdraw the redirect from ${a}` : `Create a redirect from ${a}`;
    case "og":
      return withdrawing ? `Withdraw the share card of ${a}` : `Change the share card of ${a}`;
    case "index":
      return withdrawing ? `Undo: ${p.after.noindex ? "put" : "take"} ${a} ${p.after.noindex ? "back in" : "out of"} search` : p.after.noindex ? `Take ${a} out of search` : `Put ${a} back in search`;
    case "canonical":
      return withdrawing ? `Withdraw the canonical of ${a}` : `Point ${a} at ${p.after.canonical}`;
    case "schema":
      return withdrawing ? `Withdraw the ${p.after.jsonLd?.["@type"] ?? "structured data"} of ${a}` : `Add ${p.after.jsonLd?.["@type"] ?? "structured data"} to ${a}`;
    default:
      return withdrawing ? `Withdraw the change to ${a}` : `Update the metadata of ${a}`;
  }
}

/** What withdrawing does on the live site, in one sentence. */
function undoLine(p: ProposalRow): string {
  switch (p.kind) {
    case "redirect":
      return `${p.address} stops redirecting to ${p.after.to} on the live site within about two minutes.`;
    case "index":
      return p.after.noindex
        ? `${p.address} may be listed by search engines again and returns to the sitemap on the next deploy.`
        : `${p.address} goes out of search again ("noindex, follow") and leaves the sitemap on the next deploy.`;
    case "canonical":
      return `${p.address} names itself as canonical again and returns to the sitemap on the next deploy.`;
    case "og":
      return `The share card of ${p.address} goes back to what the page's own source says${p.picture ? ", and the uploaded picture leaves the site in the same commit" : ""}, from the next deploy.`;
    case "schema":
      return `${p.address} stops printing this ${p.after.jsonLd?.["@type"] ?? "structured-data"} block from the next deploy.`;
    default:
      return `The entry is removed and ${p.address} shows what its own source says again, on the live site within about two minutes.`;
  }
}

/**
 * Review, Approve and Withdraw on a proposal: each opens the same account of
 * the change (before and after, why, who proposed it) and the plain
 * consequence, then does the one thing asked. Approving and withdrawing
 * change the live site, so only a person who can publish is offered them.
 * A live change can be read back from the page, to know the website applied it.
 */
export function ReviewButton({ p, mode, canApprove, why, specimen, label, variant }: { p: ProposalRow; mode: Mode; canApprove: boolean; why: string | null; specimen: boolean; label: string; variant: ButtonVariant }) {
  const [open, setOpen] = useState(false);
  const { go, busy, message, setMessage } = useSend();
  const close = () => {
    setOpen(false);
    setMessage(null);
  };

  const act = async (what: "approve" | "reject" | "withdraw" | "check") => {
    if (specimen) return setMessage({ ok: false, text: "Specimen data is showing: these proposals are made up and nothing is changed from this view." });
    const r = await go<ProposalAnswer>(`/api/v1/operator/proposals/${p.id}/${what}`, {}, (v) => (what === "check" ? (v.line ?? "Read.") : null));
    if (r.ok && what !== "check") close();
  };

  const withdrawing = mode === "withdraw";
  const consequence = withdrawing ? undoLine(p) : p.consequence;

  return (
    <>
      <button type="button" className={buttonClass({ variant, size: "xs" }, "dk-operator-row-btn")} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {label}
      </button>
      <Sheet open={open} onClose={close} title={titleOf(p, withdrawing)} description={p.state === "waiting" ? "Waiting for a person who can publish." : undefined}>
        <Body p={p} />
        <p className={cx("dk-operator-consequence", (withdrawing || (p.kind === "index" && p.after.noindex)) && "dk-operator-consequence--warn")}>{consequence}</p>
        {!canApprove && p.state !== "rejected" && p.state !== "withdrawn" ? <p className="dk-operator-aside">{why}</p> : null}
        {message ? (
          <p className={cx("dk-operator-said", !message.ok && "dk-operator-said--bad")} role="alert">
            {message.text}
          </p>
        ) : null}
        <DialogActions>
          <Button variant="quiet" onClick={close}>
            Close
          </Button>
          {p.state === "applied" ? (
            <Button variant="quiet" icon="eye" disabled={busy} onClick={() => void act("check")} title="Read the live page and confirm it shows this change">
              Check the live page
            </Button>
          ) : null}
          {p.state === "waiting" || (p.state === "approved" && p.error) ? (
            <Button variant="danger" disabled={busy} onClick={() => void act("reject")}>
              Reject
            </Button>
          ) : null}
          {canApprove && withdrawing && p.state === "applied" ? (
            <Button variant="danger" disabled={busy} onClick={() => void act("withdraw")}>
              Withdraw
            </Button>
          ) : null}
          {canApprove && !withdrawing && !p.drift && (p.state === "waiting" || (p.state === "approved" && p.error)) ? (
            <Button variant="primary" icon="check" disabled={busy} onClick={() => void act("approve")}>
              {p.state === "approved" ? "Apply again" : "Approve"}
            </Button>
          ) : null}
        </DialogActions>
      </Sheet>
    </>
  );
}
