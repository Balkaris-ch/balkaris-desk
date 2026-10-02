import type { ActivityItem } from "@/contract/common";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { ago } from "@/lib/format";
import "@/components/ui/tone.css";
import "./article.css";

/**
 * Which rows of the events log an action writes, by the `done` word the
 * page put in its `back` address. Read from the handlers in src/server.ts.
 */
const WRITES: Record<string, string[]> = {
  publish: ["draft.publish"],
  list: ["draft.list"],
  unlist: ["draft.unlist"],
  takedown: ["draft.remove"],
  redraw: ["cover.redraw.queued"],
  clip: ["clip.queued"],
  attach: ["watch.attach", "watch.pushed", "watch.push.failed"],
  remove: ["draft.removed"],
  retry: ["link.retried"],
};

/** How recent a row must be to be the answer to the button just pressed. */
const FRESH_MS = 10 * 60_000;

/**
 * The result of the action that brought the person back here.
 *
 * The address only says which button was pressed; what happened is read from
 * the desk's log: the newest row that action writes, if it is minutes old.
 * An address typed by hand with `?done=` therefore shows nothing that did not
 * happen, and an action that wrote nothing shows nothing.
 */
export function Done({ done, history }: { done: string | undefined; history: ActivityItem[] }) {
  const kinds = done ? WRITES[done] : undefined;
  if (!kinds) return null;
  const hit = history.find((h) => kinds.includes(h.kind) && Date.now() - Date.parse(h.at) < FRESH_MS);
  if (!hit) return null;
  return (
    <div className={cx("dk-article-done", `dk-tone-${hit.tone === "bad" ? "bad" : hit.tone === "warn" ? "warn" : "good"}`)} role="status">
      <Icon name={hit.tone === "bad" ? "alert" : "check-circle"} size={16} />
      <p>
        <b>{hit.text}</b>
        {hit.detail ? <span>{` · ${hit.detail}`}</span> : null}
        <span className="dk-article-quiet">{` · ${ago(hit.at)}`}</span>
      </p>
    </div>
  );
}
