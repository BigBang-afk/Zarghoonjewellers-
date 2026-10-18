import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/Sidebar";

vi.mock("next/navigation", () => ({ usePathname: () => "/customers/123" }));

describe("sidebar", () => {
  const items = [
    { href: "/", label: "Overview" },
    { href: "/customers", label: "Customers" },
    { href: "/orders", label: "Orders", note: "read-only" },
    { href: "/handoffs", label: "Human Handoffs", count: 2 },
  ];
  it("marks the current section, shows notes and counts", () => {
    render(<Sidebar items={items} />);
    const desktop = screen.getAllByRole("navigation", { name: "Main" })[0]!;
    expect(desktop.querySelector('[aria-current="page"]')!.textContent).toContain("Customers");
    expect(desktop.textContent).toContain("read-only");
    expect(desktop.textContent).toContain("2");
  });
  it("opens and closes the mobile menu", () => {
    render(<Sidebar items={items} />);
    const button = screen.getByRole("button", { name: "Menu" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Close" }).getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("mobile-nav")).not.toBeNull();
  });
});
