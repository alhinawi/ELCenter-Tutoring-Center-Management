export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}
export type Env = {
  DB: Database;
  ENVIRONMENT?: string;
  DOCUMENT_ENCRYPTION_KEY?: string;
};
export const uid = () => crypto.randomUUID();
export const now = () => Math.floor(Date.now() / 1000);

export function searchPattern(input: string) {
  let value = "",
    bytes = 0;
  for (const char of input) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 46) break;
    value += char;
    bytes += size;
  }
  return value + "%";
}
