/**
 * The AI Operator screen, as the desk server describes it.
 *
 * THE TRUTH ABOUT THE MODEL. There is no paid model and there will be none.
 * The only model is the local one on the studio's workstation, reached
 * through the runner, which is on in working hours and off otherwise. So the
 * operator is QUEUED, not live: a request becomes a task, the workstation
 * picks it up when it is on, answers from the context the desk assembled from
 * its own stored data, and the answer appears here. Every type below carries
 * enough to say that truthfully: where a task is in the queue, which data it
 * was given and from when, and whether the workstation is on.
 *
 * Types only. The server imports this file with `import type`.
 */

import type { ActivityItem, Range, Reading, SourceId, Tone } from "./common";

/** What a task asks the model to do. */
export type TaskKind =
  /** A free question, answered in plain text from the chosen context. */
  | "ask"
  /** What changed in the traffic and what stands out, quoting the pack's figures. */
  | "traffic"
  /** Opportunities from the crawl's findings and, when connected, Search Console. */
  | "opportunities"
  /** New titles and descriptions for pages; each becomes a proposal. */
  | "metadata"
  /** Targets for addresses that no longer answer; rules pick the candidates, the model ranks; each becomes a proposal. */
  | "redirect"
  /** A page or article brief for a topic or query. */
  | "brief"
  /** The crawl is run, then its findings are summarised. */
  | "audit"
  /** A share title and description for one page, from what the page says; becomes an "og" proposal. */
  | "og"
  /** A FAQPage or Service block for one page, from its own text; becomes a "schema" proposal. */
  | "schema"
  /** Which pages should link to one page, and with what words, from the crawl's link graph: to-dos for the website's code. */
  | "links"
  /** Alt texts for a page's pictures that have none: to-dos for the website's code. */
  | "alt"
  /** Sort tracked search phrases: relevant, weak or irrelevant, their topic and intent. */
  | "keywords"
  /** What the first results for a kept search have that our page lacks, as a brief. */
  | "serp";

export type TaskState = "queued" | "running" | "done" | "failed" | "cancelled";

/** Which of the desk's records go with a question. */
export type ContextChoice = "website" | "pages" | "traffic" | "issues" | "insights" | "none";

/**
 * How much the model is given and asked for. Real, not decoration:
 *   quick  the workstation's smaller model, about half the context, a short answer
 *   deep   its larger model, the fuller context, a longer answer
 */
export type Depth = "quick" | "deep";

/** One block of data a task was given: what it was, where it came from and when it was read. */
export interface Given {
  /** "traffic", "issues", "pages", "insights", "page", "search", "targets", "candidates". */
  name: string;
  /** "Traffic (GA4)", "The crawl's findings". */
  label: string;
  source: SourceId;
  /** When the source read it, ISO; null when it was not available. */
  asOf: string | null;
  /** ok: given; waiting or off: the block says it is missing and why, and the model was told so. */
  state: "ok" | "waiting" | "off";
  /** The caveat that belongs to the data, or why it is missing. */
  note?: string;
}

/** A task in the queue or in the history. */
export interface TaskRow {
  id: number;
  kind: TaskKind;
  /** "Question", "Traffic summary", "SEO audit". */
  kindLabel: string;
  /** The question, or what the task does: "Create metadata for /services". */
  title: string;
  state: TaskState;
  askedBy: string;
  createdAt: string;
  /** When the workstation took it. */
  takenAt: string | null;
  finishedAt: string | null;
  /** The runner that has it, or had it. */
  runner: string | null;
  /** Queued: how many open tasks are ahead of it. Null otherwise. */
  ahead: number | null;
  /** An audit waiting for its crawl: the crawl's own count of pages read, while it runs. */
  crawl: { done: number; of: number } | null;
  /**
   * Running, but the workstation has been silent for longer than any answer
   * takes (switched off, asleep, or stopped while working): when it took the
   * task, and when the task goes back to the queue if it still says nothing.
   * Null while the task is within its time.
   */
  lost: { since: string; backAt: string } | null;
  /** "crawl" while an audit waits for the crawl to finish; then null. */
  stage: "crawl" | null;
  /** How many times it was handed to the workstation. */
  attempts: number;
  /** True when its first answer was refused and it was asked again. */
  retried: boolean;
  error: string | null;
  context: ContextChoice | null;
  depth: Depth;
}

