import type { RunnerState } from "@/contract/operator";
import { PageHead } from "@/components/shell/PageHead";
import { Icon } from "@/components/ui/icons";
import { ago } from "@/lib/format";
import { cx } from "@/lib/cx";

/** The board's globe, drawn: a dark sphere rising behind the head with dotted orbits. Decoration only. */
function Globe() {
  const meridians = [-60, -30, 0, 30, 60];
  return (
    <svg className="dk-operator-globe" viewBox="0 0 420 150" aria-hidden focusable="false">
      <defs>
        <radialGradient id="dk-op-sphere" cx="38%" cy="22%" r="80%">
          <stop offset="0" className="dk-operator-globe-lit" />
          <stop offset="0.55" className="dk-operator-globe-mid" />
          <stop offset="1" className="dk-operator-globe-dark" />
        </radialGradient>
        <clipPath id="dk-op-clip">
          <circle cx="210" cy="178" r="150" />
        </clipPath>
      </defs>
      <circle cx="210" cy="178" r="150" fill="url(#dk-op-sphere)" className="dk-operator-globe-ball" />
      <g clipPath="url(#dk-op-clip)" className="dk-operator-globe-grid">
        {meridians.map((m) => (
          <ellipse key={m} cx={210 + m * 0.6} cy="178" rx={Math.max(8, 150 - Math.abs(m) * 2.2)} ry="150" />
        ))}
        {[60, 92, 124].map((y) => (
          <line key={y} x1="40" x2="380" y1={y} y2={y} />
        ))}
      </g>
      <ellipse cx="210" cy="96" rx="196" ry="38" transform="rotate(-8 210 96)" className="dk-operator-globe-orbit" />
      <ellipse cx="210" cy="108" rx="168" ry="26" transform="rotate(10 210 108)" className="dk-operator-globe-orbit" />
      {[
        [128, 92],
        [176, 74],
        [232, 96],
        [281, 66],
        [312, 112],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="2.6" className="dk-operator-globe-dot" />
      ))}
    </svg>
  );
}

/**
 * The head: the board's eyebrow, title and subtitle; its globe; the chip that
 * says the workstation is working, shown only while a task really runs; and,
 * where the board says "Powered by Balkaris AI", what is true: it runs on
 * the studio's workstation and answers from the desk's own data, and whether
 * the workstation is on.
 */
export function Head({ runner, working }: { runner: RunnerState; working: { id: number; title: string } | null }) {
  const on = runner.state === "online";
  return (
    <div className="dk-operator-head">
      <PageHead
        eyebrow="AI Operator"
        title="AI Operator"
        subtitle="Your intelligent assistant for operating, optimizing and growing balkaris.ch."
      />
      <div className="dk-operator-engine">
        <span className={cx("dk-operator-engine-mark", on && "dk-operator-engine-mark--on")} aria-hidden>
          <Icon name="cpu" size={18} />
        </span>
        <span className="dk-operator-engine-text">
          <span className="dk-operator-engine-title">Runs on the studio workstation.</span>
          <span className="dk-operator-engine-sub">Answers from the desk&apos;s own data.</span>
          <span className={cx("dk-operator-engine-state", on ? "dk-tone-good" : runner.state === "articles" ? "dk-tone-warn" : "dk-tone-quiet")}>
            <span className="dk-operator-status-dot" aria-hidden />
            {runner.line}
            {runner.lastSeen && runner.state !== "articles" ? (
              <>
                {" "}
                Last asked for a task{" "}
                <time dateTime={runner.lastSeen} suppressHydrationWarning>
                  {ago(runner.lastSeen)}
                </time>
                .
              </>
            ) : null}
          </span>
        </span>
      </div>

      <div className="dk-operator-sky" aria-hidden={working ? undefined : true}>
        <Globe />
        {working ? (
          <a href={`#current-tasks`} className="dk-operator-working" title={working.title}>
            <span className="dk-operator-working-ring" aria-hidden />
            Analyzing your website…
          </a>
        ) : null}
      </div>
    </div>
  );
}
