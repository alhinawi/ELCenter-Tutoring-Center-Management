"use client";
import { useModalFocus } from "./modal-focus";
import { AccountStatementExport } from "./account-statement";
import { ReceiptNumberSettings } from "./receipt-numbering";
import { InvoiceNumberSettings } from "./invoice-numbering";
import {
  InvoicePrintHeader,
  InvoicePrintFooter,
  InvoicePrintSettings,
} from "./invoice-print";
import { ZeroPayrollClosure } from "./zero-payroll";
import {
  PayrollSnapshot,
  FinancialStatements,
  InstallmentPlan,
  Reconciliation,
  printRecord,
} from "./finance-extra";
import { useEffect, useState, type FormEvent } from "react";
import {
  Plus,
  X,
  Receipt,
  Wallet,
  BookOpen,
  Users,
  Settings,
  CheckCircle2,
  ArrowRightLeft,
  Printer,
  Trash2,
} from "lucide-react";
import { Button, Input, Select, Field, Card } from "./ui";
import type { T } from "./i18n";
type Row = Record<string, any>;
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
type Section =
  | "invoices"
  | "expenses"
  | "ledger"
  | "reports"
  | "payroll"
  | "settings"
  | "reconciliation";
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useModalFocus(close);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm"
      onClick={close}
    >
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[93dvh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-semibold">{title}</h2>
          <button aria-label="Close" onClick={close} className="p-2">
            <X size={19} />
          </button>
        </header>
        <div className="p-5">{children}</div>
      </section>
    </div>
  );
}
export default function Finance({
  t,
  api,
  allowed,
  toast,
  currency,
  timezone,
  headquarters,
}: {
  t: T;
  api: Api;
  allowed: (r: string, a?: string) => boolean;
  toast: () => void;
  currency: string;
  timezone: string;
  headquarters: boolean;
}) {
  const ar = t.language === "English",
    L = (a: string, b: string) => (ar ? b : a);
  const [section, setSection] = useState<Section>(
      allowed("finance") ? "invoices" : "payroll",
    ),
    [data, setData] = useState<Row | null>(null),
    [options, setOptions] = useState<Record<string, Row[]>>({}),
    [settings, setSettings] = useState<Row | null>(null),
    [form, setForm] = useState<string | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0),
    [page, setPage] = useState(1),
    [items, setItems] = useState([
      { description: "", quantity: 1, unit_price: 0 },
    ]),
    [discount, setDiscount] = useState(0),
    [dates, setDates] = useState(() => {
      const year = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
      }).format(new Date());
      return { from: year + "-01-01", to: year + "-12-31" };
    }),
    [paymentKey, setPaymentKey] = useState(""),
    [refund, setRefund] = useState<Row | null>(null),
    [ledgerCursors, setLedgerCursors] = useState<(string | null)[]>([null]);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const money = (n: number) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) +
    " " +
    currency;
  const reload = () => setVersion((v) => v + 1);
  const labels: Record<Section, string> = {
    invoices: L("Invoices", "الفواتير"),
    expenses: L("Expenses", "المصروفات"),
    ledger: L("Ledger", "دفتر الأستاذ"),
    reports: L("Financial reports", "التقارير المالية"),
    reconciliation: L("Reconciliation", "مطابقة الحسابات"),
    payroll: L("Payroll", "المرتبات"),
    settings: L("Finance settings", "إعدادات الحسابات"),
  };
  useEffect(() => {
    api("/finance/options")
      .then(setOptions)
      .catch((e) => setError(e.message));
    if (allowed("finance"))
      api("/finance/settings")
        .then(setSettings)
        .catch((e) => setError(e.message));
  }, [version]);
  useEffect(() => {
    setError("");
    setData(null);
    if (section === "reconciliation") return;
    const path =
      section === "invoices"
        ? `/invoices?page=${page}`
        : section === "expenses"
          ? "/expenses"
          : section === "payroll"
            ? "/payroll"
            : section === "settings"
              ? "/finance/settings"
              : section === "ledger"
                ? `/finance/ledger?from=${dates.from}&to=${dates.to}${ledgerCursors.at(-1) ? "&cursor=" + encodeURIComponent(ledgerCursors.at(-1)!) : ""}`
                : `/finance/reports?from=${dates.from}&to=${dates.to}`;
    let active = true;
    api(path)
      .then((result) => {
        if (active) setData({ ...result, _section: section });
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [section, version, page, dates, ledgerCursors]);
  function exportLedgerPage() {
    if (!data?.data.length) return;
    const cell = (v: unknown) => {
      let s = String(v ?? "");
      if (/^(?:\s*[=+@\-]|[\t\r])/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    const rows = [
      [
        "Date",
        "Journal",
        "Reference",
        "Memo",
        "Branch",
        "Account code",
        "Account name",
        "Debit",
        "Credit",
        "Source",
        "Reversal of",
      ],
      ...data.data.map((r: Row) => [
        r.date,
        r.id,
        r.reference,
        r.memo,
        r.branch_id,
        r.code,
        r.account_name,
        r.debit,
        r.credit,
        r.source_type,
        r.reverse_of,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(
        ["\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download =
      "ledger-page-" +
      ledgerCursors.length +
      "-" +
      dates.from +
      "-" +
      dates.to +
      ".csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function command(path: string, method: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await api(path, method, body);
      reload();
      toast();
      if (detail) await open(detail.data.id);
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    setError("");
    setDetail(await api("/invoices/" + id));
    setPaymentKey(crypto.randomUUID());
  }
  const branchSelect = (
    <Select name="branch_id" required>
      <option value="">{t.branch}</option>
      {options.branches?.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </Select>
  );
  const teacherSelect = (
    <Select name="teacher_id" required>
      <option value="">{L("Teacher", "المدرّس")}</option>
      {options.teachers?.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </Select>
  );
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-[0.15em] text-teal-600">
            {L("EVERY NUMBER HAS A STORY", "كل رقم ليه حكاية")}
          </p>
          <h1 className="text-3xl font-semibold">
            {L("Finance & payroll", "الحسابات والمرتبات")}
          </h1>
          <p className="mt-2 text-xs text-slate-400">
            {L(
              "Recorded operations only. No real funds move through this app.",
              "تسجيل عمليات بس. مفيش فلوس حقيقية بتتنقل من خلال الموقع.",
            )}
          </p>
        </div>
        {allowed(section === "payroll" ? "payroll" : "finance", "create") &&
          ["invoices", "expenses", "payroll"].includes(section) && (
            <Button
              onClick={() => {
                setForm(section);
                setError("");
                setItems([{ description: "", quantity: 1, unit_price: 0 }]);
                setDiscount(0);
              }}
            >
              <Plus size={17} />
              {L("New record", "سجل جديد")}
            </Button>
          )}
      </div>
      <nav className="mb-6 flex gap-2 overflow-x-auto pb-2">
        {(Object.keys(labels) as Section[])
          .filter((s) =>
            s === "payroll" ? allowed("payroll") : allowed("finance"),
          )
          .map((s) => (
            <button
              key={s}
              onClick={() => {
                setSection(s);
                setPage(1);
                setLedgerCursors([null]);
              }}
              aria-current={section === s ? "page" : undefined}
              className={`shrink-0 rounded-xl px-4 py-3 text-xs font-semibold ${section === s ? "bg-blue-700 text-white" : "border border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900"}`}
            >
              {labels[s]}
            </button>
          ))}
      </nav>
      {error && !form && !detail && (
        <p
          role="alert"
          className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {settings &&
        settings.accounts.length === 0 &&
        allowed("finance", "manage") && (
          <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 p-6">
            <div>
              <h2 className="font-semibold">
                {L("Start with a clean ledger", "ابدأ بدفتر حسابات منظم")}
              </h2>
              <p className="mt-2 text-xs text-slate-400">
                {L(
                  "Create the default chart of accounts and the current financial period.",
                  "اعمل شجرة الحسابات الأساسية والفترة المالية الحالية.",
                )}
              </p>
            </div>
            <Button
              disabled={busy}
              onClick={() =>
                command("/finance/initialize", "POST", {
                  year: Number(today.slice(0, 4)),
                })
              }
            >
              {L("Initialize finance", "تجهيز الحسابات")}
            </Button>
          </Card>
        )}
      {["ledger", "reports"].includes(section) && (
        <Card className="mb-5 p-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              setLedgerCursors([null]);
              setDates({ from: String(d.from), to: String(d.to) });
            }}
          >
            <Field label={L("From", "من")}>
              <Input
                type="date"
                name="from"
                required
                defaultValue={dates.from}
              />
            </Field>
            <Field label={L("To", "لحد")}>
              <Input type="date" name="to" required defaultValue={dates.to} />
            </Field>
            <Button type="submit">{L("Apply", "تطبيق")}</Button>
          </form>
        </Card>
      )}
      {section === "reconciliation" ? (
        <Reconciliation
          api={api}
          ar={ar}
          options={options}
          settings={settings}
          money={money}
          today={today}
          canApprove={allowed("finance", "approve")}
        />
      ) : !data || data._section !== section ? (
        <p className="py-12 text-center text-sm text-slate-400">
          {error ? "" : t.loading}
        </p>
      ) : section === "reports" ? (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
            {[
              [L("Revenue", "الإيراد"), data.revenue],
              [L("Expenses", "المصروفات"), data.expenses],
              [L("Net profit", "صافي الربح"), data.profit],
              [L("Outstanding", "المتبقي"), data.outstanding],
            ].map(([label, value]) => (
              <Card key={String(label)} className="p-5">
                <p className="text-xs text-slate-400">{label}</p>
                <p className="mt-3 text-lg font-semibold" dir="ltr">
                  {money(Number(value))}
                </p>
              </Card>
            ))}
          </div>
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
              <h2 className="font-semibold">
                {L("Trial balance", "ميزان المراجعة")}
              </h2>
              <span
                className={`rounded-full px-3 py-1 text-[10px] ${data.balanced ? "bg-teal-50 text-teal-700" : "bg-red-50 text-red-700"}`}
              >
                {data.balanced
                  ? L("Balanced", "متوازن")
                  : L("Not balanced", "مش متوازن")}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-start text-xs">
                <thead className="bg-slate-50 text-slate-400 dark:bg-slate-800">
                  <tr>
                    {[
                      L("Account", "الحساب"),
                      L("Type", "النوع"),
                      L("Debit", "مدين"),
                      L("Credit", "دائن"),
                    ].map((h) => (
                      <th className="p-4 text-start font-normal" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.trial_balance.map((r: Row) => (
                    <tr key={r.id}>
                      <td className="p-4 font-medium">
                        {r.code} · {r.name}
                      </td>
                      <td className="p-4 text-slate-400">{r.kind}</td>
                      <td className="p-4" dir="ltr">
                        {money(r.debit)}
                      </td>
                      <td className="p-4" dir="ltr">
                        {money(r.credit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <FinancialStatements data={data} ar={ar} money={money} />
        </>
      ) : section === "settings" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <InvoiceNumberSettings
            api={api}
            ar={ar}
            editable={allowed("finance", "manage") && headquarters}
          />
          <ReceiptNumberSettings
            api={api}
            ar={ar}
            editable={headquarters && allowed("finance", "manage")}
          />
          <InvoicePrintSettings
            api={api}
            ar={ar}
            editable={allowed("finance", "manage") && headquarters}
          />
          <Card className="p-5">
            <h2 className="mb-5 font-semibold">
              {L("Chart of accounts", "شجرة الحسابات")}
            </h2>
            {data.accounts.map((a: Row) => (
              <div
                key={a.id}
                className="mb-2 flex justify-between rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800"
              >
                <span>
                  {a.code} · {a.name}
                </span>
                <span className="text-slate-400">{a.kind}</span>
              </div>
            ))}
            {allowed("finance", "manage") && (
              <Button className="mt-4" onClick={() => setForm("account")}>
                <Plus size={15} />
                {L("Add account", "إضافة حساب")}
              </Button>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="mb-5 font-semibold">
              {L("Financial periods", "الفترات المالية")}
            </h2>
            {data.periods.map((p: Row) => (
              <div
                key={p.id}
                className="mb-3 rounded-xl border border-slate-200 p-4 text-xs dark:border-slate-700"
              >
                <p className="font-semibold">
                  {p.name} · {p.status}
                </p>
                <p className="my-2 text-slate-400" dir="ltr">
                  {p.starts_on} → {p.ends_on}
                </p>
                {p.status === "open" && allowed("finance", "approve") && (
                  <button
                    className="text-red-600"
                    onClick={() => {
                      if (
                        window.confirm(
                          L(
                            "Closing this period prevents any more posting. Continue?",
                            "قفل الفترة هيمنع أي ترحيل جديد. متأكد؟",
                          ),
                        )
                      )
                        void command(
                          `/finance/periods/${p.id}/close`,
                          "POST",
                          {},
                        );
                    }}
                  >
                    {L("Close period", "قفل الفترة")}
                  </button>
                )}
              </div>
            ))}
            {allowed("finance", "manage") && (
              <Button onClick={() => setForm("period")}>
                <Plus size={15} />
                {L("New period", "فترة جديدة")}
              </Button>
            )}
          </Card>
        </div>
      ) : section === "invoices" ? (
        <Card className="overflow-hidden">
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.data.map((i: Row) => (
              <button
                className="flex w-full flex-wrap items-center justify-between gap-4 p-5 text-start hover:bg-slate-50 dark:hover:bg-slate-800"
                key={i.id}
                onClick={() => open(i.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="rounded-xl bg-blue-50 p-3 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    <Receipt size={19} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">
                      {i.number} · {i.student_name}
                    </p>
                    <p className="mt-2 text-[10px] text-slate-400">
                      {i.due_date} · {i.status}
                    </p>
                  </div>
                </div>
                <div className="text-end">
                  <p className="text-sm font-semibold" dir="ltr">
                    {money(i.total)}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {L("Outstanding", "المتبقي")}: {money(i.outstanding)}
                  </p>
                </div>
              </button>
            ))}
          </div>
          {!data.data.length && (
            <p className="p-14 text-center text-sm text-slate-400">
              {t.noResults}
            </p>
          )}
          <div className="flex justify-between border-t border-slate-100 p-4 text-xs text-slate-400 dark:border-slate-800">
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              {t.previous}
            </button>
            <span>{page}</span>
            <button
              disabled={data.data.length < 30}
              onClick={() => setPage(page + 1)}
            >
              {t.next}
            </button>
          </div>
        </Card>
      ) : section === "ledger" ? (
        <>
          {allowed("finance", "export") && (
            <AccountStatementExport
              key={dates.from + dates.to}
              api={api}
              ar={ar}
              accounts={settings?.accounts ?? []}
              from={dates.from}
              to={dates.to}
            />
          )}
          <p className="mb-4 text-sm leading-7 text-slate-500">
            {L(
              "Each page contains up to 25 complete journals, including every line. Page CSV exports only the visible page, not the full ledger. Newly posted entries may require a refresh; pagination is not a point-in-time accounting snapshot.",
              "كل صفحة فيها لحد 25 قيد كامل بكل السطور. تصدير CSV للصفحة الظاهرة بس، مش دفتر الحسابات كله. القيود الجديدة ممكن تحتاج تحديث؛ التصفح مش لقطة حسابية ثابتة في وقت واحد.",
            )}
          </p>
          <div className="mb-4 flex flex-wrap justify-end gap-3">
            <Button onClick={() => setLedgerCursors([null])}>
              {L("Refresh ledger", "تحديث الدفتر")}
            </Button>
            {allowed("finance", "export") && (
              <Button disabled={!data.data.length} onClick={exportLedgerPage}>
                {L("Export this page CSV", "تصدير الصفحة CSV")}
              </Button>
            )}
            {allowed("finance", "approve") && (
              <Button onClick={() => setForm("journal")}>
                <Plus size={16} />
                {L("Post journal", "ترحيل قيد")}
              </Button>
            )}
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-start text-xs">
                <thead className="bg-slate-50 text-slate-400 dark:bg-slate-800">
                  <tr>
                    {[
                      L("Date", "التاريخ"),
                      L("Reference", "المرجع"),
                      L("Account", "الحساب"),
                      L("Debit", "مدين"),
                      L("Credit", "دائن"),
                      t.actions,
                    ].map((h) => (
                      <th className="p-4 text-start font-normal" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.data.map((r: Row, i: number) => (
                    <tr key={r.line_id ?? r.id + ":" + i}>
                      <td className="p-4" dir="ltr">
                        {r.date}
                      </td>
                      <td className="p-4">
                        <p className="font-semibold">{r.reference}</p>
                        <p className="mt-1 text-slate-400">{r.memo}</p>
                      </td>
                      <td className="p-4">
                        {r.code} · {r.account_name}
                      </td>
                      <td className="p-4" dir="ltr">
                        {money(r.debit)}
                      </td>
                      <td className="p-4" dir="ltr">
                        {money(r.credit)}
                      </td>
                      <td className="p-4">
                        {r.source_type === "manual" &&
                          allowed("finance", "approve") && (
                            <button
                              className="text-blue-700 dark:text-blue-300"
                              onClick={() => {
                                setRefund({ ...r, kind: "journal" });
                                setForm("reverse");
                              }}
                            >
                              {L("Reverse", "قيد عكسي")}
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.data.length && (
              <p className="p-14 text-center text-sm text-slate-400">
                {t.noResults}
              </p>
            )}
          </Card>
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button
              disabled={ledgerCursors.length === 1}
              onClick={() => setLedgerCursors((v) => v.slice(0, -1))}
            >
              {L("Previous ledger page", "صفحة الدفتر السابقة")}
            </Button>
            <span className="text-xs text-slate-500">
              {L("Page", "صفحة")} {ledgerCursors.length} · {data.journal_count}{" "}
              {L("journals", "قيد")}
            </span>
            <Button
              disabled={!data.next_cursor}
              onClick={() => setLedgerCursors((v) => [...v, data.next_cursor])}
            >
              {L("Next ledger page", "صفحة الدفتر التالية")}
            </Button>
          </div>
        </>
      ) : section === "expenses" ? (
        <div className="grid gap-4 md:grid-cols-2">
          {data.data.map((e: Row) => (
            <Card key={e.id} className="p-5">
              <div className="flex justify-between gap-3">
                <span className="text-xs text-slate-400">
                  {e.category} · {e.date}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-500 dark:bg-slate-800">
                  {e.status}
                </span>
              </div>
              <h2 className="my-4 font-semibold">{e.description}</h2>
              <p className="text-xl font-semibold" dir="ltr">
                {money(e.amount)}
              </p>
              {e.status === "pending" && allowed("finance", "approve") && (
                <div className="mt-5 flex gap-3">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      command(`/expenses/${e.id}/decision`, "POST", {
                        decision: "approved",
                      })
                    }
                  >
                    {L("Approve", "اعتماد")}
                  </Button>
                  <Button
                    className="bg-slate-500"
                    disabled={busy}
                    onClick={() =>
                      command(`/expenses/${e.id}/decision`, "POST", {
                        decision: "rejected",
                      })
                    }
                  >
                    {L("Reject", "رفض")}
                  </Button>
                </div>
              )}
            </Card>
          ))}
          {!data.data.length && (
            <Card className="p-14 text-center text-sm text-slate-400">
              {t.noResults}
            </Card>
          )}
        </div>
      ) : (
        <>
          <div className="mb-5 flex gap-3">
            {allowed("payroll", "manage") && (
              <Button
                className="bg-slate-700"
                onClick={() => setForm("compensation")}
              >
                {L("Compensation agreement", "اتفاق مرتب")}
              </Button>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {data.data.map((p: Row) => (
              <Card key={p.id} className="p-5">
                <div className="flex justify-between">
                  <h2 className="font-semibold">{p.teacher_name}</h2>
                  <span className="text-[10px] text-slate-400">
                    {p.zero_closed_on
                      ? L("Closed / no payment", "مغلق / بدون صرف")
                      : p.status}
                  </span>
                </div>
                <p className="my-2 text-xs text-slate-400">{p.month}</p>
                <p className="my-4 text-xl font-semibold" dir="ltr">
                  {money(p.total)}
                </p>
                <details className="mb-4 text-xs text-slate-400">
                  <summary className="cursor-pointer">
                    {L("Calculation snapshot", "تفاصيل الحسبة")}
                  </summary>
                  <PayrollSnapshot
                    value={JSON.parse(p.calculation_json)}
                    ar={ar}
                    money={money}
                  />
                </details>
                <button
                  className="mb-4 text-xs text-blue-700 dark:text-blue-300"
                  onClick={(e) =>
                    printRecord(
                      L("Payslip", "بيان مرتب") + " · " + p.month,
                      e.currentTarget.closest("section")!,
                    )
                  }
                >
                  {L("Print payslip", "طباعة بيان المرتب")}
                </button>
                {p.status === "draft" && allowed("payroll", "approve") && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      command(`/payroll/${p.id}/approve`, "POST", {})
                    }
                  >
                    {L("Approve payroll", "اعتماد المرتب")}
                  </Button>
                )}
                {p.zero_closed_on && (
                  <p className="my-4 whitespace-pre-wrap break-words text-sm text-slate-500">
                    {L("Closed without payment", "اتقفل بدون صرف")} ·{" "}
                    {p.zero_closed_on}
                    <br />
                    {p.zero_closure_reason}
                  </p>
                )}
                {p.status === "approved" &&
                  !p.zero_closed_on &&
                  p.total === 0 &&
                  allowed("finance", "approve") && (
                    <ZeroPayrollClosure
                      api={api}
                      ar={ar}
                      id={p.id}
                      kind="payroll"
                      onSaved={() => {
                        toast();
                        setVersion((v) => v + 1);
                      }}
                    />
                  )}
                {p.status === "approved" &&
                  !p.zero_closed_on &&
                  p.total > 0 &&
                  allowed("finance", "approve") && (
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setRefund(p);
                        setForm("payroll-payment");
                      }}
                    >
                      {L("Record payment", "تسجيل الصرف")}
                    </Button>
                  )}
              </Card>
            ))}
          </div>
        </>
      )}
      {form && (
        <Dialog
          title={
            form === "reverse"
              ? L("Auditable reversal", "قيد عكسي موثّق")
              : L("Finance record", "سجل مالي")
          }
          close={() => {
            setForm(null);
            setError("");
          }}
        >
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              let path = "",
                body: Row = { ...d };
              if (form === "invoices") {
                path = "/invoices";
                body = { ...d, items, discount };
              } else if (form === "expenses") {
                path = "/expenses";
                body.amount = Number(d.amount);
              } else if (form === "account") path = "/finance/accounts";
              else if (form === "period") path = "/finance/periods";
              else if (form === "compensation") {
                path = "/payroll/compensation";
                for (const k of ["base", "rate", "percent"])
                  body[k] = Number(d[k]);
              } else if (form === "payroll") {
                path = "/payroll";
                body.bonus = Number(d.bonus);
                body.deduction = Number(d.deduction);
              } else if (form === "payroll-payment")
                path = `/payroll/${refund?.id}/pay`;
              else if (form === "settle") {
                path = `/expenses/${refund?.id}/settle`;
                body.amount = Number(d.amount);
                body.idempotency_key = paymentKey;
              } else if (form === "reverse")
                path = `/finance/journals/${refund?.id}/reverse`;
              else if (form === "journal") {
                path = "/finance/journals";
                body = {
                  branch_id: d.branch_id,
                  date: d.date,
                  reference: d.reference,
                  memo: d.memo,
                  lines: [
                    {
                      account: d.debit_account,
                      debit: Number(d.amount),
                      credit: 0,
                    },
                    {
                      account: d.credit_account,
                      debit: 0,
                      credit: Number(d.amount),
                    },
                  ],
                };
              }
              const r = await command(path, "POST", body);
              if (r) setForm(null);
            }}
          >
            {form === "invoices" ? (
              <>
                <Field label={L("Student", "الطالب")}>
                  <Select name="student_id" required>
                    <option value="">—</option>
                    {options.students?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={L("Invoice number", "رقم الفاتورة")}>
                  <Input
                    name="number"
                    maxLength={40}
                    placeholder={L(
                      "Blank for configured automatic number",
                      "سيبه فاضي للترقيم التلقائي لو متفعل",
                    )}
                  />
                </Field>
                <Field label={L("Invoice date", "تاريخ الفاتورة")}>
                  <Input
                    type="date"
                    name="date"
                    defaultValue={today}
                    required
                  />
                </Field>
                <Field label={L("Due date", "تاريخ الاستحقاق")}>
                  <Input
                    type="date"
                    name="due_date"
                    defaultValue={today}
                    required
                  />
                </Field>
                <div className="col-span-full grid gap-3">
                  {items.map((item, i) => (
                    <div
                      key={i}
                      className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_80px_120px_36px] dark:border-slate-700"
                    >
                      <Input
                        aria-label={L("Item description", "وصف البند")}
                        required
                        placeholder={L("Description", "الوصف")}
                        value={item.description}
                        onChange={(e) =>
                          setItems((v) =>
                            v.map((r, n) =>
                              n === i
                                ? { ...r, description: e.target.value }
                                : r,
                            ),
                          )
                        }
                      />
                      <Input
                        aria-label={L("Quantity", "الكمية")}
                        type="number"
                        min={1}
                        max={10000}
                        required
                        value={item.quantity}
                        onChange={(e) =>
                          setItems((v) =>
                            v.map((r, n) =>
                              n === i
                                ? { ...r, quantity: Number(e.target.value) }
                                : r,
                            ),
                          )
                        }
                      />
                      <Input
                        aria-label={L("Unit price", "سعر الوحدة")}
                        type="number"
                        min={0}
                        required
                        value={item.unit_price}
                        onChange={(e) =>
                          setItems((v) =>
                            v.map((r, n) =>
                              n === i
                                ? { ...r, unit_price: Number(e.target.value) }
                                : r,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        disabled={items.length === 1}
                        aria-label={L("Remove item", "حذف البند")}
                        onClick={() =>
                          setItems((v) => v.filter((_, n) => n !== i))
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="w-fit text-xs text-blue-700 dark:text-blue-300"
                    disabled={items.length >= 40}
                    onClick={() =>
                      setItems((v) => [
                        ...v,
                        { description: "", quantity: 1, unit_price: 0 },
                      ])
                    }
                  >
                    {L("Add item", "إضافة بند")}
                  </button>
                </div>
                <Field label={L("Discount", "الخصم")}>
                  <Input
                    type="number"
                    min={0}
                    value={discount}
                    onChange={(e) => setDiscount(Number(e.target.value))}
                  />
                </Field>
                <p className="self-end py-3 text-lg font-semibold" dir="ltr">
                  {money(
                    items.reduce((n, x) => n + x.quantity * x.unit_price, 0) -
                      discount,
                  )}
                </p>
              </>
            ) : form === "expenses" ? (
              <>
                <Field label={t.branch}>{branchSelect}</Field>
                <Field label={L("Date", "التاريخ")}>
                  <Input
                    name="date"
                    type="date"
                    defaultValue={today}
                    required
                  />
                </Field>
                <Field label={L("Category", "التصنيف")}>
                  <Select name="category">
                    {[
                      "Rent",
                      "Salaries",
                      "Utilities",
                      "Maintenance",
                      "Marketing",
                      "Equipment",
                      "Transportation",
                      "Supplies",
                      "Other",
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={L("Amount", "المبلغ")}>
                  <Input name="amount" type="number" min={1} required />
                </Field>
                <Field label={L("Description", "الوصف")}>
                  <Input name="description" required />
                </Field>
                <Field label={L("Method", "الطريقة")}>
                  <Select name="method">
                    <option value="cash">{L("Cash", "كاش")}</option>
                    <option value="payable">
                      {L("Accounts payable", "حساب مورد آجل")}
                    </option>
                    <option value="bank">{L("Bank", "بنك")}</option>
                  </Select>
                </Field>
              </>
            ) : form === "account" ? (
              <>
                <Field label={L("Account code", "كود الحساب")}>
                  <Input name="code" pattern="[0-9]{3,10}" required />
                </Field>
                <Field label={t.name}>
                  <Input name="name" required />
                </Field>
                <Field label={L("Type", "النوع")}>
                  <Select name="kind">
                    {["asset", "liability", "equity", "revenue", "expense"].map(
                      (k) => (
                        <option key={k}>{k}</option>
                      ),
                    )}
                  </Select>
                </Field>
              </>
            ) : form === "period" ? (
              <>
                <Field label={t.name}>
                  <Input name="name" required />
                </Field>
                <Field label={L("Starts", "البداية")}>
                  <Input name="starts_on" type="date" required />
                </Field>
                <Field label={L("Ends", "النهاية")}>
                  <Input name="ends_on" type="date" required />
                </Field>
              </>
            ) : form === "compensation" ? (
              <>
                <Field label={L("Teacher", "المدرّس")}>{teacherSelect}</Field>
                <Field label={L("Compensation type", "طريقة الحسبة")}>
                  <Select name="type">
                    {[
                      "fixed",
                      "hourly",
                      "per_session",
                      "per_student",
                      "revenue_percent",
                      "hybrid",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                </Field>
                {["base", "rate", "percent"].map((k) => (
                  <Field key={k} label={k}>
                    <Input
                      name={k}
                      type="number"
                      min={0}
                      max={k === "percent" ? 100 : 100000000}
                      defaultValue={0}
                      required
                    />
                  </Field>
                ))}
                <p className="col-span-full text-xs leading-6 text-slate-400">
                  {L(
                    "Revenue percentages use explicit invoice allocations, not guessed teacher ownership. Hybrid = fixed base + per-session rate + allocated revenue share.",
                    "نسبة الإيراد بتتحسب من تخصيص المدرّس في الفاتورة، مش بالتخمين. المختلط = الأساسي + سعر الحصة + نسبة الإيراد المخصص.",
                  )}
                </p>
              </>
            ) : form === "payroll" ? (
              <>
                <Field label={L("Teacher", "المدرّس")}>{teacherSelect}</Field>
                <Field label={L("Month", "الشهر")}>
                  <Input
                    name="month"
                    type="month"
                    required
                    defaultValue={today.slice(0, 7)}
                  />
                </Field>
                <Field label={L("Bonus", "مكافأة")}>
                  <Input name="bonus" type="number" min={0} defaultValue={0} />
                </Field>
                <Field label={L("Deduction", "خصم")}>
                  <Input
                    name="deduction"
                    type="number"
                    min={0}
                    defaultValue={0}
                  />
                </Field>
                <Field label={L("Adjustment reason", "سبب التعديل")}>
                  <Input name="adjustment_reason" />
                </Field>
                <p className="col-span-full text-xs leading-6 text-slate-400">
                  {L(
                    "Approval must be by another user. Payment must be recorded by a third finance user. This does not move funds.",
                    "الاعتماد لازم من مستخدم تاني. تسجيل الصرف من مستخدم حسابات تالت. ده مش بينقل فلوس فعلية.",
                  )}
                </p>
              </>
            ) : form === "journal" ? (
              <>
                <Field label={t.branch}>{branchSelect}</Field>
                <Field label={L("Date", "التاريخ")}>
                  <Input
                    name="date"
                    type="date"
                    defaultValue={today}
                    required
                  />
                </Field>
                <Field label={L("Reference", "المرجع")}>
                  <Input name="reference" required />
                </Field>
                <Field label={L("Memo", "البيان")}>
                  <Input name="memo" required />
                </Field>
                {["debit", "credit"].map((side) => (
                  <Field
                    key={side}
                    label={
                      side === "debit"
                        ? L("Debit account", "الحساب المدين")
                        : L("Credit account", "الحساب الدائن")
                    }
                  >
                    <Select name={side + "_account"} required>
                      <option value="">—</option>
                      {settings?.accounts.map((a: Row) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
                <Field label={L("Amount", "المبلغ")}>
                  <Input name="amount" type="number" min={1} required />
                </Field>
              </>
            ) : (
              <>
                <Field label={L("Date", "التاريخ")}>
                  <Input
                    name="date"
                    type="date"
                    defaultValue={today}
                    required
                  />
                </Field>
                {form === "settle" && (
                  <>
                    <Field label={L("Amount", "المبلغ")}>
                      <Input
                        type="number"
                        name="amount"
                        min={1}
                        max={refund?.outstanding}
                        required
                      />
                    </Field>
                    <Field label={L("Reference", "المرجع")}>
                      <Input name="reference" />
                    </Field>
                  </>
                )}
                {form === "reverse" ? (
                  <Field label={L("Reason", "السبب")}>
                    <Input name="reason" required />
                  </Field>
                ) : (
                  <Field label={L("Method", "الطريقة")}>
                    <Select name="method">
                      <option value="bank">{L("Bank", "بنك")}</option>
                      <option value="cash">{L("Cash", "كاش")}</option>
                    </Select>
                  </Field>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="col-span-full text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="col-span-full mt-3 flex justify-end">
              <Button disabled={busy} type="submit">
                {busy ? "…" : t.save}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {detail && !form && (
        <Dialog
          title={detail.data.number}
          close={() => {
            setDetail(null);
            setError("");
          }}
        >
          {allowed("finance", "print") && (
            <button
              className="mb-4 text-xs text-blue-700 dark:text-blue-300"
              onClick={(e) =>
                printRecord(detail.data.number, e.currentTarget.parentElement!)
              }
            >
              {L("Print invoice and receipts", "طباعة الفاتورة والإيصالات")}
            </button>
          )}
          <InvoicePrintHeader
            snapshot={detail.print_snapshot}
            ar={ar}
            draft={detail.data.status === "draft"}
          />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold">{detail.student?.name}</h3>
              <p className="mt-2 text-xs text-slate-400">
                {detail.student?.code} · {detail.data.date} ·{" "}
                {detail.data.status}
              </p>
            </div>
            <p className="text-2xl font-semibold" dir="ltr">
              {money(detail.data.total)}
            </p>
          </div>
          <div className="my-5 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {detail.items.map((x: Row) => (
              <div
                key={x.id}
                className="flex justify-between gap-3 p-4 text-sm"
              >
                <span>
                  {x.description}{" "}
                  <span className="text-xs text-slate-400">× {x.quantity}</span>
                </span>
                <span dir="ltr">{money(x.quantity * x.unit_price)}</span>
              </div>
            ))}
          </div>
          <div className="mb-6 flex justify-between rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800">
            <span>{L("Paid / outstanding", "المدفوع / المتبقي")}</span>
            <span dir="ltr">
              {money(detail.paid)} / {money(detail.data.total - detail.paid)}
            </span>
          </div>
          {detail.data.status === "draft" && allowed("finance", "edit") && (
            <form
              className="my-4 flex gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const d = Object.fromEntries(new FormData(e.currentTarget));
                await command(`/invoices/${detail.data.id}/coupon`, "POST", d);
              }}
            >
              <Input
                name="code"
                aria-label={L("Coupon code", "كود الخصم")}
                placeholder={L("Coupon code", "كود الخصم")}
                required
              />
              <Button disabled={busy}>
                {L("Apply coupon", "تطبيق الخصم")}
              </Button>
            </form>
          )}
          <InstallmentPlan
            key={detail.data.id + ":" + detail.data.status}
            detail={detail}
            ar={ar}
            api={api}
            reload={() => open(detail.data.id)}
            money={money}
            editable={
              detail.data.status === "draft" && allowed("finance", "edit")
            }
          />
          {detail.data.status === "draft" && allowed("finance", "edit") && (
            <form
              className="mb-5 grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-3 dark:border-slate-700"
              onSubmit={(e) => {
                e.preventDefault();
                const d = Object.fromEntries(new FormData(e.currentTarget));
                void command(
                  `/invoices/${detail.data.id}/teacher-shares`,
                  "POST",
                  {
                    shares: [
                      { teacher_id: d.teacher_id, amount: Number(d.amount) },
                    ],
                  },
                );
              }}
            >
              {teacherSelect}
              <Input
                type="number"
                name="amount"
                min={1}
                max={detail.data.total}
                required
                placeholder={L(
                  "Teacher revenue allocation",
                  "الإيراد المخصص للمدرّس",
                )}
              />
              <Button disabled={busy} type="submit">
                {L("Allocate", "تخصيص")}
              </Button>
            </form>
          )}
          {detail.teacher_shares?.map((s: Row) => (
            <p key={s.id} className="mb-3 text-xs text-slate-400">
              {s.teacher_name}: {money(s.amount)}
            </p>
          ))}
          {detail.data.status === "draft" && allowed("finance", "approve") && (
            <Button
              disabled={busy}
              onClick={() =>
                command(`/invoices/${detail.data.id}/issue`, "POST", {})
              }
            >
              {L("Issue & post invoice", "إصدار وترحيل الفاتورة")}
            </Button>
          )}
          {detail.data.status === "issued" && allowed("finance", "create") && (
            <form
              className="my-5 grid gap-3 rounded-xl bg-blue-50/50 p-4 sm:grid-cols-2 dark:bg-blue-950/30"
              onSubmit={async (e) => {
                e.preventDefault();
                const d = Object.fromEntries(new FormData(e.currentTarget));
                const r = await command(
                  `/invoices/${detail.data.id}/payments`,
                  "POST",
                  {
                    ...d,
                    amount: Number(d.amount),
                    idempotency_key: paymentKey,
                  },
                );
                if (r) setPaymentKey(crypto.randomUUID());
              }}
            >
              <Field label={L("Payment amount", "المبلغ المدفوع")}>
                <Input
                  name="amount"
                  type="number"
                  min={1}
                  max={detail.data.total - detail.paid}
                  required
                />
              </Field>
              <Field label={L("Date", "التاريخ")}>
                <Input name="date" type="date" defaultValue={today} required />
              </Field>
              <Field label={L("Method", "الطريقة")}>
                <Select name="method">
                  {["cash", "bank", "electronic"].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Select>
              </Field>
              <Field label={L("Reference", "المرجع")}>
                <Input name="reference" />
              </Field>
              <Button disabled={busy} type="submit">
                {L("Record receipt", "تسجيل التحصيل")}
              </Button>
            </form>
          )}
          <InvoicePrintFooter snapshot={detail.print_snapshot} ar={ar} />
          <h3 className="mb-3 mt-6 font-semibold">
            {L("Receipt history", "سجل التحصيل")}
          </h3>
          {detail.payments.map((p: Row) => (
            <div
              key={p.id}
              className="mb-2 rounded-xl border border-slate-200 p-4 text-xs dark:border-slate-700"
            >
              <div className="flex justify-between">
                <span>
                  {p.kind} · {p.date}
                </span>
                <span dir="ltr">{money(p.amount)}</span>
              </div>
              <p className="mt-2 text-slate-400">
                {p.reference} · {p.reason}
                <br />
                {p.receipt_number && (
                  <>
                    {L("Receipt number", "رقم إيصال القبض")}:{" "}
                    <span dir="ltr">{p.receipt_number}</span>
                    <br />
                  </>
                )}
                {L("Receipt ID", "معرّف الإيصال")}: {p.id}
              </p>
              {p.kind === "receipt" && allowed("finance", "approve") && (
                <button
                  className="mt-3 text-blue-700 dark:text-blue-300"
                  onClick={() =>
                    setRefund({
                      ...p,
                      kind: "receipt-refund",
                      idempotency_key: crypto.randomUUID(),
                    })
                  }
                >
                  {L("Record refund", "تسجيل استرداد")}
                </button>
              )}
            </div>
          ))}
          {!!detail.payments.length && (
            <InvoicePrintFooter
              snapshot={detail.print_snapshot}
              ar={ar}
              receipt
            />
          )}
          {refund?.kind === "receipt-refund" && (
            <form
              className="mt-4 grid gap-3 rounded-xl bg-amber-50 p-4 sm:grid-cols-2 dark:bg-amber-950/30"
              onSubmit={async (e) => {
                e.preventDefault();
                const d = Object.fromEntries(new FormData(e.currentTarget));
                const r = await command(
                  `/payments/${refund.id}/refund`,
                  "POST",
                  {
                    ...d,
                    amount: Number(d.amount),
                    idempotency_key: refund.idempotency_key,
                  },
                );
                if (r) setRefund(null);
              }}
            >
              <Input
                aria-label={L("Refund amount", "مبلغ الاسترداد")}
                name="amount"
                type="number"
                min={1}
                max={refund.amount}
                required
              />
              <Input name="date" type="date" defaultValue={today} required />
              <Input
                name="reason"
                required
                placeholder={L("Refund reason", "سبب الاسترداد")}
              />
              <Button disabled={busy} type="submit">
                {L("Confirm refund record", "تأكيد تسجيل الاسترداد")}
              </Button>
            </form>
          )}
          {detail.data.status === "issued" &&
            detail.paid === 0 &&
            allowed("finance", "approve") && (
              <form
                className="mt-6 flex flex-wrap gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = Object.fromEntries(new FormData(e.currentTarget));
                  if (
                    window.confirm(
                      L(
                        "Void with a permanent reversing journal?",
                        "إلغاء بقيد عكسي دائم؟",
                      ),
                    )
                  )
                    void command(`/invoices/${detail.data.id}/void`, "POST", {
                      ...d,
                      date: today,
                    });
                }}
              >
                <Input
                  className="min-w-40 flex-1"
                  name="reason"
                  required
                  placeholder={L("Reason for voiding", "سبب الإلغاء")}
                />
                <Button className="bg-slate-600" disabled={busy} type="submit">
                  {L("Void with reversal", "إلغاء بقيد عكسي")}
                </Button>
              </form>
            )}
          {allowed("finance", "print") && (
            <Button
              className="mt-5 bg-slate-700"
              onClick={() => window.print()}
            >
              <Printer size={16} />
              {t.print}
            </Button>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-600">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </>
  );
}
