import type { SeoTask, SeoTasksAnswer, TaskDoer } from "@/contract/seo/common";
import { api, ask } from "@/lib/api";
import { cx } from "@/lib/cx";
import { fullDate, num } from "@/lib/format";
import { Badge, Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { Tabs } from "@/components/ui/Tabs";
import { AddTask, ImportAudit, TaskMark, TaskNote } from "./ListAct";
import { TASKS_HREF } from "./pages";
import { SeoRefused } from "./Refused";
import "./lists.css";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** What the address may carry to the desk server; anything else in it is ignored. */
const PASSED = ["who", "done", "q", "open"] as const;

const WHO_TABS: { key: TaskDoer | "all"; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "owner", label: "The owner" },
  { key: "lead-chrome", label: "In the owner’s browser" },
  { key: "code", label: "Website code" },
  { key: "content", label: "Content" },
];

const DOER_SAYS: Record<TaskDoer, string> = {
  owner: "The owner’s own step",
  "lead-chrome": "In the owner’s browser",
  code: "Website code",
  content: "Content",
};

const IMPACT_TONE = { high: "bad", medium: "warn", low: "quiet" } as const;

const DONE_OPTIONS = [
  { value: "open", label: "Still to do" },
  { value: "done", label: "Done" },
  { value: "all", label: "Done or not" },
];

const FIND = "dk-seo-lists-find";

/** This list's address with some of what was asked changed (undefined or the default removes it). */
function tasksHref(asked: SeoTasksAnswer["asked"], change: Partial<Record<"who" | "done" | "q" | "open", string | undefined>>): string {
  const now: Record<string, string | undefined> = { who: asked.who, done: asked.done, q: asked.q || undefined, ...change };
  const p = new URLSearchParams();
  if (now.who && now.who !== "all") p.set("who", now.who);
  if (now.done && now.done !== "open") p.set("done", now.done);
  if (now.q) p.set("q", now.q);
  if (now.open) p.set("open", now.open);
  const s = p.toString();
  return s ? `${TASKS_HREF}?${s}` : TASKS_HREF;
}

/** The export of the list as filtered (GET /api/v1/seo/owner-tasks/export.csv takes the same filters). */
function exportHref(asked: SeoTasksAnswer["asked"]): string {
  const p = new URLSearchParams();
  if (asked.who !== "all") p.set("who", asked.who);
  p.set("done", asked.done);
  if (asked.q) p.set("q", asked.q);
  return `/api/v1/seo/owner-tasks/export.csv?${p.toString()}`;
}

/**
 * EVERY SEO TASK (/seo/list/tasks): the owner's own steps (the Overview's
 * "Needs you" shows those), the steps the lead takes in the owner's browser,
 * changes to the website's code and content to write, from the SEO audit's
 * import and written here by hand. One request (GET /api/v1/seo/owner-tasks)
 * draws it; who does it, done or not and the words searched for are in the
 * address, and ?open=<id> shows one task on top whatever the filters (the
 * search box and an opportunity's task lead there).
 *
 * A task is a person's to close: the owner's own steps only the owner marks,
 * the server refuses anybody else and says so.
 */
