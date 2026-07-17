import { expect, test } from "@playwright/test";

test("D-group mock runtime works through Playground and survives reload", async ({ page, request }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/playground");
  await expect(page.locator(".admin-shell")).toBeVisible();

  const composer = page.locator(".composer textarea");
  await expect(composer).toBeEditable();
  await composer.fill("D-E2E: perform a read-only local nginx diagnostic.");
  await composer.press("Enter");

  await expect(page.locator("body")).toContainText("Observation: nginx is unavailable");

  const sessionsResponse = await request.get("/api/agent-sessions?limit=20");
  expect(sessionsResponse.ok()).toBeTruthy();
  const sessionsPayload = await sessionsResponse.json();
  expect(sessionsPayload.data.items.length).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator(".admin-shell")).toBeVisible();
  const persistedSession = page.locator(".session-row-main", {
    hasText: "D-E2E: perform a read-only local nginx diagnostic.",
  });
  await expect(persistedSession).toBeVisible();
  await persistedSession.click();
  await expect(page.locator("body")).toContainText("Observation: nginx is unavailable");
  expect(pageErrors).toEqual([]);
});
