import { statfsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Reading } from "../../../web/src/contract/common.ts";
import { ok } from "../store.ts";

/**
 * What the desk can truthfully say about its own server.
 *
 * THIS IS THE DESK'S SERVER, NOT THE WEBSITE'S. The website runs on Vercel,
 * whose machines the desk cannot see: no CPU, no memory, no function count,
 * no bandwidth figure exists for it without Vercel's own API and a token.
 * What is here is the small Hetzner box the desk process runs on (shared
 * with the engine), read from the operating system at the moment of asking.
 * A screen that shows these numbers must label them "desk server", or it
 * tells a lie about the website's hosting.
 *
 * Nothing is stored and nothing is averaged: it is a reading of now.
 */

export interface Box {
  /** Always "desk": these figures describe the desk's own server and nothing else. */
  of: "desk";
  hostname: string;
  /** "linux", "win32"… */
  platform: string;
  cpus: number;
  /**
   * Load average over 1, 5 and 15 minutes: how many processes wanted a CPU.
   * Divide by `cpus` for "how busy". Null on Windows, which has no such figure.
   */
  load: { one: number; five: number; fifteen: number } | null;
  /** The machine's memory, in bytes. `available` is what could be handed to a program now. */
  memory: { total: number; available: number; usedPercent: number };
  /** The disk the desk's database lives on. Null when the system would not say. */
  disk: { total: number; free: number; usedPercent: number; path: string } | null;
  /** The desk process itself. */
  process: {
    /** Resident memory: what the process really holds, in bytes. */
    rss: number;
    heapUsed: number;
    /** The ceiling the system puts on this process (the unit's MemoryMax), in bytes, or null when there is none. */
    limit: number | null;
    /** Seconds since the desk last started: every deploy restarts it. */
    uptime: number;
    node: string;
    pid: number;
  };
  /** Seconds since the machine booted. */
  uptime: number;
}

/** A reading of the desk's server, now. Never `off`: the operating system always answers. */
export function box(): Reading<Box> {
  const total = os.totalmem();
  const available = os.freemem();

  let disk: Box["disk"] = null;
  const dbPath = path.resolve(process.env.DESK_DB ?? "./desk.db");
  try {
    const s = statfsSync(path.dirname(dbPath));
    const size = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    if (size > 0) disk = { total: size, free, usedPercent: ((size - free) / size) * 100, path: path.dirname(dbPath) };
  } catch {
    disk = null;
  }

  /* The cgroup limit systemd sets (MemoryMax). Node reports "no limit" in
     different ways across versions: 0, or a number at least the machine's
     whole memory. Both mean none. */
  const constrained = typeof process.constrainedMemory === "function" ? process.constrainedMemory() : 0;
  const mem = process.memoryUsage();
  const load = os.loadavg();

  return ok(
    {
      of: "desk",
      hostname: os.hostname(),
      platform: process.platform,
      cpus: os.cpus().length,
      load: process.platform === "win32" ? null : { one: load[0] as number, five: load[1] as number, fifteen: load[2] as number },
      memory: { total, available, usedPercent: ((total - available) / total) * 100 },
      disk,
      process: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        limit: constrained > 0 && constrained < total ? constrained : null,
        uptime: Math.round(process.uptime()),
        node: process.version,
        pid: process.pid,
      },
      uptime: Math.round(os.uptime()),
    },
    "desk",
    Date.now(),
    "The desk's own server (shared with the engine), read from the operating system now. Not the website's hosting: Vercel's machines are not visible from here.",
  );
}
