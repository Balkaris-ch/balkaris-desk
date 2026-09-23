import sharp from "sharp";
import { ask, QUICK_MODEL } from "./llm.ts";
import type { TopicId } from "./catalogue.ts";

/**
 * The picture at the top of an article, drawn here and never photographed.
 *
 * Fini, 23 September 2026: *"abstract — no fake photos."* Which is the right
 * call and worth writing down: a fabricated photograph of a place that does
 * not exist, on a company's own journal, is a thing somebody eventually has
 * to explain. An abstract composition is honestly what it is — a made image —
 * and it can look deliberate rather than merely plausible.
 *
 * THE LOOK IS HARD-CODED, exactly as the article's format is. `HOUSE` below is
 * the whole visual system and the model never sees a free hand: it is given
 * two or three nouns for the SUBJECT and everything else — the palette, the
 * material, the light, the framing — is fixed. Thirty covers that share a
 * system read as a journal; thirty that each invented their own read as a
 * stock library.
 *
 * Z-Image Turbo, 8 steps, cfg 1.0, on the workstation's 4090. The graph is
 * the one `workstation-gens/studio/presets.py` already proved for its
 * flash-photo preset — copied, not re-derived, because the loader/encoder/VAE
 * combination for this model is not guessable and is exactly the kind of
 * thing that costs an afternoon.
 */

const COMFY = (process.env.COMFY_URL ?? "http://127.0.0.1:8189").replace(/\/$/, "");

/** 16:10, which is what the journal's card and the article header both want. */
const W = 1280;
const H = 800;

/**
 * The house style. Every cover is this; only the subject changes.
 *
 * Green is the site's own #25f716 named in words, because a diffusion model
 * reads "electric lime green" and does not read a hex code.
 */
/*
 * Rewritten a fourth time, because every cover came out looking like the last
 * one. The house style was ONE recipe — "four or five bold shapes filling the
 * frame, greyscale with one green" — and a single recipe run thirty times is
 * thirty variations of one picture, however good that picture is.
 *
 * So the system now has a CONSTANT and a VARIABLE, the way the articles do.
 * HOUSE is what never changes: flat, hard-edged, printed, greyscale with one
 * green, no text. LAYOUTS is eight genuinely different compositions, and
 * `pickLayout` chooses one from the slug — deterministic, so an article always
 * has the same cover, and spread, so the journal does not.
 *
 * Earlier attempts and what each taught, kept so nobody repeats them:
 *   1. "flat vector, generous negative space" -> a glossy op-art spiral
 *      filling the frame. A model renders unless told several times that there
 *      is no depth, and a shape with no stated size becomes the whole picture.
 *   2. Over-corrected to "one large empty field, small shapes lower right" ->
 *      a beige field with two tiny marks.
 *   3. Naming the genre — Bauhaus poster, mid-century Swiss — landed the look
 *      but not the variety, which is this pass.
 * And "one shape in green" reads as "green is in the palette" and comes back
 * three times; saying what the OTHER shapes are is what holds it to one.
 */
const HOUSE =
  "flat geometric abstraction, mid-century Swiss graphic design, silkscreen print, " +
  "flat solid colour, hard edges, no shading, no gradient, no perspective, no 3d, no texture, " +
  "almost entirely greyscale — charcoal, warm grey, bone white — " +
  "with ONE shape in bright electric lime green and every other shape grey, white or charcoal, " +
  "no text, no letters, no logos, no people, not a photograph";

/**
 * Eight compositions. Each one is a different PICTURE, not a different mood.
 *
 * Written as instructions to a printer rather than adjectives, because
 * "dynamic" gets ignored and "one diagonal band from the lower left to the
 * upper right" does not.
 */
