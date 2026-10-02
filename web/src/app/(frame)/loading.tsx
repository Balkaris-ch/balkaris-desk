import { PageHeadSkeleton } from "@/components/shell/PageHead";
import { Grid } from "@/components/ui/Grid";
import { SkeletonCard, SkeletonTile } from "@/components/ui/Skeleton";
import { Tiles } from "@/components/ui/Tile";

/**
 * What a screen shows while the server is asked for it: the frame stays, and
 * the screen's place holds the shape most screens have (a head, a row of
 * tiles, a row of panels) in grey. Shapes only: nothing here can be read as a
 * figure. A screen with a different shape may bring its own loading.tsx.
 */
export default function Loading() {
  return (
    <div className="dk-page-loading" role="status" aria-label="Loading">
      <PageHeadSkeleton />
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
