import type { SettingsPayload, SettingsTab } from "@/contract/settings";
import { PageHead } from "@/components/shell/PageHead";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { AboutSection } from "@/components/settings/About";
import { AccessSection } from "@/components/settings/Access";
import { PeopleSection } from "@/components/settings/People";
import { SourcesSection } from "@/components/settings/Sources";
import { TabsInView } from "@/components/settings/TabsInView";
import { WritingSection } from "@/components/settings/Writing";
import { api } from "@/lib/api";
import "@/components/settings/settings.css";

export const metadata = { title: "Settings" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const TABS: readonly SettingsTab[] = ["people", "sources", "access", "writing", "about"];

/**
 * Settings: who works the desk, where its figures come from and what only the
 * owner can do to connect them, how signing in works, whether articles
 * publish themselves, and what the desk runs on.
 *
 * There is no board for it; it is drawn in the boards' language. One request
 * for the whole screen; the tab (`?tab=`) only chooses which part is drawn,
 * so every tab is an address that can be shared and the back button works.
 * People is first: this replaces the old people page as the main view.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const asked = Array.isArray(q.tab) ? q.tab[0] : q.tab;
  const tab: SettingsTab = TABS.find((t) => t === asked) ?? "people";

  const data = await api<SettingsPayload>("/api/v1/settings");
  const steps = data.sources.state === "ok" ? data.sources.value.steps.length : null;
  const domain = data.access.state === "ok" ? data.access.value.domain : "balkaris.ch";

  const items: TabItem[] = [
    { key: "people", label: "People", href: "/settings", icon: "users", count: data.people.state === "ok" ? data.people.value.people.length : null },
    { key: "sources", label: "Sources", href: "/settings?tab=sources", icon: "database", count: steps || null, countTone: "warn" },
    /* "Access" for the section Session and access: a short label keeps the strip within a phone's width for longer. */
    { key: "access", label: "Access", href: "/settings?tab=access", icon: "lock" },
    { key: "writing", label: "Writing", href: "/settings?tab=writing", icon: "send" },
    { key: "about", label: "About", href: "/settings?tab=about", icon: "server" },
  ];

  return (
    <>
      <PageHead
        eyebrow="Settings"
        title="Settings"
        subtitle={
          <>
            Who works the desk, where its figures come from, and what only the owner can connect. Credentials live on the server, never on this page.
          </>
        }
      />
      <TabsInView active={tab}>
        <Tabs items={items} active={tab} label="Settings sections" className="dk-settings-tabs" />
      </TabsInView>
      {tab === "people" ? <PeopleSection people={data.people} domain={domain} /> : null}
      {tab === "sources" ? <SourcesSection sources={data.sources} account={data.account} keyEvents={data.keyEvents} quota={data.quota} /> : null}
      {tab === "access" ? <AccessSection me={data.me} people={data.people} access={data.access} /> : null}
      {tab === "writing" ? <WritingSection writing={data.writing} runner={data.runner} /> : null}
      {tab === "about" ? <AboutSection versions={data.versions} server={data.server} /> : null}
    </>
  );
}
