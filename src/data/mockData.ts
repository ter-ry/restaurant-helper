import { defaultDemoProfileSlug, getDemoProfileView } from "../lib/demoProfile";

export const demoProfile = getDemoProfileView(defaultDemoProfileSlug);

export const restaurantProfile = {
  name: demoProfile.customization.restaurantName,
  businessType: demoProfile.customization.restaurantType,
  mainContact: "Maya Chen",
  email: "maya@harbourfrontbakehouse.example",
  phone: "(416) 555-0148",
  reportFrequency: "Monthly",
  alertThreshold: 5,
  currency: demoProfile.currency,
  period: demoProfile.period,
  city: demoProfile.customization.city,
  ownerPainPoint: demoProfile.customization.ownerPainPoint,
  primarySupplier: demoProfile.customization.primarySupplier,
};

export const monthlySummary = demoProfile.monthlySummary;
export const categories = demoProfile.categories.map((category) => category.category);
export const suppliers = demoProfile.suppliers;
export const supplierSpend = demoProfile.supplierSpend;
export const trackedItems = demoProfile.trackedItems;
export const priceChanges = demoProfile.priceChanges;
export const invoices = demoProfile.invoices;
export const extractedInvoice = demoProfile.extractedInvoice;
export const dashboardAlerts = demoProfile.dashboardAlerts;
export const recommendedActions = demoProfile.recommendedActions;
export const monthlyInsights = demoProfile.monthlyInsights;
export const reportCards = demoProfile.reportCards;
export const categorySpend = demoProfile.categories;
export const dailyReconciliation = demoProfile.dailyReconciliation;
