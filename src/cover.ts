import sharp from "sharp";
import { SERVICES, type TopicId } from "./catalogue.ts";
import { look, type Look, type Mood, type Motion } from "./look.ts";

/**
 * The picture at the top of an article, drawn here and never photographed.
 *
 * Fini, 23 September 2026: *"abstract — no fake photos."* Which is the right
 * call and worth writing down: a fabricated photograph of a place that does
 * not exist, on a company's own journal, is a thing somebody eventually has
 * to explain. An abstract composition is honestly what it is — a made image —
 * and it can look deliberate rather than merely plausible.
 *
 * THE LOOK IS HARD-CODED, exactly as the article's format is. Nothing here is
 * left to the model's taste: it is handed one composition and four named
 * colours and it does the drawing. Thirty covers that share a system read as
 * a journal; thirty that each invented their own read as a stock library.
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

/*
 * Fifth pass, and the first one that READS.
 *
 * Fini, 23 September 2026: *"this designs are actually shit… I like the
 * geometric of it but try maybe to create a system where it takes and
 * investigates what it is so it can create some geometric abstract image that
 * looks a bit more colorful."* Two separate complaints, fixed separately:
 *
 *   · IT DID NOT READ. The fourth pass picked one of eight compositions from
 *     a hash of the slug. Varied, and the variety meant nothing — a piece
 *     about a bottleneck was as likely to get a rising staircase as a piece
 *     about growth. `look.ts` now reads the article for the SHAPE of its
 *     argument, and the shape picks the composition.
 *   · IT WAS GREY. Almost-greyscale with one green shape was a safe rule that
 *     produced thirty safe pictures. Now there are eight PALETTES of four
 *     colours each, and the article's register picks one — so a technical
 *     piece prints cool and a studio piece prints warm, and green is the
 *     accent on about a third of the journal rather than all of it.
 *
 * Earlier attempts and what each taught, kept so nobody repeats them:
 *   1. "flat vector, generous negative space" -> a glossy op-art spiral
 *      filling the frame. A model renders unless told several times that there
 *      is no depth, and a shape with no stated size becomes the whole picture.
 *   2. Over-corrected to "one large empty field, small shapes lower right" ->
 *      a beige field with two tiny marks.
 *   3. Naming the genre — Bauhaus poster, mid-century Swiss — landed the look.
 *   4. Eight compositions by slug hash -> variety without meaning.
 * And a colour named without saying WHICH shape wears it spreads across three
 * of them; every composition below names its accent shape for that reason.
 */
const HOUSE =
  "flat geometric abstraction, mid-century Swiss graphic design, silkscreen poster print, " +
  "flat solid colour fills, hard clean edges, no shading, no gradient, no perspective, no 3d, no texture, " +
  "no text, no letters, no logos, no people, not a photograph";

const AVOID =
  "text, letters, words, numbers, watermark, logo, signature, people, faces, " +
  "photograph, photorealistic, 3d render, glossy, shiny, metallic, drop shadow, " +
  "spiral, optical illusion, concentric rings, busy, cluttered, symmetrical, " +
  "rainbow, neon glow, airbrush, more than four colours";

interface Composition {
  name: string;
  /** The picture, with no colour in it at all. */
  how: string;
  /** Which single shape wears the accent colour. */
  accent: string;
}

/**
 * Two compositions per motion, sixteen in all.
 *
 * Written as instructions to a printer rather than adjectives, because
 * "dynamic" gets ignored and "one diagonal band from the lower left to the
 * upper right" does not. Colour is deliberately absent from every `how`: the
 * palette is bolted on afterwards, so the same picture can print cool or warm
 * and the two systems stay independent.
 */
