import { test, expect } from "@playwright/test";
import { totp, unbase32 } from "../../src/server/mfa";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "system-browser-test" } });
test("account security, global search and saved automation digests work end-to-end", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const password = "Test-only-browser-password-2026";
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "system-browser@example.invalid",
          password,
          organization: "Fictional Systems Academy",
        },
      })
    ).ok(),
  ).toBeTruthy();
  let me = await (await page.request.get("/api/me")).json();
  const branch = (await (await page.request.get("/api/branches")).json())
    .data[0];
  expect(
    (
      await page.request.post("/api/students", {
        headers: { "x-csrf-token": me.user.csrf },
        data: {
          name: "Samira Example",
          code: "SYS-BROWSE-1",
          branch_id: branch.id,
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Headquarters overview" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Global search", exact: true })
    .click();
  await page.getByLabel("Search records", { exact: true }).fill("Samira");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Samira Example", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase8-search-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Account security", exact: true })
    .click();
  await expect(page.getByText("This session", { exact: true })).toBeVisible();
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page
    .getByLabel("New password, at least 12 characters", { exact: true })
    .fill("Changed-test-browser-password-2026");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("Changed-test-browser-password-2026");
  await page
    .getByRole("button", {
      name: "Change password and revoke other sessions",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved successfully");
  await page
    .getByLabel("Password for authenticator change", { exact: true })
    .fill("Changed-test-browser-password-2026");
  await page
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  const seed = await page
    .getByLabel("Manual authenticator key", { exact: true })
    .inputValue();
  const code = await totp(unbase32(seed), Math.floor(Date.now() / 1000));
  await page
    .getByLabel("Confirm current password", { exact: true })
    .fill("Changed-test-browser-password-2026");
  await page
    .getByLabel("6-digit authenticator code", { exact: true })
    .fill(code);
  await page
    .getByRole("button", { name: "Confirm authenticator", exact: true })
    .click();
  await expect(
    page.getByText("Authenticator enabled.", { exact: false }),
  ).toBeVisible();
  const recovery = (await page.locator("pre").innerText()).split("\n")[0];
  await page
    .getByRole("button", { name: "I saved them. Hide codes.", exact: true })
    .click();
  expect(
    (
      await page.request.post("/api/auth/login", {
        data: {
          email: "system-browser@example.invalid",
          password: "Changed-test-browser-password-2026",
        },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.post("/api/auth/login", {
        data: {
          email: "system-browser@example.invalid",
          password: "Changed-test-browser-password-2026",
          otp: recovery,
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByRole("dialog").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({
    path: "/downloads/elcenter-phase8-security-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Resources & service", exact: true })
    .click();
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await page
    .getByLabel("Digest name", { exact: true })
    .fill("Daily academy report");
  await page
    .getByRole("button", { name: "Schedule digest", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Daily academy report", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Automation controls", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Run in-app reminders now", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved successfully");
  await page.screenshot({
    path: "/downloads/elcenter-phase8-automation-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Resources & service", exact: true })
    .click();
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(
    page.getByText("Groups / seats: 0 / 0", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase8-digest-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page.getByRole("button", { name: "أمان الحساب", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "أمان الحساب", exact: true }),
  ).toBeVisible();
  const bounds = await page.getByRole("dialog").boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await page.screenshot({
    path: "/downloads/elcenter-phase8-security-ar-mobile.png",
    fullPage: false,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
