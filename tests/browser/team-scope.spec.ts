import { test, expect } from "@playwright/test";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "team-scope-browser" } });
test("branch-bound team viewer sees only branch contacts and no headquarters write controls", async ({
  page,
  browser,
}) => {
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Private Owner",
          email: "teamscope-owner-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Team Scope Academy",
        },
      })
    ).ok(),
  ).toBeTruthy();
  async function api(p: string, m = "GET", data?: any) {
    const me = (await (await page.request.get("/api/me")).json()).user;
    const r = await page.request.fetch("/api" + p, {
      method: m,
      headers: { "x-csrf-token": me.csrf },
      ...(data ? { data } : {}),
    });
    const j = await r.json();
    expect(r.ok(), JSON.stringify(j)).toBeTruthy();
    return j;
  }
  const branch = (await api("/branches")).data[0].id,
    b2 = (
      await api("/branches", "POST", {
        name: "Private Other Branch",
        code: "TEAMUI2",
        capacity: 100,
        status: "active",
      })
    ).id;
  const role = (
    await api("/roles", "POST", {
      name: "Scoped Team Observer",
      permissions: [
        "users:view",
        "users:create",
        "users:edit",
        "branches:view",
      ],
    })
  ).id;
  for (const [name, email, branch_id] of [
    [
      "Fictional Branch Observer",
      "teamscope-observer-browser@example.invalid",
      branch,
    ],
    [
      "Fictional Branch Colleague",
      "teamscope-colleague-browser@example.invalid",
      branch,
    ],
    ["Private Other Staff", "teamscope-other-browser@example.invalid", b2],
  ])
    await api("/users", "POST", {
      name,
      email,
      branch_id,
      password: "Testing-password-2026",
      role_id: role,
    });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "en-US",
    }),
    sp = await context.newPage();
  const errors: string[] = [];
  sp.on("pageerror", (e) => errors.push(e.message));
  expect(
    (
      await sp.request.post("/api/auth/login", {
        data: {
          email: "teamscope-observer-browser@example.invalid",
          password: "Testing-password-2026",
        },
      })
    ).ok(),
  ).toBeTruthy();
  await sp.goto("/");
  await sp.getByRole("button", { name: "Team & access", exact: true }).click();
  await expect(
    sp.getByText("Fictional Branch Colleague", { exact: true }),
  ).toBeVisible();
  await expect(
    sp.getByRole("main").getByText("Private Other Staff", { exact: true }),
  ).toHaveCount(0);
  await expect(
    sp.getByRole("main").getByText("Fictional Private Owner", { exact: true }),
  ).toHaveCount(0);
  await expect(
    sp.getByRole("button", { name: "Add user", exact: true }),
  ).toHaveCount(0);
  await expect(
    sp.getByRole("button", { name: "Suspend", exact: true }),
  ).toHaveCount(0);
  const list = await (await sp.request.get("/api/users")).json();
  expect(list.data).toHaveLength(2);
  expect(list.data.every((u: any) => u.branch_id === branch)).toBeTruthy();
  await sp.screenshot({
    path: "/downloads/elcenter-team-scope-desktop.png",
    fullPage: false,
  });
  await sp.setViewportSize({ width: 390, height: 844 });
  await sp.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(
    sp.getByText("Fictional Branch Colleague", { exact: true }),
  ).toBeVisible();
  expect(
    await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await expect
    .poll(() =>
      sp.locator("aside").evaluate((el) => el.getBoundingClientRect().left),
    )
    .toBeGreaterThanOrEqual(390);
  await sp.screenshot({
    path: "/downloads/elcenter-team-scope-ar-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await context.close();
});
