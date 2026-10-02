import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type { LeadsDetail } from "@/contract/leads";
import { Chip } from "@/components/ui/Badge";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { ago, DASH } from "@/lib/format";
import { SheetKeys } from "./SheetKeys";
import { callTime, intentWords, leadsHref, pageHref, stageLabel, stageTone, stampTime, webHref, type LeadsQuery } from "./words";

/**
 * One enquiry in full, in a panel over the right of the screen. Its address
 * is /leads?open=<id> with the screen's filters kept, so it can be shared and
 * the back button closes it. Read only: the engine owns the enquiry, and the
 * one way to change it is the engine's own interface.
 */
export function LeadSheet({ reading, query, closeHref }: { reading: Reading<LeadsDetail>; query: LeadsQuery; closeHref: string }) {
  const titleId = "dk-leads-sheet-title";
  return (
    <div className="dk-leads-sheet-wrap">
      <Go href={closeHref} scroll={false} className="dk-leads-scrim" aria-hidden tabIndex={-1}>
        <span className="dk-sr">Close</span>
      </Go>
      <aside className="dk-leads-sheet" id="dk-leads-sheet" tabIndex={-1} aria-labelledby={titleId}>
        <SheetKeys closeHref={closeHref} focusId="dk-leads-sheet" />
        <Go href={closeHref} scroll={false} className="dk-leads-sheet-x" aria-label="Close the enquiry">
          <Icon name="x" size={16} />
        </Go>
        {reading.state === "ok" ? (
          <Detail d={reading.value} reading={reading} query={query} titleId={titleId} />
        ) : (
          <div className="dk-leads-sheet-body">
            <h2 className="dk-leads-sheet-title" id={titleId}>
              Enquiry
            </h2>
            <Absent reading={reading} />
          </div>
        )}
      </aside>
    </div>
  );
}

