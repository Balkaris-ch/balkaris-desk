import { notFound } from "next/navigation";
import { Frame } from "@/components/shell/Frame";
import { PageHead } from "@/components/shell/PageHead";
import { api } from "@/lib/api";

export const metadata = { title: "Failure · Kit" };

/**
 * Development only: makes a screen fail on purpose, so the error screens can
 * be seen and photographed.
 *
 *   /kit/fail?kind=missing   asks the desk server for a path it does not have
 *                            (a DeskError, told apart by its digest)
 *   /kit/fail?kind=broken    throws in the interface itself
 *
 * What it asks for is a path no route answers; nothing is read or changed.
 */
export default async function FailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const kind = (await searchParams).kind;
  if (kind === "missing") await api("/api/v1/kit-asks-for-nothing");
  if (kind === "broken") throw new Error("The kit threw this on purpose, to show the error screen.");
  return (
    <Frame>
      <PageHead eyebrow="Desk kit" title="Failures" subtitle="Add ?kind=missing or ?kind=broken to the address to see each error screen." />
    </Frame>
  );
}
