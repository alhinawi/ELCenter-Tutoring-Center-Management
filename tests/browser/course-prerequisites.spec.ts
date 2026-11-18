import { test, expect } from "@playwright/test";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "prereq-browser" } });
test("course detail saves visible prerequisite and blocks cyclic requirement", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.request.post("/api/auth/register", {
    data: {
      name: "Fictional Owner",
      email: "prereq-browser@example.invalid",
      password: "Test-only-browser-password-2026",
      organization: "Fictional Prerequisite Academy",
    },
  });
  const me = await (await page.request.get("/api/me")).json(),
    branch = (await (await page.request.get("/api/branches")).json()).data[0],
    courses: Record<string, string> = {};
  for (const [name, code] of [
    ["Foundation course", "FOUNDATION"],
    ["Advanced course", "ADVANCED"],
  ]) {
    const r = await page.request.post("/api/courses", {
      headers: { "x-csrf-token": me.user.csrf },
      data: { branch_id: branch.id, name, code },
    });
    expect(r.ok()).toBeTruthy();
    courses[name] = (await r.json()).id;
  }
  await page.goto("/");
  await page.getByRole("button", { name: "Courses", exact: true }).click();
  await page.getByRole("button", { name: /Advanced course.*ADVANCED/ }).click();
  await page
    .getByLabel("Required course", { exact: true })
    .selectOption(courses["Foundation course"]);
  await page
    .getByRole("button", { name: "Add prerequisite", exact: true })
    .click();
  await expect(
    page.getByText("Foundation course · FOUNDATION", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("heading", { name: "Course prerequisites", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/downloads/elcenter-course-prerequisites-desktop.png",
    fullPage: false,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: /Foundation course.*FOUNDATION/ })
    .click();
  await page
    .getByLabel("Required course", { exact: true })
    .selectOption(courses["Advanced course"]);
  await page
    .getByRole("button", { name: "Add prerequisite", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Course prerequisite rule failed",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page.getByRole("button", { name: /Advanced course.*ADVANCED/ }).click();
  await page
    .getByRole("heading", { name: "متطلبات الكورس", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/downloads/elcenter-course-prerequisites-ar-mobile.png",
    fullPage: false,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
