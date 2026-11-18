import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "invoice-number-browser" },
});
test("numbering controls save and blank new invoice gets the configured number in both languages", async ({
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
          email: "invoice-number-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Sequence Academy",
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
  const branch = (await api("/branches")).data[0].id;
  await api("/students", "POST", {
    name: "Fictional Sequence Learner",
    code: "SEQ-S",
    branch_id: branch,
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Finance & payroll", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Finance settings", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "Use automatic invoice numbers",
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByRole("checkbox", {
      name: "Use automatic invoice numbers",
      exact: true,
    })
    .check();
  await page
    .getByLabel("Invoice number prefix", { exact: true })
    .fill("ACADEMY-");
  await page
    .getByLabel("Next invoice sequence number", { exact: true })
    .fill("42");
  await page
    .getByRole("button", { name: "Save numbering", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Numbering saved");
  await page.screenshot({
    path: "/downloads/elcenter-invoice-numbering-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Invoices", exact: true }).click();
  await page.getByRole("button", { name: "New record", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Student", exact: true })
    .selectOption({ label: "Fictional Sequence Learner" });
  await page
    .getByRole("textbox", { name: "Item description", exact: true })
    .fill("Fictional tuition");
  await page
    .getByRole("spinbutton", { name: "Unit price", exact: true })
    .fill("200");
  await expect(
    page.getByRole("textbox", { name: "Invoice number", exact: true }),
  ).toBeEmpty();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /ACADEMY-000042/ }),
  ).toBeVisible();
  expect((await api("/finance/numbering")).data.next_number).toBe(43);
  await page
    .getByRole("button", { name: "Finance settings", exact: true })
    .click();
  await expect(
    page.getByLabel("Next invoice sequence number", { exact: true }),
  ).toHaveValue("43");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(page.locator("aside")).not.toBeInViewport();
  await expect(
    page.getByRole("heading", { name: "ترقيم الفواتير", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-invoice-numbering-ar-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
