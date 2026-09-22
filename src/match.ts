import { PRACTICE_TOPIC, SERVICES, SERVICE_SLUGS, type Practice, type Service, type TopicId } from "./catalogue.ts";

/**
 * Which Balkaris services a piece is about, and which shelf it goes on.
 *
 * THIS IS HARD-CODED, AND THAT IS THE POINT (Fini, 22 September 2026: "we
 * need to hard-code this at the end of the day").
 *
 * A model asked to pick services is right most of the time and confidently
 * wrong the rest of it — it will attach "Voice AI Development" to a piece
 * about shop signage because both mention "customers", and nobody notices
 * until a reader clicks through to a page that has nothing to do with what
 * they were reading. A table is wrong in a way you can read, argue with, fix
 * in one line and prove with a test.
 *
 * How it scores. Every service owns a set of terms in three strengths:
 *
 *   · `is`     the thing itself. "google ads", "meta ads", "shopify".
 *              Worth 6. One of these and the service is almost certainly in.
 *   · `near`   the work around it. "landing page", "bounce rate", "crm".
 *              Worth 3. Two of these beat one `is` — a piece can be about a
 *              service without ever naming it.
 *   · `weak`   the neighbourhood. "conversion", "campaign", "brand".
 *              Worth 1. Only ever a tie-breaker; a page of these alone is
 *              not about anything in particular.
 *
 * A term matches on a word boundary, case-folded, in the title and the body,
 * with the TITLE COUNTING TWICE — an article that says "SEO" in its heading
 * is about SEO in a way one that says it in paragraph nine is not.
 *
 * What comes out is at most `limit` services over the floor, never more than
 * two from one practice unless a third scored above `STRONG`, so a piece does
 * not end up recommending six variations of "we build software". The shelf is
 * decided separately, by its own table, because "AI & Automation" is a
 * subject and AI Development is a service and they do not always agree.
 */

type Strength = "is" | "near" | "weak";

const WEIGHT: Record<Strength, number> = { is: 6, near: 3, weak: 1 };

/** A score at or above this is "this piece is plainly about it". */
const STRONG = 9;

/** Below this, a service is noise and is dropped however many rivals there are. */
const FLOOR = 4;

interface Rule {
  slug: string;
  is?: string[];
  near?: string[];
  weak?: string[];
}

/* ---------- the table ------------------------------------------------------
   One block per service, in the site's own order. Terms are lower case and
   matched whole: "ads" does not fire on "adsense", "seo" does not fire on
   "seoul". Add a term when a draft comes out attached to the wrong thing —
   that is the maintenance this file is for.                                 */

