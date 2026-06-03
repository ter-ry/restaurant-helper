import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import "./styles.css";
import { DashboardPage } from "./pages/DashboardPage";
import { InvoiceUploadPage } from "./pages/InvoiceUploadPage";
import { ItemsPage } from "./pages/ItemsPage";
import { LandingPage } from "./pages/LandingPage";
import { PilotPage } from "./pages/PilotPage";
import { PriceChangesPage } from "./pages/PriceChangesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SuppliersPage } from "./pages/SuppliersPage";

const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> },
  { path: "/pilot", element: <PilotPage /> },
  {
    path: "/app",
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "upload", element: <InvoiceUploadPage /> },
      { path: "suppliers", element: <SuppliersPage /> },
      { path: "items", element: <ItemsPage /> },
      { path: "price-changes", element: <PriceChangesPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
