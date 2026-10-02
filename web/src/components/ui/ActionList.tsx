import { cx } from "@/lib/cx";
import { Go } from "./Go";
import { Icon, type IconName } from "./icons";
import "./action-list.css";

interface ActionBase {
  icon: IconName;
  label: string;
  /** A second line under the label: what the action does. */
  description?: string;
}

/**
 * One row of "Quick actions". It is either a link to where the thing is done,
 * or a button that runs a server action: a function marked "use server" that
 * asks the desk server with `apiPost` (lib/api.ts) and then redirects or
 * revalidates. Not a desk path posted by the browser: the desk answers JSON,
 * and the person would be left looking at it. There is no third kind: a row
 * that does nothing is not drawn.
 */
export type ActionItem =
  | (ActionBase & { href: string; action?: undefined })
  | (ActionBase & {
      action: (formData: FormData) => void | Promise<void>;
      /** Hidden fields sent with the form. */
      fields?: Readonly<Record<string, string>>;
      href?: undefined;
    });

export interface ActionListProps {
  items: readonly ActionItem[];
  /** What the list is, for a screen reader: "Quick actions". */
  label: string;
  /** Two columns of rows, as on the Insights board, while the panel is wide enough. */
  columns?: 1 | 2;
  className?: string;
}

/** The "Quick actions" rows: icon, label, optional description, chevron. */
export function ActionList({ items, label, columns = 1, className }: ActionListProps) {
  return (
    <ul className={cx("dk-actions", columns === 2 && "dk-actions--two", className)} aria-label={label}>
      {items.map((it) => {
        const inner = (
          <>
            <span className="dk-action-icon" aria-hidden>
              <Icon name={it.icon} size={16} />
            </span>
            <span className="dk-action-text">
              <span className="dk-action-label">{it.label}</span>
              {it.description ? <span className="dk-action-desc">{it.description}</span> : null}
            </span>
            <Icon name="chevron-right" size={14} className="dk-action-go" />
          </>
        );
        return (
          <li key={it.label}>
            {it.action === undefined ? (
              <Go href={it.href} className="dk-action">
                {inner}
              </Go>
            ) : (
              <form action={it.action} className="dk-action-form">
                {Object.entries(it.fields ?? {}).map(([name, value]) => (
                  <input key={name} type="hidden" name={name} value={value} />
                ))}
                <button type="submit" className="dk-action">
                  {inner}
                </button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
