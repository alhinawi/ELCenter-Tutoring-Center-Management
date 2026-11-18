import { test, expect } from "@playwright/test";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "branch-logo-browser" } });
test("private branch logos persist, refresh cards and respect view-only branch membership", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "branch-logo-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Branch Logo Center",
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
  const branch = (await api("/branches")).data[0];
  await api("/branches", "POST", {
    name: "Second Fictional Branch",
    code: "BLogo2",
    capacity: 100,
    status: "active",
  });
  const role = (
    await api("/roles", "POST", {
      name: "Branch logo observer",
      permissions: ["branches:view"],
    })
  ).id;
  await api("/users", "POST", {
    name: "Fictional observer",
    email: "branch-logo-observer@example.invalid",
    password: "Testing-password-2026",
    branch_id: branch.id,
    role_id: role,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Branches", exact: true }).click();
  await page
    .getByRole("button", { name: "Logo " + branch.name, exact: true })
    .click();
  await page
    .getByLabel("Choose branch logo", { exact: true })
    .setInputFiles("public/images/study.jpg");
  await expect(page.getByRole("status")).toHaveText("Branch logo saved");
  const image = page.getByAltText("Saved branch logo", { exact: true });
  await expect(image).toBeVisible();
  expect(
    await image.evaluate(
      (i: HTMLImageElement) =>
        i.naturalWidth > 0 && i.naturalWidth <= 384 && i.naturalHeight <= 384,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByAltText("Branch logo", { exact: true })).toHaveCount(
    1,
  );
  await page.screenshot({
    path: "/downloads/elcenter-branch-logos-desktop.png",
    fullPage: false,
  });
  await page.reload();
  await page.getByRole("button", { name: "Branches", exact: true }).click();
  await expect(page.getByAltText("Branch logo", { exact: true })).toBeVisible();
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "ar-EG",
    }),
    sp = await context.newPage();
  await sp.request.post("/api/auth/login", {
    data: {
      email: "branch-logo-observer@example.invalid",
      password: "Testing-password-2026",
    },
  });
  await sp.goto("/");
  await sp.getByRole("button", { name: "فتح القائمة", exact: true }).click();
  await sp.getByRole("button", { name: "الفروع", exact: true }).click();
  await expect(sp.getByAltText("شعار الفرع", { exact: true })).toBeVisible();
  await expect(
    sp.getByText("Second Fictional Branch", { exact: true }),
  ).toHaveCount(0);
  await sp
    .getByRole("button", { name: "الشعار " + branch.name, exact: true })
    .click();
  await expect(
    sp.getByAltText("شعار الفرع المحفوظ", { exact: true }),
  ).toBeVisible();
  await expect(sp.getByLabel("اختار شعار الفرع", { exact: true })).toHaveCount(
    0,
  );
  expect(
    await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await sp.screenshot({
    path: "/downloads/elcenter-branch-logo-observer-ar-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Logo " + branch.name, exact: true })
    .click();
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Remove branch logo", exact: true })
    .click();
  await expect(image).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Remove branch logo", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Branch logo removed");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByAltText("Branch logo", { exact: true })).toHaveCount(
    0,
  );
  await sp.reload();
  await sp.getByRole("button", { name: "فتح القائمة", exact: true }).click();
  await sp.getByRole("button", { name: "الفروع", exact: true }).click();
  await expect(sp.getByAltText("شعار الفرع", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});
