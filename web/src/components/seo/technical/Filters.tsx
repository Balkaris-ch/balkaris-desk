import type { TechAsked } from "@/contract/seo/technical";
import { Button, LinkButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/icons";
import { exportHref, techHref, type Kept } from "./href";

/**
 * Find a rule or a page: one search box over "Issues by rule" and "Pages by
 * score" (?q=), a plain GET form so it works without script and the address
 * says what is shown, and the lists as files. The severity and Google filters
 * sit in the heads of their own panels.
 */
export function TechFilters({ asked, base }: { asked: TechAsked; base: Kept }) {
  const narrowed = asked.q || asked.sev !== "all" || asked.index !== "all";
  return (
    <div className="dk-seo-technical-filters" role="search">
      <form method="get" action="/seo/technical#issues" className="dk-seo-technical-filters-form">
        {(["range", "sev", "index", "device"] as const).map((k) => (base[k] ? <input key={k} type="hidden" name={k} value={base[k]} /> : null))}
        <Input name="q" defaultValue={asked.q} placeholder="Find a rule, a finding or a page" aria-label="Find a rule, a finding or a page" maxLength={100} />
        <Button type="submit" size="sm" icon="search">
          Find
        </Button>
        {narrowed ? (
          <LinkButton href={techHref(base, { q: null, sev: null, index: null }, "issues")} size="sm" variant="ghost">
            Show all
          </LinkButton>
        ) : null}
      </form>
      <p className="dk-seo-technical-filters-files">
        <Icon name="download" size={14} />
        <span>As a file:</span>
        <a href={exportHref("issues", base)} download>
          findings
        </a>
        <a href={exportHref("pages", base)} download>
          pages
        </a>
        <a href={exportHref("index", base)} download>
          Google’s index
        </a>
        <a href={exportHref("redirects", base)} download>
          redirects
        </a>
      </p>
    </div>
  );
}