const RULES: Rule[] = [
  /* ---- Digital ---------------------------------------------------------- */
  {
    slug: "web-design-development",
    is: ["web design", "website design", "webflow", "wordpress", "shopify", "squarespace", "framer", "website redesign"],
    near: ["landing page", "homepage", "web page", "site speed", "responsive", "core web vitals", "page speed", "cms"],
    weak: ["website", "design", "browser", "mobile"],
  },
  {
    slug: "digital-product-development",
    is: ["digital product", "product discovery", "mvp", "product-market fit"],
    near: ["prototype", "user testing", "product roadmap", "feature set", "onboarding flow"],
    weak: ["product", "users", "roadmap"],
  },
  {
    slug: "web-application-development",
    is: ["web app", "web application", "single page app", "dashboard app"],
    near: ["react", "next.js", "typescript", "front end", "back end", "portal", "admin panel"],
    weak: ["app", "platform", "interface"],
  },
  {
    slug: "saas-development",
    is: ["saas", "software as a service", "subscription software", "multi-tenant"],
    near: ["recurring revenue", "seat", "free trial", "churn", "billing", "stripe"],
    weak: ["subscription", "tier", "plan"],
  },
  {
    slug: "custom-software-development",
    is: ["custom software", "bespoke software", "internal tool", "line of business"],
    near: ["legacy system", "spreadsheet", "manual process", "in-house tool"],
    weak: ["software", "system", "tool"],
  },
  {
    slug: "enterprise-software-development",
    is: ["enterprise software", "erp", "sap", "enterprise architecture"],
    near: ["compliance", "sso", "audit trail", "role-based", "procurement", "on-premise"],
    weak: ["enterprise", "governance", "scale"],
  },
  {
    slug: "api-system-integration",
    is: ["api integration", "system integration", "webhook", "middleware", "rest api", "graphql"],
    near: ["sync", "two systems", "data pipeline", "connector", "zapier", "make.com"],
    weak: ["api", "integration", "endpoint"],
  },
  {
    slug: "ai-development",
    is: ["ai development", "machine learning", "llm", "large language model", "fine-tune", "rag", "vector database"],
    near: ["model", "inference", "prompt", "openai", "anthropic", "claude", "gpt", "gemini", "ollama", "embedding"],
    weak: ["ai", "artificial intelligence", "training"],
  },
  {
    slug: "ai-agent-development",
    is: ["ai agent", "agentic", "autonomous agent", "agent framework", "mcp", "tool use"],
    near: ["multi-step", "orchestration", "copilot", "assistant that", "agent loop"],
    weak: ["agent", "assistant", "automation"],
  },
  {
    slug: "voice-ai-development",
    is: ["voice ai", "voice agent", "speech to text", "text to speech", "voice assistant", "elevenlabs", "whisper"],
    near: ["phone call", "call centre", "call center", "ivr", "transcription", "voice clone"],
    weak: ["voice", "speech", "audio"],
  },
  {
    slug: "ai-automation",
    is: ["ai automation", "workflow automation", "automate the", "back office automation"],
    near: ["manual work", "repetitive task", "handover", "approval flow", "n8n", "triage"],
    weak: ["automate", "workflow", "process"],
  },

  /* ---- Growth ----------------------------------------------------------- */
  {
    slug: "digital-marketing",
    is: ["digital marketing", "marketing strategy", "marketing mix", "go to market"],
    near: ["channel", "audience", "positioning", "marketing budget", "media plan"],
    weak: ["marketing", "campaign", "growth"],
  },
  {
    slug: "performance-marketing",
    is: ["performance marketing", "paid media", "roas", "cost per acquisition", "cpa", "cac"],
    near: ["ad spend", "bidding", "attribution", "media buying", "creative testing"],
    weak: ["ads", "spend", "return"],
  },
  {
    slug: "meta-ads",
    is: ["meta ads", "facebook ads", "instagram ads", "advantage+", "meta pixel"],
    near: ["lookalike", "ad set", "creative fatigue", "retargeting", "catalogue ads"],
    weak: ["facebook", "instagram", "meta"],
  },
  {
    slug: "google-ads",
    is: ["google ads", "adwords", "performance max", "pmax", "search ads", "shopping ads"],
    near: ["keyword bid", "quality score", "negative keyword", "ad rank", "broad match"],
    weak: ["google", "bidding", "search"],
  },
  {
    slug: "seo",
    is: ["seo", "search engine optimisation", "search engine optimization", "backlink", "serp", "organic search"],
    near: ["ranking", "keyword research", "search intent", "indexing", "crawl", "schema markup", "ai overview"],
    weak: ["google", "search", "traffic"],
  },
  {
    slug: "local-seo",
    is: ["local seo", "google business profile", "google my business", "map pack", "near me"],
    near: ["local search", "citation", "nap", "opening hours", "reviews", "local ranking"],
    weak: ["local", "reviews", "directory"],
  },
  {
    slug: "content-marketing",
    is: ["content marketing", "blog strategy", "editorial calendar", "topic cluster", "newsletter"],
    near: ["blog post", "long form", "thought leadership", "content plan", "pillar page"],
    weak: ["content", "article", "publishing"],
  },
  {
    slug: "full-funnel-marketing",
    is: ["full funnel", "full-funnel", "marketing funnel", "top of funnel", "bottom of funnel"],
    near: ["awareness", "consideration", "nurture", "customer journey", "lifecycle"],
    weak: ["funnel", "journey", "stage"],
  },
  {
    slug: "crm-automation",
    is: ["crm", "hubspot", "salesforce", "pipedrive", "marketing automation", "lead scoring"],
    near: ["email sequence", "drip", "deal stage", "sales pipeline", "handoff to sales"],
    weak: ["pipeline", "contacts", "leads"],
  },
  {
    slug: "social-media-marketing",
    is: ["social media marketing", "tiktok", "linkedin", "instagram reels", "short form video", "community management"],
    near: ["posting schedule", "engagement rate", "follower", "creator", "ugc", "algorithm"],
    weak: ["social", "post", "feed"],
  },
  {
    slug: "conversion-rate-optimization",
    is: ["conversion rate optimisation", "conversion rate optimization", "cro", "a/b test", "split test"],
    near: ["bounce rate", "checkout flow", "form abandonment", "heatmap", "friction", "sign-up rate"],
    weak: ["conversion", "test", "rate"],
  },
  {
    slug: "lead-generation",
    is: ["lead generation", "lead gen", "outbound", "cold email", "prospecting"],
    near: ["qualified lead", "sql", "mql", "icp", "enquiry form", "booking form"],
    weak: ["lead", "enquiry", "pipeline"],
  },

  /* ---- Studio ----------------------------------------------------------- */
  {
    slug: "branding",
    is: ["branding", "brand identity", "rebrand", "logo design", "visual identity", "brand guidelines"],
    near: ["tone of voice", "colour palette", "typography", "brand book", "naming"],
    weak: ["brand", "identity", "logo"],
  },
  {
    slug: "commercial-execution",
    is: ["tv commercial", "brand film", "commercial shoot", "advertising film"],
    near: ["director", "storyboard", "casting", "location scout", "film crew", "broadcast"],
    weak: ["commercial", "advert", "spot"],
  },
  {
    slug: "video-production",
    is: ["video production", "film production", "video shoot", "cinematography", "post production"],
    near: ["camera", "lighting", "edit", "colour grade", "b-roll", "footage"],
    weak: ["video", "film", "shoot"],
  },
  {
    slug: "content-production",
    is: ["content production", "photo shoot", "product photography", "content day", "asset production"],
    near: ["photographer", "studio day", "batch", "stills", "catalogue shoot"],
    weak: ["photo", "shoot", "assets"],
  },
  {
    slug: "creative-campaigns",
    is: ["creative campaign", "campaign concept", "big idea", "brand campaign", "launch campaign"],
    near: ["creative direction", "key visual", "campaign line", "rollout"],
    weak: ["campaign", "creative", "concept"],
  },
  {
    slug: "motion-design",
    is: ["motion design", "motion graphics", "after effects", "2d animation", "3d animation", "explainer video"],
    near: ["animate", "keyframe", "lottie", "title sequence", "transitions"],
    weak: ["animation", "motion", "graphics"],
  },
  {
    slug: "ai-content-production",
    is: [
      "ai video",
      "ai generated video",
      "generative video",
      "ai image",
      "image generation",
      "video generation",
      "midjourney",
      "runway",
      "sora",
      "veo",
      "kling",
      "stable diffusion",
      "comfyui",
      "flux",
      "architectural visualisation",
      "architectural visualization",
    ],
    near: ["text to video", "text to image", "virtual production", "synthetic", "render farm", "deepfake"],
    weak: ["generated", "render", "prompt"],
  },
];

