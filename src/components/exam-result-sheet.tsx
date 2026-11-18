"use client";
import { useRef, useState } from "react";
import { Button } from "./ui";
import { printIsolated } from "./student-card";
export function ExamResultSheet({
  id,
  api,
  ar,
  allowed,
}: {
  id: string;
  api: (p: string, m?: string, b?: unknown) => Promise<any>;
  ar: boolean;
  allowed: (r: string, a?: string) => boolean;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    ref = useRef<HTMLElement>(null),
    n = (v: number) =>
      new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v),
    outcome = (v: string) =>
      v === "passed" ? L("Passed", "ناجح") : L("Needs support", "محتاج دعم");
  async function generate(action: string) {
    setData(null);
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const r = await api("/exams/" + id + "/result-sheet", "POST", { action });
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
            "Exam",
            "Group",
            "Course",
            "Exam UTC",
            "Generated UTC",
            "Rank",
            "Student",
            "Student code",
            "Score",
            "Maximum",
            "Percent",
            "Outcome",
          ],
          ...r.results.map((s: any) => [
            r.exam.organization_name,
            r.exam.branch_name,
            r.exam.name,
            r.exam.group_name,
            r.exam.course_name,
            new Date(r.exam.scheduled_at * 1000).toISOString(),
            new Date(r.generated_at * 1000).toISOString(),
            s.rank,
            s.name,
            s.code,
            s.score,
            r.exam.max_score,
            s.percent,
            s.outcome,
          ]),
        ];
        const url = URL.createObjectURL(
            new Blob(
              [
                "\ufeff" +
                  rows.map((row) => row.map(cell).join(",")).join("\r\n"),
              ],
              { type: "text/csv;charset=utf-8" },
            ),
          ),
          a = document.createElement("a");
        a.href = url;
        a.download = "exam-final-results.csv";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice(
          L("Exported final results: ", "تم تصدير نتايج نهائية: ") +
            r.summary.final +
            L(" · Pending review excluded: ", " · مستبعد للمراجعة: ") +
            r.summary.pending_review,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="my-5 space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h3 className="font-semibold">
        {L("Final exam result sheet", "كشف النتيجة النهائية للامتحان")}
      </h3>
      <p className="text-xs leading-6 text-slate-500">
        {L(
          "Current finalized results only, up to 5000 recorded results including pending. Pending scores are excluded; learners without a result are not counted as failed or absent. Ties share competition rank. No question keys, answers, grading feedback, contacts or national IDs. A published exam can still have changing grades. Not a certified cumulative report card.",
          "النتايج النهائية المسجلة حاليا بس، لحد 5000 نتيجة مسجلة بما فيها المعلق. الدرجات المعلقة مستبعدة؛ اللي ملوش نتيجة مش محسوب راسب أو غايب. التعادل له نفس الترتيب التنافسي. من غير مفاتيح أو إجابات أو ملاحظات تصحيح أو بيانات تواصل أو رقم قومي. درجات الامتحان المنشور ممكن تتغير. مش بيان تراكمي معتمد.",
        )}
      </p>
      <div className="flex flex-wrap gap-3">
        {allowed("exams", "print") && (
          <Button disabled={busy} onClick={() => generate("print")}>
            {L("Prepare result sheet", "تجهيز كشف النتيجة")}
          </Button>
        )}
        {allowed("exams", "export") && (
          <Button disabled={busy} onClick={() => generate("export")}>
            {L("Export final results CSV", "تصدير النتايج النهائية CSV")}
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
            data-exam-result-sheet
            className="bg-white p-4 text-slate-900"
          >
            <header className="border-b border-slate-200 pb-4">
              <h3 className="break-words text-xl font-semibold">
                {data.exam.name}
              </h3>
              <p className="mt-2 text-sm">
                {data.exam.organization_name} · {data.exam.branch_name}
              </p>
              <p className="mt-2 text-sm">
                {data.exam.group_name} · {data.exam.course_name}
              </p>
              <p className="mt-2 text-xs">
                {L("Exam UTC", "الامتحان UTC")}:{" "}
                <bdi dir="ltr">
                  {new Date(data.exam.scheduled_at * 1000).toISOString()}
                </bdi>
              </p>
              <p className="mt-2 text-xs">
                {L("Final / pending review", "نهائي / معلق")}:{" "}
                <bdi dir="ltr">
                  {data.summary.final} / {data.summary.pending_review}
                </bdi>
              </p>
              <p className="mt-2 text-xs">
                {L("Passed / needs support", "ناجح / محتاج دعم")}:{" "}
                <bdi dir="ltr">
                  {data.summary.passed} / {data.summary.needs_support}
                </bdi>
              </p>
              <p className="mt-2 text-xs">
                {L("Final average", "متوسط النهائي")}:{" "}
                {data.summary.average_score === null ? (
                  L("No final grades", "مفيش درجات نهائية")
                ) : (
                  <bdi dir="ltr">
                    {n(data.summary.average_score)} / {n(data.exam.max_score)}
                  </bdi>
                )}
              </p>
              <p className="mt-2 text-xs">
                {L("Pass threshold", "درجة النجاح")}:{" "}
                <bdi dir="ltr">
                  {n(data.exam.pass_score)} / {n(data.exam.max_score)}
                </bdi>
              </p>
            </header>
            <table className="mt-4 w-full table-fixed text-start text-xs">
              <thead>
                <tr>
                  {[
                    L("Rank / student", "الترتيب / الطالب"),
                    L("Score / percent", "الدرجة / النسبة"),
                    L("Outcome", "النتيجة"),
                  ].map((h) => (
                    <th
                      key={h}
                      className="border-b border-slate-200 p-2 text-start"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.results.map((r: any, i: number) => (
                  <tr key={i} className="break-inside-avoid">
                    <td className="break-words border-b border-slate-200 p-2">
                      <bdi dir="ltr">{r.rank}.</bdi> <bdi>{r.name}</bdi>
                      <p className="mt-1">
                        <bdi>{r.code}</bdi>
                      </p>
                    </td>
                    <td className="border-b border-slate-200 p-2">
                      <bdi>
                        {n(r.score)} / {n(data.exam.max_score)} · {n(r.percent)}
                        %
                      </bdi>
                    </td>
                    <td className="break-words border-b border-slate-200 p-2">
                      {outcome(r.outcome)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.results.length === 0 && (
              <p className="mt-4 text-sm">
                {L("No finalized results recorded", "مفيش نتايج نهائية مسجلة")}
              </p>
            )}
            <footer className="mt-5 text-xs text-slate-500">
              <p>
                {L(
                  "Private current sheet, not certification. Pending and missing results excluded. Printed copies cannot be recalled.",
                  "كشف حالي خاص مش شهادة. المعلق والنتايج غير المسجلة مستبعدين. النسخ المطبوعة مش بتتسحب.",
                )}
              </p>
              <p dir="ltr" className="mt-2">
                {new Date(data.generated_at * 1000).toISOString()}
              </p>
            </footer>
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
                    "ELCenter private final exam results",
                  );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {L("Print result sheet / Save PDF", "طباعة كشف النتيجة / حفظ PDF")}
          </Button>
        </>
      )}
    </section>
  );
}
