import type { Stat } from "@/contract/common";
import type { BacklinksTiles } from "@/contract/seo/backlinks";
import { SparkBars } from "@/components/charts";
import { Tile, Tiles } from "@/components/ui/Tile";

const bars = (s: Stat) => <SparkBars data={s.series} />;

/**
 * The five figures under the head, in board 113's places. The board's
 * "Total backlinks" is Bing's count of links (absent with its step until Bing
 * Webmaster is connected); its "Referring domains" the sites GA4 saw send
 * visitors; "Domain rating", "New" and "Lost backlinks" have no free, honest
 * source, so their places hold what this page is for: the profiles that
 * exist, whether they state one name, address and phone, and the steps only
 * the owner can take.
 */
export function BlTiles({ tiles }: { tiles: BacklinksTiles }) {
  return (
    <Tiles count={5} className="dk-seo-bl-tiles">
      <Tile
        label="Links Bing knows"
        reading={tiles.links}
        chart={bars}
        info="Inbound links in Bing Webmaster's index, counted once a day. Google gives no backlink figures by any API, so Bing's index is the one free source; it sees fewer links than Google does. “First reported” is the day the desk first saw Bing list a link, not the day it was made."
      />
      <Tile
        label="Sites that sent visitors"
        reading={tiles.sites}
        chart={bars}
        info="Other websites a visitor came from in the period, AI assistants included, as GA4 counted them: consenting visitors only, so an undercount. Search engines are not counted here; their visits are on Search Console. The bars are sites per day."
      />
      <Tile
        label="Profiles and listings"
        reading={tiles.profiles}
        delta="none"
        info="The studio's profiles and listings the desk knows of (the SEO audit's registry), and how many exist: the weekly check asks each address, and a listing with no address keeps the audit's finding. No free source gives an honest “domain rating”, so none is shown."
      />
      <Tile
        label="Name, address, phone"
        reading={tiles.nap}
        delta="none"
        info="Of the fields the profiles state, how many every profile states alike. Search engines and AI assistants match a business across sites by these three; two addresses read as two businesses, or as an unreliable one."
      />
      <Tile
        label="Steps that need you"
        reading={tiles.needsYou}
        delta="none"
        info="Profiles to create or fix, reviews to ask for, the one true address to decide: steps behind a login or a decision, which no tool takes for the owner. Each is listed under “Needs you” with its exact step."
      />
    </Tiles>
  );
}
