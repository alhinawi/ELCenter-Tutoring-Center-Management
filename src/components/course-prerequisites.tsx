"use client";
import { useEffect, useState } from "react";
import { Button, Select, Field } from "./ui";
type Row = Record<string, any>;
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
export function CoursePrerequisites({
  api,
  ar,
  id,
  options,
  editable,
}: {
  api: Api;
  ar: boolean;
  id: string;
  options: Row[];
  editable: boolean;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setRows((await api("/courses/" + id + "/prerequisites")).data);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h3 className="font-semibold">
        {L("Course prerequisites", "متطلبات الكورس")}
      </h3>
      <p className="my-3 text-xs leading-6 text-slate-500">
        {L(
          "New enrollments and waitlists need a recorded completed enrollment in every required course. Existing enrollments are unchanged. This is a staff-recorded completion rule, not a grade or certificate check. At most 20 direct prerequisites.",
          "التسجيل الجديد وقائمة الانتظار محتاجين تسجيل مكتمل في كل كورس مطلوب. التسجيلات الحالية مش بتتغير. الشرط بيعتمد على إكمال مسجل من الموظف، مش درجة امتحان أو شهادة. الحد 20 متطلب مباشر.",
        )}
      </p>
      {error && (
        <p role="alert" className="my-3 text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="space-y-3">
        {rows.map((r) => (
          <div
            key={r.prerequisite_id}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span>
              {r.name} · {r.code}
              {r.status !== "active" ? " (" + r.status + ")" : ""}
            </span>
            {editable && (
              <button
                disabled={busy}
                className="text-red-600"
                onClick={async () => {
                  if (
                    !confirm(
                      L(
                        "Remove this requirement for future enrollments?",
                        "نلغي الشرط ده للتسجيلات الجديدة؟",
                      ),
                    )
                  )
                    return;
                  setBusy(true);
                  setError("");
                  try {
                    await api(
                      "/courses/" + id + "/prerequisites/" + r.prerequisite_id,
                      "DELETE",
                      {},
                    );
                    await load();
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {L("Remove prerequisite", "إلغاء المتطلب")}
              </button>
            )}
          </div>
        ))}
      </div>
      {editable && (
        <form
          className="mt-4 grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              await api("/courses/" + id + "/prerequisites", "POST", {
                prerequisite_id: d.get("prerequisite_id"),
              });
              await load();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={L("Required course", "الكورس المطلوب")}>
            <Select
              name="prerequisite_id"
              aria-label={L("Required course", "الكورس المطلوب")}
              required
            >
              <option value="">{L("Choose course", "اختار كورس")}</option>
              {options
                .filter(
                  (o) =>
                    o.id !== id &&
                    o.status === "active" &&
                    !rows.some((r) => r.prerequisite_id === o.id),
                )
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Button disabled={busy} type="submit">
            {L("Add prerequisite", "إضافة متطلب")}
          </Button>
        </form>
      )}
    </section>
  );
}
