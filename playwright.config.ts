import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:3000" },
  webServer: {
    command:
      "DOCUMENT_ENCRYPTION_KEY=test-only-browser-document-key-2026 ELCENTER_PREVIEW_DB=:memory: npx tsx scripts/preview.ts",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
  },
});
