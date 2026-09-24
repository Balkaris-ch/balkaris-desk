import { ensureComfy, release } from "../src/ensure.ts";

/**
 * Does the runner actually give the machine back?
 *
 * Fini, 24 September 2026: *"when I send a message it wakes up anything it
 * needs and then when job finish it turn it off."* This proves the second
 * half without queueing a job, drawing anything or committing to the site:
 * start ComfyUI the way a cover job would, then release it the way an empty
 * queue does, and look at what is left.
 *
 * It is worth having as a script rather than a one-off because the mechanism
 * is full of things that failed SILENTLY: pythonw, which starts ComfyUI and
 * then kills it the moment it prints; a pid note that outlives the process it
 * names; and an identity check that asked wmic, which Windows 11 no longer
 * has. Every one of those read as "ComfyUI was not ours" and left the card
 * held while the log said nothing was wrong.
 *
 *   npm run check:release
 */

const COMFY = (process.env.COMFY_URL ?? "http://127.0.0.1:8189").replace(/\/$/, "");

const up = async () => {
  try {
    return (await fetch(`${COMFY}/system_stats`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
};

if (await up()) {
  console.log("ComfyUI is already running — close it first, or this proves nothing.");
  process.exit(1);
}

console.log("starting ComfyUI the way a cover job would…");
if (!(await ensureComfy())) {
  console.error("  it would not start.");
  process.exit(1);
}
console.log(`  up: ${await up()}`);

console.log("\nqueue is empty — releasing…");
const freed = await release();
console.log(`  ${freed.length ? freed.join(", ") : "NOTHING FREED"}`);

/* It is asked to close, not killed outright, so give it a moment to go. */
await new Promise((r) => setTimeout(r, 4000));

const still = await up();
console.log(`\n  ComfyUI still answering: ${still}`);

const ok = freed.includes("closed ComfyUI") && !still;
console.log(ok ? "\nit gives the machine back." : "\nIT DID NOT. The card stays held.");
process.exit(ok ? 0 : 1);
