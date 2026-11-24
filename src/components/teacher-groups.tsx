"use client";
import { useEffect, useRef, useState } from "react";
export function TeacherGroups({
  api,
  ar,
}: {
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
    api(`/portal/teacher/groups?page=${page}&status=${status}`)
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
  }, [page, status]);
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
      aria-label={L("Your assigned groups", "مجموعاتك")}
    >
      <p className="text-xs leading-6 text-slate-500">
        {L(
          "Every group currently assigned to you in your branch scope, 20 per page, ordered by group name.",
          "كل المجموعات المسندة ليك حاليا داخل نطاق فرعك، 20 في الصفحة، مرتبة باسم المجموعة.",
        )}
      </p>
      <label className="block text-sm">
        {L("Group status filter", "تصفية حالة المجموعة")}
        <select
          aria-label={L("Group status filter", "تصفية حالة المجموعة")}
          className="mt-2 w-full rounded-xl border border-slate-200 bg-transparent p-3 dark:border-slate-700"
          value={status}
          onChange={(e) => {
            clear();
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{L("All groups", "كل المجموعات")}</option>
          <option value="active">{L("Active", "نشط")}</option>
          <option value="completed">{L("Completed", "مكتمل")}</option>
          <option value="inactive">{L("Inactive", "غير نشط")}</option>
        </select>
      </label>
      {busy ? (
        <p role="status">{L("Loading groups…", "تحميل المجموعات…")}</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : (
        <>
          <p role="status" className="text-xs text-slate-500">
            {L("Matching groups", "المجموعات المطابقة")}: {total} ·{" "}
            {L("Page", "صفحة")} {page} / {Math.max(1, Math.ceil(total / 20))}
          </p>
          {!data.length && (
            <p className="text-sm text-slate-500">
              {L(
                "No groups match this filter.",
                "مفيش مجموعات مطابقة للتصفية دي.",
              )}
            </p>
          )}
          {data.map((r) => (
            <article
              key={r.id}
              data-testid="teacher-group-row"
              className="space-y-2 break-words rounded-2xl border border-slate-100 p-4 text-sm dark:border-slate-800"
            >
              <div className="flex flex-wrap justify-between gap-3">
                <h3 className="font-semibold">{r.name}</h3>
                <span>
                  {r.status === "completed"
                    ? L("Completed", "مكتمل")
                    : r.status === "inactive"
                      ? L("Inactive", "غير نشط")
                      : L("Active", "نشط")}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                <bdi>{r.code}</bdi> · {r.course_name} · {r.branch_name}
              </p>
              <p className="text-xs text-slate-500">
                {L("Active students", "الطلاب النشطون")}:{" "}
                <bdi>{r.students}</bdi>
              </p>
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
              {L("Previous groups", "المجموعات السابقة")}
            </button>
            <button
              className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
              disabled={page * 20 >= total}
              onClick={() => {
                clear();
                setPage((p) => p + 1);
              }}
            >
              {L("Next groups", "المجموعات التالية")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
