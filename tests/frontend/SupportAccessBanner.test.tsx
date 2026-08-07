import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SupportAccessBanner } from "../../src/components/SupportAccessBanner";

describe("SupportAccessBanner", () => {
  it("renders the active support grant details", () => {
    render(
      <SupportAccessBanner
        grant={{
          id: 7,
          organizationId: 42,
          reason: "Troubleshoot Square sync",
          caseReference: "CASE-123",
          status: "active",
          startsAt: "2026-08-07T10:00:00Z",
          expiresAt: "2026-08-07T12:00:00Z",
        }}
      />,
    );

    expect(screen.getByText("Support access active")).toBeVisible();
    expect(screen.getByText("Organization #42")).toBeVisible();
    expect(screen.getByText("Case CASE-123")).toBeVisible();
    expect(screen.getByText("Reason: Troubleshoot Square sync")).toBeVisible();
  });

  it("renders nothing when support access is inactive", () => {
    const { container } = render(<SupportAccessBanner grant={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
