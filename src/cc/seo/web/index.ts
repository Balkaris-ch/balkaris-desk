/**
 * THE WEB LAYER: what the SEO section can learn from the open web. One import
 * for the Keywords and Competitors pages:
 *
 *   import * as web from "../../seo/web/index.ts";
 *
 * Every function, its answer, its limits and its refusal sentences are in
 * work/audit/FOUNDATION-API.md; the shapes are the contract's
 * (web/src/contract/seo/common.ts, "the web layer"). Person-asked actions
 * throw an HTTPException (400, 409 or 429) with a plain sentence, which a
 * page's route answers as { error } through apiError like any other refusal.
 *
 * Files: suggest.ts (research a phrase), serp.ts (who ranks, the weekly rank
 * check), fetchq.ts + door.ts + work.ts + allow.ts (the workstation's fetch
 * door), parse.ts (result pages), domain.ts + guard.ts (any domain),
 * volumes.ts (demand figures), dataforseo.ts (the paid source), filing.ts
 * (the cluster rule), shared.ts (pacing, allowances, pauses).
 */

export { researchPhrase, researchAllowance, researchCost, researchCap, requestsFor, sourcePaused, trackSuggestions, DEFAULT_MODES, ALL_MODES, QUESTION_WORDS, MODIFIERS } from "./suggest.ts";
export type { ResearchAsk, SuggestRequest } from "./suggest.ts";
export { requestSerp, serpCheck, latestSerp, serpHistory, recentSerps, withdrawSerp, googleLane, rankCheck, targetPhrases, googleUrl, ddgUrl } from "./serp.ts";
export type { SerpAsk } from "./serp.ts";
export { workstation, laneState, unpauseLane, googleDaily } from "./fetchq.ts";
export { lookupDomain, domainFacts, domainOf, domainAllowance, FACT_KEYS } from "./domain.ts";
export type { FactKey, LookupOptions } from "./domain.ts";
export { checkAddress } from "./guard.ts";
export { importPlannerCsv, refreshVolumes, volumesOf, allVolumes } from "./volumes.ts";
export { configured as dataforseoConfigured, step as dataforseoStep, status as dataforseoStatus, spent as dataforseoSpent, paidDomainFacts, UNTESTED as DATAFORSEO_UNTESTED } from "./dataforseo.ts";
export { filer, fileUnder } from "./filing.ts";
export type { Filed } from "./filing.ts";
export { WEB_LANGS, asLang, asCountry } from "./shared.ts";
/* Registers the Google result pages and the suggestions among the desk's sources (Settings › Sources). */
export { googlePagesStatus, suggestionsStatus } from "./sources.ts";
export type {
  CommonCrawlFact,
  CruxFact,
  DomainFact,
  DomainFacts,
  GoogleLane,
  HomeFact,
  KeywordVolume,
  PageSpeedFact,
  PaidDomainFacts,
  PlannerImport,
  RegistrationFact,
  ResearchMode,
  ResearchResult,
  ResearchSourceLine,
  RobotsFact,
  SerpAsked,
  SerpCheck,
  SerpEngine,
  SerpFetcher,
  SerpLocalRow,
  SerpOrganicRow,
  SerpPage,
  SitemapFact,
  SuggestSource,
  TrancoFact,
  WaybackFact,
  WebAllowance,
  WebLang,
  WebSuggestion,
  WikipediaFact,
} from "../../../../web/src/contract/seo/common.ts";
