/**
 * Why a link did not become an article, in words for the person who sent it,
 * and what they can do about it.
 *
 * The runner's errors are written for whoever debugs the runner: "Command
 * failed: ffmpeg.exe ... Output file does not contain any stream", "Ollama
 * 500: llama-server process has terminated". Fini, 3 October 2026: "if an
 * error on executing something comes up it should tell us why it is not a
 * good video" — on Telegram and on the Insights page alike, so both read this
 * one table and never say different things.
 *
 * Two kinds of answer, and the difference matters to the reader:
 *   - `link`: the link itself cannot become an article (restricted, private,
 *     nobody speaks in it). Trying again gives the same answer; a different
 *     link is the way forward.
 *   - `desk`: something on our side or the platform's failed on the way
 *     (the model, a download, a rate limit). The link may be fine; try again.
 *
 * An error nobody has met yet falls through to the last entry, which says so
 * plainly and keeps the original line beside it, never a guess dressed up.
 * When a new failure turns up, add its rule here, above the fallback.
 */

export interface Why {
  /** What went wrong, in one or two plain sentences. */
  reason: string;
  /** What to do next. */
  next: string;
  /** "link": this link will not work however often it is tried. "desk": a failure on the way; trying again may work. */
  fault: "link" | "desk";
}

type Rule = { test: RegExp; why: Why | ((m: RegExpMatchArray) => Why) };

const RULES: Rule[] = [
  /* ---------- the link itself ---------- */
  {
    test: /isn't available to everyone|can't be seen by certain audiences|age.?restricted|sign in to confirm your age|members.only/i,
    why: {
      reason: "The platform only shows this post to signed-in viewers (an age, country or audience limit), so the desk cannot open it.",
      next: "Send a public post on the same subject, or a link where the same content is open to everyone.",
      fault: "link",
    },
  },
  {
    /* Not a bare "unavailable": a 503 says "Service Unavailable" and is ours, not the link's. */
    test: /video unavailable|private (video|account|post)|(post|video|content) is (private|unavailable|not available)|does not exist|not exist|has been removed|been deleted|no video in this post/i,
    why: {
      reason: "The post is private, removed or no longer available.",
      next: "Check the link opens in a private browser window; if it does not, send another one.",
      fault: "link",
    },
  },
  {
    test: /nobody speaks in it|nothing to write from/i,
    why: {
      reason: "Nobody speaks in this video, and the desk writes from what is said in it. Music, ASMR or a silent showcase gives it no words to work with.",
      next: "Send a video where someone explains the idea, or the article or post the video is based on.",
      fault: "link",
    },
  },
  {
    test: /no article on that page|could not find (an )?article|no readable text/i,
    why: {
      reason: "That page has no article text the desk can read: it is a login wall, a gallery, or a page made mostly of pictures or video.",
      next: "Send the address of the article itself, or a post where the text is on the page.",
      fault: "link",
    },
  },
  {
    test: /too short to be worth publishing/i,
    why: {
      reason: "The source has too little in it: what the desk could write from it came out too short to publish.",
      next: "Send a longer piece on the same subject.",
      fault: "link",
    },
  },
  {
    /* The writer's own checks (draft.ts guard): the link is fine, the draft was not. */
    test: /never names .*source is not credited/i,
    why: {
      reason: "The article the local model wrote did not name the creator, and the desk never publishes someone's work without crediting them.",
      next: "Try it again: each try is a new draft. If it keeps failing, add a note with the creator's name when you share the link.",
      fault: "desk",
    },
  },
  {
    test: /12-word run is lifted from the source|last paragraph repeats the first/i,
    why: {
      reason: "The draft copied a whole sentence from the source, or ended by repeating how it began, so the desk threw it away.",
      next: "Try it again: each try is a new draft.",
      fault: "desk",
    },
  },
  {
    test: /unsupported host|not a valid url|no (tiktok|instagram|youtube) (video id|shortcode)/i,
    why: {
      reason: "The desk does not recognise this as an article, TikTok, Instagram or YouTube link.",
      next: "Open the post, use the platform's Share > Copy link, and send that.",
      fault: "link",
    },
  },

  /* ---------- on the way ---------- */
  {
    test: /rate.?limit|429|wall:|checkpoint|confirm you(?:'|’)?re not a bot|sign in/i,
    why: {
      reason: "The platform is turning the desk's requests away for the moment (too many requests, or a bot check).",
      next: "Try it again in an hour.",
      fault: "desk",
    },
  },
  {
    test: /fetch failed|timed out|unreachable|could not reach|download failed|ECONNRESET|ETIMEDOUT|(desk answered|resolver http) 5\d\d/i,
    why: {
      reason: "The video or page did not come down: the platform or the connection did not answer in time.",
      next: "Try it again. If it fails the same way twice, the platform is probably blocking this link.",
      fault: "desk",
    },
  },
  {
    test: /does not contain any stream|ffmpeg|ffprobe|no video stream|unusable duration|no downloadable video format|no playable url/i,
    why: {
      reason: "The video file came down without usable picture or sound, so it could not be listened to.",
      next: "Try it again. If it fails again, send another link to the same video (the original post rather than a repost).",
      fault: "desk",
    },
  },
  {
    test: /^Ollama|llama-server|model could not produce|nothing usable came back|did not answer in time/im,
    why: {
      reason: "The writing model on the workstation failed while working on it (it crashes or restarts, for example after an automatic update).",
      next: "Try it again. If it keeps failing, restart Ollama on the workstation.",
      fault: "desk",
    },
  },
  {
    test: /ComfyUI/i,
    why: {
      reason: "The cover picture could not be drawn on the workstation.",
      next: "Nothing is lost: the article goes out with the journal's own plate, and the cover can be redrawn from its page.",
      fault: "desk",
    },
  },
  {
    test: /whisper/i,
    why: {
      reason: "Listening to the video failed on the workstation.",
      next: "Try it again.",
      fault: "desk",
    },
  },
];

/** The first line that says something, for the fallback's "what it said". */
function firstLine(raw: string): string {
  return (raw.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "").slice(0, 200);
}

export function explain(raw: string | null | undefined): Why {
  const text = (raw ?? "").trim();
  for (const r of RULES) {
    const m = text.match(r.test);
    if (m) return typeof r.why === "function" ? r.why(m) : r.why;
  }
  return {
    reason: text ? `It failed with an error the desk does not explain yet: "${firstLine(text)}".` : "It failed without saying why.",
    next: "Try it again. If it fails the same way twice, the link is probably not usable.",
    fault: "desk",
  };
}

/** The same in one Telegram message, plain text for the HTML parse mode (the caller escapes). */
export function explainForChat(raw: string | null | undefined): string {
  const w = explain(raw);
  const lead = w.fault === "link" ? "That link cannot become an article." : "That link did not become an article this time.";
  return `${lead}\n\nWhy: ${w.reason}\n\nWhat to do: ${w.next}`;
}
