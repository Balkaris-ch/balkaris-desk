"use client";

import { useActionState, useMemo, useState } from "react";
import type { HighlightMode, HighlightPlace, HighlightProject, HighlightSettings, HighlightsPayload, Practice } from "@/contract/highlights";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { saveHighlights, type SaveResult } from "./highlights-actions";
import "./highlights.css";

/**
 * Project highlights: which case studies balkaris.ch puts first, place by
 * place, and how each place chooses (src/cc/highlights.ts says the rules).
 *
 * The preview beside each place is worked out here with the server's own
 * rules, so a change shows before it is saved; saving sends the choices, the
 * server works the order out again from fresh views and commits it.
 */

const PLACES: { key: HighlightPlace; label: string; about: string }[] = [
  { key: "home", label: "Home page", about: "The one project “Selected work” shows on the home page." },
  { key: "digital", label: "Digital", about: "Listed first under Digital on /work and in the menu." },
  { key: "growth", label: "Growth", about: "Listed first under Growth on /work and in the menu." },
  { key: "studio", label: "Studio", about: "Listed first under Studio on /work and in the menu." },
];

const MODES: { key: HighlightMode; label: string; about: string }[] = [
  { key: "smart", label: "Smart", about: "Most viewed in the last 30 days; the newest when nothing has views yet." },
  { key: "latest", label: "Latest", about: "The most recently published." },
  { key: "pick", label: "Pick", about: "Your choice, in your order." },
];

const newest = (a: HighlightProject, b: HighlightProject) => (b.published ?? "").localeCompare(a.published ?? "");

function order(list: HighlightProject[], mode: HighlightMode, pick: string[]): HighlightProject[] {
  if (mode === "pick") {
    const chosen = pick.map((s) => list.find((p) => p.slug === s)).filter((p): p is HighlightProject => !!p);
    return [...chosen, ...list.filter((p) => !chosen.includes(p)).sort(newest)];
  }
  if (mode === "latest" || !list.some((p) => (p.views ?? 0) > 0)) return [...list].sort(newest);
  return [...list].sort((a, b) => (b.views ?? 0) - (a.views ?? 0) || newest(a, b));
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "date unknown");

