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
 * Rewritten after the first real cover came back as a glossy op-art spiral
 * filling the frame edge to edge — abstract and on-palette and completely
 * wrong. Three lessons, all of them about composition rather than subject:
 *
 *   · "flat vector" is not enough. The model renders unless it is told, in
 *     several ways, that there is no depth: no shading, no gradient, no
 *     perspective, no highlight.
 *   · "generous negative space" is a hope. "The shapes occupy the lower right
 *     third, the rest empty" is an instruction.
 *   · a shape given no size becomes the whole picture. Concentric rings
 *     became a hypnotic spiral because nothing said small.
 *
 * The composition rules therefore come FIRST, before the subject, because the
 * front of the prompt is what a diffusion model weights most.
 */
const HOUSE =
  "Bauhaus poster, flat geometric abstraction, " +
  "four or five large bold shapes filling most of the frame in an asymmetric arrangement, " +
  "shapes overlapping and cropped by the edges, " +
  "flat solid colour, hard edges, no shading, no gradient, no perspective, no 3d, no texture, " +
  "very dark charcoal background, shapes in warm grey, bone white and deep slate, " +
  /* "one shape in green" is read as "green is in the palette" and comes back
     three times. Saying what the OTHER shapes are is what holds it to one. */
  "almost entirely greyscale, every shape grey or white or charcoal, " +
  "with exactly ONE single shape in bright electric lime green and no other green anywhere, " +
  "confident, graphic, printed, mid-century Swiss design, " +
  "no text, no letters, no logos, no people, not a photograph";

const AVOID =
  "text, letters, words, numbers, watermark, logo, signature, people, faces, " +
  "photograph, photorealistic, 3d render, glossy, shiny, metallic, drop shadow, " +
  "spiral, optical illusion, high contrast stripes, busy, cluttered, symmetrical, " +
  "filling the frame, rainbow colours, neon glow";

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

export async function cover(article: { title: string; thesis: string; topic: TopicId }): Promise<Cover> {
  const started = Date.now();
  const nouns = await subject(article.title, article.thesis);
  /* House first: the front of the prompt is what the model weights most, and
     the composition matters more here than the subject does. */
  const prompt = `${HOUSE}. The shapes: ${nouns}. ${BY_SHELF[article.topic] ?? ""}. Avoid: ${AVOID}.`;

  const png = await draw(prompt);
  /* Straight to webp at the size the page actually draws it. A cover is the
     heaviest thing on an article and the journal never shows one larger. */
  const webp = await sharp(png).resize({ width: W, withoutEnlargement: true }).webp({ quality: 78, effort: 6 }).toBuffer();

  return {
    webp,
    alt: `An abstract composition: ${nouns}, in charcoal and greys with one green accent.`,
    caption: "Drawn for this article on our own machine. It is not a photograph.",
    prompt,
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
