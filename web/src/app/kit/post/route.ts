import { notFound } from "next/navigation";
import { askPost } from "@/lib/api";

/**
 * Development only: proves that a POST made by this app's server reaches the
 * desk server with the visitor's Origin, and that a foreign one is still
 * refused there.
 *
 *   curl -X POST http://localhost:3401/kit/post -H "Origin: http://localhost:3401"   202
 *   curl -X POST http://localhost:3401/kit/post -H "Origin: https://example.org"     403
 *
 * It asks for one run of "Read the website's git history" (the `repo` job),
 * which reads a local clone and changes nothing. On the box this is a 404.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") notFound();
  const a = await askPost<{ ok: boolean }>("/api/v1/jobs/repo/run");
  return Response.json(a.ok ? { asked: true, answer: a.value } : { asked: false, kind: a.kind, error: a.message }, { status: a.ok ? 202 : a.status || 502 });
}
