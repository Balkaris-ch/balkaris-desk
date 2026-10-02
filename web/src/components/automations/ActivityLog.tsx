import type { ActivityItem, Reading } from "@/contract/common";
import type { ActivityPage } from "@/contract/automations";
import { Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Read } from "@/components/ui/Read";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { Table } from "@/components/ui/Table";
import { activityItems, Timeline } from "@/components/ui/Timeline";
import { clock, feedTime, num } from "@/lib/format";
import { kindWord, TONE_WORD } from "./words";

const PATH = "/automations";

/** This screen's address with the log's filter and a page. */
function href(kinds: string[], tone: string | null, page: number): string {
  const q = new URLSearchParams();
  if (kinds.length) q.set("kinds", kinds.join(","));
  if (tone) q.set("tone", tone);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return `${PATH}${s ? `?${s}` : ""}#log`;
}

/**
 * Everything the desk wrote down, newest first, filtered by kind and level
 * and paged. Other screens' "View all" links land here with ?kinds= and
 * ?tone= already set.
 */
export function ActivityLog({ reading, at }: { reading: Reading<ActivityPage>; at: string }) {
  const v = reading.state === "ok" ? reading.value : null;

  const kindOptions: SelectOption[] = [{ value: "", label: "All kinds" }];
  if (v) {
    /* A combination that came in by a link ("incident,probe") is an option of its own, so the select shows it. */
    if (v.filter.kinds.length > 1) kindOptions.push({ value: v.filter.kinds.join(","), label: v.filter.kinds.map(kindWord).join(" + ") });
    for (const k of v.kinds) kindOptions.push({ value: k.kind, label: `${kindWord(k.kind)} (${num(k.count)})` });
    /* A kind asked for that the log has never held still shows as chosen. */
    for (const k of v.filter.kinds) if (v.filter.kinds.length === 1 && !v.kinds.some((x) => x.kind === k)) kindOptions.push({ value: k, label: `${kindWord(k)} (0)` });
  }
  const toneOptions: SelectOption[] = [
    { value: "", label: "All levels" },
    ...(["bad", "warn", "good", "info", "quiet"] as const).map((t) => {
      const n = v?.tones.find((x) => x.tone === t)?.count ?? 0;
      return { value: t, label: `${TONE_WORD[t]!.many} (${num(n)})` };
    }),
  ];

  return (
    <div id="log" className="dk-automations-anchor">
      <Card
        title="Activity log"
        icon="list"
        count={v ? num(v.total) : undefined}
        sub="Everything the desk and its people wrote down, newest first"
        flush
        right={
          v ? (
            <div className="dk-automations-filters">
              <Select param="kinds" label="Kind" options={kindOptions} fallback="" resets={["page"]} />
              <Select param="tone" label="Level" options={toneOptions} fallback="" resets={["page"]} />
            </div>
          ) : null
        }
        footer={
          v && v.pages > 1 ? (
            <nav className="dk-automations-pager" aria-label="Pages of the activity log">
              <span className="dk-num dk-automations-quiet">
                {num((v.page - 1) * v.per + 1)}–{num(Math.min(v.total, v.page * v.per))} of {num(v.total)}
              </span>
              <span className="dk-automations-pager-go">
                {v.page > 1 ? (
                  <LinkButton href={href(v.filter.kinds, v.filter.tone, v.page - 1)} size="sm" icon="chevron-left">
                    Newer
                  </LinkButton>
                ) : null}
                {v.page < v.pages ? (
                  <LinkButton href={href(v.filter.kinds, v.filter.tone, v.page + 1)} size="sm" iconRight="chevron-right">
                    Older
                  </LinkButton>
                ) : null}
              </span>
            </nav>
          ) : null
        }
      >
        <Read reading={reading}>
          {(page, ok) => (
            <div className="dk-automations-log">
              <div className="dk-automations-log-table">
              <Table<ActivityItem>
                caption="Activity log"
                rows={page.items}
                rowKey={(a) => a.id}
                rowHref={(a) => a.href}
                minWidth={720}
                empty={
                  page.filter.kinds.length || page.filter.tone
                    ? "Nothing in the log matches this filter."
                    : "Nothing has been written down yet. The collectors write here as things happen: deployments, page changes, incidents, switches."
                }
                columns={[
                  {
                    key: "when",
                    head: "When",
                    width: "calc(var(--x56) * 2)",
                    cell: (a) => (
                      <time className="dk-num" dateTime={a.at}>
                        {feedTime(a.at, at)}
                        {feedTime(a.at, at) === clock(a.at) ? "" : ` ${clock(a.at)}`}
                      </time>
                    ),
                  },
                  {
                    key: "level",
                    head: "Level",
                    width: "calc(var(--x8) * 13)",
                    cell: (a) => (
                      <StatusDot tone={TONE_WORD[a.tone]?.tone ?? "quiet"} tint>
                        {TONE_WORD[a.tone]?.one ?? a.tone}
                      </StatusDot>
                    ),
                  },
                  {
                    key: "what",
                    head: "What happened",
                    cell: (a) => (
                      <span className="dk-automations-log-what">
                        <span className="dk-automations-log-text" title={a.text}>
                          {a.text}
                        </span>
                        {a.detail ? (
                          <small className="dk-automations-log-detail" title={a.detail}>
                            {a.detail}
                          </small>
                        ) : null}
                      </span>
                    ),
                  },
                  { key: "kind", head: "Kind", width: "calc(var(--x32) * 4)", cell: (a) => <Chip>{kindWord(a.kind)}</Chip> },
                  { key: "by", head: "By", width: "calc(var(--x32) * 4)", cell: (a) => <span className="dk-automations-log-by">{a.actor ?? "desk"}</span> },
                ]}
              />
              </div>
              {/* On a phone the table would scroll sideways: the same rows as the boards' feed instead. */}
              <div className="dk-automations-log-list">
                {page.items.length ? (
                  <Timeline label="Activity log" items={activityItems(page.items, new Date(at)).map((t, i) => ({ ...t, text: <>{t.text} <span className="dk-automations-quiet">· {kindWord(page.items[i]!.kind)}</span></> }))} />
                ) : (
                  <p className="dk-automations-quiet">{page.filter.kinds.length || page.filter.tone ? "Nothing in the log matches this filter." : "Nothing has been written down yet."}</p>
                )}
              </div>
              <div className="dk-automations-log-stamp">
                <Stamp reading={ok} />
              </div>
            </div>
          )}
        </Read>
      </Card>
    </div>
  );
}