/** One opportunity, as the model named it and the desk checked it. */
export interface Opportunity {
  title: string;
  why: string;
  /** An address the desk knows, or null. */
  page: string | null;
  action: string;
  /** Which data it came from. */
  from: "crawl" | "search-console" | "analytics";
}

/** A brief, as the model wrote it and the desk checked it. */
export interface Brief {
  title: string;
  audience: string;
  question: string;
  outline: string[];
  /** Addresses the desk knows, each with why. */
  links: { path: string; why: string }[];
  notes: string;
}

/** One phrase as the "keywords" task judged it, checked against the phrases and topics it was given. */
export interface KeywordJudgement {
  /** cc_seo_keywords id: what POST /api/v1/seo/keywords/bulk takes. */
  id: number;
  phrase: string;
  judgement: "relevant" | "weak" | "irrelevant";
  /** One of the given topics, by name, or a new topic's name when `newTopic`. */
  topic: string | null;
  /** The given topic's key (cc_seo_clusters), what POST /api/v1/seo/keywords/:id/edit takes as `cluster`; null for a new topic. */
  topicKey: string | null;
  newTopic: boolean;
  intent: "informational" | "commercial" | "transactional" | "navigational";
  why: string;
}

/** What the first results for a kept search have that our page lacks: the "serp" task. */
export interface SerpBrief {
  phrase: string;
  /** The kept result page it read (cc_seo_serp_checks id) and when that was read. */
  checkId: number;
  checkedAt: string | null;
  /** Our page for the search, when there is one. */
  page: string | null;
  /** Each point names the result addresses, as kept, that show it. */
  theyHave: { what: string; seenOn: string[] }[];
  /** What to add or change on our page, in order. */
  outline: string[];
  notes: string;
}

/** A to-do for the website's code (the desk cannot edit a page's body): from the "links" and "alt" tasks. */
export interface SuggestedTodo {
  title: string;
  note: string;
  /** The page whose source changes. */
  page: string;
}

/** A finished task, with what it was given. */
export interface TaskResult {
  task: TaskRow;
  /** Plain text. Drawn as text, never as HTML. */
  text: string;
  /** Opportunities, for that kind. */
  opportunities?: Opportunity[];
  brief?: Brief;
  /** For "keywords". */
  keywords?: KeywordJudgement[];
  /** For "serp". */
  serp?: SerpBrief;
  /** For "links" and "alt": what the website's code should change. */
  todos?: SuggestedTodo[];
  /** True once its to-dos were put on the to-do list (POST /tasks/:id/todos). */
  todosAdded?: boolean;
  /** The proposals this task created. */
  proposals: ProposalRow[];
  given: Given[];
  /** What the desk refused or changed in the answer, in plain words: removed figures, dropped entries. */
  flags: string[];
  /** The model's name as the workstation reported it, and how long it took. */
  model: string | null;
  ms: number | null;
}

/** A link to a recent result, in the AI response panel. */
export interface ResultCard {
  id: number;
  kind: TaskKind;
  label: string;
  /** "Updated 2 minutes ago" is made by the page from this. */
  finishedAt: string;
  /** What it holds, counted: "6 opportunities", "3 proposals". */
  sub: string;
}

export type ProposalState = "waiting" | "approved" | "applied" | "rejected" | "withdrawn";

/**
 * What a proposal changes on the website, each a field of
 * content/desk/overrides.json (work/audit/OVERRIDES-V2.md):
 *   meta       title and/or description
 *   redirect   a permanent redirect from an address that no longer answers
 *   og         share title, share description and/or share picture
 *   index      noindex: true takes a page out of search; false puts it back
 *   canonical  the page tells search engines to count another address instead
 *   schema     one structured-data block printed on the page
 */
