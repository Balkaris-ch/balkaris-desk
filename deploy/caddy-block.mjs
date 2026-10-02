// Print /etc/caddy/Caddyfile with the desk's block replaced by deploy/Caddyfile.desk.
//
//   node deploy/caddy-block.mjs /etc/caddy/Caddyfile deploy/Caddyfile.desk > /tmp/Caddyfile.new
//
// It only prints. push.sh validates the result with `caddy validate`, keeps a
// backup, and only then copies it into place and reloads.
//
// WHY A SCRIPT AND NOT `sed`. The file holds two sites. The engine's block
// must come out byte for byte as it went in, and the desk's block must be
// replaced whole, including the comment lines that sit directly above it
// (they are part of what Caddyfile.desk carries). The first version of the
// block was appended from a Windows checkout, so its lines end in CRLF: the
// closing brace is "}\r", which a naive match for "}" misses.
import { readFileSync } from "node:fs";

const [, , livePath, blockPath] = process.argv;
if (!livePath || !blockPath) {
  console.error("usage: node deploy/caddy-block.mjs <Caddyfile> <Caddyfile.desk>");
  process.exit(2);
}

const bare = (l) => l.replace(/\r$/, "");
const live = readFileSync(livePath, "utf8").split("\n");
const block = readFileSync(blockPath, "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, "");

const open = live.findIndex((l) => /^desk\.balkaris\.ch\s*\{\s*$/.test(bare(l)));

let out;
if (open === -1) {
  /* Not there yet: append, after exactly one blank line. */
  const head = live.join("\n").replace(/\n*$/, "\n");
  out = `${head}\n${block}\n`;
} else {
  /* The site's closing brace is the first "}" in column 0 after it opens. */
  let close = -1;
  for (let i = open + 1; i < live.length; i++) {
    if (bare(live[i]) === "}") {
      close = i;
      break;
    }
  }
  if (close === -1) {
    console.error("the desk's block opens and never closes; refusing to touch the file");
    process.exit(1);
  }
  /* The comment lines directly above the block belong to it. */
  let start = open;
  while (start > 0 && bare(live[start - 1]).startsWith("#")) start--;
  /* …unless they run all the way up into another site's closing brace with
     nothing between, in which case they still are ours: the engine's block
     ends with "}" and its own comments sit above ITS opening line. */
  const before = live.slice(0, start).join("\n").replace(/\n*$/, "\n");
  const after = live.slice(close + 1).join("\n").replace(/^\n+/, "");
  out = `${before}${block}\n${after ? `\n${after}` : ""}`;
}

/* One sanity check a typo cannot pass: the engine's site is still in it. */
if (readFileSync(livePath, "utf8").includes("operation.balkaris.ch") && !out.includes("operation.balkaris.ch")) {
  console.error("the engine's block would be lost; refusing");
  process.exit(1);
}

process.stdout.write(out);
