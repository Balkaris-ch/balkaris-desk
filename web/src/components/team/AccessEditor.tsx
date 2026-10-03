"use client";

import { useActionState, useId } from "react";
import type { AccessLevel } from "@/contract/common";
import type { AccessArea, AccessPerson, AccessPreset } from "@/contract/team";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { applyPreset, saveAccess } from "./actions";
import { Answer } from "./parts";

const LEVEL_WORD: Record<AccessLevel, string> = { none: "No access", view: "View", edit: "Edit" };

/**
 * The owner's choice of what one person may do, area by area: the same thing
 * the engine's access matrix does (balkaris-engine, Team & access), for the
 * desk's sixteen areas. A template fills every row at once; the rows change
 * one area, or one of SEO's pages, at a time. Saved together, checked again
 * on the server (src/cc/routes/team.ts), and refused there for anybody but
 * the owner.
 */
export function AccessEditor({ person, areas, presets }: { person: AccessPerson; areas: AccessArea[]; presets: AccessPreset[] }) {
  const [said, act, busy] = useActionState(saveAccess, null);
  /* The rows are drawn again from what the server now holds whenever it changes (a template applied, a save), so no
     choice on screen is one the desk did not keep. The answers live up here and survive that. */
  const held = JSON.stringify([person.pages, person.overridden, person.leadsGranted]);
  return (
    <div className="dk-team-editor">
      <PresetForm person={person} presets={presets} />
      <form key={held} action={act} className="dk-team-form">
        <input type="hidden" name="id" value={person.id} />
        <div className="dk-team-areas" role="group" aria-label={`What ${person.name} may do`}>
          <div className="dk-team-area dk-team-area--head" aria-hidden>
            <span>Area</span>
            <span>Access</span>
          </div>
          {areas.map((a) => (
            <AreaRow key={a.key} area={a} person={person} />
          ))}
        </div>
        <div className="dk-team-formfoot">
          <Answer said={said} />
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            {busy ? "Saving" : "Save access"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function PresetForm({ person, presets }: { person: AccessPerson; presets: AccessPreset[] }) {
  const [said, act, busy] = useActionState(applyPreset, null);
  return (
    <form action={act} className="dk-team-preset">
      <input type="hidden" name="id" value={person.id} />
      <span className="dk-team-preset-label">Start from a template</span>
      <span className="dk-team-preset-pick">
        <Select
          name="preset"
          label="Template"
          defaultValue={presets.some((p) => p.key === person.role.key) ? person.role.key : ""}
          options={[{ value: "", label: "Choose a template…" }, ...presets.map((p) => ({ value: p.key, label: p.label }))]}
        />
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Applying" : "Apply"}
        </Button>
      </span>
      <Answer said={said} />
    </form>
  );
}

function AreaRow({ area, person }: { area: AccessArea; person: AccessPerson }) {
  const level = person.areas[area.key] ?? "none";
  const leads = useId();
  return (
    <div className={`dk-team-area${area.sensitive ? " dk-team-area--sensitive" : ""}`}>
      <span className="dk-team-area-text">
        <span className="dk-team-area-name">
          {area.label}
          {area.sensitive ? <Icon name="lock" size={12} title="Personal data" /> : null}
        </span>
        <span className="dk-team-area-about">{area.about}</span>
      </span>
      <span className="dk-team-area-pick">
        <Levels name={`area:${area.key}`} levels={area.levels} value={level} label={area.label} />
      </span>
      {area.key === "leads" ? (
        <div className="dk-team-sub dk-team-sub--check">
          <input type="hidden" name="leads-shown" value="1" />
          <input id={leads} className="dk-team-check" type="checkbox" name="leads" defaultChecked={person.leadsGranted} />
          <label htmlFor={leads} className="dk-team-area-text">
            <span className="dk-team-area-name">Names, contact details and messages</span>
            <span className="dk-team-area-about">
              {person.leadsGranted && !person.seesLeads && !person.revoked ? "Granted, and without Leads it shows nothing: give Leads as well. " : ""}
              Without it, Leads shows counts only. An enquiry is a stranger&apos;s personal data: give it person by person.
            </span>
          </label>
        </div>
      ) : null}
      {area.pages.length ? (
        <details className="dk-team-pages" open={area.pages.some((p) => person.overridden.includes(p.key))}>
          <summary className="dk-team-pages-sum">
            <Icon name="chevron-right" size={12} />
            {area.pages.some((p) => p.ownerOnly) ? `${area.label}'s pages` : `Set ${area.label}'s ${area.pages.length} pages one by one`}
            {area.pages.some((p) => person.overridden.includes(p.key)) ? <span className="dk-team-pages-count">{area.pages.filter((p) => person.overridden.includes(p.key)).length} set on their own</span> : null}
          </summary>
          {area.pages.map((p) =>
            p.ownerOnly ? (
              <div key={p.key} className="dk-team-sub">
                <span className="dk-team-area-text">
                  <span className="dk-team-sub-name">{p.label}</span>
                </span>
                <span className="dk-team-quiet dk-team-sub-fixed">
                  <Icon name="lock" size={12} /> The owner&apos;s alone
                </span>
              </div>
            ) : (
              <div key={p.key} className="dk-team-sub">
                <span className="dk-team-area-text">
                  <span className="dk-team-sub-name">{p.label}</span>
                </span>
                <span>
                  <Select
                    name={`page:${p.key}`}
                    label={`${area.label} › ${p.label}`}
                    defaultValue={person.overridden.includes(p.key) ? person.pages[p.key] : ""}
                    options={[{ value: "", label: `As ${area.label}` }, ...area.levels.map((l) => ({ value: l, label: LEVEL_WORD[l] }))]}
                  />
                </span>
              </div>
            ),
          )}
        </details>
      ) : null}
    </div>
  );
}

/** None / View / Edit as one control: radio buttons drawn as a segmented switch, native so the keyboard works. */
function Levels({ name, levels, value, label }: { name: string; levels: AccessLevel[]; value: AccessLevel; label: string }) {
  return (
    <span className="dk-team-seg" role="radiogroup" aria-label={`${label}: access`}>
      {levels.map((l) => (
        <label key={l} className={`dk-team-seg-opt dk-team-seg-opt--${l}`}>
          <input type="radio" name={name} value={l} defaultChecked={l === value} />
          <span>{LEVEL_WORD[l]}</span>
        </label>
      ))}
    </span>
  );
}