/* ---------- the shelf ------------------------------------------------------
   Its own table, because a subject and a service are different things: a
   piece about what GPT-6 changed is "AI & Automation" even when the service
   it recommends is Web Application Development.                             */

const TOPIC_RULES: { topic: TopicId; is?: string[]; near?: string[] }[] = [
  {
    topic: "ai-automation",
    is: ["ai", "artificial intelligence", "llm", "gpt", "claude", "gemini", "machine learning", "agent", "automation", "copilot"],
    near: ["model", "prompt", "inference", "chatbot", "autonomous"],
  },
  {
    topic: "marketing",
    is: ["seo", "ads", "campaign", "funnel", "conversion", "lead", "crm", "roas", "marketing"],
    near: ["traffic", "ranking", "audience", "spend", "attribution", "newsletter"],
  },
  {
    topic: "creative-content",
    is: ["brand", "branding", "video", "film", "photography", "motion", "creative", "design"],
    near: ["shoot", "edit", "identity", "storyboard", "colour", "typography"],
  },
  {
    topic: "technology",
    is: ["software", "api", "database", "framework", "developer", "code", "platform", "saas", "integration"],
    near: ["deploy", "architecture", "typescript", "react", "performance", "security"],
  },
  {
    topic: "industry-trends",
    /* Deliberately narrow. Half the web mentions Switzerland and a market; a
       piece is only a TREND piece when something is CHANGING — a rule, a
       round, a rollout — so the geography and the word "market" are `near`
       and cannot carry the shelf on their own. */
    is: ["regulation", "funding round", "acquisition", "forecast", "eu ai act", "legislation", "rollout"],
    near: ["market", "industry", "adoption", "switzerland", "swiss", "report", "survey", "competitor", "gdpr"],
  },
  /* "Behind the Scenes" is how Balkaris works. It is never inferred from a
     link somebody shared — it is chosen by hand when we write about
     ourselves, so it has no terms and can only be set explicitly. */
];

/* ---------- matching ------------------------------------------------------ */

/** Word-boundary, case-folded, punctuation-tolerant. Built once per term. */
const patterns = new Map<string, RegExp>();

