"use client";

import { useActionState } from "react";
import type { FindState, ScoutFind, ScoutMode, ScoutPayload, ScoutSource } from "@/contract/scout";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { addScoutSource, decideFind, runScout, saveScout, setScoutSource, type ScoutSaid } from "./scout-actions";
import "./scout.css";

/**
 * Insights › Scout: the web-hunting agent (src/scout/index.ts). Its mode and
 * quota, every find with its state, and the sources with the scores they
 * earned. Nothing here decides: each button asks the desk server.
 */

const MODES: { key: ScoutMode; label: string; about: string }[] = [
  { key: "auto", label: "Automatic", about: "Chooses and publishes up to the day's number by itself." },
  { key: "mix", label: "Mix", about: "Publishes the clearest news by itself; offers the rest in Telegram." },
  { key: "select", label: "You select", about: "Only offers, in Telegram and here; nothing is written until somebody chooses." },
  { key: "off", label: "Off", about: "Reads nothing." },
];

const STATE: Record<FindState, { label: string; tone: string }> = {
  found: { label: "Found", tone: "quiet" },
  offered: { label: "Offered", tone: "info" },
  queued: { label: "With the writer", tone: "good" },
  skipped: { label: "Skipped", tone: "quiet" },
  failed: { label: "Failed", tone: "bad" },
};

const ago = (sqlUtc: string | null): string => {
  if (!sqlUtc) return "never";
  const t = Date.parse(sqlUtc.includes("T") ? sqlUtc : `${sqlUtc.replace(" ", "T")}Z`);
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const every = (min: number) => (min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`);

function Said({ said }: { said: ScoutSaid }) {
  return said ? (
    <span className={said.ok ? "dk-scout-said" : "dk-scout-said dk-scout-said--bad"} role="status">
      {said.message}
    </span>
  ) : null;
}

function Settings({ data }: { data: ScoutPayload }) {
  const [said, act, busy] = useActionState<ScoutSaid, FormData>(saveScout, null);
  const [ran, run, running] = useActionState<ScoutSaid, FormData>(runScout, null);
  const s = data.settings;
  return (
    <Card
      title="Scout"
      icon="pulse"
      info="Hunts AI and marketing news, YouTube channels, Hacker News and Reddit every half hour, scores what it finds against Balkaris's services, and feeds the best to the writer on the workstation. Reading and scoring run on the server; only chosen items reach the local model."
      right={
        <form action={run}>
          <Button type="submit" size="sm" icon="refresh" disabled={running}>
            {running ? "Reading" : "Read now"}
          </Button>
        </form>
      }
    >
      <form action={act} className="dk-scout-settings">
        <fieldset className="dk-scout-modes">
          <legend>Mode</legend>
          {MODES.map((m) => (
            <label key={m.key} className="dk-scout-mode" title={m.about}>
              <input type="radio" name="mode" value={m.key} defaultChecked={s.mode === m.key} />
              <span>
                <b>{m.label}</b>
                <small>{m.about}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="dk-scout-numbers">
          <label>
            Posts a day
            <input type="number" name="perDay" min={0} max={10} defaultValue={s.perDay} />
          </label>
          <label title="In Mix: how many of the day's posts it may publish by itself">
            By itself (Mix)
            <input type="number" name="autoNews" min={0} max={10} defaultValue={s.autoNews} />
          </label>
          <label title="The score, out of 100, a find needs before it is published without a person">
            Score to publish alone
            <input type="number" name="autoMin" min={30} max={100} defaultValue={s.autoMin} />
          </label>
        </div>
        <div className="dk-scout-save">
          <Button type="submit" variant="good" size="sm" disabled={busy}>
            {busy ? "Saving" : "Save"}
          </Button>
          <span className="dk-scout-today">
            Last 24 h: {data.today.all} of {s.perDay} started{s.mode === "mix" ? `, ${data.today.auto} by itself` : ""}.{" "}
            {s.chat ? "Offers go to the chosen Telegram chat." : "No Telegram chat chosen: send /scout here in the group that should get offers."}
          </span>
          <Said said={said ?? ran} />
        </div>
      </form>
    </Card>
  );
}

function FindRow({ f }: { f: ScoutFind }) {
  const [said, act, busy] = useActionState<ScoutSaid, FormData>(decideFind, null);
  const st = f.published ? { label: "Published", tone: "good" } : STATE[f.state];
  const open = f.state === "found" || f.state === "offered";
  return (
    <li className="dk-scout-find">
      <span className={`dk-scout-score dk-tone-${f.score >= 70 ? "good" : f.score >= 50 ? "info" : "quiet"}`}>{Math.round(f.score)}</span>
      <div className="dk-scout-what">
        <a href={f.url} target="_blank" rel="noreferrer" className="dk-scout-title">
          {f.title}
        </a>
        <p className="dk-scout-meta">
          {f.source} · {f.kind === "news" ? "news" : "article"} · found {ago(f.found_at)}
          {f.why ? ` · ${f.why}` : ""}
        </p>
        <Said said={said} />
      </div>
      <span className={`dk-scout-state dk-tone-${st.tone}`}>
        {st.label}
        {f.state === "queued" && f.decided_by ? ` · ${f.decided_by}` : ""}
      </span>
      {open ? (
        <form action={act} className="dk-scout-acts">
          <input type="hidden" name="id" value={f.id} />
          <Button type="submit" name="action" value="news" size="xs" variant="good" disabled={busy}>
            News
          </Button>
          <Button type="submit" name="action" value="standard" size="xs" disabled={busy}>
            Article
          </Button>
          <Button type="submit" name="action" value="skip" size="xs" variant="ghost" disabled={busy}>
            Skip
          </Button>
        </form>
      ) : f.liveSlug ? (
        <a className="dk-scout-live" href={`https://www.balkaris.ch/insights/${f.liveSlug}`} target="_blank" rel="noreferrer">
          Read it
        </a>
      ) : (
        <span />
      )}
    </li>
  );
}

