import type { ReadinessCheck } from "@/contract/seo/ai-search";
import type { ChipTone } from "@/components/ui/Badge";
import type { IconName } from "@/components/ui/icons";

/** How a readiness check's state is drawn: shared by the server panels and the page table (a client component). */
export const CHECK_STATE: Record<ReadinessCheck["state"], { tone: ChipTone; icon: IconName; word: string }> = {
  pass: { tone: "good", icon: "check-circle", word: "Passes" },
  fail: { tone: "bad", icon: "x-circle", word: "Fails" },
  unknown: { tone: "warn", icon: "help", word: "Could not be read" },
  "n/a": { tone: "quiet", icon: "minus", word: "Does not apply" },
};

/** Who fixes a failing check, as a chip. */
export const WHO_FIX: Record<NonNullable<ReadinessCheck["who"]>, { word: string; tone: ChipTone }> = {
  content: { word: "Content", tone: "violet" },
  code: { word: "Website code", tone: "quiet" },
  owner: { word: "Needs you", tone: "warn" },
};
