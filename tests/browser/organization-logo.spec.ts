import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "organization-logo-browser" },
});
test("organization logo upload persists and reaches the authenticated family without edit controls", async ({
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
          email: "organization-logo-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Logo Academy",
        },
      })
    ).ok(),
  ).toBeTruthy();
  async function api(path: string, method = "GET", data?: any) {
    const me = (await (await page.request.get("/api/me")).json()).user;
    const r = await page.request.fetch("/api" + path, {
      method,
      headers: { "x-csrf-token": me.csrf },
      ...(data ? { data } : {}),
    });
    const j = await r.json();
    expect(r.ok(), JSON.stringify(j)).toBeTruthy();
    return j;
  }
  await page.goto("/");
  await expect(
    page.getByAltText("Organization logo", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  await page
    .getByLabel("Choose organization logo", { exact: true })
    .setInputFiles("public/images/study.jpg");
  await expect(page.getByRole("status")).toHaveText("Organization logo saved");
  await expect(
    page.getByAltText("Saved organization logo", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("banner").getByAltText("Organization logo", { exact: true }),
  ).toBeVisible();
  expect(
    await page
      .getByAltText("Saved organization logo", { exact: true })
      .evaluate(
        (img: HTMLImageElement) =>
          img.naturalWidth > 0 &&
          img.naturalWidth <= 384 &&
          img.naturalHeight <= 384,
      ),
  ).toBeTruthy();
  const data = (await api("/portal/organization-logo")).data;
  expect(data.mime).toBe("image/jpeg");
  expect(Buffer.from(data.data, "base64").byteLength).toBeLessThanOrEqual(
    32768,
  );
  await page
    .getByLabel("Choose organization logo", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/downloads/elcenter-organization-logo-desktop.png",
    fullPage: false,
  });
  await page.reload();
  await expect(
    page.getByRole("banner").getByAltText("Organization logo", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  await expect(
    page.getByAltText("Saved organization logo", { exact: true }),
  ).toBeVisible();
  const branch = (await api("/branches")).data[0].id,
    student = (
      await api("/students", "POST", {
        name: "Fictional Logo Learner",
        code: "LOGO-ST",
        branch_id: branch,
      })
    ).id,
    role = (await api("/roles")).data.find(
      (r: any) => r.system_key === "student",
    ).id,
    email = "logo-family-browser@example.invalid",
    password = "Testing-password-2026";
  await api("/users", "POST", {
    name: "Fictional Logo Learner",
    email,
    password,
    role_id: role,
    branch_id: branch,
  });
  const user = (await api("/users")).data.find(
    (r: any) => r.email === email,
  ).user_id;
  await api("/portal-links", "POST", {
    user_id: user,
    kind: "student",
    profile_id: student,
  });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "ar-EG",
    }),
    sp = await context.newPage();
  await sp.request.post("/api/auth/login", { data: { email, password } });
  await sp.goto("/");
  await expect(sp.getByAltText("شعار المؤسسة", { exact: true })).toBeVisible();
  await expect(
    sp.getByLabel("اختار شعار المؤسسة", { exact: true }),
  ).toHaveCount(0);
  await sp.screenshot({
    path: "/downloads/elcenter-organization-logo-family-ar-mobile.png",
    fullPage: true,
  });
  expect(
    await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Remove organization logo", exact: true })
    .click();
  await expect(
    page.getByAltText("Saved organization logo", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Remove organization logo", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Organization logo removed",
  );
  await expect(
    page.getByAltText("Saved organization logo", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("banner").getByAltText("Organization logo", { exact: true }),
  ).toHaveCount(0);
  await sp.reload();
  await expect(sp.getByAltText("شعار المؤسسة", { exact: true })).toHaveCount(0);
  await context.close();
  expect(errors).toEqual([]);
});
