"use client";
import { useEffect, useRef, useState } from "react";
export function FamilyLibraryHistory({
  id,
  api,
  ar,
}: {
  id: string;
  api: (p: string) => Promise<any>;
  ar: boolean;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [page, setPage] = useState(1),
    [status, setStatus] = useState(""),
    [data, setData] = useState<any[]>([]),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    request = useRef(0);
  useEffect(() => {
    const n = ++request.current;
    setData([]);
    setTotal(0);
    setBusy(true);
    setError("");
    api(`/portal/library/${id}?page=${page}&status=${status}`)
      .then((r) => {
        if (n === request.current) {
          setData(r.data);
          setTotal(r.total);
        }
      })
      .catch((e) => {
        if (n === request.current) setError(e.message);
      })
      .finally(() => {
        if (n === request.current) setBusy(false);
      });
    return () => {
      request.current++;
    };
  }, [id, page, status]);
  function clear() {
    request.current++;
    setData([]);
    setTotal(0);
    setError("");
    setBusy(true);
  }
  return (
    <section
      className="space-y-4 p-5"
      aria-label={L("Family borrowing history", "سجل استعارات الأسرة")}
    >
      <p className="text-xs leading-6 text-slate-500">
        {L(
          "All recorded loans for this currently linked student, 20 per page, newest recorded first. Book titles and copy barcodes are current catalog labels. Recorded late days and penalty amounts are saved at return, not a live overdue estimate or proof of payment. No reservation, renewal, return or payment is made here. Pages reset when switching children.",
          "كل الاستعارات المسجلة للطالب المرتبط حاليا،20 في الصفحة، الأحدث تسجيلا الأول. عنوان الكتاب وباركود النسخة من الكتالوج الحالي. أيام التأخير والغرامة المسجلة محفوظة وقت الإرجاع، مش تقدير تأخير مباشر أو إثبات دفع. مفيش حجز أو تجديد أو إرجاع أو دفع من هنا. الصفحة بتبدأ من الأول لما تختار طفل تاني.",
        )}
      </p>
      <label className="block text-sm">
        {L("Loan status filter", "تصفية حالة الاستعارة")}
        <select
          aria-label={L("Loan status filter", "تصفية حالة الاستعارة")}
          className="mt-2 w-full rounded-xl border border-slate-200 bg-transparent p-3 dark:border-slate-700"
          value={status}
          onChange={(e) => {
            clear();
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{L("All loans", "كل الاستعارات")}</option>
          <option value="on_loan">{L("On loan", "قيد الاستعارة")}</option>
          <option value="returned">{L("Returned", "تم الإرجاع")}</option>
        </select>
      </label>
      {busy ? (
        <p role="status">
          {L("Loading borrowing history…", "تحميل سجل الاستعارات…")}
        </p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : (
        <>
          <p role="status" className="text-xs text-slate-500">
            {L("Matching loans", "الاستعارات المطابقة")}: {total} ·{" "}
            {L("Page", "صفحة")} {page} / {Math.max(1, Math.ceil(total / 20))}
          </p>
          {!data.length && (
            <p className="text-sm text-slate-500">
              {L(
                "No loans match these filters.",
                "مفيش استعارات مطابقة للتصفية دي.",
              )}
            </p>
          )}
          {data.map((r) => (
            <article
              key={r.id}
              data-testid="family-loan-row"
              className="space-y-3 break-words rounded-2xl border border-slate-100 p-4 text-sm dark:border-slate-800"
            >
              <div className="flex flex-wrap justify-between gap-3">
                <h3 className="font-semibold">{r.title}</h3>
                <span>
                  {r.returned_on
                    ? L("Returned", "تم الإرجاع")
                    : L("On loan", "قيد الاستعارة")}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {L("Copy barcode", "باركود النسخة")}: <bdi>{r.barcode}</bdi>
              </p>
              <dl className="grid gap-3 sm:grid-cols-2">
                {[
                  [L("Borrowed", "الاستعارة"), r.borrowed_on],
                  [L("Due", "الموعد"), r.due_on],
                  [
                    L("Returned", "الإرجاع"),
                    r.returned_on || L("Not returned", "لسه مرجعش"),
                  ],
                  [
                    L("Recorded late days", "أيام التأخير المسجلة"),
                    r.late_days,
                  ],
                  [
                    L("Recorded penalty amount", "قيمة الغرامة المسجلة"),
                    r.penalty_total,
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-slate-500">{label}</dt>
                    <dd className="mt-1">
                      <bdi dir="ltr">{value}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
          <div className="flex justify-between gap-3">
            <button
              className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
              disabled={page === 1}
              onClick={() => {
                clear();
                setPage((p) => p - 1);
              }}
            >
              {L("Previous loans", "الاستعارات السابقة")}
            </button>
            <button
              className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
              disabled={page * 20 >= total}
              onClick={() => {
                clear();
                setPage((p) => p + 1);
              }}
            >
              {L("Next loans", "الاستعارات التالية")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