export type ProposalKind = "meta" | "redirect" | "og" | "index" | "canonical" | "schema";

/** The schema.org types the website prints from the desk's file (its lib/desk.ts). */
export type DeskJsonLdType = "FAQPage" | "Service" | "BreadcrumbList" | "Article" | "HowTo" | "LocalBusiness" | "Organization" | "Product" | "VideoObject" | "WebPage";

export interface DeskJsonLdBlock {
  "@context": "https://schema.org";
  "@type": DeskJsonLdType;
  [property: string]: unknown;
}

/** One line of "what approving changes", before and after, in the words a person reads. */
export interface ProposalChange {
  label: string;
  /** "text": words; "picture": both values are picture addresses, drawn as pictures; "code": structured data, drawn as code. */
  look: "text" | "picture" | "code";
  before: string | null;
  after: string | null;
}

/** A share picture a person uploaded, kept by the desk until an approval commits it under public/desk/og/. */
export interface UploadedPicture {
  /** "seo-1a2b3c4d.jpg": the file's name on the site. */
  name: string;
  /** Where the desk serves it meanwhile: /api/v1/operator/pictures/<name>. */
  url: string;
  /** What the overrides file names: /desk/og/<name>. */
  sitePath: string;
  width: number;
  height: number;
  bytes: number;
  format: "png" | "jpeg" | "webp";
}

/** A change to the website the operator (or a person) proposes, waiting for a person who can publish. */
export interface ProposalRow {
  id: number;
  kind: ProposalKind;
  /** The page whose title and description change, or the address a redirect leaves from. */
  address: string;
  /** What the site said when it was proposed, as the crawl read the live page (a title with the brand the site appends). A field that is null was not set. */
  before: {
    title?: string | null;
    description?: string | null;
    to?: string | null;
    ogTitle?: string | null;
    ogDescription?: string | null;
    /** The share picture the live page named when it was proposed, absolute, as the crawl read it. */
    ogImage?: string | null;
    noindex?: boolean;
    canonical?: string | null;
    /** The structured-data types the page printed when it was proposed. */
    schemaTypes?: string[];
  };
  /**
   * What it would say. Only the fields that change. A title is the page's own
   * part, as content/desk/overrides.json stores it: the website's root layout
   * appends " | Balkaris" to it (see `shownTitle`).
   */
  after: {
    title?: string;
    description?: string;
    to?: string;
    ogTitle?: string;
    ogDescription?: string;
    /** Site-relative, as the overrides file names it: "/desk/og/seo-1a2b3c4d.jpg" or "/og/about.jpg". */
    ogImage?: string;
    /** true: out of search; false: back in (the desk's own noindex removed). */
    noindex?: boolean;
    canonical?: string;
    jsonLd?: DeskJsonLdBlock;
  };
  /** Field by field, what approving changes on the live site, before and after. */
  changes: ProposalChange[];
  /** The picture this proposal uploads with it, while the desk keeps it. Null when it names none, or one already on the site. */
  picture: UploadedPicture | null;
  /**
   * The live page read back after the deploy (POST /proposals/:id/check). The
   * website ignores a field that breaks a rule without a word, so this is how
   * an applied change is known to show. Null until it was read.
   */
  readBack: { at: string; ok: boolean; line: string; missing: string[] } | null;
  /** The title the live page would show after approval, the brand included. Null when the title does not change. */
  shownTitle: string | null;
  /**
   * A waiting change whose page no longer says what it was proposed against:
   * what the last crawl read there now, field by field. Approving is refused
   * until the operator is asked again. Null when nothing moved.
   */
  drift: { title?: string | null; description?: string | null } | null;
  why: string | null;
  source: "operator" | "person";
  taskId: number | null;
  proposedBy: string | null;
  state: ProposalState;
  decidedBy: string | null;
  decidedAt: string | null;
  appliedAt: string | null;
  /** The website commit that applied it, and its address on GitHub when known. */
  sha: string | null;
  shaUrl: string | null;
  /** Withdrawn: who, when, and the commit that removed it. */
  withdrawnBy: string | null;
  withdrawnAt: string | null;
  /** The last thing that went wrong applying or withdrawing it. */
  error: string | null;
  note: string | null;
  createdAt: string;
  /** The plain consequence of approving it, in one sentence. */
  consequence: string;
  /** Title (as shown, the brand included) and description lengths after, for the review. */
  lengths: { title: number | null; description: number | null };
}

