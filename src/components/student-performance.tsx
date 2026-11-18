"use client";
import { useEffect, useState } from "react";
import { Button, Field, Input, Select } from "./ui";
export function StudentPerformance({
  api,
  ar,
}: {
  api: (p: string, m?: string, b?: unknown) => Promise<any>;
  ar: boolean;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [data, setData] = useState<any[]>([]),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData([]);
    setTotal(0);
    setBusy(true);
    setError("");
    api(
      `/academic/performance?page=${page}&q=${encodeURIComponent(q)}&status=${status}`,
    )
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
  }, [page, q, status]);
  return (
    <section className="space-y-4">
      <p className="text-xs leading-6 text-slate-500">
        {L(
          "Current student branch, all recorded dates and statuses, including demo records and any stored canceled-session attendance. Branch accounts include only session/exam activity recorded in their branch; headquarters includes all organization activity. Attendance = present, late or left early / non-excused recorded rows. Unrecorded sessions are not absences. Exam percentage weights finalized scores by each exam's maximum; pending results are excluded. No applicable records shows a dash. Not a certified report card or an improvement measure.",
          "فرع الطالب الحالي، وكل التواريخ والحالات المسجلة، بما فيها البيانات التجريبية وأي حضور محفوظ لحصص ملغية. حساب الفرع بيحسب نشاط الحصص والامتحانات المسجل في فرعه بس؛ الإدارة بتشوف نشاط المؤسسة كله. الحضور = حاضر أو متأخر أو مشي بدري / السجلات غير المعذورة. الحصص غير المسجلة مش غياب. نسبة الامتحانات موزونة بالدرجة النهائية لكل امتحان وبتستبعد النتائج المعلقة. مفيش سجلات مناسبة بيظهر شرطة. مش بيان معتمد ولا مقياس تحسّن.",
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={L(
            "Search performance by student name",
            "ابحث في المستوى باسم الطالب",
          )}
        >
          <Input
            aria-label={L(
              "Search performance by student name",
              "ابحث في المستوى باسم الطالب",
            )}
            value={q}
            maxLength={100}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label={L("Performance student status", "حالة طالب المستوى")}>
          <Select
            aria-label={L("Performance student status", "حالة طالب المستوى")}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">
              {L("All student statuses", "كل حالات الطلبة")}
            </option>
            {[
              ["new", "New", "جديد"],
              ["active", "Active", "نشط"],
              ["inactive", "Inactive", "غير نشط"],
              ["suspended", "Suspended", "موقوف"],
              ["graduated", "Graduated", "متخرج"],
              ["withdrawn", "Withdrawn", "منسحب"],
              ["pending", "Pending registration", "في انتظار التسجيل"],
            ].map(([v, e, a]) => (
              <option key={v} value={v}>
                {L(e, a)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {busy && (
        <p role="status" className="text-sm text-slate-500">
          {L("Loading student performance…", "جاري تحميل مستوى الطلبة…")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!busy && !error && !data.length && (
        <p className="text-sm text-slate-500">
          {L("No matching students", "مفيش طلبة مطابقين")}
        </p>
      )}
      <div className="space-y-3">
        {data.map((s) => (
          <article
            key={s.id}
            data-testid="student-performance-row"
            className="grid gap-3 rounded-xl bg-slate-50 p-4 text-xs dark:bg-slate-800 sm:grid-cols-3"
          >
            <div>
              <h3 className="font-semibold">{s.name}</h3>
              <p className="mt-1 text-slate-500">
                <bdi>{s.code}</bdi>
              </p>
            </div>
            <div>
              <p>
                {L("Attendance", "الحضور")}:{" "}
                <bdi dir="ltr">
                  {s.attendance_percent === null
                    ? "—"
                    : s.attendance_percent + "%"}
                </bdi>
              </p>
              <p className="mt-1 text-slate-500">
                {L("Attended / non-excused", "حضور / غير معذور")}:{" "}
                <bdi dir="ltr">
                  {s.attended_count} / {s.attendance_eligible}
                </bdi>
              </p>
              <p className="mt-1 text-slate-500">
                {L("Recorded attendance", "سجلات الحضور")}: {s.attendance_count}
              </p>
            </div>
            <div>
              <p>
                {L("Exams", "الامتحانات")}:{" "}
                <bdi dir="ltr">
                  {s.exam_percent === null ? "—" : s.exam_percent + "%"}
                </bdi>
              </p>
              <p className="mt-1 text-slate-500">
                {L("Final results", "نتايج نهائية")}: {s.exam_count}
              </p>
            </div>
          </article>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={busy || page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          {L("Previous performance page", "صفحة المستوى السابقة")}
        </Button>
        <p role="status" className="text-xs text-slate-500">
          {L("Page", "صفحة")} {page} · {L("Matching students", "طلبة مطابقين")}:{" "}
          {total}
        </p>
        <Button
          disabled={busy || page * 20 >= total || page >= 10000}
          onClick={() => setPage((p) => p + 1)}
        >
          {L("Next performance page", "صفحة المستوى التالية")}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        {L(
          "20 students per page, sorted by name and ID. Name search starts at the beginning and uses the first 46 UTF-8 bytes, following the existing directory search. Live pages can shift after changes. Maximum page 10000; narrow the search beyond it.",
          "20 طالب في الصفحة، بالاسم والمعرّف. البحث من أول الاسم وبيستخدم أول 46 بايت UTF-8 زي بحث القوائم الحالي. الصفحات ممكن تتغيّر بعد التعديلات. أقصى صفحة 10000؛ ضيّق البحث لو العدد أكبر.",
        )}
      </p>
    </section>
  );
}
