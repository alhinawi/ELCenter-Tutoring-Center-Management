import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "academic-export-browser" },
});
test("academic CSV exports all matching pages under current filters, with visible success in both languages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Export Owner",
          email: "academic-export-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Export Academy",
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
  const branch = (await api("/branches")).data[0].id;
  for (let i = 0; i < 26; i++)
    await api("/students", "POST", {
      name: "Fictional Export Learner " + String(i).padStart(2, "0"),
      code: "CSVUI-" + i,
      branch_id: branch,
      national_id: "PRIVATE-EXPORT-ID",
    });
  await api("/students", "POST", {
    name: "Unmatched learner",
    code: "UNMATCHED",
    branch_id: branch,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Students", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search records", exact: true })
    .fill("Fictional Export");
  await expect(
    page.getByRole("button", { name: /Fictional Export Learner 00/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Fictional Export Learner 25/ }),
  ).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const result = await download;
  await result.saveAs("/downloads/elcenter-academic-export.csv");
  const buffer = await readFile("/downloads/elcenter-academic-export.csv"),
    csv = buffer.toString("utf8");
  expect([...buffer.subarray(0, 3)]).toEqual([239, 187, 191]);
  expect(csv).toContain("Fictional Export Learner 25");
  expect(csv).not.toContain("Unmatched learner");
  expect(csv).not.toContain("PRIVATE-EXPORT-ID");
  expect(csv.trim().split("\r\n")).toHaveLength(27);
  await expect(page.getByRole("status")).toHaveText(
    "Exported 26 matching records.",
  );
  await page.screenshot({
    path: "/downloads/elcenter-academic-export-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("aside").evaluate((el) => el.getBoundingClientRect().left),
    )
    .toBeGreaterThanOrEqual(390);
  const arDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "تصدير", exact: true }).click();
  await arDownload;
  await expect(page.getByRole("status")).toHaveText("تم تصدير 26 سجل مطابق.");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/downloads/elcenter-academic-export-ar-mobile.png",
    fullPage: false,
  });
});
