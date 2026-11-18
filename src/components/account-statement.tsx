"use client";
import { useState } from "react";
import { Card, Field, Select, Button } from "./ui";
type Row = Record<string, any>;
type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
export function AccountStatementExport({
  api,
  ar,
  accounts,
  from,
  to,
}: {
  api: Api;
  ar: boolean;
  accounts: Row[];
  from: string;
  to: string;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Row | null>(null);
  return (
    <Card className="mb-5 p-5">
      <h2 className="font-semibold">
        {L("Account statement CSV", "كشف حساب CSV")}
      </h2>
      <p className="my-3 text-xs leading-6 text-slate-500">
        {L(
          "Uses the applied dates above and your current branch scope. Includes opening balance, every posted movement and running debit-minus-credit balance. Credit balances are negative. One database read captures this export; later or backdated entries require a new export. Maximum 5000 movements, never a partial statement. This is one account, not the complete ledger.",
          "بيستخدم التواريخ المطبقة فوق ونطاق فرعك الحالي. فيه الرصيد الافتتاحي وكل الحركات المرحلة والرصيد المتحرك مدين ناقص دائن. الرصيد الدائن سالب. قراءة واحدة بتاخد لقطة التصدير؛ القيود اللاحقة أو بأثر رجعي تحتاج تصدير جديد. أقصى حد 5000 حركة، من غير كشف جزئي. ده حساب واحد، مش الدفتر كله.",
        )}
      </p>
      <p className="mb-4 text-xs text-slate-500">
        {L("Applied range", "الفترة المطبقة")}:{" "}
        <bdi dir="ltr">
          {from} → {to}
        </bdi>
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const account = String(new FormData(e.currentTarget).get("account"));
          setBusy(true);
          setError("");
          setResult(null);
          try {
            const r = await api("/finance/account-statement", "POST", {
              account_id: account,
              from,
              to,
            });
            const cell = (v: unknown) => {
              if (typeof v === "number") return String(v);
              let s = String(v ?? "");
              if (/^(?:\s*[=+@\-]|[\t\r])/.test(s)) s = "'" + s;
              return '"' + s.replaceAll('"', '""') + '"';
            };
            const rows: unknown[][] = [
              ["ELCenter account statement"],
              ["Account", r.account.code, r.account.name],
              ["Currency", r.currency],
              ["From", r.from, "To", r.to],
              ["Branch", r.branch_id ?? "All permitted branches"],
              ["Generated UTC", new Date(r.generated_at * 1000).toISOString()],
              ["Balance basis", "Debit minus credit; negative = credit"],
              ["Opening", r.summary.opening],
              [
                "Date",
                "Journal",
                "Line",
                "Reference",
                "Memo",
                "Branch",
                "Source",
                "Reversal of",
                "Debit",
                "Credit",
                "Running balance",
              ],
              ...r.data.map((v: Row) => [
                v.date,
                v.journal_id,
                v.line_id,
                v.reference,
                v.memo,
                v.branch_id,
                v.source_type,
                v.reverse_of,
                v.debit,
                v.credit,
                v.running_balance,
              ]),
              [
                "Period debit",
                r.summary.debit,
                "Period credit",
                r.summary.credit,
              ],
              ["Closing", r.summary.closing],
              ["Movements", r.row_count],
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
              "elcenter-account-statement-" + from + "-" + to + ".csv";
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setResult(r);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={L("Statement account", "حساب الكشف")}>
          <Select name="account" required disabled={busy}>
            <option value="">{L("Choose account", "اختار الحساب")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button disabled={busy || !accounts.length} type="submit">
          {L("Export account statement CSV", "تصدير كشف الحساب CSV")}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
      {result && (
        <p role="status" className="mt-3 text-sm text-teal-700">
          {L("Export prepared and audited", "تم تجهيز وتسجيل التصدير")}:{" "}
          {result.row_count} {L("movements", "حركة")} ·{" "}
          {L("Opening", "افتتاحي")}{" "}
          <bdi dir="ltr">{result.summary.opening}</bdi> ·{" "}
          {L("Closing", "ختامي")}{" "}
          <bdi dir="ltr">
            {result.summary.closing} {result.currency}
          </bdi>
        </p>
      )}
    </Card>
  );
}
