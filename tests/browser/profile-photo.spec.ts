import { test, expect } from "@playwright/test";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "profile-photo-browser" } });
test("private photo upload persists through reload and only its linked student reads it", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Owner",
          email: "profile-photo-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Photo Academy",
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
  const branch = (await api("/branches")).data[0].id,
    student = (
      await api("/students", "POST", {
        name: "Fictional Photo Learner",
        code: "PHOTO-ST",
        branch_id: branch,
      })
    ).id;
  await page.goto("/");
  await page.getByRole("button", { name: "Students", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Fictional Photo Learner PHOTO-ST",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Choose profile photo", { exact: true })
    .setInputFiles("public/images/study.jpg");
  await expect(page.getByRole("status")).toHaveText("Profile photo saved");
  await expect(
    page.getByAltText("Saved profile photo", { exact: true }),
  ).toBeVisible();
  expect(
    await page
      .getByAltText("Saved profile photo", { exact: true })
      .evaluate((el: HTMLImageElement) => el.naturalWidth > 0),
  ).toBeTruthy();
  await page.screenshot({
    path: "/downloads/elcenter-profile-photo-desktop.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: "Students", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Fictional Photo Learner PHOTO-ST",
      exact: true,
    })
    .click();
  await expect(
    page.getByAltText("Saved profile photo", { exact: true }),
  ).toBeVisible();
  const role = (await api("/roles")).data.find(
      (r: any) => r.system_key === "student",
    ).id,
    email = "photo-family-browser@example.invalid",
    password = "Testing-password-2026";
  await api("/users", "POST", {
    name: "Fictional Photo Learner",
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
  await expect(
    sp.getByAltText("صورة الملف المحفوظة", { exact: true }),
  ).toBeVisible();
  await expect(sp.getByLabel("اختار صورة الملف", { exact: true })).toHaveCount(
    0,
  );
  await sp.screenshot({
    path: "/downloads/elcenter-profile-photo-family-ar-mobile.png",
    fullPage: true,
  });
  expect(
    await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Remove profile photo", exact: true })
    .click();
  await expect(page.getByText("Photo removed", { exact: true })).toBeVisible();
  expect((await api("/profile-photos/students/" + student)).data).toBeNull();
  await sp.reload();
  await expect(
    sp.getByAltText("صورة الملف المحفوظة", { exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});
