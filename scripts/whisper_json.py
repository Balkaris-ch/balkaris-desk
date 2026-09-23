"""Local transcription for the library lane. Costs nothing, leaves nothing.

Usage: python whisper_json.py <audio.wav> [model]
Prints one JSON object to stdout; everything else goes to stderr.

CUDA is attempted first and silently falls back to CPU int8 — short-form
audio transcribes in seconds either way, and a missing cuDNN must never
break the lane.
"""

import json
import sys


def transcribe(model, wav, vad=True):
    """One pass. Segments Whisper itself doubts are dropped.

    Without this guard the no-filter pass invents text over music and silence
    ("Thanks for watching!"), and a script someone is about to rewrite must not
    contain words nobody said.
    """
    segments, info = model.transcribe(wav, vad_filter=vad)
    segs = []
    for s in segments:
        text = s.text.strip()
        if not text:
            continue
        if getattr(s, "no_speech_prob", 0.0) > 0.7:
            continue
        if getattr(s, "avg_logprob", 0.0) < -1.2:
            continue
        segs.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": text})
    return segs, info


def spoken_seconds(segs):
    return sum(max(0.0, s["end"] - s["start"]) for s in segs)


def transcribe_twice(model, wav):
    """VAD first, then without it when the speech filter looks like it ate the voice.

    Silero's VAD is tuned for talking. On a video carried by a song it removes
    every segment — a sung line came back as "nobody speaks" (measured
    2026-09-12 on a bar montage scored with Coldplay). On a voiceover mixed
    under music it keeps a fragment: 35 seconds of video, one sentence
    (@bryanadamc, same day). So the second pass runs when the first found
    nothing OR covered less than a quarter of the audio, and the pass that
    heard MORE wins.
    """
    vad_segs, info = transcribe(model, wav, vad=True)
    covered = spoken_seconds(vad_segs)
    duration = max(1.0, getattr(info, "duration", 0.0) or 0.0)
    if covered >= 0.25 * duration:
        return vad_segs, info, "speech filter"

    raw_segs, raw_info = transcribe(model, wav, vad=False)
    if spoken_seconds(raw_segs) > covered:
        why = "no speech filter (the filter left {:.0f}% of the audio — singing or voice under music)".format(
            100.0 * covered / duration
        )
        return raw_segs, raw_info, why
    return vad_segs, info, "speech filter"


def main():
    if len(sys.argv) < 2:
        print("usage: whisper_json.py <audio.wav> [model]", file=sys.stderr)
        sys.exit(2)
    wav = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "small"

    from faster_whisper import WhisperModel

    device = "cuda"
    device_error = None
    try:
        model = WhisperModel(model_name, device="cuda", compute_type="float16")
        segs, info, how = transcribe_twice(model, wav)
    except Exception as e:
        # Not silent any more: a card that is never used is worth knowing about.
        device_error = f"{type(e).__name__}: {e}"[:200]
        print(f"cuda unavailable ({device_error}); using cpu", file=sys.stderr)
        device = "cpu"
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        segs, info, how = transcribe_twice(model, wav)

    json.dump(
        {
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
            "duration": round(info.duration, 2),
            "device": device,
            "device_error": device_error,
            "how": how,
            "segments": segs,
        },
        sys.stdout,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