const COMPOSITIONS: Record<Motion, Composition[]> = {
  rising: [
    {
      name: "steps",
      how: "a staircase of five rectangles of increasing height stepping up from the lower left towards the upper right, each overlapping the next, a wide empty field above them",
      accent: "the tallest rectangle",
    },
    {
      name: "spire",
      how: "one tall narrow column standing on the bottom edge and reaching almost to the top, with three short horizontal bars crossing it at uneven heights, the rest of the frame one flat empty field",
      accent: "the highest crossing bar",
    },
  ],
  converging: [
    {
      name: "funnel",
      how: "two long straight edges running in from the left and the right and narrowing towards a single small square at the centre right, the space between them empty",
      accent: "the small square where they meet",
    },
    {
      name: "gather",
      how: "seven squares of different sizes drifting in from the edges and clustering tightly in the lower left corner, the upper two thirds of the frame empty",
      accent: "the one square at the centre of the cluster",
    },
  ],
  splitting: [
    {
      name: "split",
      how: "the frame divided by one hard vertical edge slightly left of centre into two flat fields, with a large circle in one half and a small circle in the other",
      accent: "the smaller circle",
    },
    {
      name: "fan",
      how: "one wide rectangle along the bottom edge breaking upward into four long wedges that fan apart as they rise, widening the gaps between them",
      accent: "the outermost wedge on the right",
    },
  ],
  repeating: [
    {
      name: "grid",
      how: "a four by three grid of equal squares with even gutters, one square left out entirely so the flat ground shows through the gap",
      accent: "one square in the second row",
    },
    {
      name: "comb",
      how: "twelve identical narrow vertical bars standing in an even row across the lower two thirds of the frame, one of them noticeably shorter than the rest, empty field above",
      accent: "the shorter bar",
    },
  ],
  layering: [
    {
      name: "stack",
      how: "six horizontal bands of differing thickness stacked from the bottom edge upward, thickest at the bottom, with a wide empty field above them",
      accent: "the thinnest band",
    },
    {
      name: "slab",
      how: "four large rectangles lying flat and overlapping like sheets of paper on a table, each offset slightly to the right of the one beneath it",
      accent: "the topmost rectangle",
    },
  ],
  blocked: [
    {
      name: "wall",
      how: "one thick vertical bar standing just right of centre from the top edge to the bottom, five small squares pressed up against its left side, the space to its right completely empty",
      accent: "the small square nearest the top",
    },
    {
      name: "wedge",
      how: "one enormous triangle filling the lower right and cropped by two edges, and a single small square stranded alone in the empty upper left",
      accent: "the stranded square",
    },
  ],
  connecting: [
    {
      name: "arc",
      how: "one large quarter circle anchored in the top left corner and a single straight bar running clear across it from the left edge to the right, the rest one flat field",
      accent: "the straight bar",
    },
    {
      name: "route",
      how: "one thick line made of four straight segments turning at right angles as it crosses from the left edge down to the lower right, with a small square at each turn",
      accent: "the last square, at the end of the line",
    },
  ],
  turning: [
    {
      name: "orbit",
      how: "two large circles overlapping near the right edge, one of them cropped by the frame, a thin bar passing behind both of them, the left two thirds an empty flat field",
      accent: "the thin bar",
    },
    {
      name: "pivot",
      how: "one large square rotated to stand on its corner at the centre right, with three straight bars radiating away from it to the left at different angles",
      accent: "the longest bar",
    },
  ],
};

interface Palette {
  name: string;
  /** The flat field everything sits on. */
  ground: string;
  /** Two supporting colours, which the shapes are printed in. */
  a: string;
  b: string;
  /** The one high-chroma colour, worn by a single named shape. */
  accent: string;
}

/**
 * Eight palettes of four colours.
 *
 * Every one obeys the same two rules, which is what keeps thirty covers
 * looking related while none of them looks like the last: ONE flat ground,
 * and ONE high-chroma accent worn by a single shape. Balkaris green is in
 * four of the eight rather than all of them — a signature that appears every
 * time is wallpaper.
 *
 * Named in words, never in hex: a diffusion model reads "burnt terracotta"
 * and does not read #b4552f.
 */
const PALETTES: Record<string, Palette> = {
  signal: { name: "signal", ground: "deep charcoal", a: "bone white", b: "warm mid grey", accent: "bright electric lime green" },
  steel: { name: "steel", ground: "pale cool grey", a: "steel blue", b: "deep navy", accent: "bright mustard yellow" },
  tide: { name: "tide", ground: "deep teal", a: "pale sand", b: "muted slate blue", accent: "bright marigold orange" },
  moss: { name: "moss", ground: "deep pine green", a: "cream", b: "warm clay brown", accent: "bright electric lime green" },
  bloom: { name: "bloom", ground: "bone white", a: "deep plum", b: "soft blush pink", accent: "bright electric lime green" },
  ember: { name: "ember", ground: "warm cream", a: "burnt terracotta", b: "deep charcoal", accent: "bright tangerine orange" },
  clay: { name: "clay", ground: "warm sand", a: "deep charcoal", b: "soft olive", accent: "bright ochre yellow" },
  dusk: { name: "dusk", ground: "deep indigo", a: "dusty rose", b: "pale blue grey", accent: "warm coral" },
};

/**
 * Which palettes a register may draw from. Three each, overlapping on purpose.
 *
 * Balanced by hand so that EXACTLY ONE of every three is a green palette. The
 * first arrangement grouped by feel alone and put all three greens in the
 * growth set, which is thematically obvious and meant thirteen of the first
 * sixteen covers came out green. A signature that appears every time is
 * wallpaper; a signature that appears every third time is a signature.
 */
