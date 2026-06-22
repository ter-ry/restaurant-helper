import { useMemo } from "react";
import { useLocation, useParams } from "react-router-dom";
import {
  buildDemoPath,
  defaultDemoProfileSlug,
  demoProfileDefinitions,
  demoProfileOptions,
  isDemoProfileSlug,
  type DemoProfileSlug,
} from "../data/demoProfiles";
import type { DemoCustomization, DemoProfileData } from "../types";

export interface DemoProfileView extends DemoProfileData {
  sampleLabel: string;
  navigation: {
    dashboard: string;
    purchases: string;
    inventory: string;
    menuCosting: string;
    schedule: string;
    closeReports: string;
  };
}

function parseCustomizationOverrides(search: string): Partial<DemoCustomization> {
  const params = new URLSearchParams(search);
  const name = params.get("name")?.trim();
  const city = params.get("city")?.trim();
  const restaurantType = params.get("type")?.trim();
  const primarySupplier = params.get("supplier")?.trim();
  const ownerPainPoint = params.get("painPoint")?.trim();

  return {
    ...(name ? { restaurantName: name } : {}),
    ...(city ? { city } : {}),
    ...(restaurantType ? { restaurantType } : {}),
    ...(primarySupplier ? { primarySupplier } : {}),
    ...(ownerPainPoint ? { ownerPainPoint } : {}),
  };
}

function createDemoNavigation(slug: DemoProfileSlug) {
  return {
    dashboard: buildDemoPath(slug),
    purchases: buildDemoPath(slug, "purchases"),
    inventory: buildDemoPath(slug, "inventory"),
    menuCosting: buildDemoPath(slug, "menu-costing"),
    schedule: buildDemoPath(slug, "schedule"),
    closeReports: buildDemoPath(slug, "close-reports"),
  };
}

function hydrateProfile(slug: DemoProfileSlug, overrides: Partial<DemoCustomization> = {}): DemoProfileView {
  const baseProfile = demoProfileDefinitions[slug];
  const customization = {
    ...baseProfile.customization,
    ...overrides,
  };

  return {
    ...baseProfile,
    customization,
    sampleLabel: "Single-restaurant pilot",
    navigation: createDemoNavigation(slug),
  };
}

export function getDemoProfileView(slug: DemoProfileSlug, overrides: Partial<DemoCustomization> = {}) {
  return hydrateProfile(slug, overrides);
}

export function useDemoProfile() {
  const params = useParams();
  const location = useLocation();
  const slug = isDemoProfileSlug(params.profile) ? params.profile : defaultDemoProfileSlug;
  const overrides = parseCustomizationOverrides(location.search);

  return useMemo(() => hydrateProfile(slug, overrides), [location.search, slug]);
}

export function replaceDemoProfileInPath(pathname: string, slug: DemoProfileSlug) {
  const demoRouteMatch = pathname.match(/^\/(?:app\/demo|demo)\/([^/]+)(.*)$/);

  if (demoRouteMatch) {
    const suffix = demoRouteMatch[2] ?? "";
    return buildDemoPath(slug, suffix.replace(/^\/+/, ""));
  }

  return buildDemoPath(slug);
}

export { buildDemoPath, demoProfileOptions, defaultDemoProfileSlug };
