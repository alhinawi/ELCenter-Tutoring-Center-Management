"use client";
import { useEffect, useState } from "react";
import { Button, Select, Field } from "./ui";
export function FamilyInvoiceHistory({
  id,
  name,
  api,
  ar,
  view,
}: {
  id: string;
  name: string;
  api: (p: string) => Promise<any>;
  ar: boolean;
  view: (id: string) => void;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [page, setPage] = useState(1),
    [status, setStatus] = useState(""),
    [data, setData] = useState<any[]>([]),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const money = (value: number, currency: string) =>
    new Intl.NumberFormat(ar ? "ar-EG-u-nu-latn" : "en-GB", {
      maximumFractionDigits: 0,
    }).format(value) +
    " " +
    currency;
  useEffect(() => {
    let active = true;
    setData([]);
    setTotal(0);
    setBusy(true);
    setError("");
    api(`/portal/students/${id}/invoices?page=${page}&status=${status}`)
      .then((r) => {
        if (active) {
          setData(r.data);
          setTotal(r.total);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [id, page, status]);
  return (
    <section
      className="space-y-4 p-5"
      aria-label={L("Family invoice history", "سجل فواتير الأسرة")}
    >
      <p className="text-xs leading-6 text-slate-500">
        <strong>{name}</strong> ·{" "}
        {L(
          "All issued and void invoices, newest invoice date first,20 per page. Drafts are private to the center. Paid means recorded receipts minus refunds, not an external payment confirmation. Void invoices have no payable balance here. Online payment is not connected.",
          "كل الفواتير الصادرة والملغية، أحدث تاريخ فاتورة الأول،20 في الصفحة. المسودات خاصة بالمركز. المدفوع يعني الإيصالات المسجلة ناقص الاستردادات، مش تأكيد دفع خارجي. الفاتورة الملغية ملهاش مبلغ مستحق هنا. الدفع أونلاين غير متصل.",
        )}
      </p>
      <Field label={L("Invoice history status", "حالة سجل الفواتير")}>
        <Select
          aria-label={L("Invoice history status", "حالة سجل الفواتير")}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{L("Issued and void", "الصادرة والملغية")}</option>
          <option value="issued">{L("Issued", "صادرة")}</option>
          <option value="void">{L("Void", "ملغاة")}</option>
        </Select>
      </Field>
      {busy && (
        <p role="status" className="text-sm text-slate-500">
          {L("Loading invoice history…", "جاري تحميل سجل الفواتير…")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!busy && !error && !data.length && (
        <p className="text-sm text-slate-500">
          {L(
            "No matching issued or void invoices.",
            "مفيش فواتير صادرة أو ملغية مطابقة.",
          )}
        </p>
      )}
      <div className="space-y-3">
        {data.map((r) => (
          <article
            key={r.id}
            data-testid="family-invoice-row"
            className="space-y-2 rounded-xl border border-slate-100 p-4 text-sm dark:border-slate-800"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="break-all font-semibold">
                <bdi>{r.number}</bdi>
              </h3>
              <span className="text-xs text-slate-500">
                {r.status === "void"
                  ? L("Void", "ملغاة")
                  : L("Issued", "صادرة")}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {L("Invoice date", "تاريخ الفاتورة")}: <bdi>{r.date}</bdi> ·{" "}
              {L("Due", "الاستحقاق")}: <bdi>{r.due_date}</bdi>
            </p>
            <p>
              {L("Total", "الإجمالي")}: <bdi>{money(r.total, r.currency)}</bdi>
            </p>
            <p>
              {L("Recorded net paid", "صافي المدفوع المسجل")}:{" "}
              <bdi>{money(r.paid, r.currency)}</bdi>
            </p>
            <p>
              {L("Outstanding", "المتبقي")}:{" "}
              <bdi>
                {money(
                  r.status === "issued" ? Math.max(0, r.total - r.paid) : 0,
                  r.currency,
                )}
              </bdi>
            </p>
            <button
              className="text-sm font-medium text-blue-700 dark:text-blue-300"
              onClick={() => view(r.id)}
            >
              {L("View invoice", "عرض الفاتورة")}
            </button>
          </article>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={busy || page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          {L("Previous invoices", "الفواتير السابقة")}
        </Button>
        <p role="status" className="text-xs text-slate-500">
          {L("Page", "صفحة")} {page} · {L("Matching invoices", "فواتير مطابقة")}
          : {total}
        </p>
        <Button
          disabled={busy || page * 20 >= total || page >= 10000}
          onClick={() => setPage((p) => p + 1)}
        >
          {L("Next invoices", "الفواتير التالية")}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        {L(
          "Live totals and pages can change after receipts, refunds or voids. Tied invoice dates use invoice ID order. Status/page reset on child change. Maximum page10000; contact your center for a larger archive. Not a certified financial statement.",
          "الإجماليات والصفحات ممكن تتغيّر بعد إيصال أو استرداد أو إلغاء. نفس تاريخ الفاتورة بيترتب بمعرّفها. الحالة والصفحة بتبدأ من جديد لما تختار طفل تاني. أقصى صفحة10000؛ تواصل مع المركز لأرشيف أكبر. مش كشف مالي معتمد.",
        )}
      </p>
    </section>
  );
}
