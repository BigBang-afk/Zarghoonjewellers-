import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageThread, ScoreBreakdown } from "@/components/crmDisplay";
import { EmptyState, Karat, LeadScore, LeadStatusBadge, Money, StatCard, StockBadge, Value, Weight } from "@/components/ui";

vi.mock("next/navigation", () => ({ usePathname: () => "/customers" }));

describe("unknown values are never guessed", () => {
  it("shows Needs confirmation for missing price, weight, karat and stock", () => {
    render(
      <div>
        <Money amount={null} />
        <Weight grams={null} />
        <Karat karat={null} />
        <StockBadge status={null} />
        <Value>{""}</Value>
      </div>,
    );
    expect(screen.getAllByText("Needs confirmation")).toHaveLength(5);
  });
  it("shows stored values exactly", () => {
    render(
      <div>
        <span><Money amount="495000.00" /></span>
        <span><Weight grams="48.250" /></span>
        <span><Karat karat={22} /></span>
        <StockBadge status="low_stock" quantity={1} />
      </div>,
    );
    expect(screen.getByText("PKR 495,000")).toBeTruthy();
    expect(screen.getByText("48.25 g")).toBeTruthy();
    expect(screen.getByText("22K")).toBeTruthy();
    expect(screen.getByText("Low stock · 1")).toBeTruthy();
  });
});

describe("lead scoring display", () => {
  it("shows score with its classification", () => {
    render(<LeadScore score={85} classification="very_hot" />);
    expect(screen.getByTestId("lead-score").textContent).toContain("85");
    expect(screen.getByText("Very hot")).toBeTruthy();
  });
  it("lists each signal with its points", () => {
    render(
      <ScoreBreakdown
        score={55}
        classification="hot"
        breakdown={[
          { signal: "asked_price", points: 10 },
          { signal: "provided_budget", points: 15 },
          { signal: "specific_product_interest", points: 15 },
          { signal: "asked_availability", points: 15 },
        ]}
        events={[{ signal: "provided_budget", points: 15, evidence: "Budget 3 lakh", recordedByType: "ai", createdAt: new Date("2026-10-18T10:00:00Z") }]}
      />,
    );
    const box = screen.getByTestId("score-breakdown");
    expect(within(box).getByText("Shared a budget")).toBeTruthy();
    expect(within(box).getAllByText("+15")).toHaveLength(3);
    expect(box.textContent).toContain("Budget 3 lakh");
    expect(box.textContent).toContain("55");
  });
  it("says so when there is no active lead", () => {
    render(<ScoreBreakdown score={null} classification={null} breakdown={[]} />);
    expect(screen.getByText(/No active lead/)).toBeTruthy();
  });
  it("labels lead statuses from the enum", () => {
    render(<LeadStatusBadge status="human_followup" />);
    expect(screen.getByText("Human follow-up")).toBeTruthy();
  });
});

describe("message thread", () => {
  it("distinguishes customer, AI, staff and system messages", () => {
    const at = new Date("2026-10-18T10:00:00Z");
    render(
      <MessageThread
        messages={[
          { id: "1", senderType: "customer", content: "Salam", createdAt: at },
          { id: "2", senderType: "ai", content: "Welcome", createdAt: at },
          { id: "3", senderType: "staff", content: "I'll call you", createdAt: at, senderStaffName: "Ali" },
          { id: "4", senderType: "system", content: "Handoff requested", createdAt: at },
          { id: "5", senderType: "customer", content: "کیا رعایت ملے گی؟", createdAt: at, language: "urdu" },
        ]}
      />,
    );
    const items = screen.getByTestId("message-thread").querySelectorAll("li");
    expect([...items].map((li) => li.getAttribute("data-sender"))).toEqual(["customer", "ai", "staff", "system", "customer"]);
    expect(items[1]!.textContent).toContain("Zarghoon AI");
    expect(items[2]!.textContent).toContain("Staff · Ali");
    expect(items[3]!.textContent).toContain("System");
    expect(items[4]!.querySelector("p")!.getAttribute("lang")).toBe("ur");
  });
  it("has an empty state", () => {
    render(<MessageThread messages={[]} />);
    expect(screen.getByText("No messages.")).toBeTruthy();
  });
});

describe("overview and empty states", () => {
  it("stat cards link to their filtered lists", () => {
    render(<StatCard label="Hot leads" value={3} href="/leads?status=hot" />);
    expect(screen.getByTestId("stat-Hot leads").getAttribute("href")).toBe("/leads?status=hot");
  });
  it("empty state", () => {
    render(<EmptyState title="No customers yet">Customers appear here…</EmptyState>);
    expect(screen.getByTestId("empty-state").textContent).toContain("No customers yet");
  });
});
