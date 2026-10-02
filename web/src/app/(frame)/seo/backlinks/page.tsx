import { SeoPlaceholder } from "@/components/seo/nav/Placeholder";

export const metadata = { title: "Backlinks · SEO" };

/** SEO › Backlinks, until the page built to its board replaces this. The head and the tabs come from the SEO layout. */
export default function SeoBacklinksPage() {
  return <SeoPlaceholder page="backlinks" line="Links and listings that point to balkaris.ch. Bing Webmaster Tools is the source of inbound links and is not connected yet; the sites that send visitors (GA4) and the profiles and listings Balkaris has are being added to this page tonight." />;
}
