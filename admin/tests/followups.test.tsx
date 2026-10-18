import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BLOCK_REASONS, DraftCard, PriorityBadge, ProcessingBadge } from "@/components/followupDisplay";

describe("follow-up display", () => {
  it("an approved draft is clearly marked as not sent", () => {
    render(<DraftCard draft={{ content: "Assalamualaikum!", language: "english", authorType: "ai", status: "approved", version: 2 }} />);
    expect(screen.getByText("Approved — not sent")).toBeTruthy();
    expect(screen.getByText("Drafted by Claude")).toBeTruthy();
    expect(screen.getByText("v2")).toBeTruthy();
  });

  it("templates are labelled as not AI and staff edits as staff", () => {
    const { unmount } = render(<DraftCard draft={{ content: "x", language: "roman_urdu", authorType: "template", status: "pending_review", version: 1 }} />);
    expect(screen.getByText("Safe template (not AI)")).toBeTruthy();
    expect(screen.getByText("Pending review")).toBeTruthy();
    unmount();
    render(<DraftCard draft={{ content: "x", language: "english", authorType: "staff", status: "pending_review", version: 3 }} />);
    expect(screen.getByText("Written by staff")).toBeTruthy();
  });

  it("Urdu drafts render right-to-left-ready", () => {
    render(<DraftCard draft={{ content: "السلام علیکم", language: "urdu", authorType: "ai", status: "pending_review", version: 1 }} />);
    expect(screen.getByText("السلام علیکم").getAttribute("lang")).toBe("ur");
  });

  it("processing states and priorities", () => {
    render(
      <div>
        <ProcessingBadge state="awaiting_review" status="pending" />
        <ProcessingBadge state="failed" status="pending" />
        <ProcessingBadge state="approved" status="completed" />
        <PriorityBadge priority="urgent" />
      </div>,
    );
    expect(screen.getByText("Needs review")).toBeTruthy();
    expect(screen.getByText("Processing failed")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy(); // a closed follow-up shows its status, not its processing state
    expect(screen.getByText("Urgent")).toBeTruthy();
  });

  it("every policy block reason has a staff-readable explanation", () => {
    for (const code of ["customer_replied", "human_takeover", "consent_missing", "consent_denied", "identity_review", "do_not_contact", "lead_closed", "no_purchase", "frequency_limit"]) {
      expect(BLOCK_REASONS[code], code).toBeTruthy();
    }
  });
});