export function HighlightsPanel({ data }: { data: HighlightsPayload }) {
  const [s, setS] = useState<HighlightSettings>(data.settings);
  const [said, act, busy] = useActionState<SaveResult, FormData>(saveHighlights, null);

  const forPlace = (place: HighlightPlace) => (place === "home" ? data.projects : data.projects.filter((p) => p.practice === (place as Practice)));
  const preview = useMemo(() => {
    const out = {} as Record<HighlightPlace, HighlightProject[]>;
    for (const { key } of PLACES) {
      const o = order(forPlace(key), s.places[key].mode, s.places[key].pick);
      out[key] = key === "home" ? o.slice(0, 1) : o.slice(0, s.perPractice);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, data.projects]);

  const setMode = (place: HighlightPlace, mode: HighlightMode) => setS({ ...s, places: { ...s.places, [place]: { ...s.places[place], mode } } });
  const toggle = (place: HighlightPlace, slug: string) => {
    const pick = s.places[place].pick;
    const next = pick.includes(slug) ? pick.filter((x) => x !== slug) : place === "home" ? [slug] : [...pick, slug];
    setS({ ...s, places: { ...s.places, [place]: { ...s.places[place], pick: next } } });
  };
  const move = (place: HighlightPlace, slug: string, by: -1 | 1) => {
    const pick = [...s.places[place].pick];
    const i = pick.indexOf(slug);
    const j = i + by;
    if (i < 0 || j < 0 || j >= pick.length) return;
    [pick[i], pick[j]] = [pick[j], pick[i]];
    setS({ ...s, places: { ...s.places, [place]: { ...s.places[place], pick } } });
  };

  const changed = JSON.stringify(s) !== JSON.stringify(data.settings);
  const live = data.written;

  return (
    <Card
      id="highlights"
      title="Project highlights"
      icon="star"
      info="Which case studies balkaris.ch shows first. Each place chooses by views (Smart), by date (Latest) or by your pick. Saving commits it to the website; Smart and Latest are worked out again every day and committed when they change."
      right={
        <label className="dk-hl-count">
          Per practice
          <select value={s.perPractice} onChange={(e) => setS({ ...s, perPractice: Number(e.target.value) })} aria-label="How many projects each practice puts first">
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      }
    >
      {data.error ? <p className="dk-hl-note">{data.error}</p> : null}
      {!data.projects.length && !data.error ? <p className="dk-hl-note">The website has no published project yet.</p> : null}

      <div className="dk-hl-places">
        {PLACES.map(({ key, label, about }) => {
          const list = forPlace(key);
          const place = s.places[key];
          return (
            <section key={key} className="dk-hl-place" aria-label={label}>
              <header className="dk-hl-head">
                <h3>{label}</h3>
                <p>{about}</p>
              </header>
              <div className="dk-hl-modes" role="radiogroup" aria-label={`How ${label} chooses`}>
                {MODES.map((m) => (
                  <button key={m.key} type="button" role="radio" aria-checked={place.mode === m.key} className={place.mode === m.key ? "dk-hl-mode dk-hl-mode--on" : "dk-hl-mode"} title={m.about} onClick={() => setMode(key, m.key)}>
                    {m.label}
                  </button>
                ))}
              </div>

              <ul className="dk-hl-list">
                {(place.mode === "pick" ? order(list, "pick", place.pick) : order(list, place.mode, place.pick)).map((p) => {
                  const shown = preview[key].includes(p);
                  const picked = place.pick.indexOf(p.slug);
                  return (
                    <li key={p.slug} className={shown ? "dk-hl-row dk-hl-row--shown" : "dk-hl-row"}>
                      {place.mode === "pick" ? (
                        <input type="checkbox" checked={picked >= 0} onChange={() => toggle(key, p.slug)} aria-label={`Highlight ${p.client}`} />
                      ) : (
                        <span className="dk-hl-dot" aria-hidden>
                          {shown ? <Icon name="check" size={14} /> : null}
                        </span>
                      )}
                      <span className="dk-hl-name">
                        <a href={`https://www.balkaris.ch${p.href}`} target="_blank" rel="noreferrer">
                          {p.client}
                        </a>
                        <span className="dk-hl-meta">
                          {p.views === null ? "views unknown" : `${p.views} view${p.views === 1 ? "" : "s"} in 30 days`} · {day(p.published)}
                        </span>
                      </span>
                      {place.mode === "pick" && picked >= 0 && key !== "home" ? (
                        <span className="dk-hl-move">
                          <Button variant="ghost" size="xs" icon="arrow-up" aria-label={`Move ${p.client} up`} onClick={() => move(key, p.slug, -1)} disabled={picked === 0} />
                          <Button variant="ghost" size="xs" icon="arrow-down" aria-label={`Move ${p.client} down`} onClick={() => move(key, p.slug, 1)} disabled={picked === place.pick.length - 1} />
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <p className="dk-hl-why">
                {key === "home" ? "Home shows " : "First: "}
                <b>{preview[key].map((p) => p.client).join(", ") || "nothing"}</b>
              </p>
            </section>
          );
        })}
      </div>

      <form action={act} className="dk-hl-save">
        <input type="hidden" name="settings" value={JSON.stringify(s)} />
        <Button type="submit" variant="good" size="sm" icon="check" disabled={busy}>
          {busy ? "Committing" : "Save and publish"}
        </Button>
        <span className="dk-hl-said" role="status">
          {said ? said.message : changed ? "Not saved yet." : live ? `On the website: home ${live.home ?? "none"}, then ${live.featured.join(", ") || "none"}.` : "Not on the website yet: until you save, it keeps the order written in its code."}
        </span>
      </form>
    </Card>
  );
}
