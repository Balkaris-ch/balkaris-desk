"use client";

import { Icon } from "@/components/ui/icons";
import { THEME_COOKIE, THEME_GROUND, THEME_MAX_AGE, themeOf } from "@/lib/theme";

/**
 * The top bar's sun and moon: one press changes the whole desk between the
 * dark theme and the light one, and the browser remembers it.
 *
 * It keeps no state of its own. The theme is `data-theme` on <html>, which the
 * server set from the cookie; the stylesheet shows the sun in the dark and the
 * moon in the light, so what is drawn can never disagree with the page, and
 * the server and the browser render the same markup.
 */
export function ThemeToggle() {
  const flip = () => {
    const root = document.documentElement;
    const next = themeOf(root.dataset.theme) === "light" ? "dark" : "light";
    root.dataset.theme = next;
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${THEME_MAX_AGE}; samesite=lax${secure}`;
    /* The browser's own bar and its form controls, which the server set for the theme it drew. */
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_GROUND[next]);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", next);
  };

  return (
    <button type="button" className="dk-pop-button dk-top-icon dk-theme" onClick={flip} aria-label="Switch between the dark and the light theme" title="Light or dark theme">
      <Icon name="sun" size={20} className="dk-theme-sun" />
      <Icon name="moon" size={20} className="dk-theme-moon" />
    </button>
  );
}
