import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LandingPage } from "../../src/pages/LandingPage";

describe("public commercial landing page", () => {
  it("routes customers to production access and the separate official demo", () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);

    expect(screen.getByRole("link", { name: /Sign in/i })).toHaveAttribute("href", "https://app.flowtally.ca/app/login");
    expect(screen.getByRole("link", { name: /View Live Demo/i })).toHaveAttribute("href", "https://flowtally-demo.onrender.com/app/login");
    expect(screen.queryByText(/Join Early Pilot/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Continue with Google/i })).not.toBeInTheDocument();
  });
});
