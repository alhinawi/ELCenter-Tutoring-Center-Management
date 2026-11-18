import { test, expect, type Page, type Locator } from "@playwright/test";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "modal-focus-browser" } });
async function trap(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
    .toBeTruthy();
  const items = dialog
    .locator("button,input,select,textarea,a[href],[tabindex]")
    .filter({ visible: true });
  const handles = await items.elementHandles();
  const usable = [];
  for (const h of handles)
    if (
      await h.evaluate(
        (el: any) =>
          el.tabIndex >= 0 &&
          !el.matches(":disabled") &&
          !el.closest('[inert],[hidden],[aria-hidden="true"]'),
      )
    )
      usable.push(h);
  expect(usable.length).toBeGreaterThan(0);
  await usable[0].focus();
  await page.keyboard.press("Shift+Tab");
  expect(
    await usable.at(-1)!.evaluate((el) => el === document.activeElement),
  ).toBeTruthy();
  await page.keyboard.press("Tab");
  expect(
    await usable[0].evaluate((el) => el === document.activeElement),
  ).toBeTruthy();
  for (let i = 0; i < usable.length + 2; i++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBeTruthy();
  }
}
test("modal families trap keyboard focus, close on Escape and restore the opener", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore a private demo", exact: true })
    .click();
  const cases = [
    ["Branches", "New branch"],
    ["Students", "Add record"],
    ["Finance & payroll", "New record"],
    ["People & admissions", "New record"],
    ["Timetable & attendance", "Attendance English · Evening A"],
  ];
  for (const [nav, button] of cases) {
    await page.getByRole("button", { name: nav, exact: true }).click();
    const opener = page
      .getByRole("button", { name: button, exact: true })
      .first();
    await opener.click();
    const dialog = page.getByRole("dialog").last();
    await trap(page, dialog);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
      "hidden",
    );
  }
  const global = page.getByRole("button", {
    name: "Global search",
    exact: true,
  });
  await global.click();
  await trap(page, page.getByRole("dialog"));
  await page
    .getByRole("button", { name: "Global search", exact: true })
    .evaluate((el: HTMLElement) => el.focus());
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.contains(document.activeElement)),
  ).toBeTruthy();
  await page.screenshot({
    path: "/downloads/elcenter-modal-keyboard-desktop.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await expect(global).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  const arabicOpener = page.getByRole("button", {
    name: "البحث الشامل",
    exact: true,
  });
  await arabicOpener.click();
  await trap(page, page.getByRole("dialog"));
  await page.screenshot({
    path: "/downloads/elcenter-modal-keyboard-ar-mobile.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await expect(arabicOpener).toBeFocused();
  expect(errors).toEqual([]);
});
test("nested support document dialog closes only the top layer and restores parent focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore a private demo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Resources & service", exact: true })
    .click();
  await page.getByRole("button", { name: "Support", exact: true }).click();
  await page
    .getByRole("button", { name: "New support ticket", exact: true })
    .click();
  await page.getByLabel("Branch", { exact: true }).selectOption({ index: 1 });
  await page
    .getByLabel("Subject", { exact: true })
    .fill("Fictional keyboard support");
  await page
    .getByLabel("Describe the issue", { exact: true })
    .fill("Fictional test ticket");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Open", exact: true }).last().click();
  const parent = page.getByRole("dialog");
  await expect(parent).toBeVisible();
  const upload = parent.getByRole("button", {
    name: "Upload document",
    exact: true,
  });
  await upload.click();
  await expect(page.getByRole("dialog")).toHaveCount(2);
  await trap(
    page,
    page.getByRole("dialog", { name: "Upload document", exact: true }),
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(upload).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(
    "hidden",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/downloads/elcenter-modal-keyboard-nested-mobile.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
});
