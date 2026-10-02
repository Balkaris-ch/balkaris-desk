"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition, type SelectHTMLAttributes } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "./icons";
import "./select.css";

export interface SelectOption {
  value: string;
  label: string;
}

interface Base {
  options: readonly SelectOption[];
  /** What the select chooses, for a screen reader: "Period", "Status". */
  label: string;
  /** sm sits in a panel's head (30px); md is a form field (36px). */
  size?: "sm" | "md";
  className?: string;
}

export type SelectProps = Base &
  (
    | {
        /**
         * The search param this select writes: choosing "90d" makes the
         * address `?range=90d`, and the page, drawn again by the server,
         * reads it. Choosing the default removes the param, so the plain
         * address is the default view.
         */
        param: string;
        /** The value a bare address means. Default: the first option. */
        fallback?: string;
        /** Other params to drop when this one changes: a page number, a selection. */
        resets?: readonly string[];
        name?: undefined;
      }
    | ({
        /** A plain form field: its value is submitted under this name. */
        name: string;
        param?: undefined;
        fallback?: undefined;
        resets?: undefined;
      } & Pick<SelectHTMLAttributes<HTMLSelectElement>, "defaultValue" | "required" | "disabled">)
  );

/**
 * The browser's own select, drawn as the boards draw it. Native on purpose:
 * it works with the keyboard, on a phone and without script.
 *
 * With `param` it is a filter that writes the address ("Last 30 days", "All
 * status"); the first option is the default unless `fallback` names another. With `name` it is a field in a
 * form.
 */
export function Select(props: SelectProps) {
  const { options, label, size = "sm", className } = props;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busy, go] = useTransition();

  const box = cx("dk-select", `dk-select--${size}`, busy && "dk-select--busy", className);
  const list = options.map((o) => (
    <option key={o.value} value={o.value}>
      {o.label}
    </option>
  ));

  if (props.param === undefined) {
    return (
      <span className={box}>
        <select name={props.name} aria-label={label} defaultValue={props.defaultValue} required={props.required} disabled={props.disabled}>
          {list}
        </select>
        <Icon name="chevron-down" size={14} />
      </span>
    );
  }

  const { param, resets } = props;
  const first = props.fallback ?? options[0]?.value ?? "";
  const asked = params.get(param);
  const value = options.some((o) => o.value === asked) ? (asked as string) : first;

  return (
    <span className={box}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value === first) next.delete(param);
          else next.set(param, e.target.value);
          for (const r of resets ?? []) next.delete(r);
          const q = next.toString();
          go(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
        }}
      >
        {list}
      </select>
      <Icon name="chevron-down" size={14} />
    </span>
  );
}
