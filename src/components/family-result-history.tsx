"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui";
export function FamilyResultHistory({
  id,
  name,
  api,
  ar,
  timezone,
}: {
  id: string;
  name: string;
  api: (p: string) => Promise<any>;
  ar: boolean;
  timezone: string;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [page, setPage] = useState(1),
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
    api(`/portal/students/${id}/results?page=${page}`)
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
  }, [id, page]);
  return (
    <section
      className="space-y-4 p-5"
      aria-label={L("Final result history", "سجل النتايج النهائية")}
    >
      <p className="text-xs leading-6 text-slate-500">
        <strong>{name}</strong> ·{" "}
        {L(
          "Only finalized results from published or closed exams. All dates, newest first,20 per page. Pending results are excluded. Tied dates use result ID order. This is live academic history, not a certified report card. Filters and pages reset when switching children.",
          "النتايج النهائية للامتحانات المنشورة أو المغلقة بس. كل التواريخ، الأحدث الأول،20 في الصفحة. النتايج المعلقة مستبعدة. نفس الميعاد بيترتب بمعرّف النتيجة. ده سجل دراسي مباشر مش بيان معتمد. الصفحة بتبدأ من الأول لما تختار طفل تاني.",
        )}
      </p>
      {busy && (
        <p role="status" className="text-sm text-slate-500">
          {L("Loading final results…", "جاري تحميل النتايج النهائية…")}
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
            "No finalized results on this page.",
            "مفيش نتايج نهائية في الصفحة دي.",
          )}
        </p>
      )}
      <div className="space-y-3">
        {data.map((r) => (
          <article
            data-testid="family-result-row"
            key={r.id}
            className="rounded-xl border border-slate-100 p-4 text-sm dark:border-slate-800"
          >
            <h3 className="font-semibold">{r.name}</h3>
            <p className="mt-1 text-xs text-slate-500">{r.group_name}</p>
            <p className="mt-1 text-xs text-slate-500">
              {new Intl.DateTimeFormat(ar ? "ar-EG-u-nu-latn" : "en-GB", {
                timeZone: timezone,
                dateStyle: "medium",
                timeStyle: "short",
              }).format(r.scheduled_at * 1000)}
            </p>
            <p className="mt-3">
              {L("Score", "الدرجة")}:{" "}
              <bdi dir="ltr">
                {r.score} / {r.max_score}
              </bdi>
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-500">
              {L("Feedback", "الملاحظات")}: {r.feedback || "—"}
            </p>
          </article>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={busy || page === 1}
          onClick={() => setPage((v) => v - 1)}
        >
          {L("Previous results", "النتايج السابقة")}
        </Button>
        <p role="status" className="text-xs text-slate-500">
          {L("Page", "صفحة")} {page} · {L("Final results", "نتايج نهائية")}:{" "}
          {total}
        </p>
        <Button
          disabled={busy || page * 20 >= total || page >= 10000}
          onClick={() => setPage((v) => v + 1)}
        >
          {L("Next results", "النتايج التالية")}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        {L(
          "Live pages can shift after grade changes. Maximum page10000; contact the center for a larger archive.",
          "الصفحات ممكن تتغيّر بعد تعديل الدرجات. أقصى صفحة10000؛ تواصل مع المركز لو محتاج أرشيف أكبر.",
        )}
      </p>
    </section>
  );
}