const LAYOUTS: { name: string; how: string }[] = [
  /* Each layout NAMES the green shape. "exactly one shape in green" was read
     loosely and came back as a green circle AND a green staircase; pointing
     at which shape is green leaves nothing to interpret. */
  {
    name: "band",
    how: "a single wide diagonal band crossing from lower left to upper right dividing the frame into two plain grey fields, and one small green square resting on the band — the square is the only green thing in the picture",
  },
  {
    name: "stack",
    how: "a tall column of six horizontal grey bars of differing thickness stacked up the left half, the right half an empty flat field, and the third bar from the top is green — that bar is the only green thing in the picture",
  },
  {
    name: "orbit",
    how: "two large grey circles overlapping near the right edge, one cropped by the frame, a thin green bar passing behind them, the left two thirds empty — the bar is the only green thing in the picture",
  },
  {
    name: "grid",
    how: "a four by three grid of equal squares in charcoal and grey with one square missing entirely, and a single green square in the second row — that square is the only green thing in the picture",
  },
  {
    name: "wedge",
    how: "one enormous grey triangle occupying the lower right and cropped by two edges, and one small green square floating alone in the empty upper left — the square is the only green thing in the picture",
  },
  {
    name: "steps",
    how: "a staircase of five grey rectangles descending left to right each overlapping the next, plenty of empty room above, and the smallest rectangle is green — it is the only green thing in the picture",
  },
  {
    name: "split",
    how: "the frame divided vertically into three unequal flat panels of different greys, and one green circle sitting inside the narrowest panel — the circle is the only green thing in the picture",
  },
  {
    name: "arc",
    how: "one large grey quarter circle anchored in a corner and a straight green bar cutting across it, the rest of the frame a single flat field — the bar is the only green thing in the picture",
  },
];


/**
 * Which composition, from the slug.
 *
 * Deterministic so an article keeps its cover across a redraw, and spread
 * across the eight so two articles published together do not land on the same
 * one. The same reasoning as the template rule: a journal that varies
 * unpredictably is as strange as one that repeats.
 */
export function pickLayout(slug: string): { name: string; how: string } {
  let n = 7;
  for (let i = 0; i < slug.length; i++) n = (n * 31 + slug.charCodeAt(i)) >>> 0;
  return LAYOUTS[n % LAYOUTS.length];
}

const AVOID =
  "text, letters, words, numbers, watermark, logo, signature, people, faces, " +
  "photograph, photorealistic, 3d render, glossy, shiny, metallic, drop shadow, " +
  "spiral, optical illusion, concentric rings, busy, cluttered, symmetrical, " +
  "rainbow colours, neon glow";

/** A steer per shelf, so a marketing piece does not look like a studio one. */
const BY_SHELF: Record<TopicId, string> = {
  technology: "squared off, aligned to an invisible grid",
  "ai-automation": "one shape slightly separated from the others",
  marketing: "the shapes stepping upward to the right",
  "creative-content": "one shape overlapping another, softly",
  "industry-trends": "the shapes stacked in flat layers",
  "behind-the-scenes": "the shapes spaced apart, evenly",
};

export interface Cover {
  /** WebP bytes, ready to be written into the site. */
  webp: Buffer;
  /** What the picture is, for someone who cannot see it. */
  alt: string;
  /** The line under it on the article page. */
  caption: string;
  prompt: string;
  /** Which of the eight compositions this one is. */
  layout: string;
  ms: number;
}

/**
 * Two or three nouns, nothing more.
 *
 * A model handed a whole article draws the article: a laptop, a phone, a
 * graph with invented numbers on it. Handed two nouns inside a fixed system,
 * it draws a composition. So the local 12b does one small job — name the
 * shapes — and `HOUSE` does the rest.
 */
