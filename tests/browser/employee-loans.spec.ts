import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "employee-loans-browser" },
});
test("employee loan draft, independent review, recording and recovery persist in desktop and Arabic mobile", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const register = await page.request.post("/api/auth/register", {
    data: {
      name: "Fictional Owner",
      email: "loan-browser@example.invalid",
      password: "Testing-password-2026",
      organization: "Fictional Employee Academy",
    },
  });
  expect(register.ok()).toBeTruthy();
  async function api(p: string, m = "GET", data?: any, request = page.request) {
    const me = (await (await request.get("/api/me")).json()).user;
    const r = await request.fetch("/api" + p, {
      method: m,
      headers: { "x-csrf-token": me.csrf },
      ...(data ? { data } : {}),
    });
    const j = await r.json();
    expect(r.ok(), JSON.stringify(j)).toBeTruthy();
    return j;
  }
  const branch = (await api("/branches")).data[0].id,
    today = (await api("/employee-loans/options")).today;
  await api("/finance/initialize", "POST", { year: Number(today.slice(0, 4)) });
  const account = (
    await api("/finance/accounts", "POST", {
      code: "1199",
      name: "Employee receivables",
      kind: "asset",
    })
  ).id;
  await api("/operations/employees", "POST", {
    name: "موظف تجريبي / Fictional Coordinator",
    code: "EMP-UI",
    branch_id: branch,
    job_title: "Coordinator",
    hired_on: "2026-01-01",
    status: "active",
  });
  const role = (await api("/roles")).data.find(
    (r: any) => r.name === "Business Owner",
  ).id;
  const contexts = [];
  for (const [i, email] of [
    "loan-ui-review@example.invalid",
    "loan-ui-pay@example.invalid",
  ].entries()) {
    await api("/users", "POST", {
      name: "Fictional Finance " + i,
      email,
      password: "Testing-password-2026",
      role_id: role,
      branch_id: null,
    });
    const c = await browser.newContext();
    expect(
      (
        await c.request.post("http://127.0.0.1:3000/api/auth/login", {
          data: { email, password: "Testing-password-2026" },
        })
      ).ok(),
    ).toBeTruthy();
    contexts.push(c);
  }
  await page.goto("/");
  await page
    .getByRole("button", { name: "Finance & payroll", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Employee loans", exact: true })
    .click();
  await page
    .getByRole("button", { name: "New employee loan / advance", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Employee", exact: true })
    .selectOption({ label: "موظف تجريبي / Fictional Coordinator · EMP-UI" });
  await page.getByLabel("Principal", { exact: true }).fill("2400");
  await page
    .getByRole("combobox", { name: "Receivable asset account", exact: true })
    .selectOption(account);
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Fictional interest-free staff advance");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /Saved/ }),
  ).toContainText("Saved");
  const list = (await api("/employee-loans")).data;
  expect(list).toHaveLength(1);
  const id = list[0].id;
  await page
    .getByRole("button", { name: /Fictional Coordinator.*Draft/ })
    .click();
  await page
    .getByRole("button", { name: "Approve request", exact: true })
    .click();
  await page
    .getByLabel("Decision note", { exact: true })
    .fill("Creator must not approve");
  await page
    .getByRole("button", { name: "Confirm recorded operation", exact: true })
    .click();
  await expect(page.locator("p[role=alert]")).toContainText(
    "different finance user",
  );
  await api(
    "/employee-loans/" + id + "/decision",
    "POST",
    { decision: "approved", note: "Independent review" },
    contexts[0].request,
  );
  await api(
    "/employee-loans/" + id + "/disburse",
    "POST",
    { date: today, method: "bank" },
    contexts[1].request,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Finance & payroll", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Employee loans", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Fictional Coordinator.*Disbursed/ })
    .click();
  await page
    .getByRole("button", { name: "Record recovery", exact: true })
    .click();
  await page.getByLabel("Recovery amount", { exact: true }).fill("600");
  await page
    .getByLabel("Recovery reference", { exact: true })
    .fill("Fictional manual bank recovery");
  await page
    .getByRole("button", { name: "Confirm recorded operation", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /Saved/ }),
  ).toContainText("Saved");
  await expect(
    page.locator("p").filter({ hasText: /Outstanding:.*1,800 EGP/ }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-employee-loans-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "قروض وسلف الموظفين", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("p").filter({ hasText: /المتبقي:.*1,800 EGP/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/downloads/elcenter-employee-loans-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  for (const c of contexts) await c.close();
});