function SourceRow({ s }: { s: ScoutSource }) {
  const [said, act, busy] = useActionState<ScoutSaid, FormData>(setScoutSource, null);
  return (
    <tr>
      <td>
        <a href={s.url} target="_blank" rel="noreferrer" className="dk-scout-title">
          {s.name}
        </a>
        <span className="dk-scout-meta">
          {s.kind}
          {s.origin === "found" ? " · found by the Scout" : s.origin === "person" ? " · added by a person" : ""}
        </span>
        {s.last_error ? <span className="dk-scout-err">{s.last_error}</span> : null}
        <Said said={said} />
      </td>
      <td className="dk-num">{Math.round(s.score)}</td>
      <td>{s.status === "trial" ? "Trial" : s.status === "paused" ? "Paused" : "Active"}</td>
      <td className="dk-num">
        {s.finds} / {s.kept} / {s.published}
      </td>
      <td className="dk-num">{s.views}</td>
      <td>{s.status === "paused" ? "—" : `every ${every(s.every)}`}</td>
      <td>{ago(s.last_checked)}</td>
      <td>
        <form action={act}>
          <input type="hidden" name="id" value={s.id} />
          <input type="hidden" name="status" value={s.status === "paused" ? "active" : "paused"} />
          <Button type="submit" size="xs" variant="ghost" disabled={busy}>
            {s.status === "paused" ? "Resume" : "Pause"}
          </Button>
        </form>
      </td>
    </tr>
  );
}

function AddSource() {
  const [said, act, busy] = useActionState<ScoutSaid, FormData>(addScoutSource, null);
  return (
    <form action={act} className="dk-scout-add">
      <input name="url" type="text" placeholder="A site, a feed, a YouTube channel feed or a subreddit" aria-label="Add a source" required />
      <Button type="submit" size="sm" icon="plus" disabled={busy}>
        {busy ? "Checking" : "Add source"}
      </Button>
      <Said said={said} />
    </form>
  );
}

export function ScoutPanel({ data }: { data: ScoutPayload }) {
  const waiting = data.finds.filter((f) => f.state === "found" || f.state === "offered");
  const done = data.finds.filter((f) => !(f.state === "found" || f.state === "offered"));
  return (
    <div className="dk-scout">
      <Settings data={data} />
      <Card title="Finds" count={data.finds.length} icon="search" info="The last seven days of finds, best first: waiting for a decision at the top, then what became of the rest. The score is out of 100: how close it is to Balkaris's services, how fresh, how much it is being talked about, and how good its source has proved.">
        {data.finds.length ? (
          <ul className="dk-scout-finds">
            {[...waiting, ...done].map((f) => (
              <FindRow key={f.id} f={f} />
            ))}
          </ul>
        ) : (
          <p className="dk-scout-empty">Nothing found yet. The Scout reads its sources every half hour; Read now starts it at once.</p>
        )}
      </Card>
      <Card
        title="Sources"
        count={data.sources.length}
        icon="globe"
        info="Every source the Scout reads, with the score it earned: what came of its finds (kept, published) and the views those articles got. A good source is read every hour, an average one every three, a weak one twice a day; one that gives nothing for a month is paused. Sources found through Google News start as a trial."
      >
        <AddSource />
        <div className="dk-scout-table">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Score</th>
                <th>Status</th>
                <th title="Found / kept / published">Finds</th>
                <th title="Views of its published articles, 30 days">Views</th>
                <th>Read</th>
                <th>Last read</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.sources.map((s) => (
                <SourceRow key={s.id} s={s} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
