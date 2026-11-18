"use client";
import { useEffect, useState } from "react";
import { Button, Card, Input, Select, Field } from "./ui";
import { Dialog } from "./portals";
type Row = Record<string, any>;
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
export function CoursePackages({
  api,
  ar,
  options,
  create,
  edit,
  enroll,
}: {
  api: Api;
  ar: boolean;
  options: Record<string, Row[]>;
  create: boolean;
  edit: boolean;
  enroll: boolean;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [open, setOpen] = useState(false),
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [chosen, setChosen] = useState<Row | null>(null),
    [clock, setClock] = useState<Row | null>(null);
  async function load() {
    try {
      const response = await api("/course-packages");
      setRows(response.data);
      setClock({
        day: response.enrollment_day,
        zone: response.enrollment_timezone,
      });
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    if (open) void load();
  }, [open]);
  return (
    <>
      <Button className="bg-slate-700" onClick={() => setOpen(true)}>
        {L("Course packages", "باقات الكورسات")}
      </Button>
      {open && (
        <Dialog
          title={L("Course packages", "باقات الكورسات")}
          close={() => setOpen(false)}
        >
          <p className="mb-4 text-xs leading-6 text-slate-500">
            {L(
              "Fixed-price packages of 2–10 courses at one branch. Enrollment reserves one group per course and creates a draft invoice atomically, not a receipt or payment. Issue, collect or void through Finance. Terms are immutable; create a new package to change them.",
              "باقات بسعر ثابت من 2–10 كورسات في فرع واحد. التسجيل بيحجز مجموعة لكل كورس وبيعمل مسودة فاتورة في عملية واحدة، مش تحصيل أو دفع. الإصدار والتحصيل والإلغاء من الحسابات. شروط الباقة ثابتة؛ اعمل باقة جديدة للتغيير.",
            )}
          </p>
          {error && (
            <p role="alert" className="my-3 text-sm text-red-600">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="my-3 text-sm text-teal-700">
              {L(
                "Enrollment saved and draft invoice created. Open Finance to review and issue.",
                "تم التسجيل وعمل مسودة فاتورة. افتح الحسابات للمراجعة والإصدار.",
              )}
            </p>
          )}
          {create && (
            <form
              className="mb-6 grid gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2 dark:border-slate-700"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  d = new FormData(form);
                setBusy(true);
                setError("");
                try {
                  await api("/course-packages", "POST", {
                    branch_id: d.get("branch_id"),
                    name: d.get("name"),
                    price: Number(d.get("price")),
                    course_ids: d.getAll("course_ids"),
                    enrollment_opens_on: d.get("enrollment_opens_on") || null,
                    enrollment_closes_on: d.get("enrollment_closes_on") || null,
                  });
                  form.reset();
                  await load();
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label={L("Package name", "اسم الباقة")}>
                <Input name="name" required maxLength={160} />
              </Field>
              <Field label={L("Package branch", "فرع الباقة")}>
                <Select
                  name="branch_id"
                  aria-label={L("Package branch", "فرع الباقة")}
                  required
                >
                  <option value="">{L("Choose branch", "اختار فرع")}</option>
                  {options.branches?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={L("Fixed package price", "السعر الثابت للباقة")}>
                <Input
                  name="price"
                  type="number"
                  min={1}
                  max={1000000000}
                  step={1}
                  required
                />
              </Field>
              <Field
                label={L(
                  "Package enrollment opens on",
                  "فتح التسجيل في الباقة",
                )}
              >
                <Input type="date" name="enrollment_opens_on" />
              </Field>
              <Field
                label={L(
                  "Package enrollment closes on",
                  "قفل التسجيل في الباقة",
                )}
              >
                <Input type="date" name="enrollment_closes_on" />
              </Field>
              <p className="text-xs leading-6 text-slate-500 sm:col-span-2">
                {L(
                  "Optional inclusive dates for new package enrollment only. Server organization-local day applies, not the invoice date. Blank means no boundary. Dates are immutable; existing orders, normal course registration and class schedules do not change.",
                  "تواريخ اختيارية شاملة لتسجيل الباقة الجديدة بس. اليوم المحلي للمؤسسة من السيرفر هو الأساس، مش تاريخ الفاتورة. الفاضي من غير حد. التواريخ ثابتة؛ الطلبات القديمة وتسجيل الكورسات العادي ومواعيد الحصص مش بتتغير.",
                )}
              </p>
              <fieldset className="sm:col-span-2">
                <legend className="mb-3 text-sm font-semibold">
                  {L("Package courses, 2–10", "كورسات الباقة، 2–10")}
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {options.courses
                    ?.filter((c) => c.status === "active")
                    .map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-3 text-sm"
                      >
                        <input type="checkbox" name="course_ids" value={c.id} />
                        {c.name}
                      </label>
                    ))}
                </div>
              </fieldset>
              <div>
                <Button disabled={busy} type="submit">
                  {L("Create package", "إضافة باقة")}
                </Button>
              </div>
            </form>
          )}
          {clock && (
            <p className="mb-4 text-xs text-slate-500">
              {L("Server enrollment day", "يوم التسجيل على السيرفر")}:{" "}
              <bdi dir="ltr">
                {clock.day} · {clock.zone}
              </bdi>{" "}
              <button
                className="text-blue-700"
                disabled={busy}
                onClick={() => void load()}
              >
                {L("Refresh package availability", "تحديث إتاحة الباقات")}
              </button>
            </p>
          )}
          <div className="space-y-4">
            {rows.map((p) => (
              <Card key={p.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{p.name}</h3>
                    <p className="my-2 text-xs text-slate-500">
                      {p.price} {p.currency} ·{" "}
                      {p.status === "active"
                        ? L("Active", "نشطة")
                        : L("Archived", "مؤرشفة")}
                    </p>
                  </div>
                  {edit && (
                    <button
                      disabled={busy}
                      className="text-xs text-blue-700"
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          await api("/course-packages/" + p.id, "PUT", {
                            status:
                              p.status === "active" ? "archived" : "active",
                          });
                          await load();
                        } catch (e) {
                          setError(String(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {p.status === "active"
                        ? L("Archive package", "أرشفة الباقة")
                        : L("Restore package", "استعادة الباقة")}
                    </button>
                  )}
                </div>
                <p className="my-3 text-xs text-slate-500">
                  {L("Enrollment window", "فترة التسجيل")}:{" "}
                  <bdi dir="ltr">
                    {p.enrollment_opens_on ??
                      L("No opening limit", "من غير حد بداية")}{" "}
                    →{" "}
                    {p.enrollment_closes_on ??
                      L("No closing limit", "من غير حد نهاية")}
                  </bdi>{" "}
                  ·{" "}
                  {p.enrollment_window_open
                    ? L("Window open", "الفترة مفتوحة")
                    : L("Window not open", "الفترة مش مفتوحة")}
                </p>
                <ul className="my-3 space-y-1 text-sm">
                  {p.courses.map((c: Row) => (
                    <li key={c.course_id}>{c.name}</li>
                  ))}
                </ul>
                {enroll && p.status === "active" && (
                  <Button
                    disabled={busy || !p.enrollment_window_open}
                    onClick={() => {
                      setChosen(p);
                      setNotice("");
                    }}
                  >
                    {L("Enroll and draft invoice", "تسجيل وعمل مسودة فاتورة")}
                  </Button>
                )}
              </Card>
            ))}
          </div>
          {chosen && (
            <form
              className="mt-6 grid gap-4 rounded-xl border-2 border-blue-200 p-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                setBusy(true);
                setError("");
                try {
                  await api(
                    "/course-packages/" + chosen.id + "/enroll",
                    "POST",
                    {
                      student_id: d.get("student_id"),
                      group_ids: chosen.courses.map((c: Row) =>
                        d.get("group_" + c.course_id),
                      ),
                      invoice_number: d.get("invoice_number"),
                      date: d.get("date"),
                      due_date: d.get("due_date"),
                    },
                  );
                  setNotice(
                    L(
                      "Enrollment saved and draft invoice created. Open Finance to review and issue.",
                      "تم التسجيل وعمل مسودة فاتورة. افتح الحسابات للمراجعة والإصدار.",
                    ),
                  );
                  setChosen(null);
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h3 className="font-semibold">
                {chosen.name} · {chosen.price} {chosen.currency}
              </h3>
              <p className="text-xs text-slate-500">
                {L(
                  "All enrollments and the invoice roll back if any group is full or a prerequisite is unmet. Voiding the invoice does not withdraw enrollments; use the separate academic workflow.",
                  "لو مجموعة كاملة أو متطلب مش مكتمل، العملية كلها بترجع. إلغاء الفاتورة مش بيلغي التسجيل؛ استخدم إجراء السحب الدراسي المنفصل.",
                )}
              </p>
              <Field label={L("Package student", "طالب الباقة")}>
                <Select
                  name="student_id"
                  aria-label={L("Package student", "طالب الباقة")}
                  required
                >
                  <option value="">{L("Choose student", "اختار طالب")}</option>
                  {options.students
                    ?.filter(
                      (s) =>
                        s.branch_id === chosen.branch_id &&
                        ["new", "active"].includes(s.status),
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </Select>
              </Field>
              {chosen.courses.map((c: Row) => (
                <Field key={c.course_id} label={c.name}>
                  <Select
                    name={"group_" + c.course_id}
                    aria-label={L("Group for ", "مجموعة ") + c.name}
                    required
                  >
                    <option value="">
                      {L("Choose group", "اختار مجموعة")}
                    </option>
                    {options.groups
                      ?.filter(
                        (g) =>
                          g.course_id === c.course_id &&
                          g.branch_id === chosen.branch_id &&
                          g.status === "active",
                      )
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                  </Select>
                </Field>
              ))}
              <Field label={L("Package invoice number", "رقم فاتورة الباقة")}>
                <Input name="invoice_number" required maxLength={60} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={L("Package invoice date", "تاريخ فاتورة الباقة")}>
                  <Input name="date" type="date" required />
                </Field>
                <Field
                  label={L("Package invoice due date", "استحقاق فاتورة الباقة")}
                >
                  <Input name="due_date" type="date" required />
                </Field>
              </div>
              <Button disabled={busy} type="submit">
                {L("Confirm enrollment and draft", "تأكيد التسجيل والمسودة")}
              </Button>
              <button
                type="button"
                className="text-sm text-slate-500"
                onClick={() => setChosen(null)}
              >
                {L("Cancel package enrollment", "إلغاء تسجيل الباقة")}
              </button>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}
