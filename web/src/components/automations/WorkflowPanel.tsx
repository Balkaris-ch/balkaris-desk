import type { Reading } from "@/contract/common";
import type { FileChange, SiteWorkflow } from "@/contract/automations";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { ago } from "@/lib/format";

/**
 * The website's own automation, described from its files: after a production
 * deployment it tells the search engines what changed. Whether a given run
 * worked is GitHub's to say; the desk has no token to ask, so it shows what
 * the workflow does and where its runs are, and claims no status.
 */
export function WorkflowPanel({ reading, at }: { reading: Reading<SiteWorkflow>; at: string }) {
  const w = reading.state === "ok" ? reading.value : null;
  return (
    <Card
      title="Search engine announcements"
      icon="send"
      sub="The website's own workflow on GitHub"
      right={
        w?.runsHref ? (
          <LinkButton href={w.runsHref} size="sm" iconRight="external">
            Runs on GitHub
          </LinkButton>
        ) : null
      }
    >
      <Read reading={reading}>
        {(v, ok) => (
          <div className="dk-automations-flow">
            <p className="dk-automations-flow-when">
              <Icon name="bolt" size={14} />
              <span>
                {v.onDeploy ? "After every successful production deployment" : "Its trigger could not be read from the workflow file"}
                {v.byHand ? ", and by hand from GitHub's Actions tab." : "."}
              </span>
            </p>
            {v.compares || v.indexNow || v.webSub ? (
              <ol className="dk-automations-flow-steps">
                {v.compares ? <li>Compares the new deployment&apos;s sitemap with the one before it: addresses that are new, gone or re-dated. When there are none, it sends nothing.</li> : null}
                {v.indexNow ? <li>Announces {v.compares ? "them" : "the changed addresses"} to IndexNow, which Bing, Yandex, Naver, Seznam and Yep read.</li> : null}
                {v.webSub ? (
                  <li>
                    {v.webSubArticlesOnly ? "When an article's address is among them, pings" : "Pings"} Google&apos;s WebSub hub for the journal&apos;s feed{v.feed ? `, ${v.feed}` : ""}.
                  </li>
                ) : null}
              </ol>
            ) : (
              <p className="dk-automations-quiet">What the script sends could not be read from {v.script}.</p>
            )}
            <p className="dk-automations-flow-cannot">
              Nobody can make Google crawl a page: it reads the sitemap on its own schedule, and Search Console's Request indexing is pressed by a person and has no API.
            </p>
            <p className="dk-automations-flow-status">
              <Icon name="minus" size={14} />
              <span>How each run went is not shown here: the desk has no GitHub token to read the workflow's runs.</span>
            </p>
            <ul className="dk-automations-files">
              <FileLine label={v.file} change={v.fileChange} at={at} />
              <FileLine label={v.script} change={v.scriptChange} at={at} />
            </ul>
            <Stamp reading={ok} />
          </div>
        )}
      </Read>
    </Card>
  );
}

function FileLine({ label, change, at }: { label: string; change: FileChange | null; at: string }) {
  return (
    <li>
      <code>{label}</code>
      {change ? (
        <span className="dk-automations-quiet">
          {" "}
          changed{" "}
          {change.href ? (
            <Go href={change.href} className="dk-automations-link" title={change.subject}>
              <time dateTime={change.at}>{ago(change.at, at)}</time>
            </Go>
          ) : (
            <time dateTime={change.at}>{ago(change.at, at)}</time>
          )}
        </span>
      ) : (
        <span className="dk-automations-quiet"> not found in the repository</span>
      )}
    </li>
  );
}
