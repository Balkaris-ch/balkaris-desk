import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { SEO_PAGES } from "./pages";

/**
 * An SEO page that is not built yet: its real name and one honest line about
 * what it will show. Each page's builder replaces its page.tsx, and with it
 * this; nothing on it is a figure.
 */
export function SeoPlaceholder({ page, line, title }: { page: string; line: string; title?: string }) {
  const p = SEO_PAGES.find((s) => s.key === page);
  const name = title ?? p?.label ?? "SEO";
  return (
    <Card title={name} icon={p?.icon ?? "search"}>
      <Empty icon="hourglass" title="Being built">
        {line}
      </Empty>
    </Card>
  );
}