/** An article the desk wrote that nobody has published yet. */
export interface DraftRow {
  id: number;
  title: string;
  createdAt: string;
  /** Where it is read and published: /insights/<id>. */
  href: string;
}

/** One line of the to-do list. */
export interface TodoRow {
  id: number;
  title: string;
  note: string | null;
  who: string;
  done: boolean;
  createdAt: string;
  doneAt: string | null;
  doneBy: string | null;
}

/** Is the workstation there to answer? Judged by its asks for OPERATOR tasks, not by the article runner's. */
export interface RunnerState {
  /**
   * online       it asked for an operator task in the last five minutes, or is answering one within its time.
   * articles     its runner asks for article jobs but not for operator tasks: it runs a build that does not take them yet.
   * off          it has asked for operator tasks, but not lately.
   * never        no runner ever asked for an operator task (and none is asking for articles now).
   */
  state: "online" | "articles" | "off" | "never";
  /** When it last asked for an operator task (for "articles": when the article runner last asked). */
  lastSeen: string | null;
  /** "Online." / "The workstation is off: tasks wait until it is on." */
  line: string;
  /** True when article jobs are waiting: they go first. */
  articlesFirst: number;
}

/** A page row in "Website context". */
export interface ContextPage {
  path: string;
  /** GA4 page views in the range, or null when GA4 has no row (or is not connected). */
  views: number | null;
  status: "healthy" | "update" | "fix" | "down" | "unknown";
  statusLabel: string;
}

/** An article row in "Website context". */
export interface ContextInsight {
  title: string;
  path: string | null;
  state: "draft" | "unlisted" | "listed";
  views: number | null;
  /** /insights/<draft id> */
  href: string;
}

/** A channel row in "Website context". */
export interface ContextChannel {
  key: string;
  label: string;
  sessions: number;
  previous: number | null;
  /** "+12%", or "3 → 5" for small numbers, or null when there is no period before. */
  change: string | null;
  tone: Tone;
}

/** A finding group in "Website context". */
export interface ContextIssue {
  rule: string;
  title: string;
  severity: "critical" | "warning" | "opportunity";
  count: number;
  /** A few of the pages it was found on. */
  pages: string[];
}

export interface OperatorContext {
  pages: Reading<ContextPage[]>;
  insights: Reading<ContextInsight[]>;
  traffic: Reading<ContextChannel[]>;
  issues: Reading<ContextIssue[]>;
  /** What a "Propose fixes" would send to the workstation: pages whose title or description breaks a rule, and addresses that no longer answer. */
  fixable: { metadata: number; redirect: number };
}

/** What GET /api/v1/operator answers: the whole screen. */
export interface OperatorPayload {
  /** Present and true only when the panels below are fed with made-up specimen rows (?specimen=1 on a development copy). */
  specimen?: boolean;
  range: Range;
  me: { canApprove: boolean; why: string | null };
  runner: RunnerState;
  /** The task the workstation is working on now, for the head's chip. Null when none is running. */
  working: { id: number; title: string } | null;
  /** Queued and running, oldest first. */
  tasks: TaskRow[];
  todos: TodoRow[];
  context: OperatorContext;
  /** The answer to show: the one asked for with ?result=, else the latest finished. */
  answer: TaskResult | null;
  /** ?result=<id> names a task that has not finished: it, so the screen says so instead of showing another task's answer. */
  pending: TaskRow | null;
  /** Kept result pages a "serp" task can read, newest first. */
  serps: SerpChoice[];
  /** The newest task to finish, fail or be stopped: what the page compares its polls with. */
  latest: OperatorLive["latest"];
  /** The latest result of each kind, newest first. */
  cards: ResultCard[];
  /** What the operator did: tasks finished, proposals made, applied, withdrawn. */
  actions: ActivityItem[];
  approvals: {
    /** The newest of each, at most APPROVALS_SHOWN; `counts` has how many there are in all. */
    waiting: ProposalRow[];
    /** Applied and live on the site (withdrawable), or approved and not yet applied. */
    approved: ProposalRow[];
    /** Withdrawn or rejected. */
    completed: ProposalRow[];
    /** Proposals in each tab, counted in the database, not in the lists above. */
    counts: { waiting: number; approved: number; completed: number };
    drafts: Reading<DraftRow[]>;
  };
}

