import { Hono } from "hono";
import { z } from "zod";
import { log } from "../../db.ts";
import { me, requireOwner, type Vars } from "../access.ts";

/**
 * Settings › Writing › AI writer (src/ai/claude.ts).
 *
 * GET  /ai    the switch, the model, the month's budget and spend
 * POST /ai    { provider?, model?, budgetUsd? }   the owner only
 */
export const routes = new Hono<Vars>();

routes.get("/", async (c) => c.json((await import("../../ai/claude.ts")).aiState()));

const Change = z.object({
  provider: z.enum(["local", "anthropic"]).optional(),
  model: z.enum(["claude-opus-5-5", "claude-sonnet-5-5"]).optional(),
  budgetUsd: z.number().min(0).max(2000).optional(),
});

routes.post("/", requireOwner, async (c) => {
  const parsed = Change.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Send provider local or anthropic, a model, and a budget between 0 and 2000 dollars." }, 400);
  const ai = await import("../../ai/claude.ts");
  const next = ai.saveSettings(parsed.data);
  log("ai.settings", { by: me(c).name, ...next });
  const now = ai.aiState();
  const line =
    now.effective === "anthropic"
      ? `Saved. The desk now writes with ${ai.MODELS.find((m) => m.id === now.model)?.label ?? now.model}.`
      : now.provider === "anthropic"
        ? `Saved, but the desk still writes locally: ${now.why}.`
        : "Saved. The desk writes locally on the studio PC.";
  return c.json({ ...now, line });
});
