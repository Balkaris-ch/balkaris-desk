import { Grid } from "@/components/ui/Grid";
import { SkeletonCard, SkeletonTile } from "@/components/ui/Skeleton";
import { Tiles } from "@/components/ui/Tile";

/**
 * An SEO page while the server is asked for it. The SEO head and the tabs
 * stay (they are the layout's), so this is only the page's place in grey:
 * a row of tiles and a row of panels. Shapes only, never a figure. A page with
 * a different shape may bring its own loading.tsx.
 */
export default function SeoLoading() {
  return (
    <div className="dk-page-loading" role="status" aria-label="Loading">
      <Tiles count={5}>
        {Array.from({ length: 5 }, (_, i) => (
          <SkeletonTile key={i} />
        ))}
      </Tiles>
      <Grid cols="1.6fr 1fr 1fr">
        <SkeletonCard lines={6} height={260} />
        <SkeletonCard lines={5} height={260} />
        <SkeletonCard lines={5} height={260} />
      </Grid>
    </div>
  );
}
