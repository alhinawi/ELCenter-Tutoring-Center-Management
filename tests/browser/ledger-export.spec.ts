import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "full-ledger-browser" } });
test("complete scoped ledger CSV includes whole journals and all account summaries in both languages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "full-ledger-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Statement Academy",
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
  await api("/finance/initialize", "POST", { year: 2026 });
  const settings = await api("/finance/settings"),
    branch = (await api("/branches")).data[0].id,
    cash = settings.accounts.find((a: any) => a.system_key === "cash").id,
    equity = settings.accounts.find((a: any) => a.system_key === "equity").id;
  for (const [date, value] of [
    ["2026-10-31", 100],
    ["2026-11-01", -30],
    ["2026-11-02", 10],
    ["2026-11-15", 20],
  ] as const)
    await api("/finance/journals", "POST", {
      branch_id: branch,
      date,
      reference: "FICT-" + date,
      memo: "=Fictional spreadsheet-looking memo",
      lines: [
        {
          account: cash,
          debit: Math.max(value, 0),
          credit: Math.max(-value, 0),
        },
        {
          account: equity,
          debit: Math.max(-value, 0),
          credit: Math.max(value, 0),
        },
      ],
    });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Finance & payroll", exact: true })
    .click();
  await page.getByRole("button", { name: "Ledger", exact: true }).click();
  await page.getByLabel("From", { exact: true }).fill("2026-11-01");
  await page.getByLabel("To", { exact: true }).fill("2026-11-30");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByText("Page 1 · 3 journals", { exact: true }),
  ).toBeVisible();
  const wait = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Export complete scoped ledger CSV",
      exact: true,
    })
    .click();
  const file = await wait,
    text = readFileSync((await file.path())!, "utf8");
  expect(file.suggestedFilename()).toBe(
    "elcenter-complete-ledger-2026-11-01-2026-11-30.csv",
  );
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain('"ELCenter complete scoped ledger"');
  expect(text).toContain('"Total debit",60,"Total credit",60');
  expect(text).toContain('"Movements",6,"Accounts",2');
  expect(text).toContain('"Balanced","Yes"');
  expect(text).toContain('"\'=Fictional spreadsheet-looking memo"');
  expect(text).toContain('"Opening equity",-100,30,30,-100');
  expect(text).toContain('"Cash",100,30,30,100');
  const movements = text
    .split('"Complete period movements"\r\n')[1]
    .split('\r\n"Total debit"')[0]
    .split("\r\n");
  expect(movements).toHaveLength(7);
  await file.saveAs("/downloads/elcenter-complete-ledger.csv");
  await expect(page.getByRole("status")).toContainText(
    "Complete ledger prepared and audited: 6 movements · 2 accounts",
  );
  await page
    .getByRole("heading", { name: "Complete scoped ledger CSV", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/downloads/elcenter-complete-ledger-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "دفتر الحسابات الكامل للنطاق CSV",
      exact: true,
    }),
  ).toBeVisible();
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "تصدير الدفتر الكامل للنطاق CSV",
      exact: true,
    })
    .click();
  const f2 = await waiting,
    csv = readFileSync((await f2.path())!, "utf8");
  expect(csv).toContain('"Opening equity",-100,30,30,-100');
  await expect(page.getByRole("status")).toContainText(
    "تم تجهيز وتسجيل الدفتر الكامل: 6 حركة · 2 حساب",
  );
  await page.screenshot({
    path: "/downloads/elcenter-complete-ledger-ar-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
