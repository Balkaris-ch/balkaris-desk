"use client";

import { useActionState } from "react";
import type { AiState } from "@/contract/ai";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusDot } from "@/components/ui/StatusDot";
import { saveAi, type AiSaid } from "./ai-actions";

/**
 * Settings › Writing › AI writer: the switch between the studio PC's local
 * models and Anthropic (src/ai/claude.ts). Only the owner can save; everybody
 * else sees what writes and what it has cost this month.
 */

const usd = (n: number) => `$${n.toFixed(n < 10 ? 2 : 0)}`;

export function AiWriter({ ai, owner }: { ai: AiState; owner: boolean }) {
  const [said, act, busy] = useActionState<AiSaid, FormData>(saveAi, null);
  const name = ai.models.find((m) => m.id === ai.model)?.label ?? ai.model;
  const share = ai.budgetUsd > 0 ? Math.min(100, (ai.spentUsd / ai.budgetUsd) * 100) : 100;
  return (
    <Card
      title="AI writer"
      icon="cpu"
      sub="What writes the articles, the news and the Operator's proposals. The studio PC still reads the links either way."
      info="Local is free and uses the studio PC's graphics card. Anthropic writes with Claude through this server, where the key stays; every call is counted against the month's budget, and when it is spent the desk writes locally again until the 1st. If Claude fails on a call, that call is written locally."
    >
      <p className="dk-settings-state">
        <StatusDot tone={ai.effective === "anthropic" ? "good" : "quiet"} pulse={ai.effective === "anthropic"} />
        <span>{ai.effective === "anthropic" ? `Writing with ${name}` : "Writing locally on the studio PC"}</span>
        {ai.why ? <span className="dk-settings-state-sub">Anthropic is switched on, but {ai.why}.</span> : null}
      </p>

      <div className="dk-ai-spend" aria-label="This month's spend">
        <div className="dk-ai-bar">
          <span style={{ width: `${share}%` }} className={share >= 90 ? "dk-ai-bar--bad" : share >= 70 ? "dk-ai-bar--warn" : undefined} />
        </div>
        <span className="dk-ai-spend-line">
          {usd(ai.spentUsd)} of {usd(ai.budgetUsd)} this month · {ai.calls} {ai.calls === 1 ? "call" : "calls"}
        </span>
      </div>

      <form action={act} className="dk-ai-form">
        <fieldset className="dk-ai-choice" disabled={!owner}>
          <legend>Writes with</legend>
          <label className="dk-ai-option">
            <input type="radio" name="provider" value="local" defaultChecked={ai.provider === "local"} />
            <span>
              <b>Local</b>
              <small>Gemma on the studio PC. Free; the PC has to be on and its card free enough.</small>
            </span>
          </label>
          <label className="dk-ai-option">
            <input type="radio" name="provider" value="anthropic" defaultChecked={ai.provider === "anthropic"} />
            <span>
              <b>Anthropic</b>
              <small>Claude, billed per call to the Anthropic account, separately from any Claude plan.</small>
            </span>
          </label>
        </fieldset>
        <div className="dk-ai-numbers">
          <label>
            Claude model
            <select name="model" defaultValue={ai.model} disabled={!owner}>
              {ai.models.map((m) => (
                <option key={m.id} value={m.id} title={m.note}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label title="At this figure the desk writes locally until the 1st">
            Monthly budget ($)
            <input type="number" name="budgetUsd" min={0} max={2000} step={10} defaultValue={ai.budgetUsd} disabled={!owner} />
          </label>
        </div>
        <div className="dk-ai-save">
          {owner ? (
            <Button type="submit" variant="good" size="sm" disabled={busy}>
              {busy ? "Saving" : "Save"}
            </Button>
          ) : (
            <span className="dk-ai-note">Only the owner switches it.</span>
          )}
          <span className="dk-ai-note">{ai.key ? `Key: ${ai.key}, on the server.` : "No Anthropic key on the server: Anthropic cannot be used yet."}</span>
          {said ? (
            <span className={said.ok ? "dk-ai-said" : "dk-ai-said dk-ai-said--bad"} role="status">
              {said.message}
            </span>
          ) : null}
        </div>
      </form>

      {ai.recent.length ? (
        <ul className="dk-ai-recent" aria-label="The last calls to Claude">
          {ai.recent.map((r, i) => (
            <li key={i}>
              <span>{r.purpose}</span>
              <span>{r.model}</span>
              <span className="dk-num">${r.usd.toFixed(3)}</span>
              <span suppressHydrationWarning>{new Date(`${r.at.replace(" ", "T")}Z`).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
