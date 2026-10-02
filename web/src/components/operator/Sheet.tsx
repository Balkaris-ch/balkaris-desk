"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/ui/icons";
import "@/components/ui/dialog.css";

/**
 * A dialog opened by something that is not a button of the Dialog
 * primitive's own: an action card, a row's Review. The same browser
 * <dialog> and the same look as components/ui/Dialog.tsx (its stylesheet),
 * with the open state held by the caller. The content is mounted only while
 * it is open, so a form starts clean every time.
 */
export function Sheet({ open, onClose, title, description, size = "md", children }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; size?: "sm" | "md"; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx("dk-dialog", `dk-dialog--${size}`)}
      aria-labelledby={heading}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open ? (
        <div className="dk-dialog-panel">
          <header className="dk-dialog-head">
            <div>
              <h2 id={heading} className="dk-dialog-title">
                {title}
              </h2>
              {description ? <p className="dk-dialog-desc">{description}</p> : null}
            </div>
            <button type="button" className="dk-dialog-x" aria-label="Close" onClick={onClose}>
              <Icon name="x" size={16} />
            </button>
          </header>
          <div className="dk-dialog-body">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
