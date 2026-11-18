import { test, expect } from "@playwright/test";
test("calendar, attendance and assessment screens work in both languages", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore a private demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Headquarters overview" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Timetable & attendance", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Timetable & attendance", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();
  await expect(
    page.getByText("Conversation practice", { exact: false }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase3-calendar-en-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Attendance English · Evening A" })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Mariam Adel", { exact: true })).toBeVisible();
  await page.getByLabel("Student code or QR", { exact: true }).fill("ST-101");
  await page.getByRole("button", { name: "Mark", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Student marked present",
  );

  await page.screenshot({
    path: "/downloads/elcenter-phase3-attendance-en.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Exams & performance", exact: true })
    .click();
  await page.getByRole("button", { name: "Open exam", exact: true }).click();
  await expect(
    page.getByText("Choose the correct greeting.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase3-exam-en.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "الامتحانات والمستوى", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase3-exams-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "فتح القائمة" }).click();
  await page
    .getByRole("button", { name: "الجدول والحضور", exact: true })
    .click();
  await expect(page.getByRole("table").first()).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase3-calendar-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "الوضع الداكن", exact: true }).click();
  await page.screenshot({
    path: "/downloads/elcenter-phase3-calendar-ar-dark-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
