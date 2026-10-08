import demoWorkflow from "../../.github/workflows/demo-keep-alive.yml?raw";
import productionWorkflow from "../../.github/workflows/production-keep-alive.yml?raw";
import productionDocumentation from "../../docs/production-keep-alive.md?raw";

describe("backend keep-alive workflows", () => {
  const productionHealthUrl = "https://flowtally-api-production.onrender.com/api/health";

  it("keeps the Production target and guard separate from the demo workflow", () => {
    expect(productionWorkflow).toContain(`PRODUCTION_HEALTH_URL: ${productionHealthUrl}`);
    expect(productionWorkflow).toContain("github.event_name == 'schedule' && vars.PRODUCTION_KEEP_ALIVE_ENABLED == 'true'");
    expect(productionWorkflow).not.toContain("DEMO_KEEP_ALIVE_ENABLED");
    expect(demoWorkflow).toContain("DEMO_KEEP_ALIVE_ENABLED");
    expect(demoWorkflow).not.toContain("PRODUCTION_KEEP_ALIVE_ENABLED");
  });

  it("only performs bounded health GETs and keeps warm-up one-time", () => {
    expect(productionWorkflow.match(new RegExp(productionHealthUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);
    expect(productionWorkflow).toContain('echo "GET ${PRODUCTION_HEALTH_URL}"');
    expect(productionWorkflow).toContain('echo "One-time warm-up: GET ${PRODUCTION_HEALTH_URL}"');
    expect(productionWorkflow).toContain("github.event_name == 'workflow_dispatch' && inputs.action == 'warm-up'");
    expect(productionWorkflow).toContain("This did not enable recurring traffic.");
    expect(productionWorkflow).not.toMatch(/\b(POST|PUT|PATCH|DELETE)\b/);
    expect(productionWorkflow).not.toMatch(/\/api\/(?!health\b)[^\s"']+/);
  });

  it("documents the exact variable and manual warm-up steps", () => {
    expect(productionDocumentation).toContain("Settings → Secrets and variables → Actions → Variables");
    expect(productionDocumentation).toContain("PRODUCTION_KEEP_ALIVE_ENABLED");
    expect(productionDocumentation).toContain("value `true`");
    expect(productionDocumentation).toContain("value `false`");
    expect(productionDocumentation).toContain("Actions → Production backend keep-alive → Run workflow");
    expect(productionDocumentation).toContain("Choose `warm-up`");
    expect(productionDocumentation).toContain(productionHealthUrl);
  });
});
