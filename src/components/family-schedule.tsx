"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Field, Input } from "./ui";
export function FamilySchedule({
  id,
  name,
  api,
  ar,
  teacher = false,
  attendance,
}: {
  id: string;
  name: string;
  api: (p: string) => Promise<any>;
  ar: boolean;
  teacher?: boolean;
  attendance?: (id: string) => ReactNode;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [applied, setApplied] = useState<{ from: string; to: string } | null>(null),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [data, setData] = useState<any[]>([]),
    [zone, setZone] = useState(""),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [version, setVersion] = useState(0),
    request = useRef(0);
  useEffect(() => {
    const current = ++request.current;
    setData([]);
    setBusy(true);
    setError("");
    setDirty(false);
    api(
      (teacher
        ? "/portal/teacher/schedule"
        : `/portal/students/${id}/schedule`) +
        (applied ? `?from=${applied.from}&to=${applied.to}` : ""),
    )
      .then((r) => {
        if (current === request.current) {
          setData(r.data);
          setZone(r.timezone);
          setFrom(r.from);
          setTo(r.to);
        }
      })
      .catch((e) => {
        if (current === request.current) setError(e.message);
      })
      .finally(() => {
        if (current === request.current) setBusy(false);
      });
    return () => {
      request.current++;
    };
  }, [id, teacher, applied, version]);
  function edit() {
    request.current++;
    setData([]);
    setBusy(false);
    setError("");
    setDirty(true);
  }
  const status: Record<string, string> = {
    scheduled: L("Scheduled", "مجدول"),
    completed: L("Completed", "مكتمل"),
    cancelled: L("Cancelled", "ملغي"),
  };
  return (
    <section
      className="space-y-4 p-5"
      aria-label={
        teacher
          ? L("Teacher schedule window", "فترة جدول المدرّس")
          : L("Family schedule window", "فترة جدول الأسرة")
      }
    >
      <p className="text-xs leading-6 text-slate-500">
        <strong>{name}</strong> ·{" "}
        {teacher
          ? L(
              "Only sessions assigned to your currently linked teacher profile, within your membership branch scope. Group defaults do not grant access to another teacher's replacement session. Canceled/completed sessions stay labeled. Both dates are inclusive in organization time. Default seven days ago through 90 days ahead; maximum 370 calendar days and 1000 complete sessions. Exceeding the cap rejects the whole window, narrow dates. Attendance actions recheck assignment separately.",
              "الحصص المسندة لملف المدرّس المرتبط بحسابك حاليا بس، في نطاق فرع عضويتك. المدرّس الافتراضي للمجموعة مش بيديك حصة بديل مسندة لمدرّس تاني. الملغي والمكتمل ظاهر بحالته. التاريخين شاملين بتوقيت المؤسسة. الافتراضي من7 أيام فاتوا لحد90 يوم قدام؛ بحد370 يوم تقويمي و1000 حصة كاملة. لو العدد أكبر الفترة كلها بترفض؛ ضيّق التواريخ. إجراءات الحضور بتراجع التكليف بشكل مستقل.",
            )
          : L(
              "Sessions in currently active enrollments only, including replacement teachers/rooms. Canceled/completed sessions remain labeled, not hidden. Both dates are inclusive in the organization timezone. Default yesterday through120 days ahead, up to370 calendar days and 1000 complete sessions per request. Exceeding the limit rejects the whole window; narrow dates. Not an attendance record.",
              "حصص التسجيلات النشطة حاليا بس، بما فيها المدرّسين والقاعات البديلة. الحصص الملغية والمكتملة ظاهرة بحالتها. التاريخين شاملين بتوقيت المؤسسة. الافتراضي من إمبارح لحد120 يوم قدام، بحد370 يوم تقويمي و1000 حصة كاملة للطلب. لو العدد أكبر الفترة كلها بترفض؛ ضيّق التواريخ. ده مش سجل حضور.",
            )}
      </p>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ from, to });
          setVersion((v) => v + 1);
        }}
      >
        <Field label={L("Schedule from date", "تاريخ بداية الجدول")}>
          <Input
            aria-label={L("Schedule from date", "تاريخ بداية الجدول")}
            type="date"
            required
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              edit();
            }}
          />
        </Field>
        <Field label={L("Schedule through date", "تاريخ نهاية الجدول")}>
          <Input
            aria-label={L("Schedule through date", "تاريخ نهاية الجدول")}
            type="date"
            required
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              edit();
            }}
          />
        </Field>
        <Button type="submit" disabled={busy || !from || !to}>
          {L("Apply schedule dates", "طبّق تواريخ الجدول")}
        </Button>
        <p className="self-center text-xs text-slate-500">{zone}</p>
      </form>
      {dirty && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-300">
          {L(
            "Dates changed. Apply to load this window; previous sessions were cleared.",
            "التواريخ اتغيّرت. طبّق عشان تحمّل الفترة؛ الحصص القديمة اتشالت.",
          )}
        </p>
      )}
      {busy && (
        <p role="status" className="text-sm text-slate-500">
          {L("Loading schedule…", "جاري تحميل الجدول…")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!busy && !error && !dirty && (
        <p role="status" className="text-xs text-slate-500">
          {L("Complete window sessions", "حصص الفترة الكاملة")}: {data.length}
        </p>
      )}
      {!busy && !error && !dirty && !data.length && (
        <p className="text-sm text-slate-500">
          {L("No sessions in this date window.", "مفيش حصص في الفترة دي.")}
        </p>
      )}
      <div className="space-y-3">
        {data.map((r) => (
          <article
            key={r.id}
            data-testid="family-schedule-row"
            className="space-y-2 rounded-xl border border-slate-100 p-4 text-sm dark:border-slate-800"
          >
            <h3 className="break-words font-semibold">
              {r.topic || r.group_name}
            </h3>
            <p className="text-xs text-slate-500">
              {r.group_name} · {r.teacher_name}
            </p>
            <p className="text-xs text-slate-500">{r.classroom_name}</p>
            <p className="text-xs text-slate-500">
              {new Intl.DateTimeFormat(ar ? "ar-EG-u-nu-latn" : "en-GB", {
                timeZone: zone,
                dateStyle: "medium",
                timeStyle: "short",
              }).format(r.starts_at * 1000)}
            </p>
            <p className="text-xs">{status[r.status] ?? r.status}</p>
            {attendance?.(r.id)}
          </article>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {L(
          "A live schedule, not a saved or externally delivered itinerary. Apply again to refresh; switching profiles resets dates. Session start determines the selected calendar day.",
          "جدول مباشر مش نسخة محفوظة أو ميعاد مبعوت خارجيا. طبّق تاني للتحديث؛ تغيير الملف بيبدأ التواريخ من جديد. بداية الحصة هي اللي بتحدد اليوم المختار.",
        )}
      </p>
    </section>
  );
}
