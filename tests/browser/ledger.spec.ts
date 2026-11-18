import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { Temporal } from "@js-temporal/polyfill";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "ledger-pages-browser" } });
test("complete-journal ledger pages and explicitly page-only CSV work in both languages", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "ledger-pages-browser@example.invalid",
          password: "Test-only-password-2026",
          organization: "Fictional Ledger Academy",
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
  const today = Temporal.Now.plainDateISO("Africa/Cairo").toString();
  await api("/finance/initialize", "POST", { year: Number(today.slice(0, 4)) });
  const settings = await api("/finance/settings"),
    branch = (await api("/branches")).data[0].id,
    debit = settings.accounts.find((a: any) => a.system_key === "cash").id,
    credit = settings.accounts.find((a: any) => a.system_key === "equity").id;
  for (let i = 0; i < 27; i++)
    await api("/finance/journals", "POST", {
      branch_id: branch,
      date: today,
      reference: "FICT-" + String(i).padStart(2, "0"),
      memo: "=Fictional formula-looking note",
      lines: [
        { account: debit, debit: 100, credit: 0 },
        { account: credit, debit: 0, credit: 100 },
      ],
    });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Finance & payroll", exact: true })
    .click();
  await page.getByRole("button", { name: "Ledger", exact: true }).click();
  await expect(
    page.getByText("Page 1 · 25 journals", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(51);
  await expect(
    page.getByRole("button", { name: "Previous ledger page", exact: true }),
  ).toBeDisabled();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export this page CSV", exact: true })
    .click();
  const file = await download,
    local = await file.path();
  expect(file.suggestedFilename()).toContain("ledger-page-1");
  const csv = readFileSync(local!, "utf8");
  expect(csv).toContain('"\'=Fictional formula-looking note"');
  expect(csv.split("\r\n")).toHaveLength(51);
  await file.saveAs("/downloads/elcenter-ledger-page.csv");
  await page.screenshot({
    path: "/downloads/elcenter-ledger-page-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Next ledger page", exact: true })
    .click();
  await expect(
    page.getByText("Page 2 · 2 journals", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(5);
  await expect(
    page.getByRole("button", { name: "Next ledger page", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Previous ledger page", exact: true })
    .click();
  await expect(
    page.getByText("Page 1 · 25 journals", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("From", { exact: true }).fill("2020-01-01");
  await page.getByLabel("To", { exact: true }).fill("2020-12-31");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByText("Page 1 · 0 journals", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("From", { exact: true })
    .fill(today.slice(0, 4) + "-01-01");
  await page
    .getByLabel("To", { exact: true })
    .fill(today.slice(0, 4) + "-12-31");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByText("Page 1 · 25 journals", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Next ledger page", exact: true })
    .click();
  await expect(
    page.getByText("Page 2 · 2 journals", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(page.getByText("صفحة 2 · 2 قيد", { exact: true })).toBeVisible();
  await expect(page.locator("aside")).not.toBeInViewport();
  await page.screenshot({
    path: "/downloads/elcenter-ledger-page-ar-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
