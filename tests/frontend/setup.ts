import "@testing-library/jest-dom/vitest";

beforeAll(() => {
  Object.defineProperty(window, "scrollTo", {
    value: vi.fn(),
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
