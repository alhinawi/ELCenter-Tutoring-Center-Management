import { chromium } from "playwright";
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://localhost:3000");
  await page.getByRole("button", { name: "Explore a private demo" }).click();
  await page
    .getByRole("button", { name: "Finance & payroll", exact: true })
    .click();
  await page.getByRole("button", { name: /DEMO-/ }).click();
  await page
    .getByRole("button", { name: "Print invoice and receipts" })
    .click();
  await page.waitForTimeout(200);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  if (!frame) throw Error("Print frame missing");
  const html = await frame.content();
  const print = await browser.newPage();
  await print.setContent(html);
  await print.pdf({
    path: "/downloads/elcenter-phase4-invoice-print.pdf",
    format: "A4",
    printBackground: true,
  });
  await browser.close();
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
