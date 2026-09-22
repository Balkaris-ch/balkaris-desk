/**
 * What balkaris.ch actually sells, and what its journal is shelved under.
 *
 * A copy, on purpose. The desk is a separate process from the website and
 * must not import out of its repo — but a slug that drifts here produces a
 * link to a 404, so `npm run check:catalogue` reads the real
 * content/disciplines.ts and content/journal.ts and fails loudly if this file
 * has fallen behind. Thirty services and six shelves change about twice a
 * year; a nightly sync would be more machinery than the problem deserves.
 */

export type TopicId =
  | "technology"
  | "ai-automation"
  | "marketing"
  | "creative-content"
  | "industry-trends"
  | "behind-the-scenes";

export const TOPICS: { id: TopicId; name: string }[] = [
  { id: "technology", name: "Technology" },
  { id: "ai-automation", name: "AI & Automation" },
  { id: "marketing", name: "Marketing" },
  { id: "creative-content", name: "Creative & Content" },
  { id: "industry-trends", name: "Industry Trends" },
  { id: "behind-the-scenes", name: "Behind the Scenes" },
];

export type Practice = "digital" | "growth" | "studio";

export interface Service {
  slug: string;
  name: string;
  practice: Practice;
}

/** The thirty live capabilities, in the order the site lists them. */
export const SERVICES: Service[] = [
  { slug: "web-design-development", name: "Web Design & Development", practice: "digital" },
  { slug: "digital-product-development", name: "Digital Product Development", practice: "digital" },
  { slug: "web-application-development", name: "Web Application Development", practice: "digital" },
  { slug: "saas-development", name: "SaaS Development", practice: "digital" },
  { slug: "custom-software-development", name: "Custom Software Development", practice: "digital" },
  { slug: "enterprise-software-development", name: "Enterprise Software Development", practice: "digital" },
  { slug: "api-system-integration", name: "API & System Integration", practice: "digital" },
  { slug: "ai-development", name: "AI Development", practice: "digital" },
  { slug: "ai-agent-development", name: "AI Agent Development", practice: "digital" },
  { slug: "voice-ai-development", name: "Voice AI Development", practice: "digital" },
  { slug: "ai-automation", name: "AI Automation", practice: "digital" },

  { slug: "digital-marketing", name: "Digital Marketing", practice: "growth" },
  { slug: "performance-marketing", name: "Performance Marketing", practice: "growth" },
  { slug: "meta-ads", name: "Meta Ads", practice: "growth" },
  { slug: "google-ads", name: "Google Ads", practice: "growth" },
  { slug: "seo", name: "SEO", practice: "growth" },
  { slug: "local-seo", name: "Local SEO", practice: "growth" },
  { slug: "content-marketing", name: "Content Marketing", practice: "growth" },
  { slug: "full-funnel-marketing", name: "Full-Funnel Marketing", practice: "growth" },
  { slug: "crm-automation", name: "CRM Automation", practice: "growth" },
  { slug: "social-media-marketing", name: "Social Media Marketing", practice: "growth" },
  { slug: "conversion-rate-optimization", name: "Conversion Rate Optimization", practice: "growth" },
  { slug: "lead-generation", name: "Lead Generation", practice: "growth" },

  { slug: "branding", name: "Branding", practice: "studio" },
  { slug: "commercial-execution", name: "Commercial Execution", practice: "studio" },
  { slug: "video-production", name: "Video Production", practice: "studio" },
  { slug: "content-production", name: "Content Production", practice: "studio" },
  { slug: "creative-campaigns", name: "Creative Campaigns", practice: "studio" },
  { slug: "motion-design", name: "Motion Design", practice: "studio" },
  { slug: "ai-content-production", name: "AI Content Production", practice: "studio" },
];

export const SERVICE_SLUGS = new Set(SERVICES.map((s) => s.slug));

export const serviceName = (slug: string): string =>
  SERVICES.find((s) => s.slug === slug)?.name ?? slug;

/** The shelf a practice writes to when nothing more specific wins. */
export const PRACTICE_TOPIC: Record<Practice, TopicId> = {
  digital: "technology",
  growth: "marketing",
  studio: "creative-content",
};
