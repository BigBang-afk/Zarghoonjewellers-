import { humanize } from "@/lib/format";
import { Badge, type Tone } from "./ui";

/** Follow-up engine presentation helpers. No data access; actions are verified on the server. */

export function PriorityBadge({ priority }: { priority: string }) {
  const tone: Tone = priority === "urgent" ? "danger" : priority === "high" ? "gold" : priority === "low" ? "neutral" : "emerald";
  return <Badge tone={tone}>{humanize(priority)}</Badge>;
}

const STATE_LABELS: Record<string, [string, Tone]> = {
  scheduled: ["Scheduled", "neutral"],
  processing: ["Processing", "neutral"],
  awaiting_review: ["Needs review", "warning"],
  approved: ["Approved — not sent", "emerald"],
  reminder_due: ["Reminder due", "gold"],
  blocked: ["On hold", "danger"],
  failed: ["Processing failed", "danger"],
};

export function ProcessingBadge({ state, status }: { state: string; status: string }) {
  if (status !== "pending") return <Badge tone={status === "completed" ? "emerald" : "neutral"}>{humanize(status)}</Badge>;
  const [label, tone] = STATE_LABELS[state] ?? [humanize(state), "neutral" as Tone];
  return <Badge tone={tone}>{label}</Badge>;
}

export const BLOCK_REASONS: Record<string, string> = {
  customer_replied: "Customer replied — review before following up",
  human_takeover: "A staff member has taken over the conversation",
  consent_missing: "No messaging consent recorded",
  consent_denied: "Customer declined messages",
  identity_review: "Customer identity needs review",
  do_not_contact: "Customer asked not to be contacted",
  lead_closed: "Lead is closed (won/lost) or the customer bought",
  no_purchase: "No purchase on record",
  frequency_limit: "Too many follow-ups this week",
  cancelled_by_staff: "Cancelled by staff",
};

const AUTHOR: Record<string, [string, Tone]> = {
  ai: ["Drafted by Claude", "dark"],
  template: ["Safe template (not AI)", "neutral"],
  staff: ["Written by staff", "gold"],
};

export function DraftCard({
  draft,
  compact = false,
}: {
  draft: { content: string; language: string; authorType: string; status: string; version: number };
  compact?: boolean;
}) {
  const [label, tone] = AUTHOR[draft.authorType] ?? [draft.authorType, "neutral" as Tone];
  return (
    <div className="rounded-lg border border-line bg-ivory p-3" data-testid="draft-card">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
        <Badge tone={tone}>{label}</Badge>
        <Badge>{humanize(draft.language)}</Badge>
        <Badge tone={draft.status === "approved" ? "emerald" : draft.status === "pending_review" ? "warning" : "neutral"}>
          {draft.status === "approved" ? "Approved — not sent" : humanize(draft.status)}
        </Badge>
        {!compact ? <span className="text-muted">v{draft.version}</span> : null}
      </div>
      <p className={`whitespace-pre-wrap text-sm text-ink ${compact ? "line-clamp-3" : ""}`} lang={draft.language === "urdu" ? "ur" : undefined} dir="auto">
        {draft.content}
      </p>
    </div>
  );
}
