"use client";
import { useState, useEffect } from "react";
import { Card, Button, Input, Select, Field } from "./ui";
type Row = Record<string, any>;
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
export function FinancialStatements({
  data,
  ar,
  money,
}: {
  data: Row;
  ar: boolean;
  money: (n: number) => string;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    b = data.balance_sheet,
    c = data.cash_flow;
  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="font-semibold">
          {L("Balance sheet", "الميزانية العمومية")} · {b.as_of}
        </h2>
        {[
          [L("Assets", "الأصول"), b.assets],
          [L("Liabilities", "الالتزامات"), b.liabilities],
          [L("Equity", "حقوق الملكية"), b.equity],
          [L("Retained earnings", "الأرباح المحتجزة"), b.retained_earnings],
        ].map(([k, v]) => (
          <div
            key={String(k)}
            className="mt-5 flex justify-between gap-2 text-sm"
          >
            <span>{k}</span>
            <span dir="ltr">{money(Number(v))}</span>
          </div>
        ))}
        <p className="mt-6 text-xs text-teal-600">
          {b.balanced
            ? L(
                "Assets = liabilities + equity + retained earnings",
                "الأصول = الالتزامات + الملكية + الأرباح",
              )
            : L("Out of balance", "الميزانية مش متوازنة")}
        </p>
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold">{L("Cash movement", "حركة النقدية")}</h2>
        <p className="mt-2 text-xs text-slate-400">
          {L(
            "Cash and bank. Recorded movements, not bank connectivity.",
            "الكاش والبنك. حركات مسجّلة، مش ربط بنكي.",
          )}
        </p>
        {[
          [L("Opening", "افتتاحي"), c.opening],
          ...c.sources.map((s: Row) => [s.source, s.movement]),
          [L("Closing", "ختامي"), c.closing],
        ].map(([k, v], i) => (
          <div key={i} className="mt-4 flex justify-between gap-3 text-sm">
            <span>{k}</span>
            <span dir="ltr">{money(Number(v))}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
export function InstallmentPlan({
  detail,
  ar,
  api,
  reload,
  money,
  editable,
}: {
  detail: Row;
  ar: boolean;
  api: Api;
  reload: () => Promise<void>;
  money: (n: number) => string;
  editable: boolean;
}) {
  const L = (e: string, a: string) => (ar ? a : e);
  const [lines, setLines] = useState<Row[]>(
      detail.installments?.length
        ? detail.installments.map((x: Row) => ({
            due_date: x.due_date,
            amount: x.amount,
          }))
        : [{ due_date: detail.data.due_date, amount: detail.data.total }],
    ),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  let allocated = detail.paid;
  return (
    <section className="my-6 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h3 className="mb-4 font-semibold">
        {L("Installment plan", "خطة الأقساط")}
      </h3>
      {editable ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api(`/invoices/${detail.data.id}/installments`, "PUT", {
                installments: lines,
              });
              await reload();
              setErr("");
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          className="grid gap-3"
        >
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <Input
                type="date"
                aria-label={L("Installment due", "ميعاد القسط")}
                value={l.due_date}
                min={detail.data.date}
                max={detail.data.due_date}
                required
                onChange={(e) =>
                  setLines(
                    lines.map((r, j) =>
                      i === j ? { ...r, due_date: e.target.value } : r,
                    ),
                  )
                }
              />
              <Input
                type="number"
                aria-label={L("Installment amount", "مبلغ القسط")}
                value={l.amount}
                min={1}
                required
                onChange={(e) =>
                  setLines(
                    lines.map((r, j) =>
                      i === j ? { ...r, amount: Number(e.target.value) } : r,
                    ),
                  )
                }
              />
              <button
                type="button"
                disabled={lines.length === 1}
                aria-label={L("Remove installment", "حذف القسط")}
                onClick={() => setLines(lines.filter((_, j) => i !== j))}
              >
                ×
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="bg-slate-600"
              disabled={lines.length >= 36}
              onClick={() =>
                setLines([
                  ...lines,
                  { due_date: detail.data.due_date, amount: 0 },
                ])
              }
            >
              {L("Add installment", "إضافة قسط")}
            </Button>
            <Button type="submit" disabled={busy}>
              {L("Save plan", "حفظ الخطة")}
            </Button>
          </div>
          <p className="text-xs text-slate-400">
            {L(
              "Installments must add up to the invoice total. Receipts are allocated oldest due date first.",
              "مجموع الأقساط لازم يساوي إجمالي الفاتورة. التحصيل بيتوزع على الأقدم الأول.",
            )}
          </p>
          {err && (
            <p role="alert" className="text-xs text-red-600">
              {err}
            </p>
          )}
        </form>
      ) : detail.installments?.length ? (
        detail.installments.map((l: Row) => {
          const paid = Math.max(0, Math.min(l.amount, allocated));
          allocated -= paid;
          return (
            <div key={l.id} className="mb-3 flex justify-between gap-3 text-sm">
              <span>{l.due_date}</span>
              <span dir="ltr">
                {money(paid)} / {money(l.amount)}
              </span>
            </div>
          );
        })
      ) : (
        <p className="text-xs text-slate-400">
          {L("Single balance due", "الرصيد مستحق دفعة واحدة")} ·{" "}
          {detail.data.due_date}
        </p>
      )}
    </section>
  );
}
export function Reconciliation({
  api,
  ar,
  options,
  settings,
  money,
  today,
  canApprove,
}: {
  api: Api;
  ar: boolean;
  options: Record<string, Row[]>;
  settings: Row | null;
  money: (n: number) => string;
  today: string;
  canApprove: boolean;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [branch, setBranch] = useState(""),
    [account, setAccount] = useState(""),
    [data, setData] = useState<Row | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [err, setErr] = useState(""),
    [v, setV] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api(`/finance/reconciliation?branch_id=${branch}&account_id=${account}`)
      .then((x) => {
        if (active) {
          setData(x);
          setSelected([]);
        }
      })
      .catch((e) => setErr(e.message));
    return () => {
      active = false;
    };
  }, [branch, account, v]);
  return (
    <div className="grid gap-5">
      <Card className="p-5">
        <h2 className="mb-4 font-semibold">
          {L("Account reconciliation", "مطابقة الحسابات")}
        </h2>
        <p className="mb-5 text-xs text-slate-400">
          {L(
            "Select cleared ledger lines from your statement. One statement can include up to 90 lines; use multiple reconciliations for larger statements.",
            "اختار حركات الدفتر اللي ظهرت في كشف الحساب. المطابقة بتشمل لحد ٩٠ حركة؛ قسم الكشوف الكبيرة.",
          )}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={L("Branch", "الفرع")}>
            <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">—</option>
              {options.branches?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={L("Cash / bank", "الكاش / البنك")}>
            <Select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">—</option>
              {settings?.accounts
                .filter((a: Row) => ["cash", "bank"].includes(a.system_key))
                .map((a: Row) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        {data?.data.map((l: Row) => (
          <label
            key={l.id}
            className="mt-3 flex items-center gap-3 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800"
          >
            <input
              type="checkbox"
              checked={selected.includes(l.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, l.id]
                    : selected.filter((id) => id !== l.id),
                )
              }
            />
            <span className="flex-1">
              {l.date} · {l.reference}
            </span>
            <span dir="ltr">{money(l.debit - l.credit)}</span>
          </label>
        ))}
        {!!selected.length && canApprove && (
          <form
            className="mt-6 grid gap-3 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const d = Object.fromEntries(new FormData(e.currentTarget));
                await api("/finance/reconciliation", "POST", {
                  ...d,
                  branch_id: branch,
                  account_id: account,
                  opening_balance: Number(d.opening_balance),
                  closing_balance: Number(d.closing_balance),
                  line_ids: selected,
                });
                setV(v + 1);
                setErr("");
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label={L("Statement date", "تاريخ الكشف")}>
              <Input
                type="date"
                name="statement_date"
                defaultValue={today}
                required
              />
            </Field>
            <Field label={L("Statement reference", "مرجع الكشف")}>
              <Input name="reference" required />
            </Field>
            <Field
              label={L("Statement opening balance", "الرصيد الافتتاحي للكشف")}
            >
              <Input
                type="number"
                name="opening_balance"
                defaultValue={0}
                required
              />
            </Field>
            <Field
              label={L("Statement closing balance", "الرصيد الختامي للكشف")}
            >
              <Input type="number" name="closing_balance" required />
            </Field>
            <p className="text-xs text-slate-400 sm:col-span-2">
              {L("Selected net movement", "صافي الحركات المختارة")}:{" "}
              {money(
                data?.data
                  .filter((l: Row) => selected.includes(l.id))
                  .reduce((n: number, l: Row) => n + l.debit - l.credit, 0) ||
                  0,
              )}
            </p>
            <Button disabled={busy || selected.length > 90}>
              {L("Finalize matching statement", "اعتماد المطابقة")}
            </Button>
          </form>
        )}
        {err && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {err}
          </p>
        )}
      </Card>
      <Card className="p-5">
        <h2 className="mb-4 font-semibold">
          {L("Statement history", "سجل المطابقات")}
        </h2>
        {data?.history.map((r: Row) => (
          <div
            key={r.id}
            className="mb-3 rounded-xl bg-slate-50 p-4 text-xs dark:bg-slate-800"
          >
            <p>
              {r.branch_name} · {r.account_name} · {r.statement_date}
            </p>
            <p className="mt-2 text-slate-400">
              {r.reference} · {money(r.opening_balance)} →{" "}
              {money(r.closing_balance)}
            </p>
          </div>
        ))}
      </Card>
    </div>
  );
}
export function printRecord(title: string, body: HTMLElement, wide = false) {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.opacity = "0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) return;
  const root = doc.createElement("html");
  root.dir = document.documentElement.dir;
  root.lang = document.documentElement.lang;
  doc.replaceChild(root, doc.documentElement);
  const head = doc.createElement("head"),
    meta = doc.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  head.appendChild(meta);
  const t = doc.createElement("title");
  t.textContent = title;
  head.appendChild(t);
  const style = doc.createElement("style");
  style.textContent =
    "body{font:14px Arial,sans-serif;color:#17233e;padding:30px;overflow-wrap:anywhere}[class*=whitespace-pre-wrap]{white-space:pre-wrap}[data-print-identity]{border-bottom:2px solid;padding-bottom:14px}h1{font-size:26px}button,form,input,select{display:none!important}section,div{break-inside:avoid}[class*=flex]{display:flex;justify-content:space-between;align-items:start;gap:24px;margin:12px 0}[class*=rounded]{border:1px solid #ddd;padding:14px;margin:14px 0}span+span{margin-inline-start:8px}h3{margin-top:24px}p{margin:8px 0}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:start}";
  if (wide)
    style.textContent +=
      "@page{size:A3 landscape;margin:12mm}body{padding:0;font-size:10px}td,th{padding:6px;white-space:normal;overflow-wrap:normal}section,div{break-inside:auto}tr{break-inside:avoid}thead{display:table-header-group}";
  head.appendChild(style);
  root.appendChild(head);
  const b = doc.createElement("body"),
    h = doc.createElement("h1");
  h.textContent = "ELCenter · " + title;
  b.appendChild(h);
  b.appendChild(body.cloneNode(true));
  root.appendChild(b);
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  }, 100);
}
export function PayrollSnapshot({
  value,
  ar,
  money,
}: {
  value: Record<string, any>;
  ar: boolean;
  money: (n: number) => string;
}) {
  const L = (e: string, a: string) => (ar ? a : e);
  const rows: [string, unknown][] = value.contract
    ? [
        [L("Monthly salary", "المرتب الشهري"), money(value.contract.salary)],
        [L("Scheduled days", "أيام العمل"), value.scheduled_days],
        [
          L("Absent / unpaid leave days", "أيام الغياب / الإجازة بدون أجر"),
          value.absent_days + " / " + value.unpaid_leave_days,
        ],
        [
          L("Attendance deduction", "خصم الحضور"),
          money(value.absence_deduction),
        ],
        [L("Overtime minutes", "دقايق الإضافي"), value.overtime_minutes],
        [L("Overtime pay", "أجر الإضافي"), money(value.overtime_pay)],
        [L("Bonus", "مكافأة"), money(value.bonus)],
        [L("Additional deduction", "خصم إضافي"), money(value.deduction)],
        ...(value.loan_deduction_total
          ? ([
              [
                L("Loan / advance deduction", "خصم السلف والقروض"),
                money(value.loan_deduction_total),
              ],
            ] as [string, unknown][])
          : []),
      ]
    : [
        [L("Agreement", "الاتفاق"), value.agreement?.type],
        [
          L("Base / rate / percent", "الأساسي / السعر / النسبة"),
          [
            value.agreement?.base,
            value.agreement?.rate,
            value.agreement?.percent,
          ].join(" / "),
        ],
        ...[
          ["minutes", L("Teaching minutes", "دقايق التدريس")],
          ["sessions", L("Completed sessions", "الحصص المكتملة")],
          ["students", L("Students", "الطلاب")],
          ["revenue", L("Attributed collections", "التحصيل المخصص")],
        ].map(
          ([key, label]) => [label, value.stats?.[key]] as [string, unknown],
        ),
      ];
  return (
    <dl className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-xs dark:bg-slate-800">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <dt className="text-slate-400">{label}</dt>
          <dd className="text-end" dir="ltr">
            {String(value ?? 0)}
          </dd>
        </div>
      ))}
      {(value.reason || value.adjustment_reason) && (
        <div className="mt-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          <dt className="text-slate-400">
            {L("Adjustment reason", "سبب التعديل")}
          </dt>
          <dd className="mt-2 leading-6">
            {value.reason || value.adjustment_reason}
          </dd>
        </div>
      )}
      <p className="mt-1 text-[10px] text-slate-400">
        {L(
          "Saved calculation. Rounded to whole currency units.",
          "حسبة محفوظة، بالتقريب لأقرب وحدة عملة.",
        )}
      </p>
    </dl>
  );
}