async function subject(title: string, thesis: string): Promise<string> {
  const res = await ask(
    `An article: "${title}"\nWhat it argues: ${thesis}\n\n` +
      `Name THREE simple flat geometric shapes that could stand for this. ` +
      `Things a printer could cut out of paper: a square, a wedge, a thin bar, a half circle, ` +
      `a stack of three rectangles, a single diagonal line. ` +
      `No spirals, no rings, no grids, no lattices — those become optical patterns. ` +
      `No people, no screens, no logos, no text, nothing literal from the subject matter. ` +
      `Answer with the three shapes only, comma separated, nothing else.`,
    { model: QUICK_MODEL, temperature: 0.7, timeoutMs: 90_000 },
  );
  return res.text
    .replace(/["'\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** The graph, straight from the preset that already works on this machine. */
function graph(prompt: string, seed: number): Record<string, unknown> {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen_3_4b_fp8_mixed.safetensors", type: "lumina2", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
    "4": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3.0 } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    /* Z-Image Turbo runs at cfg 1.0, where a negative prompt does nothing at
       all — so the negative is zeroed exactly as the preset does, and the
       avoid-list lives in the positive prompt instead. */
    "6": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["5", 0] } },
    "7": { class_type: "EmptySD3LatentImage", inputs: { width: W, height: H, batch_size: 1 } },
    "8": {
      class_type: "KSampler",
      inputs: {
        model: ["4", 0],
        positive: ["5", 0],
        negative: ["6", 0],
        latent_image: ["7", 0],
        seed,
        steps: 8,
        cfg: 1.0,
        sampler_name: "res_multistep",
        scheduler: "simple",
        denoise: 1.0,
      },
    },
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: "desk/cover" } },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Queue it, wait for it, fetch the bytes. */
async function draw(prompt: string): Promise<Buffer> {
  const seed = Math.floor(Math.random() * 2 ** 31);

  const queued = await fetch(`${COMFY}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: graph(prompt, seed) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!queued.ok) throw new Error(`ComfyUI refused the job (${queued.status}): ${(await queued.text()).slice(0, 200)}`);

  const { prompt_id } = (await queued.json()) as { prompt_id?: string };
  if (!prompt_id) throw new Error("ComfyUI queued nothing");

  /* Eight steps is about thirteen seconds on a warm card and a minute cold,
     so two minutes is generous and still bounded. */
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    const res = await fetch(`${COMFY}/history/${prompt_id}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) continue;
    const hist = (await res.json()) as Record<
      string,
      { outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>; status?: { status_str?: string } }
    >;
    const run = hist[prompt_id];
    if (!run) continue;
    if (run.status?.status_str === "error") throw new Error("ComfyUI failed while drawing it");

    const img = Object.values(run.outputs ?? {}).flatMap((o) => o.images ?? [])[0];
    if (!img) continue;

    const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type });
    const file = await fetch(`${COMFY}/view?${q}`, { signal: AbortSignal.timeout(60_000) });
    if (!file.ok) throw new Error(`could not fetch the drawn image (${file.status})`);
    return Buffer.from(await file.arrayBuffer());
  }
  throw new Error("ComfyUI did not finish in two minutes");
}

export async function cover(article: {
  title: string;
  thesis: string;
  topic: TopicId;
  /** Decides the composition, so an article keeps its cover across a redraw. */
  slug: string;
}): Promise<Cover> {
  const started = Date.now();
  /* The LAYOUT first, because the composition is what makes two covers
     different and the front of the prompt is what a model weights most. */
  const layout = pickLayout(article.slug);
  const prompt = `${layout.how}. ${HOUSE}. ${BY_SHELF[article.topic] ?? ""}. Avoid: ${AVOID}.`;

  const png = await draw(prompt);
  /* Straight to webp at the size the page actually draws it. A cover is the
     heaviest thing on an article and the journal never shows one larger. */
  const webp = await sharp(png).resize({ width: W, withoutEnlargement: true }).webp({ quality: 78, effort: 6 }).toBuffer();

  return {
    webp,
    alt: `An abstract composition in charcoal, grey and bone white with one green shape: ${layout.how.split(",")[0]}.`,
    caption: "Drawn for this article on our own machine. It is not a photograph.",
    prompt,
    layout: layout.name,
    ms: Date.now() - started,
  };
}

/** Is the card reachable? The runner asks before promising anything. */
export async function comfyUp(): Promise<boolean> {
  try {
    const res = await fetch(`${COMFY}/system_stats`, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}