/** What GET /api/v1/operator/live answers: the little that changes while a task runs. */
export interface OperatorLive {
  specimen?: boolean;
  runner: RunnerState;
  working: { id: number; title: string } | null;
  tasks: TaskRow[];
  /** The newest finished task's id and when, so the page knows to redraw. */
  latest: { id: number; state: TaskState; finishedAt: string | null } | null;
}

/** GET /api/v1/operator/history?tab= */
export interface OperatorHistory {
  specimen?: boolean;
  tab: "results" | "tasks" | "proposals" | "actions";
  /** How many there are in all, counted in the database. The lists hold the newest, at most `most`. */
  counts: { results: number; tasks: number; proposals: number; actions: number };
  most: number;
  results: ResultCard[];
  tasks: TaskRow[];
  proposals: ProposalRow[];
  actions: ActivityItem[];
}

/** POST /api/v1/operator/tasks */
export interface NewTask {
  kind: TaskKind;
  /** The question, for "ask"; the topic, for "brief"; otherwise optional words shown as the title. */
  prompt?: string;
  context?: ContextChoice;
  depth?: Depth;
  /** Pages, for "metadata": at most five. Left out, the pages whose title or description breaks a rule. */
  paths?: string[];
  /** One page in depth, for "ask" and "brief"; the page, for "og", "schema", "links" and "alt"; our page, for "serp". */
  path?: string;
  range?: Range;
  /** "keywords": cc_seo_keywords ids, at most 30. Left out, the unjudged phrases, newest first. */
  ids?: number[];
  /** "serp": the kept result page (cc_seo_serp_checks id). Left out, the newest that is done. */
  serpId?: number;
  /** "schema": which block to draft. Left out, FAQPage, or Service when the page prints FAQPage already. */
  schemaType?: "FAQPage" | "Service";
}

/** A kept result page a "serp" task can read. */
export interface SerpChoice {
  id: number;
  phrase: string;
  doneAt: string | null;
  ownPosition: number | null;
}

/**
 * POST /api/v1/operator/proposals: a change a person writes by hand. No model
 * is involved; the same rules apply as to the operator's, and it waits for a
 * person who can publish like any other. A body without `kind` is a redirect.
 */
export type NewProposalBody =
  | { kind?: "redirect"; from: string; to: string; why?: string }
  | { kind: "meta"; address: string; title?: string; description?: string; why?: string }
  | { kind: "og"; address: string; ogTitle?: string; ogDescription?: string; ogImage?: string; why?: string }
  | { kind: "index"; address: string; noindex: boolean; why?: string }
  | { kind: "canonical"; address: string; canonical: string; why?: string }
  | { kind: "schema"; address: string; jsonLd: DeskJsonLdBlock | string; why?: string };

/** POST /api/v1/operator/pictures { address, data: base64 of the file, filename? } */
export interface PictureAnswer {
  ok: true;
  picture: UploadedPicture;
  line: string;
}

/** POST /api/v1/operator/tasks/:id/todos */
export interface TodosAdded {
  ok: true;
  added: number;
  line: string;
}

/** What POST /tasks and the other changes answer. */
export interface TaskAnswer {
  ok: true;
  task: TaskRow;
}

export interface ProposalAnswer {
  ok: true;
  proposal: ProposalRow;
  /** What happened, in a sentence. */
  line?: string;
}

export interface TodoAnswer {
  ok: true;
  todo: TodoRow | null;
}
