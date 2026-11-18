"use client";
import { useEffect, useState } from "react";
import { Button, Select, Field } from "./ui";
export function FamilyAttendanceHistory({
  id,
  name,
  api,
  ar,
  timezone,
  correction,
}: {
  id: string;
  name: string;
  api: (p: string) => Promise<any>;
  ar: boolean;
  timezone: string;
  correction: (row: Record<string, any>) => void;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [page, setPage] = useState(1),
    [status, setStatus] = useState(""),
    [data, setData] = useState<any[]>([]),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const labels: Record<string, string> = {
    present: L("Present", "حاضر"),
    absent: L("Absent", "غائب"),
    late: L("Late", "متأخر"),
    excused: L("Excused", "بعذر"),
    left_early: L("Left early", "انصرف مبكرا"),
  };
  const date = (value: number | null) =>
    value === null
      ? "—"
      : new Intl.DateTimeFormat(ar ? "ar-EG-u-nu-latn" : "en-GB", {
          timeZone: timezone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(value * 1000);
  useEffect(() => {
    let active = true;
    setData([]);
    setTotal(0);
    setBusy(true);
    setError("");
    api(`/portal/students/${id}/attendance?page=${page}&status=${status}`)
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
      aria-label={L("Recorded attendance history", "سجل الحضور المسجل")}
    >
      <p className="text-xs leading-6 text-slate-500">
        <strong>{name}</strong> ·{" "}
        {L(
          "All recorded dates, newest session first,20 per page. Only saved attendance rows, including any stored canceled-session history. Unrecorded sessions are not inferred as absences. No internal notes or recording staff details. Requests do not change records until an independent reviewer approves.",
          "كل التواريخ المسجلة، أحدث حصة الأول،20 في الصفحة. سجلات الحضور المحفوظة بس، بما فيها أي سجل محفوظ لحصة ملغية. الحصص غير المسجلة مش محسوبة غياب. من غير ملاحظات داخلية أو بيانات الموظف المسجّل. الطلب مش بيغيّر السجل لحد موافقة مراجع مستقل.",
        )}
      </p>
      <Field label={L("Attendance history status", "حالة سجل الحضور")}>
        <Select
          aria-label={L("Attendance history status", "حالة سجل الحضور")}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">
            {L("All attendance statuses", "كل حالات الحضور")}
          </option>
          {Object.entries(labels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      {busy && (
        <p role="status" className="text-sm text-slate-500">
          {L("Loading recorded attendance…", "جاري تحميل سجل الحضور…")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!busy && !error && !data.length && (
        <p className="text-sm text-slate-500">
          {L("No matching recorded attendance.", "مفيش حضور مسجل مطابق.")}
        </p>
      )}
      <div className="space-y-3">
        {data.map((r) => (
          <article
            key={r.id}
            data-testid="family-attendance-row"
            className="space-y-2 rounded-xl border border-slate-100 p-4 text-sm dark:border-slate-800"
          >
            <h3 className="font-semibold">{r.group_name}</h3>
            <p className="break-words text-xs text-slate-500">
              {r.topic || "—"}
            </p>
            <p className="text-xs text-slate-500">{date(r.starts_at)}</p>
            <p>
              {L("Attendance", "الحضور")}: {labels[r.status] ?? r.status}
            </p>
            <p className="text-xs text-slate-500">
              {L("Arrival", "الوصول")}: {date(r.arrival)}
            </p>
            <p className="text-xs text-slate-500">
              {L("Departure", "المغادرة")}: {date(r.departure)}
            </p>
            {r.session_status === "cancelled" && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {L(
                  "Session marked canceled; this is a stored historical record.",
                  "الحصة مسجلة ملغية؛ ده سجل تاريخي محفوظ.",
                )}
              </p>
            )}
            <button
              className="text-sm font-medium text-blue-700 dark:text-blue-300"
              onClick={() => correction(r)}
            >
              {L("Request / history", "طلب / السجل")}
            </button>
          </article>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={busy || page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          {L("Previous attendance", "الحضور السابق")}
        </Button>
        <p role="status" className="text-xs text-slate-500">
          {L("Page", "صفحة")} {page} ·{" "}
          {L("Matching attendance records", "سجلات حضور مطابقة")}: {total}
        </p>
        <Button
          disabled={busy || page * 20 >= total || page >= 10000}
          onClick={() => setPage((p) => p + 1)}
        >
          {L("Next attendance", "الحضور التالي")}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        {L(
          "Live pages can shift after attendance corrections. Tied session times use attendance ID. Filters reset on child change. Maximum page10000; contact your center for a larger archive.",
          "الصفحات ممكن تتغيّر بعد تصحيح الحضور. نفس ميعاد الحصة بيترتب بمعرّف الحضور. الفلاتر بتبدأ من جديد لما تختار طفل تاني. أقصى صفحة10000؛ تواصل مع المركز لو محتاج أرشيف أكبر.",
        )}
      </p>
    </section>
  );
}
