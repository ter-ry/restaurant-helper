import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotCloverConnection } from "../../src/pilot/PilotCloverConnection";

const session = vi.hoisted(() => ({ organizationId: 1, userId: 10 }));

const mockApi = vi.hoisted(() => ({
  fetchPilotCloverStatus: vi.fn(),
  fetchPilotCloverCatalog: vi.fn(),
  disconnectPilotClover: vi.fn(),
  beginPilotCloverConnection: vi.fn(),
  resumePilotCloverLaunch: vi.fn(),
}));

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => ({
    user: { id: session.userId, email: "qa@example.com" },
    organization: { id: session.organizationId, name: `Organization ${session.organizationId}` },
    currentLocation: null,
    locations: [],
  }),
}));

vi.mock("../../src/pilot/pilotApi", () => ({
  fetchPilotCloverStatus: mockApi.fetchPilotCloverStatus,
  fetchPilotCloverCatalog: mockApi.fetchPilotCloverCatalog,
  disconnectPilotClover: mockApi.disconnectPilotClover,
  beginPilotCloverConnection: mockApi.beginPilotCloverConnection,
  resumePilotCloverLaunch: mockApi.resumePilotCloverLaunch,
}));

vi.mock("../../src/pilot/pilotConfig", () => ({ demoReadOnly: false }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

const connectedStatus = (organizationId: number) => ({
  enabled: true,
  catalogEnabled: true,
  connection: { environment: "sandbox", merchantName: `Merchant ${organizationId}`, merchantId: `merchant-${organizationId}`, status: "connected" },
});

const catalog = (name: string) => ({
  readOnly: true,
  merchantName: "Sandbox Cafe",
  location: { id: "location-1", name: "Main" },
  itemCount: 1,
  items: [{
    id: `item-${name}`,
    name,
    priceCents: 500,
    active: true,
    deleted: false,
    hidden: false,
    available: true,
    itemGroupId: null,
    optionIds: [],
    categories: [],
    modifierGroups: [],
  }],
});

describe("PilotCloverConnection tenant state", () => {
  beforeEach(() => {
    session.organizationId = 1;
    session.userId = 10;
    mockApi.fetchPilotCloverStatus.mockReset();
    mockApi.fetchPilotCloverCatalog.mockReset();
    mockApi.disconnectPilotClover.mockReset();
    mockApi.beginPilotCloverConnection.mockReset();
    mockApi.resumePilotCloverLaunch.mockReset();
    mockApi.fetchPilotCloverStatus.mockResolvedValue(connectedStatus(1));
  });

  it("hides the previous organization's status when switching organizations", async () => {
    const firstStatus = deferred<ReturnType<typeof connectedStatus>>();
    mockApi.fetchPilotCloverStatus.mockImplementation((organizationId: number) => organizationId === 1 ? firstStatus.promise : Promise.resolve({ enabled: false, catalogEnabled: false, connection: null }));
    const view = render(<MemoryRouter><PilotCloverConnection /></MemoryRouter>);

    session.organizationId = 2;
    view.rerender(<MemoryRouter><PilotCloverConnection /></MemoryRouter>);
    firstStatus.resolve(connectedStatus(1));

    await waitFor(() => expect(screen.queryByText("Merchant 1")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Preview catalog" })).not.toBeInTheDocument();
  });

  it("does not apply a catalog response after switching to another organization", async () => {
    const catalogResponse = deferred<ReturnType<typeof catalog>>();
    mockApi.fetchPilotCloverStatus.mockImplementation((organizationId: number) => organizationId === 1 ? Promise.resolve(connectedStatus(1)) : Promise.resolve({ enabled: false, catalogEnabled: false, connection: null }));
    mockApi.fetchPilotCloverCatalog.mockReturnValue(catalogResponse.promise);
    const view = render(<MemoryRouter><PilotCloverConnection /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "Preview catalog" }));
    session.organizationId = 2;
    view.rerender(<MemoryRouter><PilotCloverConnection /></MemoryRouter>);
    catalogResponse.resolve(catalog("Old organization item"));

    await waitFor(() => expect(screen.queryByText("Old organization item")).not.toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "Clover catalog preview" })).not.toBeInTheDocument();
  });

  it("does not apply a stale status response after switching to a non-allowlisted organization", async () => {
    const firstStatus = deferred<ReturnType<typeof connectedStatus>>();
    mockApi.fetchPilotCloverStatus.mockImplementation((organizationId: number) => organizationId === 1 ? firstStatus.promise : Promise.resolve({ enabled: false, catalogEnabled: false, connection: null }));
    const view = render(<MemoryRouter><PilotCloverConnection /></MemoryRouter>);

    session.organizationId = 2;
    view.rerender(<MemoryRouter><PilotCloverConnection /></MemoryRouter>);
    firstStatus.resolve(connectedStatus(1));

    await waitFor(() => expect(screen.queryByText("Merchant 1")).not.toBeInTheDocument());
    expect(screen.queryByText("Connect Clover sandbox")).not.toBeInTheDocument();
  });

  it("clears catalog state when disconnecting while a catalog request is pending", async () => {
    const catalogResponse = deferred<ReturnType<typeof catalog>>();
    const disconnectResponse = deferred<{ connection: { status: string } }>();
    mockApi.fetchPilotCloverCatalog.mockReturnValue(catalogResponse.promise);
    mockApi.disconnectPilotClover.mockReturnValue(disconnectResponse.promise);
    render(<MemoryRouter><PilotCloverConnection /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "Preview catalog" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    disconnectResponse.resolve({ connection: { status: "disconnected" } });
    catalogResponse.resolve(catalog("Late catalog"));

    await waitFor(() => expect(screen.queryByText("Late catalog")).not.toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "Clover catalog preview" })).not.toBeInTheDocument();
  });

  it("clears previously loaded catalog when the feature becomes disabled for a new session", async () => {
    mockApi.fetchPilotCloverCatalog.mockResolvedValue(catalog("Previously loaded"));
    const view = render(<MemoryRouter><PilotCloverConnection /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "Preview catalog" }));
    expect(await screen.findByText("Previously loaded")).toBeVisible();

    session.userId = 11;
    mockApi.fetchPilotCloverStatus.mockResolvedValue({ enabled: true, catalogEnabled: false, connection: null });
    view.rerender(<MemoryRouter><PilotCloverConnection /></MemoryRouter>);

    await waitFor(() => expect(screen.queryByText("Previously loaded")).not.toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "Clover catalog preview" })).not.toBeInTheDocument();
  });
});
