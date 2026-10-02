import type { Reading } from "@/contract/common";
import type { ImportStep, ManualImport } from "@/contract/seo/ai-search";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent } from "@/components/seo/bits";
import { fullDate, num } from "@/lib/format";
import { ImportForm } from "./ImportForm";
import "@/components/ui/table.css";
import "./ai-search.css";

const ROWS = 10;

/** "2026-09" as "September 2026". */
const monthText = (m: string): string => {
  const [y, mo] = m.split("-").map(Number);
  return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][(mo ?? 1) - 1]} ${y}`;
};

/**
 * One of the two reports no API gives (Search Console's Generative AI,
 * Bing's AI Performance): the newest month imported, as exported, with the
 * months before it; or where it is exported and what it needs first. The
 * import is the owner's.
 */
export function ImportPanel({ reading, step, owner }: { reading: Reading<ManualImport>; step: ImportStep; owner: boolean }) {
  const v = reading.state === "ok" ? reading.value : null;
  return (
    <Card
      title={step.title}
      icon={step.kind === "gsc-generative-ai" ? "sparkles" : "search"}
      className="dk-seo-ai-search-panel"
      info="In no API: the report is exported as CSV once a month and imported here by the owner. Shown as exported, column for column; importing the same file twice changes nothing, and a new export of a month replaces the earlier one."
      sub={v ? `${monthText(v.month)} · imported by ${v.importedBy}, ${fullDate(v.importedAt)}` : "Monthly import"}
      right={<ImportForm kind={step.kind} title={step.title} owner={owner} blocked={step.needs} />}
    >
      {v ? (
        <>
          <div className="dk-table-wrap dk-seo-ai-search-import">
            <table className="dk-table dk-table--dense dk-table--caps">
              <caption className="dk-sr">
                {step.title}, {monthText(v.month)}, as exported
              </caption>
              <thead>
                <tr>
                  {v.columns.map((c, i) => (
                    <th key={`${c}-${i}`} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {v.rows.slice(0, ROWS).map((r, i) => (
                  <tr key={i}>
                    {v.columns.map((_, j) => (
                      <td key={j} className="dk-seo-ai-search-clip">
                        {r[j] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
                {!v.rows.length ? (
                  <tr className="dk-table-none">
                    <td colSpan={Math.max(1, v.columns.length)}>The export has its columns and no rows.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="dk-seo-ai-search-line dk-seo-ai-search-quiet">
            {(v.total ?? v.rows.length) > ROWS ? `The first ${num(ROWS)} of ${num(v.total ?? v.rows.length)} rows. ` : ""}
            {v.earlier.length ? `Earlier: ${v.earlier.map((e) => `${monthText(e.month)} (${num(e.rows)} rows)`).join(", ")}. ` : ""}
            <Stamp reading={reading} />
          </p>
        </>
      ) : reading.state !== "ok" ? (
        <>
          <PanelAbsent reading={reading} />
          <div className="dk-seo-ai-search-howto">
            <p className="dk-seo-ai-search-sublabel">How it gets here</p>
            <p className="dk-seo-ai-search-check-fix">
              <Icon name="arrow-right" size={12} />
              <span>{step.where}</span>
            </p>
            {step.needs ? <p className="dk-seo-ai-search-quiet">First: {step.needs}</p> : null}
            {step.ownerTask ? (
              <p className="dk-seo-ai-search-quiet">
                {step.where.startsWith(step.ownerTask.title) ? "Its task" : `Task: ${step.ownerTask.title}`}
                {step.ownerTask.done ? ` is marked done${step.ownerTask.doneBy ? ` by ${step.ownerTask.doneBy}` : ""}.` : " is open in Needs you."}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </Card>
  );
}
