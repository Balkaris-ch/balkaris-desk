import type { CompetitorTiles } from "@/contract/seo/competitors";
import { Tile, Tiles } from "@/components/ui/Tile";

/**
 * The five figures over SEO › Competitors. Each is a count from the desk's
 * own record of what was observed, so none carries a change: there is one
 * round of observations, and no earlier one to compare with. No domain
 * rating, no traffic, no backlinks: no free, honest source gives them.
 */
export function CompTiles({ tiles }: { tiles: CompetitorTiles }) {
  return (
    <Tiles count={5}>
      <Tile
        label="Who appears"
        icon="users"
        delta="none"
        reading={tiles.seen}
        info="Every site or company seen in Google's results or named in an AI answer for the searches and questions captured, except the directories and platforms on the desk's list, which are counted apart. They are not checked one by one to be studios: search engines' help pages, software vendors, news sites and public bodies are among them. A company named without its site is joined to its site where the names agree; one written two ways that do not begin alike is counted twice (the joining rule, under the list's i)."
      />
      <Tile label="In Google" icon="search" delta="none" reading={tiles.google} info="Of those sites and companies, the ones seen in Google's top results or its map pack for one of our searches, as the audit counted the positions (ads not counted). Platforms apart." />
      <Tile
        label="In AI answers"
        icon="sparkles"
        tone="violet"
        delta="none"
        reading={tiles.ai}
        info="Companies and sites an AI answer named or cited: Google's AI Overviews and AI Mode, ChatGPT, Perplexity, Gemini. Under it, the recorded checks of Balkaris on questions that did not name it."
      />
      <Tile label="Pages read" icon="file-text" tone="info" delta="none" reading={tiles.pages} info="Competitor pages the desk has read for our searches: the page that ranks where the capture recorded it, else the site's home page. Read once a week, robots.txt obeyed." />
      <Tile label="Clusters" icon="layers" tone="warn" delta="none" reading={tiles.clusters} info="Our keyword clusters with at least one competitor seen for their searches, of every cluster the keyword table knows." />
    </Tiles>
  );
}
