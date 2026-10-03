import type { ReactNode } from "react";
import type { ShownFailure } from "@/lib/failure";
import { cx } from "@/lib/cx";
import { Icon, type IconName } from "@/components/ui/icons";
import "./gate.css";

/**
 * What a gate can say. The first five are the desk server's failures
 * (lib/failure.ts); `broken` is a fault in the interface itself, and
 * `not-found` an address with nothing behind it.
 */
export type GateKind = ShownFailure | "broken" | "not-found" | "waiting";

const TEXT: Record<GateKind, { icon: IconName; title: string; text: string }> = {
  down: {
    icon: "server",
    title: "The desk server is not answering",
    text: "This interface is running, but the server that holds the data did not answer. It restarts by itself after an update; try again in a moment.",
  },
  off: {
    icon: "lock",
    title: "This account has been switched off",
    text: "The desk knows this account but no longer lets it in. The owner can switch it back on under People.",
  },
  forbidden: {
    icon: "lock",
    title: "This part is not open to this account",
    text: "The desk lets this account in, but not into this. The owner chooses what each person sees and changes, under Team › Access & Roles.",
  },
  waiting: {
    icon: "clock",
    title: "Waiting for access",
    text: "You are signed in, and the owner has not given this account any part of the desk yet. Once that is done, the desk opens here: there is nothing else to do.",
  },
  missing: {
    icon: "search",
    title: "The desk server has nothing here",
    text: "The screen asked the server for something it does not have. If the desk was just updated, the server may still be starting.",
  },
  error: {
    icon: "alert",
    title: "The desk server answered with an error",
    text: "The server is running but could not answer this. Trying again is safe; if it keeps happening, the server's log says why.",
  },
  broken: {
    icon: "alert",
    title: "This screen could not be drawn",
    text: "Something in the interface itself failed. No data was changed. Trying again is safe.",
  },
  "not-found": {
    icon: "search",
    title: "There is nothing at this address",
    text: "The address may be mistyped, or the thing it pointed to is gone.",
  },
};

export interface GateProps {
  kind: GateKind;
  /** What the server said, in its own words, when it said something. */
  detail?: string;
  /** Buttons and links: try again, sign out, go home. */
  children?: ReactNode;
  /**
   * `page` fills the window and carries the wordmark: used when the frame
   * itself cannot be drawn. `panel` sits where a screen would, inside the frame.
   */
  form?: "page" | "panel";
}

/**
 * The calm screen shown instead of a stack trace: the server is down, the
 * account is off, the address leads nowhere. One sentence of what happened,
 * one of what to do, and the buttons that do it.
 */
export function Gate({ kind, detail, children, form = "panel" }: GateProps) {
  const t = TEXT[kind];
  return (
    <div className={cx("dk-gate", `dk-gate--${form}`)}>
      {form === "page" ? (
        <p className="dk-gate-brand">
          <span className="dk-brand-name">BALKARIS</span>
          <span className="dk-brand-slash" aria-hidden>
            /
          </span>
          <span className="dk-brand-desk">desk</span>
        </p>
      ) : null}
      <div className="dk-gate-box" role={kind === "not-found" ? undefined : "alert"}>
        <span className="dk-gate-mark" aria-hidden>
          <Icon name={t.icon} size={20} />
        </span>
        <h1 className="dk-gate-title">{t.title}</h1>
        <p className="dk-gate-text">{t.text}</p>
        {detail ? <p className="dk-gate-detail">{detail}</p> : null}
        {children ? <div className="dk-gate-actions">{children}</div> : null}
      </div>
    </div>
  );
}
