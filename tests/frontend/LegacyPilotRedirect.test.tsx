import React from "react";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LegacyPilotRedirect } from "../../src/pilot/LegacyPilotRedirect";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

describe("legacy pilot redirects", () => {
  it.each([
    ["/app/reports", "/app/dashboard?view=daily"],
    ["/app/reports?view=daily", "/app/dashboard?view=daily"],
    ["/app/reports?view=weekly", "/app/dashboard?view=weekly"],
  ])("redirects %s to %s", (from, expected) => {
    const view = new URLSearchParams(from.split("?")[1] ?? "").get("view") ?? "daily";
    const path = from.split("?")[0];
    const { container } = renderWithRoute(path, from, view);
    expect(container.querySelector("[data-testid='location']")).toHaveTextContent(expected);
  });
});

function renderWithRoute(path: string, initialEntry: string, view: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path={path} element={<LegacyPilotRedirect view={view} dashboard />} />
        <Route path="/app/dashboard" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}
