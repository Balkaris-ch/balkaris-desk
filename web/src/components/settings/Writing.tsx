import type { Reading } from "@/contract/common";
import type { SettingsRunner, SettingsWriting } from "@/contract/settings";
import { Badge } from "@/components/ui/Badge";
import { Card, CardFoot } from "@/components/ui/Card";
import { Grid } from "@/components/ui/Grid";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { ago, fullDate, num } from "@/lib/format";
import { Code, Facts, Prose } from "./parts";

function PublishingCard({ writing }: { writing: Reading<SettingsWriting> }) {
  return (
    <Card title="Publishing" icon="send" right={<Stamp reading={writing} />}>
      <Read reading={writing}>
        {(w) => (
          <>
            <p className="dk-settings-state">
              <StatusDot tone={w.autopublish ? "good" : "quiet"} />
              <span>{w.autopublish ? "Articles publish themselves" : "Articles wait for a person"}</span>
            </p>
            <Prose>
              {w.autopublish ? (
                <p>
                  When the workstation has written an article and its cover is done, the desk publishes it, lists it on the journal and sends the live address to whoever shared
                  the link. The checks that throw a draft away (one that leans on its source, never names it, or comes out too short) still stop it before it gets here.
                </p>
              ) : (
                <p>A written article waits in the console until somebody opens it and publishes it.</p>
              )}
            </Prose>
            <Facts
              items={[
                ...(w.autopublish
                  ? [
                      {
                        label: "Publishes as",
                        value: "Whoever shared the link",
                        note: "If the desk has an address for them: the commit is theirs, and Vercel builds it because they are on the team.",
                      },
                      w.fallback
                        ? {
                            label: "Otherwise as",
                            value: w.fallback,
                            note: "The owner, when the person who shared it has no address yet. A link shared by somebody without edit on Insights is written and waits on the desk as a draft.",
                          }
                        : {
                            label: "Otherwise as",
                            value: (
                              <Badge tone="warn" dot>
                                Nobody
                              </Badge>
                            ),
                            note: "The owner has no address for publishing, so an article from somebody without one is written and not published.",
                          },
                    ]
                  : [
                      {
                        label: "Published by",
                        value: "Whoever presses Publish",
                        note: "In the console, on the article. The commit carries that person's address, so it must be on their Vercel account.",
                      },
                    ]),
                { label: "People who can publish", value: num(w.publishers) },
                {
                  label: "Switched by",
                  value: <Code>DESK_AUTOPUBLISH</Code>,
                  note: "In the server's configuration: 0 turns it off, anything else leaves it on. The desk only reads it; it is not changed from this page.",
                },
              ]}
            />
          </>
        )}
      </Read>
    </Card>
  );
}

function RunnerCard({ runner }: { runner: Reading<SettingsRunner> }) {
  return (
    <Card
      title="The workstation"
      icon="cpu"
      sub="It writes the articles, when it is awake. Shared links wait in the queue until it is."
      right={<Stamp reading={runner} />}
      footer={<CardFoot href="/console">Open the queue in the console</CardFoot>}
    >
      <Read reading={runner}>
        {(r) => (
          <>
            <p className="dk-settings-state">
              <StatusDot tone={r.awake ? "good" : "quiet"} pulse={r.awake} />
              <span>{r.awake ? "Awake" : r.lastSeen ? "Asleep" : "Never seen"}</span>
              {r.lastSeen ? (
                <span className="dk-settings-state-sub" title={fullDate(r.lastSeen)} suppressHydrationWarning>
                  asked for work {ago(r.lastSeen)}
                </span>
              ) : (
                <span className="dk-settings-state-sub">No runner has asked this desk for work yet.</span>
              )}
            </p>
            <Facts
              items={[
                { label: "Waiting in the queue", value: <span className="dk-num">{num(r.queued)}</span> },
                { label: "Being written now", value: <span className="dk-num">{num(r.running)}</span> },
                {
                  label: "Stuck after three tries",
                  value: r.stuck ? (
                    <Badge tone="warn" dot>
                      {num(r.stuck)}
                    </Badge>
                  ) : (
                    <span className="dk-num">0</span>
                  ),
                  note: r.stuck ? "Try again is on each one in the console." : undefined,
                },
                { label: "Written, not published yet", value: <span className="dk-num">{num(r.drafts)}</span> },
                { label: "Published and listed", value: <span className="dk-num">{num(r.listed)}</span> },
              ]}
            />
          </>
        )}
      </Read>
    </Card>
  );
}

/** WRITING: whether articles publish themselves, and the machine that writes them. */
export function WritingSection({ writing, runner }: { writing: Reading<SettingsWriting>; runner: Reading<SettingsRunner> }) {
  return (
    <Grid cols="1.25fr 1fr">
      <PublishingCard writing={writing} />
      <RunnerCard runner={runner} />
    </Grid>
  );
}
