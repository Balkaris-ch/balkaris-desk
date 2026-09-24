import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expandUrl, classify, resolve } from "../src/social/resolve.ts";
import { download, probe } from "../src/social/media.ts";
import { makePreview } from "../src/social/preview.ts";

/**
 * What does a preview actually cost, and does it look like anything?
 *
 * Fini, 24 September 2026: *"I need the video to play - like muted"* and
 * *"not with all the tiktok or yt players... that removes those
 * recommendations at the end."* So the clip is ours, which makes its size our
 * problem — the whole reason the first design used an embed was *"we don't
 * upload it on the server because then we will have too many videos."*
 *
 * This resolves a real link, cuts the preview and prints the bytes, so the
 * answer to "how much is this going to cost us" is measured rather than
 * guessed. It writes the files out so they can be looked at.
 *
 *   npm run check:preview -- https://www.tiktok.com/@bbcnews/video/7688929368789372163
 */

const url = process.argv[2];
if (!url) {
  console.error("give it a link");
  process.exit(1);
}

const dir = await mkdtemp(path.join(tmpdir(), "bk-preview-"));
try {
  const expanded = await expandUrl(url);
  const { videoId } = classify(expanded);
  const { transient } = await resolve(expanded);

  const file = path.join(dir, `${videoId}.mp4`);
  const bytes = await download(transient.mediaUrl, file, 120_000);
  const meta = await probe(file);
  console.log(`original   ${(bytes / 1024 / 1024).toFixed(1)} MB   ${meta.width}x${meta.height}   ${Math.round(meta.durationS)}s`);

  const started = Date.now();
  const out = await makePreview(file, dir);
  if (!out) {
    console.error("no preview came back");
    process.exit(1);
  }

  const kb = (b: Buffer) => `${Math.round(b.length / 1024)} KB`;
  console.log(`preview    ${kb(out.clip)}   ${out.seconds}s, silent, long side capped   in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log(`poster     ${kb(out.poster)}`);
  console.log(`saving     ${(out.clip.length / bytes * 100).toFixed(1)}% of the original's size`);

  const where = process.argv[3] ?? ".";
  await writeFile(path.join(where, `${videoId}-preview.mp4`), out.clip);
  await writeFile(path.join(where, `${videoId}-poster.webp`), out.poster);
  console.log(`\nwrote ${videoId}-preview.mp4 and ${videoId}-poster.webp to ${where}`);
} finally {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
