/**
 * Who is performing an action, and the correlation IDs that tie it to a
 * request. Every mutating service call takes one of these so the audit log
 * can always answer "who did this, and as part of what?".
 */

export const ACTOR_TYPES = ["ai", "staff", "system"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export type Actor =
  | { type: "staff"; staffId: string }
  | { type: "ai"; agentName: string }
  | { type: "system"; name?: string };

export interface ActionContext {
  actor: Actor;
  /** Correlates all writes made while handling one inbound request. */
  requestId?: string;
  /** Set when the action was initiated by an AI tool call. */
  toolName?: string;
}

export function actorStaffId(ctx: ActionContext): string | null {
  return ctx.actor.type === "staff" ? ctx.actor.staffId : null;
}

export function actorAgentName(ctx: ActionContext): string | null {
  return ctx.actor.type === "ai" ? ctx.actor.agentName : null;
}

/** Clock injection keeps time-based rules (e.g. "no follow-ups in the past") testable. */
export type Clock = () => Date;
export const systemClock: Clock = () => new Date();
