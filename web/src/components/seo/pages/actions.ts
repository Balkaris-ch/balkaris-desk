"use server";

import type { NewTask, ProposalAnswer, TaskAnswer } from "@/contract/operator";
import { askPost } from "@/lib/api";

export type Queued = { ok: true; id: number; title: string } | { ok: false; message: string };

const PATH = /^\/[^\s?#]{0,199}$/;

/**
 * One of SEO › Pages' buttons: queue an operator task (POST
 * /api/v1/operator/tasks, the AI Operator's own door).
 *
 *   metadata  the operator writes titles and descriptions for the pages
 *             named (at most five), or, with none named, for the pages whose
 *             title or description breaks a rule. Each becomes a proposal in
 *             the approval queue; nothing reaches the live site until a
 *             person approves it.
 *   ask       a question about one page, answered in plain text.
 *
 * The task is answered by the studio workstation's local model when it is on;
 * until then it waits in the queue. The browser's word is not trusted: only
 * these two kinds go through, with the fields they need, and the desk server
 * checks everything again (src/cc/routes/operator.ts).
 */
export async function queueTask(task: NewTask): Promise<Queued> {
  let clean: NewTask;
  if (task?.kind === "metadata") {
    const paths = Array.isArray(task.paths) ? task.paths.filter((p): p is string => typeof p === "string" && PATH.test(p)).slice(0, 5) : [];
    clean = { kind: "metadata", depth: "deep", ...(paths.length ? { paths } : {}) };
  } else if (task?.kind === "ask" && typeof task.prompt === "string" && typeof task.path === "string" && PATH.test(task.path)) {
    clean = { kind: "ask", prompt: task.prompt.slice(0, 1000), path: task.path, context: "pages", depth: "deep" };
  } else {
    return { ok: false, message: "This button cannot ask for that." };
  }
  const a = await askPost<TaskAnswer>("/api/v1/operator/tasks", clean);
  return a.ok ? { ok: true, id: a.value.task.id, title: a.value.task.title } : { ok: false, message: a.message };
}

export type Proposed = { ok: true; id: number; line: string } | { ok: false; message: string };

/**
 * An address the website no longer has, which Google still counts: propose a
 * redirect from it to a live page (POST /api/v1/operator/proposals, the AI
 * Operator's own door). It waits in AI Operator › Approvals; nothing reaches
 * the website until a person approves it. The desk server applies its own
 * rules (not from a live page, not to a dead one) and says why when it refuses.
 */
export async function proposeRedirect(from: string, to: string): Promise<Proposed> {
  const f = typeof from === "string" ? from.trim() : "";
  const t = typeof to === "string" ? to.trim() : "";
  if (!PATH.test(f)) return { ok: false, message: "That is not an address of the website to redirect from." };
  if (!PATH.test(t)) return { ok: false, message: "Give the page to send it to as an address of the website, such as /about." };
  const a = await askPost<ProposalAnswer>("/api/v1/operator/proposals", { from: f, to: t });
  return a.ok ? { ok: true, id: a.value.proposal.id, line: `A redirect from ${a.value.proposal.address} to ${a.value.proposal.after.to ?? t} waits for approval (#${a.value.proposal.id}).` } : { ok: false, message: a.message };
}
