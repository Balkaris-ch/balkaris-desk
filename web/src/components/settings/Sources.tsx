import type { ReactNode } from "react";
import type { Reading, SourceStatus } from "@/contract/common";
import type { Allowance, KeyEvent, KeyEvents, OwnerStep, SettingsAccount, SettingsQuota, SettingsSources } from "@/contract/settings";
import { Badge, Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Grid, Stack } from "@/components/ui/Grid";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { Table } from "@/components/ui/Table";
import { ago, fullDate, num, sourceLabel } from "@/lib/format";
import { Copy } from "./Copy";
import { Code, Facts, Prose } from "./parts";

const STATE: Record<SourceStatus["state"], { label: string; tone: "good" | "info" | "quiet" | "bad" }> = {
  connected: { label: "Connected", tone: "good" },
  waiting: { label: "Waiting", tone: "info" },
  off: { label: "Not connected", tone: "quiet" },
  failing: { label: "Failing", tone: "bad" },
};

/* ---------- the owner's checklist ------------------------------------------- */

function Step({ step, n }: { step: OwnerStep; n: number }) {
  return (
    <li className="dk-settings-step">
      <span className="dk-settings-step-n dk-num" aria-hidden>
        {n}
      </span>
      <div className="dk-settings-step-body">
        <div className="dk-settings-step-head">
          <p className="dk-settings-step-title">{step.title}</p>
          {step.unconfirmed ? (
            <Chip tone="info">Not confirmed</Chip>
          ) : (
            <Chip tone={step.tone === "bad" ? "bad" : "warn"}>{step.tone === "bad" ? "Refused" : "To do"}</Chip>
          )}
        </div>
        <p className="dk-settings-step-unlocks">
          <span className="dk-settings-step-key">Unlocks</span> {step.unlocks}
        </p>
        {step.why ? (
          <p className="dk-settings-step-why">
            <span className="dk-settings-step-key">Now</span> {step.why}
          </p>
        ) : null}
        {step.unconfirmed ? (
          <p className="dk-settings-step-why">
            <span className="dk-settings-step-key">Not confirmed</span> {step.unconfirmed}
          </p>
        ) : null}
        <div className="dk-settings-step-text">
          <p>{step.step}</p>
          <span className="dk-settings-step-copy">
            <Copy text={step.step} label="Copy step" what={step.title} />
          </span>
        </div>
        {step.commands.map((cmd) => (
          <div className="dk-settings-cmd" key={cmd}>
            <span className="dk-settings-cmd-prompt" aria-hidden>
              $
            </span>
            <code className="dk-settings-cmd-text">{cmd}</code>
            <Copy text={cmd} what={`the command for ${step.title}`} />
          </div>
        ))}
        {step.links.length ? (
          <div className="dk-settings-step-links">
            {step.links.map((href) => (
              <LinkButton key={href} href={href} size="xs" variant="quiet" iconRight="external">
                {new URL(href).hostname}
              </LinkButton>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Checklist({ sources }: { sources: Reading<SettingsSources> }) {
  const steps = sources.state === "ok" ? sources.value.steps : null;
  return (
    <Card
      title="What only the owner can connect"
      icon="flag"
      tone={steps?.length ? "warn" : "good"}
      count={steps?.length}
      sub="Every source the desk cannot read yet, most valuable first, with the one step that connects it."
      right={<Stamp reading={sources} />}
      footer={
        <p className="dk-settings-foot">
          No credential is typed into the desk or shown on it. Each one is placed on the server by the owner, with the line given here, and the desk notices it by itself.
        </p>
      }
    >
      <Read reading={sources}>
        {(v) =>
          v.steps.length ? (
            <ol className="dk-settings-steps">
              {v.steps.map((s, i) => (
                <Step key={s.id} step={s} n={i + 1} />
              ))}
            </ol>
          ) : (
            <Empty icon="check-circle" title="Nothing left to connect" compact>
              Every source the desk reads answers on its own.
            </Empty>
          )
        }
      </Read>
    </Card>
  );
}

/* ---------- the side panels --------------------------------------------------- */

function AccountCard({ account }: { account: Reading<SettingsAccount> }) {
  return (
    <Card title="The desk's Google account" icon="user" right={<Stamp reading={account} />}>
      <Read reading={account}>
        {(a) => (
          <>
            <div className="dk-settings-copyline">
              <Code>{a.email}</Code>
              <Copy text={a.email} label="Copy" what="the desk's Google account address" />
            </div>
            <Prose>
              <p>
                This is the address to add as a user in Search Console. The desk only ever asks Google with read-only scopes. In Search Console the step adds it as a Full user,
                the smallest level Google&apos;s documentation does not leave in doubt for reading through the API; the desk still only reads. Its key stays on the server and is
                never shown.
              </p>
            </Prose>
            {a.project ? <Facts items={[{ label: "Google Cloud project", value: <Code>{a.project}</Code> }]} /> : null}
          </>
        )}
      </Read>
    </Card>
  );
}

/** How many were recorded, in words: a count under 20 is said as it is. */
function recorded(e: KeyEvent): string | null {
  if (e.recorded === null) return null;
  if (e.recorded === 0) return "Not recorded in the last 30 days.";
  return `${num(e.recorded)} recorded in the last 30 days.`;
}

/**
 * With GA4's setting read, the badge is the setting. Without it, it is only
 * what the recorded events carry, named as that: GA4 flags an event as key
 * when it is recorded, from the marking on, so "not counted" may still be
 * marked, with no enquiry since.
 */
function keyState(e: KeyEvent, read: boolean): { value: ReactNode; note: string | null } {
  if (read) {
    return {
      value: e.marked ? (
        <Badge tone="good" dot>
          Marked as key event
        </Badge>
      ) : (
        <Badge tone="warn" dot>
          Not marked
        </Badge>
      ),
      note: recorded(e),
    };
  }
  if (e.recorded === null || e.counted === null) return { value: <span className="dk-settings-quiet">Not known</span>, note: "Neither the setting nor the events report could be read." };
  if (e.recorded === 0) return { value: <Chip>Not recorded in 30 days</Chip>, note: "So nothing says whether it is marked." };
  if (e.counted) {
    return {
      value: (
        <Badge tone="good" dot>
          Counted as key
        </Badge>
      ),
      note: e.recorded === 1 ? "The one recorded in the last 30 days." : `At least one of the ${num(e.recorded)} recorded in the last 30 days.`,
    };
  }
  return {
    value: (
      <Badge tone="warn" dot>
        Not counted as key
      </Badge>
    ),
    note: e.recorded === 1 ? "The one recorded in the last 30 days was not." : `None of the ${num(e.recorded)} recorded in the last 30 days.`,
  };
}

function KeyEventsCard({ keyEvents }: { keyEvents: Reading<KeyEvents> }) {
  return (
    <Card title="Key events in GA4" icon="target" right={<Stamp reading={keyEvents} />} sub="Whether GA4 counts the website's two enquiry events as key events.">
      <Read reading={keyEvents}>
        {(k) => (
          <>
            <Facts
              items={k.events.map((e) => {
                const s = keyState(e, k.setting.read);
                return {
                  label: (
                    <span className="dk-settings-evt">
                      <Code>{e.name}</Code>
                      <span className="dk-settings-quiet">{e.what}</span>
                    </span>
                  ),
                  value: s.value,
                  note: s.note,
                };
              })}
            />
            <p className="dk-settings-keynote">
              {k.setting.read
                ? "Read from GA4's own settings, asked again every ten minutes."
                : `${k.setting.why} So this is the flag GA4 puts on each recorded event, which it sets only for events recorded after the marking.${k.setting.step ? " The step that lets the desk read the setting is in the list." : ""}`}
            </p>
          </>
        )}
      </Read>
    </Card>
  );
}

function share(a: Allowance): "good" | "warn" | "bad" {
  if (a.left === null || a.of === null || a.of === 0) return "good";
  const r = a.left / a.of;
  return r < 0.1 ? "bad" : r < 0.3 ? "warn" : "good";
}

function AllowanceRow({ a }: { a: Allowance }) {
  return (
    <div className="dk-settings-allow">
      <div className="dk-settings-allow-head">
        <span className="dk-settings-allow-label">{a.label}</span>
        <span className="dk-settings-allow-value dk-num">{a.left === null ? <span className="dk-settings-quiet">Not known</span> : `${num(a.left)} of ${num(a.of)} left`}</span>
      </div>
      {a.left !== null && a.of ? <ProgressBar value={a.left} max={a.of} tone={share(a)} label={`${a.label}: share left`} /> : null}
      {a.pace && a.pace !== "ok" ? (
        <span className="dk-settings-allow-note">
          <Chip tone={a.pace === "hold" ? "bad" : "warn"}>{a.pace === "hold" ? "Holding" : "Slowed"}</Chip> {a.note}
        </span>
      ) : a.note ? (
        <span className="dk-settings-allow-note">{a.note}</span>
      ) : null}
    </div>
  );
}

function QuotaCard({ quota }: { quota: SettingsQuota }) {
  return (
    <Card title="Quota left" icon="gauge" right={<Stamp reading={quota.ga4} />} sub="What the metered sources still let the desk ask, as each last said.">
      <div className="dk-settings-allows">
        <Read reading={quota.ga4} form="panel">
          {(g) => (
            <>
              {[...g.history, ...g.realtime].map((a) => (
                <AllowanceRow key={a.label} a={a} />
              ))}
            </>
          )}
        </Read>
        <div className="dk-settings-allow">
          <div className="dk-settings-allow-head">
            <span className="dk-settings-allow-label">Clarity data export</span>
            <span className="dk-settings-allow-value">
              <Read reading={quota.clarity} form="inline">
                {(c) => <span className="dk-num">{`${num(c.left)} of ${num(c.of)} left ${c.per}`}</span>}
              </Read>
            </span>
          </div>
          {quota.clarity.state === "ok" ? (
            <ProgressBar value={quota.clarity.value.left ?? 0} max={quota.clarity.value.of ?? 10} tone={share(quota.clarity.value)} label="Clarity requests left today" />
          ) : (
            <span className="dk-settings-allow-note">{quota.clarity.reason}</span>
          )}
        </div>
        <div className="dk-settings-allow">
          <div className="dk-settings-allow-head">
            <span className="dk-settings-allow-label">PageSpeed Insights</span>
            <span className="dk-settings-allow-value">
              <Read reading={quota.pagespeed} form="inline">
                {(p) => (p.keyed ? "With the desk's own key" : "Without a key")}
              </Read>
            </span>
          </div>
          {quota.pagespeed.state === "ok" ? (
            <span className="dk-settings-allow-note">
              {quota.pagespeed.value.refused
                ? `Last refused on ${fullDate(quota.pagespeed.value.refused.day)} (${quota.pagespeed.value.refused.said}).`
                : "Google has not refused it lately."}
              {quota.pagespeed.value.keyed ? "" : " Keyless requests share Google's quota with everybody else."}
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/* ---------- every source, and the checks ------------------------------------- */

function SourcesTable({ sources }: { sources: Reading<SettingsSources> }) {
  return (
    <Card
      title="Every source"
      icon="database"
      count={sources.state === "ok" ? sources.value.list.length : undefined}
      sub="What each one feeds, and whether it answers. Not connected is not a fault: it is waiting for its step."
      right={<Stamp reading={sources} />}
      flush
    >
      <Read reading={sources}>
        {(v) => (
          <Table
            caption="Sources"
            rows={v.list}
            rowKey={(s) => `${s.id}:${s.name}`}
            density="roomy"
            minWidth={820}
            empty="No source has registered itself."
            columns={[
              {
                key: "source",
                head: "Source",
                width: "30%",
                sort: (s) => s.name,
                cell: (s) => (
                  <span className="dk-settings-src">
                    <span className="dk-settings-src-name">{s.name}</span>
                    {s.error && s.state !== "connected" ? <span className="dk-settings-src-err">{s.error}</span> : <span className="dk-settings-who-sub">{sourceLabel(s.id)}</span>}
                  </span>
                ),
              },
              { key: "feeds", head: "Feeds", cell: (s) => <span className="dk-settings-wrap">{s.feeds}</span> },
              {
                key: "state",
                head: "State",
                width: "130px",
                sort: (s) => ["failing", "off", "waiting", "connected"].indexOf(s.state),
                cell: (s) => (
                  <Badge tone={STATE[s.state].tone} dot>
                    {STATE[s.state].label}
                  </Badge>
                ),
              },
              {
                key: "last",
                head: "Last answer",
                width: "120px",
                sort: (s) => s.lastOk,
                cell: (s) =>
                  s.lastOk ? (
                    <time dateTime={s.lastOk} title={fullDate(s.lastOk)} suppressHydrationWarning>
                      {ago(s.lastOk)}
                    </time>
                  ) : (
                    <span className="dk-settings-quiet">Never</span>
                  ),
              },
            ]}
          />
        )}
      </Read>
    </Card>
  );
}

function ChecksCard({ sources }: { sources: Reading<SettingsSources> }) {
  return (
    <Card
      title="What the light checks"
      icon="heart-pulse"
      count={sources.state === "ok" ? sources.value.checks.length : undefined}
      sub="The top bar's light stands on these. The workstation is listed, and never turns it red."
      right={<Stamp reading={sources} />}
    >
      <Read reading={sources}>
        {(v) =>
          v.checks.length ? (
            <ul className="dk-settings-checks">
              {v.checks.map((c, i) => (
                <li key={`${c.name}-${i}`} className="dk-settings-checkline">
                  <StatusDot tone={c.ok ? "good" : "bad"} title={c.ok ? "Holds" : "Failing"} />
                  <span className="dk-settings-checkline-text">
                    <span className="dk-settings-checkline-name">{c.name}</span>
                    <span className="dk-settings-checkline-detail">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="hourglass" title="Nothing checked yet" compact>
              The collectors have not finished a first run.
            </Empty>
          )
        }
      </Read>
    </Card>
  );
}

/** SOURCES: the owner's checklist first, then every source as it reports itself. */
export function SourcesSection({
  sources,
  account,
  keyEvents,
  quota,
}: {
  sources: Reading<SettingsSources>;
  account: Reading<SettingsAccount>;
  keyEvents: Reading<KeyEvents>;
  quota: SettingsQuota;
}) {
  return (
    <>
      <Grid cols="1.7fr 1fr" mid="1.45fr 1fr">
        <Checklist sources={sources} />
        <Stack className="dk-settings-side">
          <AccountCard account={account} />
          <KeyEventsCard keyEvents={keyEvents} />
          <QuotaCard quota={quota} />
          <ChecksCard sources={sources} />
        </Stack>
      </Grid>
      <SourcesTable sources={sources} />
    </>
  );
}

