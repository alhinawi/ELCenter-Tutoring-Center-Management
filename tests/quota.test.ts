import { test } from "node:test";
import assert from "node:assert/strict";
import app from "../src/server/app";
import { searchPattern } from "../src/server/db";
test("daily D1 quota failure returns a clear localized service-busy response", async () => {
  for (const lang of ["ar", "en"]) {
    const r = await app.request(
      "http://localhost/api/me",
      {
        headers: { cookie: "elcenter_session=test-token", "x-el-locale": lang },
      },
      {
        DB: {
          prepare() {
            throw new Error("D1_ERROR 7500 daily rows read limit reached");
          },
          async batch() {
            return [];
          },
        },
        ENVIRONMENT: "test",
      },
    );
    const j: any = await r.json();
    assert.equal(r.status, 503);
    assert.equal(j.code, "SERVICE_BUSY");
    assert.equal(r.headers.get("retry-after"), "300");
    assert.ok(
      lang === "ar" ? j.error.includes("الخدمة") : j.error.includes("Service"),
    );
  }
});
test("prefix search respects the current D1 byte limit even with Arabic input", () => {
  const pattern = searchPattern("مدرسة".repeat(40));
  assert.ok(new TextEncoder().encode(pattern).length <= 50);
  assert.ok(!pattern.startsWith("%"));
  assert.ok(pattern.endsWith("%"));
});
