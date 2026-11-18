"use client";
import { useRef, useState } from "react";
import { Button, Select } from "./ui";
import { printIsolated } from "./student-card";
export function GroupRoster({
  api,
  id,
  ar,
  allowed,
}: {
  api: (p: string, m?: string, b?: unknown) => Promise<any>;
  id: string;
  ar: boolean;
  allowed: (r: string, a?: string) => boolean;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [status, setStatus] = useState("active"),
    [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    ref = useRef<HTMLElement>(null);
  const state = (v: string) =>
    ({
      active: L("Active", "نشط"),
      waiting: L("Waiting", "انتظار"),
      withdrawn: L("Withdrawn", "منسحب"),
      completed: L("Completed", "مكتمل"),
      transferred: L("Transferred", "منقول"),
      all: L("All recorded enrollments", "كل التسجيلات المسجلة"),
    })[v] ?? v;
  async function generate(action: string) {
    setBusy(true);
    setError("");
    setNotice("");
    setData(null);
    try {
      const r = await api("/groups/" + id + "/roster", "POST", {
        action,
        status,
      });
      if (action === "print") setData(r);
      else {
        const cell = (v: unknown) =>
          '"' +
          String(v ?? "")
            .replace(/^\s*[=+@\-\t\r]/, (m) => "'" + m)
            .replaceAll('"', '""') +
          '"';
        const rows = [
          [
            "Organization",
            "Branch",
            "Group",
            "Group code",
            "Course",
            "Teacher",
            "Enrollment filter",
            "Generated UTC",
            "Student name",
            "Student code",
            "Enrollment status",
          ],
          ...r.students.map((s: any) => [
            r.group.organization_name,
            r.group.branch_name,
            r.group.name,
            r.group.code,
            r.group.course_name,
            r.group.teacher_name,
            r.status,
            new Date(r.generated_at * 1000).toISOString(),
            s.name,
            s.code,
            s.enrollment_status,
          ]),
        ];
        const blob = new Blob(
            [
              "\ufeff" +
                rows.map((row) => row.map(cell).join(",")).join("\r\n"),
            ],
            { type: "text/csv;charset=utf-8" },
          ),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = "group-roster.csv";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice(
          L("Exported enrollments: ", "تم تصدير تسجيلات: ") + r.students.length,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h3 className="font-semibold">{L("Student roster", "قائمة الطلاب")}</h3>
      <p className="text-xs leading-6 text-slate-500">
        {L(
          "Current recorded enrollment snapshot, up to 5000 complete rows. Names, student codes and enrollment states only, no contacts, national IDs, notes or finances. Not proof of identity or an attendance register.",
          "لقطة من التسجيلات الحالية، لحد 5000 صف كامل. أسماء وأكواد وحالات التسجيل بس، من غير تواصل أو رقم قومي أو ملاحظات أو حسابات. مش إثبات هوية أو دفتر حضور.",
        )}
      </p>
      <Select
        aria-label={L("Roster enrollment status", "حالة تسجيل القائمة")}
        value={status}
        disabled={busy}
        onChange={(e) => {
          setStatus(e.target.value);
          setData(null);
          setNotice("");
        }}
      >
        {["active", "waiting", "all"].map((s) => (
          <option key={s} value={s}>
            {state(s)}
          </option>
        ))}
      </Select>
      <div className="flex flex-wrap gap-3">
        {allowed("groups", "print") && (
          <Button disabled={busy} onClick={() => generate("print")}>
            {L("Prepare roster print", "تجهيز طباعة القائمة")}
          </Button>
        )}
        {allowed("groups", "export") && (
          <Button disabled={busy} onClick={() => generate("export")}>
            {L("Export roster CSV", "تصدير القائمة CSV")}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-teal-700">
          {notice}
        </p>
      )}
      {data && (
        <>
          <article
            ref={ref}
            data-group-roster-print
            className="bg-white p-4 text-slate-900"
          >
            <header className="border-b border-slate-200 pb-4">
              <h3 className="break-words text-xl font-semibold">
                {data.group.name} · {data.group.code}
              </h3>
              <p className="mt-2 text-sm">
                {data.group.organization_name} · {data.group.branch_name}
              </p>
              <p className="mt-2 text-sm">
                {data.group.course_name} · {data.group.teacher_name}
              </p>
              <p className="mt-2 text-xs">
                {state(data.status)} · {data.students.length}
              </p>
              <p dir="ltr" className="mt-2 text-xs">
                {new Date(data.generated_at * 1000).toISOString()}
              </p>
            </header>
            <table className="mt-4 w-full table-fixed text-start text-xs">
              <thead>
                <tr>
                  {[
                    L("Name", "الاسم"),
                    L("Student code", "كود الطالب"),
                    L("Enrollment", "التسجيل"),
                  ].map((x) => (
                    <th
                      key={x}
                      className="border-b border-slate-200 p-2 text-start"
                    >
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.students.map((s: any, i: number) => (
                  <tr key={i} className="break-inside-avoid">
                    <td className="break-words border-b border-slate-200 p-2">
                      {s.name}
                    </td>
                    <td className="break-words border-b border-slate-200 p-2">
                      <bdi>{s.code}</bdi>
                    </td>
                    <td className="break-words border-b border-slate-200 p-2">
                      {state(s.enrollment_status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.students.length === 0 && (
              <p className="mt-4 text-sm">
                {L("No matching enrollments", "مفيش تسجيلات مطابقة")}
              </p>
            )}
            <p className="mt-5 text-xs text-slate-500">
              {L(
                "Private roster. Current records only; printed copies are not recalled.",
                "قائمة خاصة من السجلات الحالية. النسخ المطبوعة مش بتتسحب بعد التعديل.",
              )}
            </p>
          </article>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                if (ref.current)
                  await printIsolated(
                    ref.current,
                    "ELCenter private group roster",
                  );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {L("Print roster / Save PDF", "طباعة القائمة / حفظ PDF")}
          </Button>
        </>
      )}
    </section>
  );
}