export async function TasksList({ q }: { q: Search }) {
  const params: Record<string, string | undefined> = {};
  for (const k of PASSED) params[k] = one(q[k])?.slice(0, 200);
  const got = await ask<SeoTasksAnswer>("/api/v1/seo/owner-tasks", params);
  if (!got.ok) {
    if (got.kind === "signed-out" || got.kind === "off") await api<SeoTasksAnswer>("/api/v1/seo/owner-tasks", params);
    if (got.kind === "forbidden") return <SeoRefused message={got.message} />;
    return (
      <Card title="SEO tasks" icon="list">
        <Empty icon="alert" title="The desk did not answer for this list">
          {got.message}
        </Empty>
      </Card>
    );
  }
  const d = got.value;
  const asked = d.asked;
  const openId = params.open?.trim();
  const filtered = asked.who !== "all" || asked.done !== "open" || !!asked.q;
  const tabs = WHO_TABS.map((t) => ({
    key: t.key,
    label: t.label,
    href: tasksHref(asked, { who: t.key, open: undefined }),
    count: t.key === "all" ? d.counts.open : d.counts.by[t.key].open,
    countTone: t.key === "owner" && d.counts.by.owner.open ? ("warn" as const) : undefined,
  }));

  return (
    <div className="dk-seo-lists">
      {openId ? (
        d.open ? (
          <Card title="The task" icon="flag" sub={DOER_SAYS[d.open.doer]} className="dk-seo-lists-opened" right={<LinkButton href={tasksHref(asked, { open: undefined })} size="sm" icon="x" aria-label="Close this task" />}>
            <TaskRow task={d.open} opened />
          </Card>
        ) : (
          <Card title="The task" icon="list">
            <Empty icon="search" title="No task has that name" compact>
              Nothing is kept under “{openId}”. It may have been removed by a later import of the audit; the list below has every task there is.
            </Empty>
          </Card>
        )
      ) : null}

      <form id={FIND} method="get" action={TASKS_HREF} hidden>
        {asked.who !== "all" ? <input type="hidden" name="who" value={asked.who} /> : null}
        {asked.done !== "open" ? <input type="hidden" name="done" value={asked.done} /> : null}
      </form>

      <Card
        title="Every SEO task"
        icon="list"
        count={num(d.tasks.length)}
        sub={`${num(d.counts.open)} still to do and ${num(d.counts.done)} done, of ${num(d.counts.all)}. From the SEO audit’s import and written here by hand.`}
        info="A task is done when a person marks it: the desk never marks one by itself, even when it sees the result (a profile that now exists, a page that is now indexed). The owner’s own steps (his accounts, his keys, his decisions) only the owner marks."
        right={
          <LinkButton href={exportHref(asked)} icon="download" size="sm" title="Download the list as filtered, as CSV">
            Export
          </LinkButton>
        }
      >
        <Tabs items={tabs} active={asked.who} label="Who does it" size="sm" className="dk-seo-lists-tabs" />
        <div className="dk-seo-lists-filters">
          <label className="dk-seo-lists-search">
            <Icon name="search" size={14} />
            <input form={FIND} type="search" name="q" defaultValue={asked.q} placeholder="Search the tasks…" aria-label="Search the tasks by their words" maxLength={80} />
          </label>
          <Select param="done" label="Done or not" fallback="open" resets={["open"]} options={DONE_OPTIONS} />
        </div>
        {d.tasks.length ? (
          <ul className="dk-seo-lists-rows">
            {d.tasks.map((t) => (
              <li key={t.id} id={`task-${t.id}`} className={cx(t.id === openId && "dk-seo-lists-row--on")}>
                <TaskRow task={t} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon="check-circle" title={filtered ? "No task matches" : "Nothing left to do"} compact>
            {filtered ? (
              <>
                Nothing here for these filters. <Go href={TASKS_HREF}>Every task still to do</Go>.
              </>
            ) : (
              "Every SEO task is marked done. A new one comes with the next import of the audit, or is written below."
            )}
          </Empty>
        )}
      </Card>

      <Card title="Add a task" icon="plus" sub="A step the SEO work waits on that no import wrote: it joins this list, and the owner’s own ones the Overview’s “Needs you”.">
        <AddTask />
      </Card>

      {/* The owner's alone, as on the server (requireOwner): the import reads files on the desk's machine. */}
      {d.can.ownerSteps ? (
        <Card title="The audit’s files" icon="refresh" sub="Most of these tasks, the tracked phrases and the competitors came from the SEO audit’s files. Bring them in again after the files change; a task marked or written here is kept as it is.">
          <ImportAudit />
        </Card>
      ) : null}
    </div>
  );
}

/** One task: what to do, who, its impact, why, its note, and the buttons this person may use. */
function TaskRow({ task: t, opened }: { task: SeoTask; opened?: boolean }) {
  const opportunity = t.href.startsWith("/seo/opportunities");
  return (
    <article className={cx("dk-seo-lists-task", t.done && "dk-seo-lists-task--done")}>
      <header className="dk-seo-lists-task-head">
        <h3 className="dk-seo-lists-task-title">
          {opened ? t.title : <Go href={`${TASKS_HREF}?open=${encodeURIComponent(t.id)}`}>{t.title}</Go>}
        </h3>
        <div className="dk-seo-lists-chips">
          <Badge tone={IMPACT_TONE[t.impact]}>{t.impact} impact</Badge>
          <Chip>{DOER_SAYS[t.doer]}</Chip>
          {t.effort ? <Chip>{t.effort}</Chip> : null}
          {t.done ? (
            <Badge tone="good" icon="check">
              Done{t.doneBy ? ` by ${t.doneBy}` : ""}
              {t.doneAt ? `, ${fullDate(t.doneAt)}` : ""}
            </Badge>
          ) : null}
        </div>
      </header>
      {opened || t.step !== t.title ? <p className="dk-seo-lists-task-step">{t.step}</p> : null}
      {t.why ? (
        <p className="dk-seo-lists-task-why">
          <span className="dk-seo-lists-k">Why</span> {t.why}
        </p>
      ) : null}
      {t.note ? (
        <p className="dk-seo-lists-task-note">
          <span className="dk-seo-lists-k">Note</span> {t.note}
        </p>
      ) : null}
      <footer className="dk-seo-lists-task-foot">
        <span className="dk-seo-lists-from">
          {t.from}
          {opportunity && t.opportunities ? (
            <>
              {" · "}
              <Go href={t.href}>
                {t.opportunities === 1 ? "an opportunity waits on it" : `${num(t.opportunities)} opportunities wait on it`}
              </Go>
            </>
          ) : null}
        </span>
        <span className="dk-seo-lists-buttons">
          {t.mayMark ? (
            <>
              <TaskMark id={t.id} done={t.done} />
              <TaskNote id={t.id} note={t.note} />
            </>
          ) : (
            <span className="dk-seo-lists-only">Only the owner marks his own steps or writes their note.</span>
          )}
        </span>
      </footer>
    </article>
  );
}
