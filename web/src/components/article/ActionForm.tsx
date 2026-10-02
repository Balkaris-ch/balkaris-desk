import type { ReactNode } from "react";
import { Button, type ButtonVariant } from "@/components/ui/Button";
import type { IconName } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import "./article.css";

export interface Confirm {
  /** The question: "Take it off the site?" */
  title: string;
  /** What will happen, in plain words, before anybody presses yes. */
  body: ReactNode;
  /** The button that does it. */
  yes: string;
}

export interface ActionFormProps {
  /** The old console's handler this posts to: "/draft/12/publish". */
  post: string;
  /** Where to land afterwards: this page. The handler honours it only under /insights/ (src/server.ts `backTo`). */
  back: string;
  label: string;
  /** One sentence beside the button: what it does to the article and to the site. */
  explain?: ReactNode;
  variant?: ButtonVariant;
  icon?: IconName;
  /** Asked before the form is sent, for what changes the live site or deletes. */
  confirm?: Confirm | null;
  /** Fields the handler reads besides `back`. */
  fields?: Record<string, string>;
  className?: string;
}

/**
 * One of the old console's actions, as a real form.
 *
 * It posts to the same handler the old page posts to (src/server.ts), which
 * keeps its own checks, so nothing about who may do what lives in the
 * interface. It needs no JavaScript: the form is plain HTML, and the
 * confirmation is the browser's own popover (`popovertarget`), which opens
 * and closes without a script. In a browser without popovers the question is
 * shown in place, under the button, and the form still works.
 */
export function ActionForm({ post, back, label, explain, variant = "quiet", icon, confirm, fields, className }: ActionFormProps) {
  const id = `dk-article-ask-${post.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`;
  const hidden = (
    <>
      <input type="hidden" name="back" value={back} />
      {Object.entries(fields ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );

  return (
    <div className={cx("dk-article-act", className)}>
      {confirm ? (
        <>
          <Button variant={variant} size="sm" icon={icon} popoverTarget={id} aria-haspopup="dialog">
            {label}
          </Button>
          <div id={id} popover="auto" className="dk-article-ask" role="dialog" aria-labelledby={`${id}-q`}>
            <p id={`${id}-q`} className="dk-article-ask-q">
              {confirm.title}
            </p>
            <div className="dk-article-ask-body">{confirm.body}</div>
            <form method="post" action={post} className="dk-article-ask-row">
              {hidden}
              <Button variant="quiet" size="sm" popoverTarget={id} popoverTargetAction="hide">
                Cancel
              </Button>
              <Button type="submit" variant={variant === "danger" ? "danger" : "primary"} size="sm">
                {confirm.yes}
              </Button>
            </form>
          </div>
        </>
      ) : (
        <form method="post" action={post} className="dk-article-act-form">
          {hidden}
          <Button type="submit" variant={variant} size="sm" icon={icon}>
            {label}
          </Button>
        </form>
      )}
      {explain ? <p className="dk-article-act-why">{explain}</p> : null}
    </div>
  );
}
