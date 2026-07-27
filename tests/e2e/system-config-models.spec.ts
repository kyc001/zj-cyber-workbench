import { expect, test } from "@playwright/test";

test("fetched provider models are shown by shared and agent selectors", async ({ page }) => {
  let savedPayload: {
    agents?: Record<string, { base_url?: string; api_key?: string; model?: string }>;
  } | null = null;

  await page.route("**/api/system-config/models", async (route) => {
    const request = route.request();
    const payload = request.postDataJSON() as { base_url?: string };
    const prefix = payload.base_url?.includes("agent-provider") ? "agent" : "shared";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: 200,
        message: "success",
        data: { models: [`${prefix}-model-a`, `${prefix}-model-b`] },
      }),
    });
  });
  await page.route("**/api/system-config/instance", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    savedPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 200, message: "配置已保存", data: null }),
    });
  });

  await page.goto("/system-config");

  const sharedSetup = page.locator(".provider-quick-setup");
  const sharedInputs = sharedSetup.locator("input");
  await sharedInputs.nth(0).fill("https://shared-provider.example/v1");
  await sharedInputs.nth(1).fill("shared-test-key");
  await sharedSetup.locator(".model-fetch-button").click();
  await expect(page.locator(".semi-toast").last()).toContainText("已拉取 2 个模型");

  await sharedSetup.locator(".semi-select").click();
  await expect(sharedSetup.locator(".semi-select")).toContainText("shared-model-a");
  await expect(page.locator(".semi-select-option")).toHaveCount(2);
  await expect(page.locator(".semi-select-option", { hasText: "shared-model-a" })).toBeVisible();
  await expect(page.locator(".semi-select-option", { hasText: "shared-model-b" })).toBeVisible();
  await page.keyboard.press("Escape");

  const headerSaveButton = page.getByRole("button", { name: "保存配置" });
  await expect(headerSaveButton).toBeEnabled();
  await headerSaveButton.click();
  await expect.poll(() => savedPayload).not.toBeNull();
  const savedAgents = Object.values(savedPayload?.agents ?? {});
  expect(savedAgents.length).toBeGreaterThan(0);
  expect(savedAgents.every((agent) => agent.model === "shared-model-a")).toBe(true);

  const firstAgent = page.locator(".agent-config-card").first();
  const agentInputs = firstAgent.locator("input");
  await agentInputs.nth(1).fill("https://agent-provider.example/v1");
  await agentInputs.nth(2).fill("agent-test-key");
  await firstAgent.locator(".model-fetch-button").click();
  await expect(page.locator(".semi-toast").last()).toContainText("拉取 2 个模型");

  await firstAgent.locator(".semi-select").click();
  await expect(firstAgent.locator(".semi-select")).toContainText("agent-model-a");
  await expect(page.locator(".semi-select-option")).toHaveCount(2);
  await expect(page.locator(".semi-select-option", { hasText: "agent-model-a" })).toBeVisible();
  await expect(page.locator(".semi-select-option", { hasText: "agent-model-b" })).toBeVisible();
});
