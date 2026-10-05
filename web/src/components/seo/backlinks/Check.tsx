"use client";

import { useState, type FormEvent } from "react";
import type { LinkCheck, LinkCheckAnswer } from "@/contract/seo/backlinks";
import type { NewTask } from "@/contract/operator";
import { Badge, Chip } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { useSend } from "@/components/operator/send";
import { FollowPage, QueueTask, Said } from "./Act";

const VERDICT: Record<LinkCheck["verdict"], { label: string; tone: "good" | "warn" | "quiet" | "bad" }> = {
  links: { label: "Links here", tone: "good" },
  mentions: { label: "Names the studio, no link", tone: "warn" },
  nothing: { label: "No link", tone: "quiet" },
  unreadable: { label: "Could not be read", tone: "bad" },
};

/**
 * "Check a page for a link": any public page or site a person names is read
 * once by the desk (POST /api/v1/seo/backlinks/check), behind the spider's
 * guard and after the site's robots.txt allowed it, and every link to the
 * website on it is listed with its words and whether it is followed. A
 * reading is kept for a day; "Read now" asks again. A page that names the
 * studio without linking can be followed, and the studio workstation's local
 * model can draft the polite request for the link.
 */
export function CheckLink() {
  const send = useSend();
  const [got, setGot] = useState<LinkCheck | null>(null);
  const [asked, setAsked] = useState("");

  const run = async (url: string, fresh: boolean) => {
    setAsked(url);
    const r = await send.go<LinkCheckAnswer>("/api/v1/seo/backlinks/check", { url, fresh }, (v) => v.line);
    setGot(r.ok ? r.value.check : null);
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const url = String(new FormData(e.currentTarget).get("url") ?? "").trim();
    if (!url) {
      send.setMessage({ ok: false, text: "Give the address of a page, or a site's name." });
      return;
    }
    void run(url, false);
  };

  return (
    <div className="dk-seo-bl-check">
      <form className="dk-seo-bl-check-form" onSubmit={submit}>
        <label className="dk-seo-bl-find dk-seo-bl-check-field">
          <Icon name="link" size={14} />
          <input name="url" type="text" inputMode="url" placeholder="A page or a site: clientsite.ch/credits" aria-label="The page or site to read for a link" maxLength={2000} />
        </label>
        <Button type="submit" size="sm" variant="primary" icon="search" disabled={send.busy} aria-busy={send.busy || undefined}>
          {send.busy ? "Reading…" : "Check"}
        </Button>
      </form>
      <Said message={send.message} />
      {got ? <Result check={got} again={() => void run(asked, true)} busy={send.busy} /> : null}
    </div>
  );
}

function Result({ check, again, busy }: { check: LinkCheck; again: () => void; busy: boolean }) {
  const v = VERDICT[check.verdict];
  const draft: NewTask = {
    kind: "ask",
    context: "website",
    depth: "deep",
    prompt: `The page ${check.final.slice(0, 300)}${check.title ? ` (“${check.title.slice(0, 120)}”)` : ""} names Balkaris but does not link to the website. Write a short, polite email in the page's language (German or English) to whoever runs it, asking them to add a link to the most fitting page of the website, and name that page. Two short paragraphs, no flattery, nothing the website does not state.`,
  };
  return (
    <div className="dk-seo-bl-check-result">
      <div className="dk-seo-bl-check-head">
        <Badge tone={v.tone} dot>
          {v.label}
        </Badge>
        <a href={check.final} target="_blank" rel="noreferrer" className="dk-seo-bl-link dk-seo-bl-clip" title={check.final}>
          {check.title ?? check.host}
        </a>
        <span className="dk-seo-bl-quiet">
          {check.status ? `answered ${check.status}` : "no answer"}
          {check.cached ? `, read earlier today (${check.checkedAt.slice(11, 16)} UTC)` : ""}
        </span>
      </div>
      {check.links.length ? (
        <ul className="dk-seo-bl-check-links">
          {check.links.map((l) => (
            <li key={`${l.path}\n${l.anchor}\n${l.rel.join(" ")}`}>
              <Chip tone={l.follow ? "good" : "warn"}>{l.follow ? "Followed" : l.rel.length ? l.rel.join(", ") : "nofollow (page)"}</Chip>
              <span className="dk-seo-bl-clip" title={l.anchor || "no words"}>
                {l.anchor ? `“${l.anchor}”` : <span className="dk-seo-bl-quiet">no words</span>}
              </span>
              <span className="dk-seo-bl-quiet">to {l.path}</span>
              {l.times > 1 ? <span className="dk-seo-bl-quiet">×{l.times}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {check.why && check.verdict !== "unreadable" ? <p className="dk-seo-bl-quiet">{check.why}</p> : null}
      <div className="dk-seo-bl-check-actions">
        {check.tracked ? (
          <span className="dk-seo-bl-quiet">
            <Icon name="eye" size={13} /> Followed: the desk reads it every week.
          </span>
        ) : check.verdict !== "unreadable" ? (
          <FollowPage url={check.url} label={check.verdict === "links" ? "Follow this link" : "Follow this page"} />
        ) : null}
        {check.verdict === "mentions" ? (
          <QueueTask
            task={draft}
            label="Draft a link request"
            size="xs"
            title="Queue a task for the AI Operator (the studio workstation's local model): a short, polite email asking this page to link to the website. Nothing is sent: you read it and send it yourself."
          />
        ) : null}
        <Button size="xs" variant="ghost" icon="refresh" disabled={busy} onClick={again} title="Read the page again now instead of the reading kept from today">
          Read now
        </Button>
      </div>
    </div>
  );
}
