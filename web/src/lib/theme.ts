/**
 * The desk's two themes.
 *
 * Dark is the boards' and the default. The choice is one cookie, so the server
 * draws the right theme on the first byte (the root layout puts `data-theme`
 * on <html>) and no script has to run before paint: the content policy allows
 * none without a nonce, and a flash of the wrong ground is what an inline
 * theme script exists to prevent.
 *
 * The cookie is the browser's, not the person's: a phone and a workstation
 * each remember their own.
 */
export type Theme = "dark" | "light";

export const THEME_COOKIE = "dk-theme";

/** A year: the choice is kept until the person changes it. */
export const THEME_MAX_AGE = 60 * 60 * 24 * 365;

/** Anything but "light" is dark, so a missing or mangled cookie is the boards' theme. */
export const themeOf = (value: string | undefined | null): Theme => (value === "light" ? "light" : "dark");

/**
 * Each theme's --bg (styles/tokens.css), for the browser's own bar: it takes
 * the colour before any stylesheet loads and cannot read a token. Change
 * these with the tokens.
 */
export const THEME_GROUND: Record<Theme, string> = { dark: "#060909", light: "#f2f4f3" };