function Detail({ d, reading, query, titleId }: { d: LeadsDetail; reading: Reading<LeadsDetail>; query: LeadsQuery; titleId: string }) {
  const site = webHref(d.website);
  const intent = intentWords(d.intent);
  const s = d.summary;
  const hasSummary = !!s && !!(s.projectType || s.goals.length || s.timeline || s.references);

  return (
    <div className="dk-leads-sheet-body">
      <header className="dk-leads-sheet-head">
        <p className="dk-eyebrow">
          Enquiry{d.ref ? <span className="dk-leads-ref"> · {d.ref}</span> : null}
        </p>
        <h2 className="dk-leads-sheet-title" id={titleId}>
          {d.name ?? d.email ?? "No name given"}
        </h2>
        <p className="dk-leads-sheet-sub">
          {d.company ?? "No company given"}
          {d.receivedAt ? (
            <>
              {" · "}
              <time dateTime={d.receivedAt} suppressHydrationWarning>
                received {ago(d.receivedAt)}
              </time>
            </>
          ) : null}
        </p>
        <div className="dk-leads-sheet-chips">
          <Chip tone={stageTone(d.stage)}>{stageLabel(d.stage)}</Chip>
          {d.call ? (
            <Chip tone={d.call.cancelled ? "bad" : d.call.cancelled === null ? "warn" : "good"} icon="calendar">
              {d.call.cancelled ? "Call cancelled" : d.call.cancelled === null ? "Call booked, cancellation not stated" : "Call booked"}
            </Chip>
          ) : null}
          {d.returning ? <Chip tone="info">Returning</Chip> : null}
          {d.current === false ? <Chip>An earlier enquiry of this lead</Chip> : null}
        </div>
        <div className="dk-leads-sheet-meta">
          <Stamp reading={reading} />
          {d.engineHref ? (
            <Go href={d.engineHref} className="dk-leads-sheet-engine">
              Open the lead in the engine
              <Icon name="external" size={12} />
            </Go>
          ) : null}
        </div>
      </header>

      <Section title="Message">
        {d.message ? <p className="dk-leads-message">{d.message}</p> : <p className="dk-leads-quiet">They wrote no message.</p>}
      </Section>

      <Section title="Asked for">
        <div className="dk-leads-sheet-chips">
          {d.services.length ? d.services.map((x) => <Chip key={x} tone="violet">{x}</Chip>) : <span className="dk-leads-quiet">No service named</span>}
        </div>
        {intent ? <p className="dk-leads-line">{intent}</p> : null}
        <Facts
          rows={[
            ["Sent from", d.page.path ? <Go href={pageHref(d.page.path)}>{d.page.path}</Go> : <span className="dk-leads-quiet">No page recorded</span>],
            ["Page group", d.page.groupLabel],
          ]}
        />
      </Section>

      <Section title="Contact">
        <Facts
          rows={[
            ["Email", d.email ? <a href={`mailto:${d.email}`}>{d.email}</a> : null],
            ["Phone", d.phone ? <a href={`tel:${d.phone.replace(/[^\d+]/g, "")}`}>{d.phone}</a> : null],
            ["Website", d.website ? site ? <Go href={site}>{d.website}</Go> : d.website : null],
            ["Links", d.links ? <span className="dk-leads-pre">{d.links}</span> : null],
          ]}
        />
        <p className="dk-leads-fine">The address is the lead&apos;s: the engine keeps one per lead, not one per enquiry.</p>
      </Section>

      <Section title="The engine's summary">
        {hasSummary ? (
          <Facts
            rows={[
              ["Project", s!.projectType],
              ["Goals", s!.goals.length ? <ul className="dk-leads-goals">{s!.goals.map((g) => <li key={g}>{g}</li>)}</ul> : null],
              ["Timeline", s!.timeline],
              ["References", s!.references ? <span className="dk-leads-pre">{s!.references}</span> : null],
            ]}
          />
        ) : (
          <p className="dk-leads-quiet">The engine holds no summary for this enquiry.</p>
        )}
        {d.firstWords || d.recommendation ? (
          <Facts
            rows={[
              ["First words to the guide", d.firstWords ? <span className="dk-leads-pre">{d.firstWords}</span> : null],
              ["Recommendation shown", d.recommendation],
            ]}
          />
        ) : null}
      </Section>

      <Section title="Call">
        {d.call ? (
          <Facts
            rows={[
              ["When", <span key="w" className={d.call.cancelled ? "dk-leads-struck" : undefined}>{callTime(d.call.start)}{d.call.end ? ` to ${callTime(d.call.end).split(", ")[1]}` : ""} (Zurich)</span>],
              ["With", d.call.with],
              ["Meeting link", d.call.meetUrl && !d.call.cancelled ? <Go href={d.call.meetUrl}>{d.call.meetUrl.replace(/^https?:\/\//, "")}</Go> : null],
              ["Booked", d.call.bookedAt ? stampTime(d.call.bookedAt) : null],
              [
                "Cancelled",
                d.call.cancelled
                  ? [d.call.cancelledAt ? stampTime(d.call.cancelledAt) : "", d.call.cancelledBy ? `by ${d.call.cancelledBy}` : ""].filter(Boolean).join(" ") || "Yes"
                  : d.call.cancelled === null
                    ? "The engine did not say, so this call is not counted as booked"
                    : null,
              ],
            ]}
          />
        ) : (
          <p className="dk-leads-quiet">No call was booked with this enquiry.</p>
        )}
      </Section>

      <Section title="Stages">
        {d.timeline.length ? (
          <ol className="dk-leads-steps">
            {d.timeline.map((t, i) => (
              <li key={`${t.stage}-${t.at}-${i}`}>
                <span className="dk-leads-steps-dot" data-tone={stageTone(t.stage)} aria-hidden />
                <span className="dk-leads-steps-text">{stageLabel(t.stage)}</span>
                <time dateTime={t.at} className="dk-leads-steps-time">
                  {stampTime(t.at)}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="dk-leads-quiet">The engine sent no stage history for this enquiry.</p>
        )}
      </Section>

      <Section title="Updates to the visitor">
        {d.updates.length ? (
          <ul className="dk-leads-updates">
            {d.updates.map((u, i) => (
              <li key={`${u.at}-${i}`}>
                <p>{u.text}</p>
                <p className="dk-leads-fine">
                  {stampTime(u.at)}
                  {u.by ? ` · ${u.by}` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dk-leads-quiet">No update has been written for this visitor&apos;s status page.</p>
        )}
      </Section>

      <Section title="This lead's other enquiries">
        {d.others.length ? (
          <ul className="dk-leads-others">
            {d.others.map((o) => (
              <li key={o.id}>
                <Go href={leadsHref(query, o.id)} scroll={false} className="dk-leads-other">
                  <span className="dk-leads-other-top">
                    <span className="dk-leads-ref">{o.ref ?? DASH}</span>
                    <span className="dk-leads-fine">{o.receivedAt ? stampTime(o.receivedAt) : DASH}</span>
                  </span>
                  <span className="dk-leads-other-what">
                    {o.services.length ? o.services.join(", ") : "No service named"}
                    {intentWords(o.intent) ? ` · ${intentWords(o.intent)}` : ""}
                  </span>
                  <Chip tone={stageTone(o.stage)}>{stageLabel(o.stage)}</Chip>
                </Go>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dk-leads-quiet">The engine holds no other enquiry from this lead.</p>
        )}
      </Section>

      <Section title="In the engine">
        <Facts
          rows={[
            ["Lead status", d.leadStatus],
            ["Known from", d.leadSource ? d.leadSource.replace(/_/g, " ") : null],
          ]}
        />
        <p className="dk-leads-fine">The desk only reads. Stages, updates and calls are changed in the engine&apos;s own interface.</p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dk-leads-sec">
      <h3 className="dk-leads-sec-title">{title}</h3>
      {children}
    </section>
  );
}

/** Label and value rows. A row whose value is null is printed with a dash, so what the engine did not send is seen as missing. */
function Facts({ rows }: { rows: [string, ReactNode | null | undefined][] }) {
  return (
    <dl className="dk-leads-dl">
      {rows.map(([k, v]) => (
        <div key={k} className="dk-leads-dl-row">
          <dt>{k}</dt>
          <dd>{v == null || v === "" ? <span className="dk-leads-quiet">{DASH}</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}
