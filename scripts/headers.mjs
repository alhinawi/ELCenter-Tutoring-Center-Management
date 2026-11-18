import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
const hashes = new Set();
function walk(p) {
  for (const x of readdirSync(p, { withFileTypes: true })) {
    const f = join(p, x.name);
    if (x.isDirectory()) walk(f);
    else if (f.endsWith(".html")) {
      const h = readFileSync(f, "utf8");
      for (const m of h.matchAll(
        /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g,
      ))
        hashes.add(
          `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
        );
    }
  }
}
walk("out");
writeFileSync(
  "out/_headers",
  `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(self), microphone=(), geolocation=()\n  Content-Security-Policy: default-src 'self'; script-src 'self' ${[...hashes].join(" ")}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'\n`,
);
