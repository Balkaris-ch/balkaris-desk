import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import path from 'node:path'

const execFileP = promisify(execFile)
const require = createRequire(import.meta.url)
const ffmpegPath: string = require('ffmpeg-static')

/**
 * Local transcription for the library lane: ffmpeg strips the audio, a local
 * Whisper model (scripts/whisper_json.py, faster-whisper) turns it into text.
 * Zero API cost, and the audio file dies with the work dir like everything
 * else (rule 2).
 */

const PYTHON =
  process.env.WHISPER_PYTHON ??
  'C:/Users/finim/AppData/Local/Programs/Python/Python312/python.exe'
const MODEL = process.env.WHISPER_MODEL ?? 'small'
const SCRIPT = path.resolve(import.meta.dirname ?? '.', '../../scripts/whisper_json.py')

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface TranscriptResult {
  language: string | null
  segments: TranscriptSegment[]
  /** all segments joined — what the notes model actually reads */
  text: string
  /** wall-clock seconds the transcription took */
  seconds: number
  device: string
  /** why the card was not used, when it was not — a silent CPU fallback is worth knowing */
  deviceError: string | null
  /** which pass produced these words: with the speech filter, or without it */
  how: string | null
}

/** 16kHz mono wav — what Whisper wants; tiny compared to the video. */
export async function extractAudio(src: string, wavOut: string): Promise<void> {
  await execFileP(ffmpegPath, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', src,
    '-vn', '-ac', '1', '-ar', '16000',
    wavOut,
  ])
}

export async function transcribe(wavPath: string): Promise<TranscriptResult> {
  const t0 = Date.now()
  const { stdout } = await execFileP(PYTHON, ['-X', 'utf8', SCRIPT, wavPath, MODEL], {
    timeout: 10 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  let parsed: {
    language?: string
    device?: string
    device_error?: string | null
    how?: string | null
    segments?: Array<{ start: number; end: number; text: string }>
  }
  try {
    parsed = JSON.parse(stdout) as typeof parsed
  } catch {
    throw new Error(`whisper returned non-JSON: ${stdout.slice(0, 200)}`)
  }
  const segments = (parsed.segments ?? []).filter((s) => s.text.length > 0)
  return {
    language: parsed.language ?? null,
    segments,
    text: segments.map((s) => s.text).join(' '),
    seconds: Number(((Date.now() - t0) / 1000).toFixed(2)),
    device: parsed.device ?? 'unknown',
    deviceError: parsed.device_error ?? null,
    how: parsed.how ?? null,
  }
}

/**
 * The wrapper `sm-fixed/src/personal/transcript.ts` has, without the half that
 * writes to Supabase — this repo has no database but its own SQLite, and no
 * business in sm-fixed's.
 *
 * `how` is the one field worth reading downstream: whisper_json.py runs a
 * second pass with the speech filter OFF when the first pass finds nothing,
 * because `vad_filter=True` reports "nobody speaks" on any video carried by a
 * song. Half the videos worth writing about are scored with music, and a sung
 * line is often the only line.
 */
export interface Spoken {
  language: string | null
  full_text: string
  segments: TranscriptSegment[]
  seconds: number
  device: string
  /** "speech filter" / "no speech filter (…)" — how the words were found */
  how: string | null
  deviceError: string | null
  /** The whisper model that answered, with the pass appended when it was the second. */
  model: string
}

export async function transcribeVideo(src: string, workDir: string): Promise<Spoken> {
  const wav = path.join(workDir, 'audio.wav')
  await extractAudio(src, wav)
  const t = await transcribe(wav)
  const secondPass = !!t.how && /no speech filter/i.test(t.how)
  return {
    language: t.language,
    full_text: t.text,
    segments: t.segments,
    seconds: t.seconds,
    device: t.device,
    how: t.how,
    deviceError: t.deviceError,
    model: secondPass ? `${MODEL} (no-vad)` : MODEL,
  }
}
