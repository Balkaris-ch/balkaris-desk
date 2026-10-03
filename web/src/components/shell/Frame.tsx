import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { askMe, system as askSystem } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Beat } from "./Beat";
import { Gate } from "./Gate";
import { ShellRoot } from "./NavDrawer";
import { Reload } from "./Reload";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import "./shell.css";

/**
 * The frame around every screen: sidebar, top bar, and the screen in between.
 *
 * It asks the desk server two things, together: who is looking, and how the
 * system is. Nobody signed in is sent to sign in. A switched-off account, a
 * newcomer the owner has given nothing yet, or a server that is not answering
 * gets a calm page that says so IN PLACE OF the screen. That replaces only what is shown: Next renders a layout and its
 * page in parallel, so the screen's own requests have already gone out and
 * still run, and fail, on their own (a server that is down can hold each one
 * for api.ts's full patience). A screen therefore never relies on the frame
 * for its failures: it calls `api()`, whose failures reach the error screen,
 * or `ask()` and handles the answer it gets.
 * A missing status is not a failure of the frame: the top bar's light goes
 * grey and says it has no report.
 *
 * Used by the route group's layout (app/(frame)/layout.tsx) and by /kit.
 */
export async function Frame({ children }: { children: ReactNode }) {
  const [who, sys] = await Promise.all([askMe(), askSystem()]);

  if (!who.ok) {
    /* redirect() throws; nothing here catches it. */
    if (who.kind === "signed-out") redirect("/auth/google");
    return (
      <Gate kind={who.kind} detail={who.kind === "error" || who.kind === "missing" ? who.message : undefined} form="page">
        {who.kind === "off" ? (
          <form method="post" action="/logout">
            <Button type="submit" icon="logout">
              Sign out
            </Button>
          </form>
        ) : (
          <Reload variant="primary" />
        )}
      </Gate>
    );
  }

  const me = who.value;
  if (typeof me?.name !== "string") {
    return (
      <Gate kind="error" detail="The server answered /api/v1/me, but not with a person." form="page">
        <Reload variant="primary" />
      </Gate>
    );
  }

  /* Signed in, and the owner has given them nothing yet (src/grants.ts): one calm page, and the way out. */
  if (!me.owner && me.access && me.access.home === null) {
    return (
      <Gate kind="waiting" detail={me.email ? `Signed in as ${me.email}.` : undefined} form="page">
        <form method="post" action="/logout">
          <Button type="submit" icon="logout">
            Sign out
          </Button>
        </form>
        <Reload variant="primary" />
      </Gate>
    );
  }

  const system = sys.ok && Array.isArray(sys.value?.checks) && Array.isArray(sys.value?.sources) && Array.isArray(sys.value?.notices) ? sys.value : null;

  return (
    <ShellRoot>
      <Beat />
      <Sidebar pages={me.access?.pages} />
      <div className="dk-body">
        <TopBar me={me} system={system} />
        <main className="dk-main" id="main">
          <div className="dk-page">{children}</div>
        </main>
      </div>
    </ShellRoot>
  );
}
