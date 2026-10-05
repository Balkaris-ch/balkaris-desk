"use client";

import { useActionState, useEffect, useState } from "react";
import type { Said } from "@/components/automations/actions";
import { announceAsked } from "@/components/automations/Watch";
import type { Reading } from "@/contract/common";
import type { SeoDigests } from "@/contract/seo/automations";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { cx } from "@/lib/cx";
import { fullDate } from "@/lib/format";
import { askJob, digestTelegram } from "./actions";
import { when } from "./words";

/**
 * The week, in short: the newest summary the seo-digest job wrote (runs,
 * late or failing jobs, opportunities, the index, new phrases, what waits for
 * people, and what went wrong in the jobs' own words), each line linked to
 * where it is seen. "Write it now" asks for the job (the core API's Run now);
 * the owner alone can have it sent to him on Telegram.
 */
export function Digest({ reading, owner, at, canAsk }: { reading: Reading<SeoDigests>; owner: boolean; at: string; canAsk: boolean }) {
  const [ran, runAction, asking] = useActionState<Said | null, FormData>(askJob, null);
  const [set, setAction, setting] = useActionState<Said | null, FormData>(digestTelegram, null);
  const said = useFresh(ran, set);
  useEffect(() => {
    if (ran?.ok) announceAsked();
  }, [ran]);
  const t = reading.state === "ok" ? reading.value.telegram : null;
  return (
    <Card
      id="digest"
      title="The week, in short"
      icon="file-text"
      sub="What the SEO jobs did and found since the summary before, written once a week."
      right={
        <span className="dk-seo-automations-card-right">
          <Stamp reading={reading} />
          {canAsk ? (
            <form action={runAction}>
              <input type="hidden" name="name" value="seo-digest" />
              <Button type="submit" size="sm" icon="refresh" disabled={asking}>
                {asking ? "Asking…" : "Write it now"}
              </Button>
            </form>
          ) : null}
        </span>
      }
    >
      <div className="dk-seo-automations-digest">
        <Read reading={reading}>
          {(d) => {
            const newest = d.list[0]!;
            return (
              <>
                <p className="dk-seo-automations-quiet dk-num">
                  {fullDate(newest.since)} to {fullDate(newest.at)}, written {when(newest.at, at)}
                  {newest.sent === true ? " · sent on Telegram" : newest.sent === false ? " · Telegram could not take it" : ""}
                </p>
                <ul className="dk-seo-automations-digest-lines">
                  {newest.lines.map((l, i) => (
                    <li key={i}>
                      <StatusDot tone={l.tone} />
                      {l.href ? (
                        <Go href={l.href} className="dk-seo-automations-log-link">
                          <span className="dk-seo-automations-log-text">{l.text}</span>
                        </Go>
                      ) : (
                        <span className="dk-seo-automations-log-text">{l.text}</span>
                      )}
                    </li>
                  ))}
                </ul>
                {d.list.length > 1 ? (
                  <details className="dk-seo-automations-steprow-more dk-seo-automations-digest-older">
                    <summary>The {d.list.length - 1} before it</summary>
                    {d.list.slice(1).map((o) => (
                      <div key={o.at}>
                        <p className="dk-seo-automations-more-head">
                          {fullDate(o.since)} to {fullDate(o.at)}
                        </p>
                        <ul className="dk-seo-automations-digest-lines">
                          {o.lines.map((l, i) => (
                            <li key={i}>
                              <StatusDot tone={l.tone} />
                              <span>{l.text}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </details>
                ) : null}
              </>
            );
          }}
        </Read>
        {owner ? (
          <form action={setAction} className="dk-seo-automations-digest-telegram">
            <input type="hidden" name="telegram" value={t?.on ? "0" : "1"} />
            <Button type="submit" size="xs" variant="ghost" icon="send" disabled={setting}>
              {t?.on ? "Stop sending it on Telegram" : "Send it to me on Telegram"}
            </Button>
            <span className="dk-seo-automations-quiet">
              {t?.on ? (t.ready ? "Sent to you each week when it is written." : "Asked for, but the desk cannot reach you on Telegram yet: its bot or your chat is not set.") : "Only you can switch this; it is your chat."}
            </span>
          </form>
        ) : null}
        {said ? (
          <p className={cx("dk-seo-automations-said", !said.ok && "dk-seo-automations-said--bad")} role="status">
            <Icon name={said.ok ? "check" : "alert"} size={14} />
            <span>{said.message}</span>
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/** The newer of two answers, shown for a while, then gone: the card says the rest. */
function useFresh(a: Said | null, b: Said | null): Said | null {
  const newest = !a ? b : !b ? a : a.at >= b.at ? a : b;
  const [shown, setShown] = useState<Said | null>(null);
  useEffect(() => {
    if (!newest) return;
    setShown(newest);
    const t = setTimeout(() => setShown(null), newest.ok ? 12_000 : 20_000);
    return () => clearTimeout(t);
  }, [newest]);
  return shown;
}
