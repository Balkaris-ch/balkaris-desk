import type { OperatorPayload, TaskKind } from "@/contract/operator";
import { api } from "@/lib/api";
import { parseRange } from "@/lib/format";
import { Approvals, type ApprovalTab } from "@/components/operator/Approvals";
import { Ask, type Preset } from "@/components/operator/Ask";
import { Context, type ContextTab } from "@/components/operator/Context";
import { Feed } from "@/components/operator/Feed";
import { Head } from "@/components/operator/Head";
import { Quick } from "@/components/operator/Quick";
import { Response } from "@/components/operator/Response";
import { Ribbon } from "@/components/operator/Ribbon";
import { Tasks } from "@/components/operator/Tasks";
import "@/components/operator/operator.css";

export const metadata = { title: "AI Operator" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

const CONTEXT_TABS: ContextTab[] = ["pages", "insights", "traffic", "issues"];
const APPROVAL_TABS: ApprovalTab[] = ["waiting", "approved", "completed"];

/**
 * What another screen asked for: ?do=brief|metadata|redirect|traffic, with
 * &path= for a page and &q= for a topic. It fills the prompt box; nothing is
 * queued until the person presses the button.
 */
function presetOf(sp: Search): Preset | null {
  const asked = one(sp.do);
  const path = one(sp.path)?.trim();
  const q = one(sp.q)?.trim().slice(0, 300);
  const kinds: TaskKind[] = ["brief", "metadata", "redirect", "traffic", "opportunities", "audit", "ask"];
  const kind = kinds.find((k) => k === asked);
  if (!kind) return null;
  switch (kind) {
    case "brief":
      return { kind, text: q ?? "" };
    case "metadata":
      return { kind, text: path ? `Create metadata for ${path}` : "Create metadata for the pages that need it", ...(path ? { paths: [path] } : {}) };
    case "redirect":
      return { kind, text: "Fix broken links: propose redirects for addresses that no longer answer" };
    case "traffic":
      return { kind, text: "Analyze our traffic" };
    case "opportunities":
      return { kind, text: "Find new content opportunities" };
    case "audit":
      return { kind, text: "Run a full SEO audit" };
    default:
      return { kind: "ask", text: q ?? "", ...(path ? { path } : {}) };
  }
}

/**
 * The AI Operator: ask about the website, start a task, see what the
 * workstation answered, and decide on the changes it proposes.
 *
 * One request to the desk server draws the whole screen. The model is the
 * studio workstation's local one, so everything here is queued, and says so.
 */
export default async function OperatorPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const range = parseRange(one(sp.range));
  const specimen = one(sp.specimen) === "1";
  const result = one(sp.result);
  const data = await api<OperatorPayload>("/api/v1/operator", { range, result: result && /^\d+$/.test(result) ? result : undefined, specimen: specimen ? "1" : undefined });

  const ctx = CONTEXT_TABS.find((t) => t === one(sp.ctx)) ?? "pages";
  const ap = APPROVAL_TABS.find((t) => t === one(sp.ap)) ?? "waiting";
  const preset = presetOf(sp);

  /* Tabs are addresses: each keeps the rest of the address as it is. */
  const keep = (change: Record<string, string | null>, anchor: string): string => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const s = one(v);
      if (s !== undefined && !(k in change) && !["do", "path", "q"].includes(k)) next.set(k, s);
    }
    for (const [k, v] of Object.entries(change)) if (v !== null) next.set(k, v);
    const qs = next.toString();
    return `/operator${qs ? `?${qs}` : ""}#${anchor}`;
  };
  const ctxHref = (t: ContextTab) => keep({ ctx: t === "pages" ? null : t }, "context");
  const apHref = (t: ApprovalTab) => keep({ ap: t === "waiting" ? null : t }, "approvals");

  return (
    <div className="dk-operator">
      {data.specimen ? <Ribbon /> : null}
      <Head runner={data.runner} working={data.working} />
      <div className="dk-operator-top">
        <Ask key={preset ? JSON.stringify(preset) : "plain"} preset={preset} range={data.range} specimen={!!data.specimen} />
        <Response answer={data.answer} cards={data.cards} specimen={!!data.specimen} />
        <Quick range={data.range} specimen={!!data.specimen} issuesHref={ctxHref("issues")} />
        <Feed actions={data.actions} />
      </div>
      <div className="dk-operator-bottom">
        <Tasks initial={{ runner: data.runner, working: data.working, tasks: data.tasks, latest: data.latest, ...(data.specimen ? { specimen: true } : {}) }} todos={data.todos} specimen={!!data.specimen} />
        <Context context={data.context} tab={ctx} hrefFor={ctxHref} range={data.range} specimen={!!data.specimen} />
        <Approvals data={data} tab={ap} hrefFor={apHref} specimen={!!data.specimen} />
      </div>
    </div>
  );
}
