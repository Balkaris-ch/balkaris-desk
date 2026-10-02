import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cx } from "@/lib/cx";
import "./field.css";

export interface FieldProps {
  /** The field's name as a person reads it: "Title". */
  label: string;
  /** A quiet line under the box: what is expected, or what went wrong. */
  hint?: ReactNode;
  /** The hint is an error: drawn in red and announced. */
  error?: boolean;
  /** The input itself: an Input, a Textarea, a Select with `name`. */
  children: ReactNode;
  className?: string;
}

/**
 * A label over a form control, with an optional hint. The label wraps the
 * control, so clicking the words focuses it and no id has to be invented.
 */
export function Field({ label, hint, error, children, className }: FieldProps) {
  return (
    <label className={cx("dk-field", className)}>
      <span className="dk-field-label">{label}</span>
      {children}
      {hint ? (
        <span className={cx("dk-field-hint", error && "dk-field-hint--error")} role={error ? "alert" : undefined}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/** A one-line text box. Takes everything an <input> takes. */
export function Input({ className, type = "text", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type={type} className={cx("dk-input", className)} {...rest} />;
}

/** A text box of several lines. Takes everything a <textarea> takes. */
export function Textarea({ className, rows = 4, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={cx("dk-input", className)} {...rest} />;
}
