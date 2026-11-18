import { DatabaseSync } from "node:sqlite";
import type { Database, Statement } from "../src/server/db";
export function sqliteDatabase(path = ":memory:") {
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
  class Stmt implements Statement {
    constructor(
      public sql: string,
      public values: unknown[] = [],
    ) {}
    bind(...values: unknown[]) {
      return new Stmt(this.sql, values);
    }
    async first<T>(column?: string) {
      const row = raw.prepare(this.sql).get(...(this.values as never[])) as
        Record<string, unknown> | undefined;
      return (row ? (column ? row[column] : row) : null) as T | null;
    }
    async all<T>() {
      return {
        results: raw.prepare(this.sql).all(...(this.values as never[])) as T[],
      };
    }
    async run() {
      return raw.prepare(this.sql).run(...(this.values as never[]));
    }
  }
  const db: Database = {
    prepare: (s) => new Stmt(s),
    batch: async (list) => {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const out = [];
        for (const x of list)
          out.push(
            x instanceof Stmt && /^\s*(SELECT|WITH)\b/i.test(x.sql)
              ? await x.all()
              : await x.run(),
          );
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { raw, db };
}
