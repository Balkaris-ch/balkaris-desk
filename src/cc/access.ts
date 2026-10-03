import type { Context, MiddlewareHandler } from "hono";
import { accessOf } from "../grants.ts";
import type { Person } from "../people.ts";
import type { ApiError, Me } from "../../web/src/contract/common.ts";

/**
 * Who may do what on the command center's API.
 *
 * By the time a request reaches a route the server's gate (src/server.ts) has
 * already established three things: somebody is signed in, they are not
 * revoked, and a request that changes something came from the desk's own
 * pages. What is left for a route to decide is only whether THIS person may:
 *
 *   everybody signed in   reads the screens the owner gave them (src/grants.ts,
 *                         enforced at the same gate), runs a job now
 *   requireOwner          changes how the desk behaves or what people may do
 *   requireLeads          reads anything that names an enquirer
 *
 * Use them as middleware, on one route or on a whole router:
 *
 *   routes.post("/rules", requireOwner, (c) => …)
 *   routes.use("*", requireLeads)
 */

/**
 * What travels on a request: the signed-in person, set by the server's gate;
 * and `did`, what a route says it did, for the owner's record of the team
 * (src/presence.ts) when it is not news for the whole desk's feed.
 */
export type Vars = { Variables: { who: Person; did?: { text: string; href?: string } } };

/** The person making this request. Always there behind the gate. */
export const me = (c: Context<Vars>): Person => c.get("who");

/** A person as the interface is told about them: no ids, nothing it does not draw. */
export const toMe = (p: Person): Me => {
  const a = accessOf(p);
  return {
    name: p.name,
    email: p.email,
    owner: p.owner,
    canPublish: p.canPublish,
    seesLeads: p.seesLeads,
    access: { restricted: a.restricted, pages: a.pages, home: a.home },
  };
};

/** Refuses with 403 unless the owner is asking. */
export const requireOwner: MiddlewareHandler<Vars> = async (c, next) => {
  if (!me(c).owner) return c.json<ApiError>({ error: "Only the owner can do this." }, 403);
  await next();
};

/**
 * Refuses with 403 unless this person may read enquiries (`Person.seesLeads`).
 * Every route that returns a name, a contact detail or a message sits behind it.
 */
export const requireLeads: MiddlewareHandler<Vars> = async (c, next) => {
  if (!me(c).seesLeads) {
    return c.json<ApiError>({ error: "Enquiries are shown only to people the owner has given access to." }, 403);
  }
  await next();
};