function pattern(term: string): RegExp {
  let re = patterns.get(term);
  if (!re) {
    const body = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    /* `(?<![\w-])` and `(?![\w-])` rather than \b: \b would let "ads" match
       inside "adsense" on the hyphen side and would refuse to match a term
       that starts with a symbol.
       `(?:e?s)?` is the plural: the table is written in the singular and a
       writer is not. "large language model" has to find "large language
       models", the shape it is almost always written in — that one missing
       letter sent a piece about the EU AI Act to no service at all. */
    re = new RegExp(`(?<![\\w-])${body}(?:e?s)?(?![\\w-])`, "gi");
    patterns.set(term, re);
  }
  re.lastIndex = 0;
  return re;
}

function count(haystack: string, term: string): number {
  const re = pattern(term);
  let n = 0;
  while (re.exec(haystack) !== null) n += 1;
  return n;
}

export interface Hit {
  slug: string;
  name: string;
  practice: Practice;
  score: number;
  /** The terms that actually fired, strongest first — this is the "why". */
  because: string[];
}

export interface MatchResult {
  topic: TopicId;
  topicScore: number;
  services: Hit[];
  /** Everything that scored, for `npm run match` and for a bad draft's post-mortem. */
  all: Hit[];
}

const byId = new Map<string, Service>(SERVICES.map((s) => [s.slug, s]));

function scoreRule(rule: Rule, title: string, body: string): Hit | null {
  let score = 0;
  const because: string[] = [];

  for (const strength of ["is", "near", "weak"] as Strength[]) {
    for (const term of rule[strength] ?? []) {
      /* The title counts twice: a heading is a claim about what the piece is,
         a mention in paragraph nine is a passing reference. */
      const n = count(body, term) + 2 * count(title, term);
      if (!n) continue;
      /* Repeats are worth less and less. Ten mentions of "seo" do not make a
         piece ten times more about SEO, but they do make it more about SEO
         than one mention does: 1, 1.5, 1.83, 2.08… */
      const repeat = 1 + Math.log2(Math.min(n, 8));
      score += WEIGHT[strength] * repeat;
      because.push(term);
    }
  }

  if (score < FLOOR) return null;
  const svc = byId.get(rule.slug);
  if (!svc) throw new Error(`match.ts names a service the catalogue does not have: ${rule.slug}`);
  return { slug: svc.slug, name: svc.name, practice: svc.practice, score: Math.round(score * 10) / 10, because };
}

export function match(
  title: string,
  body: string,
  { limit = 3, perPractice = 2 }: { limit?: number; perPractice?: number } = {},
): MatchResult {
  const t = ` ${title} `;
  const b = ` ${body} `;

  const all = RULES.map((r) => scoreRule(r, t, b))
    .filter((h): h is Hit => h !== null)
    .sort((a, b2) => b2.score - a.score);

  /* At most `perPractice` from any one practice, so a piece about a website
     does not recommend six ways of saying "we build software" — unless a
     third one is plainly what the piece is about. */
  const used: Record<Practice, number> = { digital: 0, growth: 0, studio: 0 };
  const services: Hit[] = [];
  for (const hit of all) {
    if (services.length >= limit) break;
    if (used[hit.practice] >= perPractice && hit.score < STRONG) continue;
    services.push(hit);
    used[hit.practice] += 1;
  }

  /* The shelf. Its own table first; if nothing fires, the practice of the
     best service decides; if there is no service either, it is a trend piece,
     which is the honest home for "something happened and here is what we
     think". */
  let topic: TopicId = "industry-trends";
  let topicScore = 0;
  for (const rule of TOPIC_RULES) {
    let s = 0;
    for (const term of rule.is ?? []) s += WEIGHT.is * Math.min(count(b, term) + 2 * count(t, term), 4);
    for (const term of rule.near ?? []) s += WEIGHT.near * Math.min(count(b, term) + 2 * count(t, term), 4);
    if (s > topicScore) {
      topicScore = s;
      topic = rule.topic;
    }
  }
  if (topicScore === 0 && services[0]) topic = PRACTICE_TOPIC[services[0].practice];

  return { topic, topicScore: Math.round(topicScore * 10) / 10, services, all };
}

/** Guards the table against a slug the website no longer has. */
export function checkTable(): string[] {
  const bad: string[] = [];
  for (const r of RULES) if (!SERVICE_SLUGS.has(r.slug)) bad.push(r.slug);
  for (const s of SERVICES) if (!RULES.some((r) => r.slug === s.slug)) bad.push(`(no rule) ${s.slug}`);
  return bad;
}