const BY_MOOD: Record<Mood, string[]> = {
  technical: ["signal", "steel", "tide"],
  growth: ["moss", "tide", "clay"],
  human: ["bloom", "ember", "clay"],
  urgent: ["signal", "ember", "dusk"],
};

/**
 * The slug breaks the ties.
 *
 * The reading decides WHICH SET — two compositions, three palettes — and the
 * slug decides which of that set. Deterministic, so an article keeps its
 * cover across a redraw; spread, so two pieces that argue the same shape on
 * the same day are still two different pictures.
 */
function pick<T>(from: T[], slug: string, salt: string): T {
  /* FNV-1a with a final avalanche, and both halves matter.
     The first version was `n = n * 31 + c` and then `n % from.length` — and
     for a two-element list that is the LOW BIT, which for that hash is only
     the parity of the slug's characters and never mixes. Six "connecting"
     articles in a row took the same composition, and three "blocked" ones
     took the same one as each other, before anybody thought to check whether
     the tie-breaker was breaking anything. */
  let n = 2166136261;
  const s = `${slug}:${salt}`;
  for (let i = 0; i < s.length; i++) {
    n ^= s.charCodeAt(i);
    n = Math.imul(n, 16777619);
  }
  n ^= n >>> 15;
  n = Math.imul(n, 2246822507);
  n ^= n >>> 13;
  n = Math.imul(n, 3266489909);
  n = (n ^ (n >>> 16)) >>> 0;
  return from[n % from.length];
}

const practiceOf = new Map(SERVICES.map((s) => [s.slug, s.practice as string]));

export interface Cover {
  /** WebP bytes, ready to be written into the site. */
  webp: Buffer;
  /** What the picture is, for someone who cannot see it. */
  alt: string;
  /** The line under it on the article page. */
  caption: string;
  prompt: string;
  /** What the reading found, and what it chose — for the log and the console. */
  read: Look;
  layout: string;
  palette: string;
  ms: number;
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

/**
 * Build the prompt without drawing it.
 *
 * Separate from `cover` so the whole system can be exercised over every
 * article in the journal in a second, with no card and no ComfyUI — which is
 * the only practical way to tell whether the reading is any good.
 */
export function compose(article: {
  title: string;
  /** The whole piece: standfirst and every paragraph. */
  text: string;
  topic: TopicId;
  services?: string[];
  slug: string;
}): { prompt: string; read: Look; composition: Composition; palette: Palette } {
  const practices = (article.services ?? []).map((s) => practiceOf.get(s) ?? "").filter(Boolean);
  const read = look({ title: article.title, text: article.text, topic: article.topic, practices });

  const composition = pick(COMPOSITIONS[read.motion], article.slug, "c");
  const palette = PALETTES[pick(BY_MOOD[read.mood], article.slug, "p")];

  /* The composition leads: the front of the prompt is what the model weights
     most, and the picture is what makes two covers different. The palette
     follows as one sentence naming four colours and pinning the accent to one
     shape — "one shape in green" without saying WHICH reliably comes back
     three times. */
  const prompt =
    `${composition.how}. ` +
    `Printed flat in exactly four colours: a ${palette.ground} ground, ${palette.a}, ${palette.b}, ` +
    `and ${palette.accent} — the ${palette.accent} is used for ${composition.accent} and nowhere else in the picture. ` +
    `${HOUSE}. Avoid: ${AVOID}.`;

  return { prompt, read, composition, palette };
}

export async function cover(article: {
  title: string;
  text: string;
  topic: TopicId;
  services?: string[];
  /** Breaks the tie inside whatever the reading chose, so a redraw matches. */
  slug: string;
}): Promise<Cover> {
  const started = Date.now();
  const { prompt, read, composition, palette } = compose(article);

  const png = await draw(prompt);
  /* Straight to webp at the size the page actually draws it. A cover is the
     heaviest thing on an article and the journal never shows one larger. */
  const webp = await sharp(png).resize({ width: W, withoutEnlargement: true }).webp({ quality: 78, effort: 6 }).toBuffer();

  return {
    webp,
    alt:
      `An abstract composition printed flat in ${palette.ground}, ${palette.a}, ${palette.b} and ${palette.accent}: ` +
      `${composition.how}.`,
    caption: "Drawn for this article on our own machine. It is not a photograph.",
    prompt,
    read,
    layout: composition.name,
    palette: palette.name,
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
