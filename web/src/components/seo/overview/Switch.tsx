"use client";

import { useActionState } from "react";
import { switchJob } from "@/components/automations/actions";
import { cx } from "@/lib/cx";
import "./overview.css";

/**
 * A job's on/off switch on the Automations strip. Only the owner is shown
 * it; the desk server refuses anybody else regardless (POST
 * /api/v1/jobs/:name/enabled). Its answer is the switch's title and, when it
 * refuses, a line under it.
 */
export function JobSwitch({ name, title, enabled }: { name: string; title: string; enabled: boolean }) {
  const [said, action, pending] = useActionState(switchJob, null);
  return (
    <form action={action} className="dk-seo-overview-switch-form">
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
      <button
        type="submit"
        role="switch"
        aria-checked={enabled}
        aria-label={`"${title}" is ${enabled ? "on" : "off"}. Switch it ${enabled ? "off" : "on"}`}
        className={cx("dk-seo-overview-switch", enabled && "dk-seo-overview-switch--on")}
        disabled={pending}
        title={said?.message}
      >
        <span className="dk-seo-overview-switch-knob" />
      </button>
      {said && !said.ok ? (
        <span className="dk-seo-overview-said dk-seo-overview-said--bad dk-seo-overview-switch-said" role="alert">
          {said.message}
        </span>
      ) : null}
    </form>
  );
}
