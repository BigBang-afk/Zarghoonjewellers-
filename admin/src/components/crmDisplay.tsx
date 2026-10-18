import { LEAD_SIGNAL_POINTS } from "@zarghoon/core/dashboard";
import { formatDateTime, humanize, SENDER_LABELS, SIGNAL_LABELS } from "@/lib/format";
import { Badge } from "./ui";

/** Who said what. Customer messages sit left; AI, staff and system messages are labelled distinctly. */
export function MessageThread({
  messages,
}: {
  messages: { id: string; senderType: string; content: string; createdAt: Date; language?: string | null; senderStaffName?: string | null }[];
}) {
  if (messages.length === 0) return <p className="text-sm text-muted">No messages.</p>;
  const style: Record<string, string> = {
    customer: "mr-auto bg-ivory border-line",
    ai: "ml-auto bg-emerald-50 border-emerald-100",
    staff: "ml-auto bg-gold-50 border-gold-light",
    system: "mx-auto bg-stone-50 border-stone-200 text-muted",
  };
  return (
    <ol className="flex flex-col gap-3" data-testid="message-thread">
      {messages.map((m) => (
        <li key={m.id} className={`max-w-[85%] rounded-xl border px-3.5 py-2.5 ${style[m.senderType] ?? style.system}`} data-sender={m.senderType}>
          <div className="mb-1 flex items-center gap-2 text-xs">
            <span className="font-semibold uppercase tracking-wider text-emerald-900">
              {m.senderType === "staff" && m.senderStaffName ? `Staff · ${m.senderStaffName}` : (SENDER_LABELS[m.senderType] ?? m.senderType)}
            </span>
            <span className="text-muted">{formatDateTime(m.createdAt)}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-ink" lang={m.language === "urdu" ? "ur" : undefined} dir="auto">
            {m.content}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** The deterministic lead score: which signals were recorded and the points each carries. */
export function ScoreBreakdown({
  score,
  classification,
  breakdown,
  events,
}: {
  score: number | null;
  classification: string | null;
  breakdown: { signal: string; points: number }[];
  events?: { signal: string; points: number; evidence: string | null; recordedByType: string; createdAt: Date }[];
}) {
  if (score === null) return <p className="text-sm text-muted">No active lead, so no current score.</p>;
  const total = breakdown.reduce((s, b) => s + b.points, 0);
  return (
    <div data-testid="score-breakdown">
      <p className="mb-3 text-sm">
        <span className="tabular font-serif text-3xl font-semibold text-emerald-900">{score}</span>
        <span className="text-muted"> / 100 · {humanize(classification)}</span>
        {total > 100 ? <span className="ml-2 text-xs text-muted">(capped at 100)</span> : null}
      </p>
      {breakdown.length === 0 ? (
        <p className="text-sm text-muted">No buying signals recorded yet.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {breakdown.map((b) => {
            const event = events?.find((e) => e.signal === b.signal);
            return (
              <li key={b.signal} className="flex items-start justify-between gap-3 py-2">
                <div>
                  <p className="text-ink">{SIGNAL_LABELS[b.signal] ?? humanize(b.signal)}</p>
                  {event ? (
                    <p className="text-xs text-muted">
                      {event.recordedByType === "ai" ? "Recorded by Zarghoon AI" : `Recorded by ${event.recordedByType}`} · {formatDateTime(event.createdAt)}
                      {event.evidence ? ` · “${event.evidence}”` : ""}
                    </p>
                  ) : null}
                </div>
                <Badge tone="gold">+{b.points}</Badge>
              </li>
            );
          })}
        </ul>
      )}
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer">How the score is calculated</summary>
        <p className="mt-1">Each signal counts once. 0–20 cold, 21–50 warm, 51–75 hot, 76–100 very hot.</p>
        <ul className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          {Object.entries(LEAD_SIGNAL_POINTS).map(([s, p]) => (
            <li key={s}>
              {SIGNAL_LABELS[s] ?? s}: +{p}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
