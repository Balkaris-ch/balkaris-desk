/**
 * The two themes stay one system.
 *
 * The light theme is one block of tokens.css because no component writes a
 * colour of its own. This proves the three things that keeps true:
 *
 *   1. every colour the dark blocks declare has a light value, and the light
 *      block declares nothing the dark ones do not;
 *   2. no stylesheet but tokens.css, and no component, contains a colour;
 *   3. the ground the browser's own bar is given (web/src/lib/theme.ts) is
 *      each theme's --bg.
 *
 *   npm run check:theme
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WEB = new URL("../web/src/", import.meta.url);
const root = decodeURIComponent(WEB.pathname).replace(/^\/([A-Za-z]:)/, "$1");
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

let failed = 0;
const ok = (line) => console.log(`  ok   ${line}`);
const fail = (line, detail = []) => {
  failed += 1;
  console.log(`  FAIL ${line}`);
  for (const d of detail.slice(0, 20)) console.log(`         ${d}`);
  if (detail.length > 20) console.log(`         and ${detail.length - 20} more`);
};

/* A colour written out: hex, a colour function with numbers in it, or a named black or white. */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*[^v)]|(?<![-\w])(?:white|black)(?![-\w])/;
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/* ---- 1. tokens.css: each theme's declarations ---- */
const tokens = noComments(read(join(root, "styles/tokens.css")));
const dark = new Map();
const light = new Map();
for (const m of tokens.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selector = m[1].trim();
  const into = selector === ":root" ? dark : selector === ':root[data-theme="light"]' ? light : null;
  if (!into) {
    fail(`tokens.css has a block this check does not know: ${selector}`);
    continue;
  }
  for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) into.set(d[1], d[2].trim());
}
const darkColours = [...dark].filter(([, v]) => COLOUR.test(v)).map(([k]) => k);
const missing = darkColours.filter((k) => !light.has(k));
const orphans = [...light.keys()].filter((k) => !dark.has(k));
const notColour = [...light].filter(([k, v]) => dark.has(k) && !COLOUR.test(dark.get(k)) && !COLOUR.test(v)).map(([k]) => k);

if (missing.length) fail(`${missing.length} colour token(s) have no light value in :root[data-theme="light"]`, missing);
else ok(`all ${darkColours.length} colour tokens have a light value`);
if (orphans.length) fail("the light block declares tokens the dark blocks do not", orphans);
else ok("the light block declares nothing new");
if (notColour.length) fail("the light block changes tokens that are not colours (sizes and percentages are shared)", notColour);
else ok("the light block changes colours only");
/* color-scheme is a property, not a custom property, so it is not in the maps: look for both by text. */
if (/:root\s*\{[^}]*color-scheme:\s*dark/.test(tokens) && /:root\[data-theme="light"\]\s*\{[^}]*color-scheme:\s*light/.test(tokens)) ok("each theme sets its color-scheme");
else fail("a theme does not set color-scheme (form controls and scrollbars follow it)");

/* ---- 2. nothing else writes a colour ---- */
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(css|tsx?)$/.test(name)) files.push(p);
  }
};
walk(root);

const inCss = [];
const inCode = [];
for (const p of files) {
  const rel = relative(root, p).replace(/\\/g, "/");
  if (rel === "styles/tokens.css" || rel === "lib/theme.ts") continue;
  if (p.endsWith(".css")) {
    noComments(read(p))
      .split("\n")
      .forEach((line, i) => {
        if (COLOUR.test(line.replace(/white-space/g, ""))) inCss.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
  } else {
    /* In a component: a hex or a colour function inside a string or a style. Words like "white" are prose there. */
    const code = read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    code.split("\n").forEach((line, i) => {
      if (/["'`][^"'`]*(#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-zA-Z])|\brgba?\(\s*\d)/.test(line) && !/href=|&#|url\(/.test(line)) inCode.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }
}
if (inCss.length) fail("a stylesheet other than tokens.css writes a colour: name it in tokens.css, in both themes", inCss);
else ok(`no colour in ${files.filter((f) => f.endsWith(".css")).length - 1} component stylesheets`);
if (inCode.length) fail("a component writes a colour: use a token through its stylesheet", inCode);
else ok(`no colour in ${files.filter((f) => !f.endsWith(".css")).length} components and modules`);

/* ---- 3. the browser's bar ---- */
const themeTs = read(join(root, "lib/theme.ts"));
const ground = (name) => themeTs.match(new RegExp(`${name}:\\s*"(#[0-9a-fA-F]{6})"`))?.[1]?.toLowerCase();
const same = ground("dark") === dark.get("--bg")?.toLowerCase() && ground("light") === light.get("--bg")?.toLowerCase();
if (same) ok("lib/theme.ts gives the browser's bar each theme's --bg");
else fail(`lib/theme.ts THEME_GROUND (${ground("dark")}, ${ground("light")}) is not --bg (${dark.get("--bg")}, ${light.get("--bg")})`);

console.log(failed ? `\n${failed} failed.` : "\nall passed.");
process.exitCode = failed ? 1 : 0;
