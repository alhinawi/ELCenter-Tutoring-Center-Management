import { test, expect } from "@playwright/test";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "search-filter-browser" } });
test("global search selects modules, discloses extra matches and discards old results on edits, errors and races", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.request.post("/api/auth/register", {
    data: {
      name: "Fictional Owner",
      email: "search-filter-browser@example.invalid",
      password: "Testing-password-2026",
      organization: "Fictional Search Academy",
    },
  });
  const me = (await (await page.request.get("/api/me")).json()).user,
    b = (await (await page.request.get("/api/branches")).json()).data[0].id;
  for (let i = 0; i < 9; i++)
    expect(
      (
        await page.request.post("/api/students", {
          headers: { "x-csrf-token": me.csrf },
          data: {
            name: "Fictional Search Student " + i,
            code: "SFS-" + i,
            branch_id: b,
          },
        })
      ).ok(),
    ).toBeTruthy();
  expect(
    (
      await page.request.post("/api/teachers", {
        headers: { "x-csrf-token": me.csrf },
        data: { name: "Fictional Search Teacher", code: "SFT", branch_id: b },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await page
    .getByRole("button", { name: "Global search", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
      name: "Global search",
      exact: true,
    }),
    input = dialog.getByLabel("Search records", { exact: true }),
    module = dialog.getByLabel("Search module", { exact: true });
  await input.fill("Fictional Search");
  await module.selectOption("students");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog.locator("li")).toHaveCount(8);
  await expect(
    dialog.getByText("More than8 matches.", { exact: false }),
  ).toBeVisible();
  await dialog.screenshot({
    path: "/downloads/elcenter-global-search-filter-desktop.png",
    animations: "disabled",
  });
  await module.selectOption("teachers");
  await expect(dialog.locator("li")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog.locator("li")).toHaveCount(1);
  await expect(dialog.locator("li")).toContainText("Fictional Search Teacher");
  await input.fill("Fictional Search Student 8");
  await expect(dialog.locator("li")).toHaveCount(0);
  await module.selectOption("students");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog.locator("li")).toContainText(
    "Fictional Search Student 8",
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page.getByRole("button", { name: "البحث الشامل", exact: true }).click();
  const arabic = page.getByRole("dialog", {
      name: "البحث الشامل",
      exact: true,
    }),
    arInput = arabic.getByLabel("ابحث في السجلات", { exact: true });
  await arInput.fill("Fictional Search");
  await arabic.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(arabic.locator("li")).toHaveCount(8);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await arabic.screenshot({
    path: "/downloads/elcenter-global-search-filter-ar-mobile.png",
    animations: "disabled",
  });
  await page.route("**/api/search?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fictional search failed" }),
    }),
  );
  await arInput.fill("Fictional fail");
  await arabic.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(arabic.getByRole("alert")).toContainText(
    "Fictional search failed",
  );
  await expect(arabic.locator("li")).toHaveCount(0);
  await page.unroute("**/api/search?**");
  let releaseOld: (() => void) | undefined,
    seen = false;
  const gate = new Promise<void>((r) => (releaseOld = r));
  await page.route("**/api/search?**", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    if (q === "Old search") {
      seen = true;
      await gate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { students: [{ id: "old", label: "STALE SEARCH RESULT" }] },
          more: { students: false },
        }),
      });
    } else
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { students: [] },
          more: { students: false },
        }),
      });
  });
  await arInput.fill("Old search");
  await arabic.getByRole("button", { name: "بحث", exact: true }).click();
  await expect.poll(() => seen).toBeTruthy();
  await arInput.fill("New search");
  await arabic.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(arabic.getByText("مفيش نتائج", { exact: true })).toBeVisible();
  releaseOld!();
  await expect(
    arabic.getByText("STALE SEARCH RESULT", { exact: true }),
  ).toHaveCount(0);
});
