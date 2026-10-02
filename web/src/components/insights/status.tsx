import type { InsightRow, InsightStatus } from "@/contract/insights";
import { Chip, StatusChip } from "@/components/ui/Badge";

/** A status as a word in a line of small type. */
export const STATUS_WORD: Record<InsightStatus, string> = {
  published: "Published",
  review: "In review",
  draft: "Draft",
  writing: "Writing",
  toread: "To read",
  stuck: "Stuck",
  archived: "Archived",
};

/** The filter's options, in the order a piece moves through them. */
export const STATUS_OPTIONS: { value: InsightStatus; label: string }[] = [
  { value: "published", label: "Published" },
  { value: "review", label: "In review" },
  { value: "draft", label: "Draft" },
  { value: "writing", label: "Writing" },
  { value: "toread", label: "To read" },
  { value: "stuck", label: "Stuck" },
  { value: "archived", label: "Archived" },
];

/** A row's status chip: the primitive's for the six, a quiet one for a piece taken down or deleted. */
export function RowStatus({ row }: { row: Pick<InsightRow, "status" | "archived"> }) {
  if (row.status === "archived") {
    return (
      <Chip tone="quiet" icon={row.archived === "removed" ? "trash" : "x-circle"}>
        {row.archived === "removed" ? "Removed" : "Taken down"}
      </Chip>
    );
  }
  return <StatusChip status={row.status} />;
}
