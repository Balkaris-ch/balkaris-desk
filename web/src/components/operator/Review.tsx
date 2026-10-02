"use client";

import { useState } from "react";
import type { ProposalAnswer, ProposalRow } from "@/contract/operator";
import { Button, buttonClass, type ButtonVariant } from "@/components/ui/Button";
import { DialogActions } from "@/components/ui/Dialog";
import { Go } from "@/components/ui/Go";
import { ago, fullDate } from "@/lib/format";
import { cx } from "@/lib/cx";
import { Sheet } from "./Sheet";
import { useSend } from "./send";

type Mode = "review" | "approve" | "withdraw";

/** Before and after, both as the live page shows them: a title with the brand the website appends. */
function Change({ label, before, after, stored }: { label: string; before: string | null | undefined; after: string; stored?: string }) {
  return (
    <div className="dk-operator-diff">
      <p className="dk-operator-diff-label">{label}</p>
      <p className="dk-operator-diff-before">
        <span className="dk-operator-diff-tag">Now</span>
        <span className="dk-operator-diff-was">{before ? before : <em>none</em>}</span>
        {before ? <span className="dk-operator-diff-n dk-num">{before.length} characters</span> : null}
      </p>
      <p className="dk-operator-diff-after">
        <span className="dk-operator-diff-tag">After</span>
        <span>{after}</span>
        <span className="dk-operator-diff-n dk-num">{after.length} characters</span>
      </p>
      {stored !== undefined && stored !== after ? (
        <p className="dk-operator-aside">
          The desk stores “{stored}”; the website adds the brand after it itself, as it does on every page.
        </p>
      ) : null}
    </div>
  );
}

/** What a proposal changes, and why, and what approving it does: the body of every dialog about one. */
function Body({ p }: { p: ProposalRow }) {
  return (
    <>
      {p.kind === "redirect" ? (
        <div className="dk-operator-diff">
          <p className="dk-operator-diff-label">Redirect</p>
          <p className="dk-operator-diff-after">
            <span className="dk-operator-diff-tag">From</span>
            <span>{p.address}</span>
          </p>
          <p className="dk-operator-diff-after">
            <span className="dk-operator-diff-tag">To</span>
            <span>{p.after.to}</span>
          </p>
        </div>
      ) : (
        <>
          {p.after.title !== undefined ? <Change label="Title" before={p.before.title} after={p.shownTitle ?? p.after.title} stored={p.after.title} /> : null}
          {p.after.description !== undefined ? <Change label="Description" before={p.before.description} after={p.after.description} /> : null}
        </>
      )}
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
      {p.note ? <p className="dk-operator-aside">{p.note}</p> : null}
      {p.error ? <p className="dk-operator-said dk-operator-said--bad">The last attempt failed: {p.error}</p> : null}
    </>
  );
}

/**
 * Review, Approve and Withdraw on a proposal: each opens the same account of
 * the change (before and after, why, who proposed it) and the plain
 * consequence, then does the one thing asked. Approving and withdrawing
 * change the live site, so only a person who can publish is offered them.
 */
export function ReviewButton({ p, mode, canApprove, why, specimen, label, variant }: { p: ProposalRow; mode: Mode; canApprove: boolean; why: string | null; specimen: boolean; label: string; variant: ButtonVariant }) {
  const [open, setOpen] = useState(false);
  const { go, busy, message, setMessage } = useSend();
  const close = () => {
    setOpen(false);
    setMessage(null);
  };

  const act = async (what: "approve" | "reject" | "withdraw") => {
    if (specimen) return setMessage({ ok: false, text: "Specimen data is showing: these proposals are made up and nothing is changed from this view." });
    const r = await go<ProposalAnswer>(`/api/v1/operator/proposals/${p.id}/${what}`, {});
    if (r.ok) close();
  };

  const withdrawing = mode === "withdraw";
  const title = withdrawing
    ? p.kind === "redirect"
      ? `Withdraw the redirect from ${p.address}`
      : `Withdraw the change to ${p.address}`
    : p.kind === "redirect"
      ? `Create a redirect from ${p.address}`
      : `Update the metadata of ${p.address}`;
  const consequence = withdrawing
    ? p.kind === "redirect"
      ? `${p.address} stops redirecting to ${p.after.to} on the live site within about two minutes.`
      : `The entry is removed and ${p.address} shows what its own source says again, on the live site within about two minutes.`
    : p.consequence;

  return (
    <>
      <button type="button" className={buttonClass({ variant, size: "xs" }, "dk-operator-row-btn")} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {label}
      </button>
      <Sheet open={open} onClose={close} title={title} description={p.state === "waiting" ? "Waiting for a person who can publish." : undefined}>
        <Body p={p} />
        <p className={cx("dk-operator-consequence", withdrawing && "dk-operator-consequence--warn")}>{consequence}</p>
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
