import Link from "next/link";
import { Icon } from "@/components/ui/icons";
import { SideNav } from "./SideNav";

const SITE = "https://www.balkaris.ch";

/**
 * The frame's left column: the wordmark, the fifteen sections (shell/nav.ts;
 * Hosting, under the cloud icon, follows Site Health), and at the
 * bottom the way to the AI Operator and to the live site. SEO's row opens a
 * submenu of the SEO section's eleven pages (SideNav.tsx, side-group.css).
 */
export function Sidebar() {
  return (
    <aside className="dk-side" id="dk-side">
      <Link href="/" prefetch={false} className="dk-brand" aria-label="Balkaris desk, Command Center">
        <span className="dk-brand-name">BALKARIS</span>
        <span className="dk-brand-slash" aria-hidden>
          /
        </span>
        <span className="dk-brand-desk">desk</span>
      </Link>

      <SideNav />

      <div className="dk-side-foot">
        <Link href="/operator" prefetch={false} className="dk-ai">
          <span className="dk-ai-mark" aria-hidden>
            <Icon name="sparkles" size={14} />
          </span>
          <span className="dk-ai-text">
            <span className="dk-ai-name">Balkaris AI</span>
            <span className="dk-ai-line">Ask anything about your website</span>
          </span>
          <Icon name="chevron-right" size={14} className="dk-ai-go" />
        </Link>

        <div className="dk-side-links">
          <a href={SITE} target="_blank" rel="noreferrer" className="dk-side-link dk-side-link--name">
            <span>balkaris.ch</span>
            <Icon name="external" size={12} />
          </a>
          <a href={SITE} target="_blank" rel="noreferrer" className="dk-side-link">
            View live site
          </a>
        </div>
      </div>
    </aside>
  );
}
