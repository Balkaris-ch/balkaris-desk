import type { BuildLogPayload } from "@/contract/hosting";
import { BuildLogPanel } from "@/components/hosting/BuildLog";
import { PageHead } from "@/components/shell/PageHead";
import { LinkButton } from "@/components/ui/Button";
import { api } from "@/lib/api";
import "@/components/hosting/hosting.css";

export const metadata = { title: "Build log · Hosting" };

type Props = { params: Promise<{ uid: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * A production build's last log lines, opened from the builds panel. Read
 * from Vercel when asked (GET /api/v1/hosting/builds/:uid) and kept a day.
 */
export default async function BuildLogPage({ params, searchParams }: Props) {
  const { uid } = await params;
  const q = await searchParams;
  const data = await api<BuildLogPayload>(`/api/v1/hosting/builds/${encodeURIComponent(uid)}`, { specimen: q.specimen === "1" ? "1" : undefined });
  return (
    <>
      <PageHead
        eyebrow="Hosting"
        title="Build log"
        subtitle={<>The last lines Vercel kept for production build <span className="dk-hosting-mono">{uid}</span>. Error lines are marked.</>}
        action={
          <LinkButton href="/hosting" size="sm" icon="arrow-left">
            Hosting
          </LinkButton>
        }
      />
      <BuildLogPanel reading={data.log} />
    </>
  );
}
