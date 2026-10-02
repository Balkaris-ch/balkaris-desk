import type { ExperimentsPayload, SavedRow } from "@/contract/experiments";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Empty } from "@/components/ui/Empty";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { fullDate, num } from "@/lib/format";
import { RemoveForm } from "./forms";
import { to, type Here } from "./href";

/** What a saved comparison asks, in a line. */
function asked(s: SavedRow): string {
  const change = s.change.kind === "commit" ? (s.change.subject ? `${s.change.short} · ${s.change.subject}` : `${s.change.short} (not on the branch any more)`) : `Around ${fullDate(s.change.day)}`;
  return change;
}

function Remove({ s, now }: { s: SavedRow; now: Here }) {
  return (
    <Dialog title={`Remove “${s.name}”?`} description="Only the saved question goes: nothing about the website changes, and the same comparison can be opened again from Recent changes." size="sm" trigger={{ label: "Remove", variant: "ghost", size: "xs" }}>
      <RemoveForm id={s.id} back={to(now, {}, "saved")} />
    </Dialog>
  );
}

/** A saved comparison's buttons: open it, and remove it when the person may. */
function Acts({ s, now }: { s: SavedRow; now: Here }) {
  return (
    <span className="dk-experiments-acts">
      <LinkButton href={to({ range: now.range, metric: now.metric }, { saved: s.id }, "compare")} size="xs" variant="good">
        Open
      </LinkButton>
      {s.mine ? <Remove s={s} now={now} /> : null}
    </span>
  );
}

/**
 * Saved comparisons: what people asked to look at again. Opening one works
 * its figures out afresh; nothing but the question is kept.
 */
export function SavedCard({ data, now }: { data: ExperimentsPayload; now: Here }) {
  const r = data.saved;
  const open = data.comparison?.saved?.id ?? null;
  /* The table's own count: the list stops at the newest 200. */
  const total = data.tiles.saved.state === "ok" ? data.tiles.saved.value.value : r.state === "ok" ? r.value.length : 0;
  return (
    <Card
      id="saved"
      title="Saved comparisons"
      icon="bookmark"
      className="dk-experiments-saved"
      count={total ? num(total) : undefined}
      sub="Kept with a name and a note; the figures are worked out again when one is opened"
      info="Each row keeps who saved it, when, and what it asks: the change or the date, the page and the window. No figure is stored, because GA4 revises its last days and a stored figure would go stale without saying so."
      flush
      footer={
        r.state === "ok" && r.value.length ? (
          <div className="dk-experiments-foot">
            <Stamp reading={r} />
          </div>
        ) : undefined
      }
    >
      <Read reading={r}>
        {(rows) =>
          rows.length ? (
            <>
              <div className="dk-experiments-wide">
                <Table
                  caption="Saved comparisons"
                  rows={rows}
                  rowKey={(s) => s.id}
                  density="roomy"
                  minWidth={720}
                  columns={[
                    {
                      key: "name",
                      head: "Name",
                      width: "30%",
                      cell: (s) => (
                        <span className="dk-experiments-change">
                          <span className="dk-experiments-subject" data-on={s.id === open ? "" : undefined}>
                            {s.name}
                          </span>
                          {s.note ? (
                            <span className="dk-experiments-meta" title={s.note}>
                              {s.note}
                            </span>
                          ) : null}
                        </span>
                      ),
                    },
                    {
                      key: "asks",
                      head: "Compares",
                      cell: (s) => (
                        <span className="dk-experiments-change">
                          <span className="dk-experiments-asked" title={asked(s)}>
                            {asked(s)}
                          </span>
                          <span className="dk-experiments-meta">
                            {s.page ?? "The whole site"} · {s.window} days each side
                          </span>
                        </span>
                      ),
                    },
                    {
                      key: "by",
                      head: "Saved",
                      width: "16%",
                      cell: (s) => (
                        <span className="dk-experiments-when">
                          {s.by}
                          <span className="dk-experiments-quiet dk-num">{fullDate(s.at)}</span>
                        </span>
                      ),
                    },
                    {
                      key: "act",
                      head: <span className="dk-sr">Actions</span>,
                      align: "right",
                      width: "172px",
                      cell: (s) => <Acts s={s} now={now} />,
                    },
                  ]}
                />
              </div>
              <ul className="dk-experiments-narrow" aria-label="Saved comparisons">
                {rows.map((s) => (
                  <li key={s.id} className="dk-experiments-item">
                    <div className="dk-experiments-item-head">
                      <span className="dk-experiments-item-subject" data-on={s.id === open ? "" : undefined}>
                        {s.name}
                      </span>
                      <Acts s={s} now={now} />
                    </div>
                    {s.note ? <span className="dk-experiments-quiet">{s.note}</span> : null}
                    <span className="dk-experiments-asked">{asked(s)}</span>
                    <span className="dk-experiments-meta">
                      {s.page ?? "The whole site"} · {s.window} days each side · {s.by}, {fullDate(s.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Empty icon="bookmark" title="No comparison saved yet" compact>
              Open a comparison and press Save comparison. Only the question is kept: the change, the page and the window.
            </Empty>
          )
        }
      </Read>
    </Card>
  );
}
