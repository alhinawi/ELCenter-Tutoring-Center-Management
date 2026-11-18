"use client";
import { useState } from "react";
import { Card, Button } from "./ui";
type Row = Record<string, any>;
type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
export function CompleteLedgerExport({
  api,
  ar,
  from,
  to,
}: {
  api: Api;
  ar: boolean;
  from: string;
  to: string;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <Card className="mb-5 p-5">
      <h2 className="font-semibold">
        {L("Complete scoped ledger CSV", "دفتر الحسابات الكامل للنطاق CSV")}
      </h2>
      <p className="my-3 text-xs leading-6 text-slate-500">
        {L(
          "Every posted journal and all its lines in the applied range and current membership branch scope, plus account opening/closing balances and per-account running balances. Accounts with posted history through the end date are included, even without period movements. Never just the visible page. One financial database read; a fresh export is needed after later/backdated entries. Maximum 5000 statement rows, counting one row for a history-only account. Larger requests are rejected, never partially exported. Not a signed or retained archive.",
          "كل القيود المرحلة بكل سطورها في الفترة المطبقة ونطاق فرع العضوية، مع الأرصدة الافتتاحية والختامية والرصيد المتحرك لكل حساب. بيشمل الحسابات اللي ليها سجل مرحل لحد نهاية الفترة حتى من غير حركة فيها. مش الصفحة الظاهرة بس. قراءة مالية واحدة؛ القيود الجديدة أو بأثر رجعي تحتاج تصدير جديد. أقصى حد 5000 صف كشف، والحساب اللي ليه تاريخ بس بيحسب صف واحد. الطلب الكبير بيترفض، مش بيتصدر جزئياً. مش أرشيف موقع أو محفوظ.",
        )}
      </p>
      <p className="mb-4 text-xs text-slate-500">
        {L("Applied range", "الفترة المطبقة")}:{" "}
        <bdi dir="ltr">
          {from} → {to}
        </bdi>
      </p>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          setNotice("");
          try {
            const r = await api("/finance/ledger-export", "POST", { from, to });
            const cell = (v: unknown) => {
              if (typeof v === "number") return String(v);
              let s = String(v ?? "");
              if (/^(?:\s*[=+@\-]|[\t\r])/.test(s)) s = "'" + s;
              return '"' + s.replaceAll('"', '""') + '"';
            };
            const rows: unknown[][] = [
              ["ELCenter complete scoped ledger"],
              ["Currency", r.currency],
              ["From", r.from, "To", r.to],
              ["Branch", r.branch_id ?? "All permitted branches"],
              ["Generated UTC", new Date(r.generated_at * 1000).toISOString()],
              ["Balance basis", "Debit minus credit; negative = credit"],
              ["Account summaries"],
              [
                "Account ID",
                "Code",
                "Name",
                "Opening",
                "Period debit",
                "Period credit",
                "Closing",
              ],
              ...r.accounts.map((v: Row) => [
                v.id,
                v.code,
                v.name,
                v.opening,
                v.debit,
                v.credit,
                v.closing,
              ]),
              ["Complete period movements"],
              [
                "Date",
                "Journal",
                "Line",
                "Reference",
                "Memo",
                "Branch",
                "Account ID",
                "Code",
                "Name",
                "Source",
                "Reversal of",
                "Debit",
                "Credit",
                "Account running balance",
              ],
              ...r.data.map((v: Row) => [
                v.date,
                v.journal_id,
                v.line_id,
                v.reference,
                v.memo,
                v.branch_id,
                v.account_id,
                v.code,
                v.account_name,
                v.source_type,
                v.reverse_of,
                v.debit,
                v.credit,
                v.running_balance,
              ]),
              [
                "Total debit",
                r.summary.debit,
                "Total credit",
                r.summary.credit,
              ],
              ["Balanced", r.summary.debit === r.summary.credit ? "Yes" : "No"],
              ["Movements", r.row_count, "Accounts", r.account_count],
            ];
            const url = URL.createObjectURL(
              new Blob(
                [
                  "\uFEFF" +
                    rows.map((v) => v.map(cell).join(",")).join("\r\n"),
                ],
                { type: "text/csv;charset=utf-8" },
              ),
            );
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download =
              "elcenter-complete-ledger-" + from + "-" + to + ".csv";
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setNotice(
              L(
                "Complete ledger prepared and audited",
                "تم تجهيز وتسجيل الدفتر الكامل",
              ) +
                ": " +
                r.row_count +
                " " +
                L("movements", "حركة") +
                " · " +
                r.account_count +
                " " +
                L("accounts", "حساب"),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {L(
          "Export complete scoped ledger CSV",
          "تصدير الدفتر الكامل للنطاق CSV",
        )}
      </Button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-teal-700">
          {notice}
        </p>
      )}
    </Card>
  );
}
