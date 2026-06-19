// @ts-nocheck
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { PilotWorkspaceProvider } from "../src/lib/pilotWorkspace";
import { InvoiceUploadPage } from "../src/pages/InvoiceUploadPage";

function renderInvoiceUploadPage() {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/demo/cafe/invoices"] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: "/demo/:profile/invoices",
          element: createElement(PilotWorkspaceProvider, null, createElement(InvoiceUploadPage, null)),
        }),
      ),
    ),
  );
}

function testInvoiceUploadPageMobileSections() {
  const html = renderInvoiceUploadPage();
  assert.ok(html.includes("Invoice capture"));
  assert.ok(html.includes("Recent invoices"));
  assert.ok(html.includes("Recent price changes"));
  assert.ok(html.includes("sm:hidden"));
  assert.ok(html.includes("hidden sm:block"));
  assert.ok(html.includes("Open"));
}

testInvoiceUploadPageMobileSections();

console.log("invoice_upload_page_ui.test.tsx passed");
