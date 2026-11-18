"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
export function FamilyRequestHistory({
  id,
  name,
  ar,
  api,
  version = 0,
  timezone,
  staff = false,
  action,
}: {
  id: string;
  name: string;
  ar: boolean;
  api: (p: string) => Promise<any>;
  version?: number;
  timezone: string;
  staff?: boolean;
  action?: (r: any) => ReactNode;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [page, setPage] = useState(1),
    [status, setStatus] = useState(""),
    [kind, setKind] = useState(""),
    [rows, setRows] = useState<any[]>([]),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    request = useRef(0);
  useEffect(() => {
    const n = ++request.current;
    setRows([]);
    setTotal(0);
    setBusy(true);
    setError("");
    api(
      (staff ? "/portal-requests" : `/portal/students/${id}/requests`) +
        `?page=${page}&status=${status}&kind=${kind}`,
    )
      .then((r) => {
        if (n === request.current) {
          setRows(r.data);
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
  }, [id, page, status, kind, version, staff]);
  function clear() {
    request.current++;
    setRows([]);
    setTotal(0);
    setError("");
    setBusy(true);
  }
  const types: Record<string, string> = {
      absence_excuse: L("Absence excuse", "عذر غياب"),
      meeting: L("Meeting", "اجتماع"),
      contact: L("Contact", "تواصل"),
    },
    statuses: Record<string, string> = {
      pending: L("Pending", "قيد الانتظار"),
      accepted: L("Accepted", "مقبول"),
      rejected: L("Rejected", "مرفوض"),
      closed: L("Closed", "مغلق"),
    };
  return (
    <section
      className="space-y-4 p-5"
      aria-label={
        staff
          ? L("Family request review queue", "قائمة مراجعة طلبات الأسرة")
          : L("Your center request history", "سجل طلباتك للمركز")
      }
    >
      <p className="text-xs leading-6 text-slate-500">
        <strong>{name}</strong> ·{" "}
        {staff
          ? L(
              "All submitted family requests in your current membership branch scope, 20 per page. Pending requests need a separate authorized staff response. Decisions are saved with an in-app notification, not external delivery or a confirmed appointment. Absence requests do not change attendance.",
              "كل طلبات الأسرة في نطاق فرع عضويتك الحالي،20 في الصفحة. الطلبات المعلقة محتاجة رد موظف عنده الصلاحية. القرار بيتحفظ مع إشعار داخل التطبيق، مش إرسال خارجي أو موعد مؤكد. طلبات الغياب مش بتغير الحضور.",
            )
          : L(
              "Only requests submitted by this login for this student. Another guardian's or student's private requests are not shared. All recorded dates, 20 per page. Stored center requests and responses only, not external messages or a confirmed appointment. Submitting an absence excuse does not change attendance.",
              "طلبات الحساب ده للطالب ده بس. طلبات ولي أمر تاني أو الطالب الخاصة مش مشتركة. كل التواريخ المسجلة،20 في الصفحة. دي طلبات وردود محفوظة للمركز بس، مش رسائل خارجية أو موعد مؤكد. تقديم عذر غياب مش بيغير الحضور.",
            )}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          {L("Request status filter", "تصفية حالة الطلب")}
          <select
            aria-label={L("Request status filter", "تصفية حالة الطلب")}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-transparent p-3 dark:border-slate-700"
            value={status}
            onChange={(e) => {
              clear();
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{L("All statuses", "كل الحالات")}</option>
            {Object.entries(statuses).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {L("Request type filter", "تصفية نوع الطلب")}
          <select
            aria-label={L("Request type filter", "تصفية نوع الطلب")}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-transparent p-3 dark:border-slate-700"
            value={kind}
            onChange={(e) => {
              clear();
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="">
              {L("All request types", "كل أنواع الطلبات")}
            </option>
            {Object.entries(types).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {busy ? (
        <p role="status">{L("Loading requests…", "تحميل الطلبات…")}</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : (
        <>
          <p role="status" className="text-xs text-slate-500">
            {L("Matching requests", "الطلبات المطابقة")}: {total} ·{" "}
            {L("Page", "صفحة")} {page} / {Math.max(1, Math.ceil(total / 20))}
          </p>
          {!rows.length && (
            <p className="text-sm text-slate-500">
              {L(
                "No requests match these filters.",
                "مفيش طلبات مطابقة للتصفية دي.",
              )}
            </p>
          )}
          {rows.map((r) => (
            <article
              key={r.id}
              data-testid="family-request-row"
              className="space-y-3 break-words rounded-2xl border border-slate-100 p-4 dark:border-slate-800"
            >
              {staff && (
                <p className="text-xs text-slate-500">{r.student_name}</p>
              )}
              <div className="flex flex-wrap justify-between gap-3 text-sm">
                <strong>{r.subject}</strong>
                <span>{statuses[r.status]}</span>
              </div>
              <p className="text-xs text-slate-500">
                {types[r.kind]} ·{" "}
                {new Date(
                  r.created_at.replace(" ", "T") +
                    (/Z$|[+-]\d\d:\d\d$/.test(r.created_at) ? "" : "Z"),
                ).toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB", {
                  timeZone: timezone,
                })}
              </p>
              {r.requested_on && (
                <p className="text-xs">
                  {L("Requested date", "التاريخ المطلوب")}:{" "}
                  <bdi dir="ltr">{r.requested_on}</bdi>
                </p>
              )}
              <p className="whitespace-pre-wrap text-sm leading-7 text-slate-500">
                {r.body}
              </p>
              {r.response && (
                <div className="rounded-xl bg-blue-50 p-3 text-sm leading-7 dark:bg-blue-950">
                  <strong>{L("Center response", "رد المركز")}</strong>
                  <p className="whitespace-pre-wrap">{r.response}</p>
                </div>
              )}
              {action?.(r)}
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
              {L("Previous requests", "الطلبات السابقة")}
            </button>
            <button
              className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
              disabled={page * 20 >= total}
              onClick={() => {
                clear();
                setPage((p) => p + 1);
              }}
            >
              {L("Next requests", "الطلبات التالية")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
