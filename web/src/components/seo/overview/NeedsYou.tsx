"use client";

import { useState } from "react";
import type { Reading } from "@/contract/common";
import type { OwnerTaskRow } from "@/contract/seo/common";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/icons";
import { PanelAbsent } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { fullDate, num } from "@/lib/format";
import { OwnerMark } from "./Act";
import { PRIORITY_TONE } from "./bits";
import "./overview.css";

const SHOWN = 5;

/** Turns the addresses in a step into links, so "https://business.google.com" can be opened. */
function Step({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)"'<>]+[^\s)"'<>.,;:])/g);
  return (
    <p className="dk-seo-overview-need-step">
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="dk-seo-overview-link">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

/**
 * "Needs you": what only the owner can do (a login, a decision, a profile),
 * open first, each with its exact step, its impact and effort as the audit
 * judged them, and a "Mark done" a person presses when it is done. Never a
 * button that pretends to do the step itself. These are the owner's own steps,
 * so only the owner is offered the mark (`ownerSteps`, from the payload's
 * `can`; the server refuses anybody else); the others see who marks it.
 */
export function NeedsYou({ reading, ownerSteps = true }: { reading: Reading<{ open: number; done: number; rows: OwnerTaskRow[] }>; ownerSteps?: boolean }) {
  const [all, setAll] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const v = reading.state === "ok" ? reading.value : null;
  const rows = v ? v.rows.filter((r) => !r.done) : [];
  const done = v ? v.rows.filter((r) => r.done) : [];
  const shown = all ? rows : rows.slice(0, SHOWN);

  return (
    <Card
      id="needs-you"
      title="Needs you"
      icon="user"
      tone="warn"
      count={v ? num(v.open) : undefined}
      className="dk-seo-overview-panel dk-seo-overview-a-needs"
      info="Steps no tool can take for the owner: signing in to Google Business Profile or Bing Webmaster, creating directory profiles, asking for reviews, deciding the one true name, address and phone, publishing prices. Each has its exact step; mark it done when it is."
      sub={v ? `${num(v.open)} open · ${num(v.done)} done` : undefined}
    >
      {v ? (
        rows.length ? (
          <>
            <ol className="dk-seo-overview-needs">
              {shown.map((r) => {
                const open = opened === r.id;
                return (
                  <li key={r.id} className={cx("dk-seo-overview-need", open && "dk-seo-overview-need--open")}>
                    <div className="dk-seo-overview-need-row">
                      <button type="button" className="dk-seo-overview-need-title" aria-expanded={open} onClick={() => setOpened(open ? null : r.id)}>
                        <Icon name="chevron-right" size={14} className="dk-seo-overview-need-chev" />
                        <span>{r.title}</span>
                      </button>
                      <span className="dk-seo-overview-need-meta">
                        <Chip tone={PRIORITY_TONE[r.impact]}>{r.impact === "high" ? "High impact" : r.impact === "medium" ? "Medium impact" : "Low impact"}</Chip>
                        {r.effort ? <span className="dk-seo-overview-quiet">{r.effort}</span> : null}
                      </span>
                      {ownerSteps ? (
                        <OwnerMark id={r.id} done={r.done} />
                      ) : (
                        <span className="dk-seo-overview-quiet" title="One of the owner’s own steps: he marks it done himself.">
                          The owner marks it
                        </span>
                      )}
                    </div>
                    {open ? (
                      <div className="dk-seo-overview-need-body">
                        <Step text={r.step} />
                        {r.why ? <p className="dk-seo-overview-need-why">Why: {r.why}</p> : null}
                        <p className="dk-seo-overview-quiet">
                          {r.from}
                          {r.opportunities ? ` · ${num(r.opportunities)} opportunit${r.opportunities === 1 ? "y waits" : "ies wait"} on it` : ""}
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            {rows.length > SHOWN ? (
              <button type="button" className="dk-seo-overview-more-btn" onClick={() => setAll((x) => !x)}>
                {all ? "Show fewer" : `Show ${num(rows.length - SHOWN)} more`}
              </button>
            ) : null}
            {done.length ? (
              <p className="dk-seo-overview-quiet dk-seo-overview-needs-done">
                Done: {done.map((d) => `${d.title}${d.doneBy ? ` (${d.doneBy}${d.doneAt ? `, ${fullDate(d.doneAt)}` : ""})` : ""}`).join("; ")}
              </p>
            ) : null}
          </>
        ) : (
          <Empty icon="check-circle" title="Nothing waits for you" compact>
            Every owner step is marked done.
          </Empty>
        )
      ) : reading.state !== "ok" ? (
        <PanelAbsent reading={reading} />
      ) : null}
    </Card>
  );
}
