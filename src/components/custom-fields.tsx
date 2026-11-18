"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Field, Input, Select } from "./ui";
import { Table } from "./portals";
type Row = Record<string, any>;
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
const entities = [
  "students",
  "guardians",
  "teachers",
  "courses",
  "groups",
  "classrooms",
  "employees",
];
const names: Record<string, string> = {
  students: "الطلبة",
  guardians: "أولياء الأمور",
  teachers: "المدرسين",
  courses: "الكورسات",
  groups: "المجموعات",
  classrooms: "القاعات",
  employees: "الموظفين",
};
export function CustomFieldDefinitions({
  api,
  ar,
  editable,
}: {
  api: Api;
  ar: boolean;
  editable: boolean;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [type, setType] = useState("text");
  async function load() {
    try {
      setRows((await api("/custom-fields")).data);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      d = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await api("/custom-fields", "POST", {
        entity: d.get("entity"),
        field_key: d.get("field_key"),
        label: d.get("label"),
        type,
        options:
          type === "select"
            ? String(d.get("options"))
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
        required: d.get("required") === "on",
      });
      form.reset();
      setType("text");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="my-6 p-6 md:p-8">
      <h2 className="font-semibold">
        {L("Custom record fields", "حقول إضافية للسجلات")}
      </h2>
      <p className="my-3 text-xs leading-6 text-slate-500">
        {L(
          "Add typed fields to academic record details. Archived values are retained read-only. Required applies when the custom-field form is saved, not during record registration. Up to 200 definitions including archived fields.",
          "أضف حقول لتفاصيل السجلات الدراسية. قيم الحقول المؤرشفة بتفضل للقراءة فقط. الحقل المطلوب بيتراجع عند حفظ نموذج الحقول الإضافية، مش عند إنشاء السجل. الحد 200 حقل بما فيها المؤرشفة.",
        )}
      </p>
      {error && (
        <p role="alert" className="my-3 text-sm text-red-600">
          {error}
        </p>
      )}
      {editable && (
        <form
          onSubmit={create}
          className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <Field label={L("Record type", "نوع السجل")}>
            <Select name="entity" aria-label={L("Record type", "نوع السجل")}>
              {entities.map((x) => (
                <option key={x} value={x}>
                  {ar ? names[x] : x}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={L("Field key", "كود الحقل")}>
            <Input
              name="field_key"
              required
              pattern="[a-z][a-z0-9_]{0,39}"
              maxLength={40}
              placeholder="preferred_contact"
            />
          </Field>
          <Field label={L("Field label", "اسم الحقل")}>
            <Input name="label" required maxLength={120} />
          </Field>
          <Field label={L("Value type", "نوع القيمة")}>
            <Select
              aria-label={L("Value type", "نوع القيمة")}
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {["text", "number", "date", "select", "boolean"].map((x) => (
                <option key={x} value={x}>
                  {ar
                    ? (
                        {
                          text: "نص",
                          number: "رقم",
                          date: "تاريخ",
                          select: "اختيارات",
                          boolean: "نعم أو لا",
                        } as Record<string, string>
                      )[x]
                    : x}
                </option>
              ))}
            </Select>
          </Field>
          {type === "select" && (
            <Field
              label={L("Options, one per line", "الاختيارات، كل اختيار في سطر")}
            >
              <textarea
                name="options"
                required
                maxLength={3000}
                className="min-h-24 rounded-xl border border-slate-200 bg-transparent p-3 text-sm dark:border-slate-700"
              />
            </Field>
          )}
          <label className="flex items-center gap-3 text-sm">
            <input name="required" type="checkbox" />
            {L("Required on custom-field save", "مطلوب عند حفظ الحقول")}
          </label>
          <div className="self-end">
            <Button type="submit" disabled={busy}>
              {L("Create field", "إضافة حقل")}
            </Button>
          </div>
        </form>
      )}
      <Table
        heads={[
          L("Record", "السجل"),
          L("Label", "الاسم"),
          L("Type", "النوع"),
          L("Status", "الحالة"),
          L("Action", "الإجراء"),
        ]}
        rows={rows.map((r) => [
          ar ? names[r.entity] : r.entity,
          <span key={r.id}>
            {r.label}
            <span className="block text-xs text-slate-500">
              {r.field_key}
              {r.required ? " *" : ""}
            </span>
          </span>,
          r.type,
          r.status === "active" ? L("Active", "نشط") : L("Archived", "مؤرشف"),
          editable ? (
            <button
              disabled={busy}
              className="text-blue-700 disabled:opacity-50"
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api("/custom-fields/" + r.id, "PUT", {
                    label: r.label,
                    required: !!r.required,
                    status: r.status === "active" ? "archived" : "active",
                  });
                  await load();
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {r.status === "active"
                ? L("Archive", "أرشفة")
                : L("Restore", "استعادة")}
            </button>
          ) : (
            ""
          ),
        ])}
      />
    </Card>
  );
}
export function RecordCustomFields({
  api,
  ar,
  entity,
  id,
  editable,
}: {
  api: Api;
  ar: boolean;
  entity: string;
  id: string;
  editable: boolean;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [rows, setRows] = useState<Row[]>([]),
    [values, setValues] = useState<Row>({}),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      const r = (await api("/record-fields/" + entity + "/" + id)).data;
      setRows(r);
      setValues(Object.fromEntries(r.map((f: Row) => [f.id, f.value])));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void load();
  }, [entity, id]);
  if (!rows.length && !error) return null;
  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h3 className="mb-3 font-semibold">
        {L("Custom fields", "حقول إضافية")}
      </h3>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-teal-700">
          {notice}
        </p>
      )}
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setNotice("");
          try {
            await api("/record-fields/" + entity + "/" + id, "PUT", {
              values: Object.fromEntries(
                rows
                  .filter((r) => r.status === "active")
                  .map((r) => [r.id, values[r.id] ?? null]),
              ),
            });
            await load();
            setNotice(L("Custom fields saved", "تم حفظ الحقول"));
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {rows.map((r) => {
          const disabled = !editable || r.status !== "active" || busy,
            value = values[r.id] ?? "",
            set = (v: unknown) => setValues({ ...values, [r.id]: v });
          return (
            <Field
              key={r.id}
              label={
                r.label +
                (r.required ? " *" : "") +
                (r.status === "archived" ? L(" (archived)", " (مؤرشف)") : "")
              }
            >
              {r.type === "select" || r.type === "boolean" ? (
                <Select
                  disabled={disabled}
                  value={String(value)}
                  required={!!r.required && r.status === "active"}
                  onChange={(e) =>
                    set(
                      e.target.value === ""
                        ? null
                        : r.type === "boolean"
                          ? e.target.value === "true"
                          : e.target.value,
                    )
                  }
                >
                  <option value="">{L("No value", "بدون قيمة")}</option>
                  {(r.type === "boolean" ? ["true", "false"] : r.options).map(
                    (x: string) => (
                      <option key={x} value={x}>
                        {r.type === "boolean"
                          ? x === "true"
                            ? L("Yes", "نعم")
                            : L("No", "لا")
                          : x}
                      </option>
                    ),
                  )}
                </Select>
              ) : (
                <Input
                  disabled={disabled}
                  type={
                    r.type === "number"
                      ? "number"
                      : r.type === "date"
                        ? "date"
                        : "text"
                  }
                  step={r.type === "number" ? "any" : undefined}
                  maxLength={2000}
                  required={!!r.required && r.status === "active"}
                  value={String(value)}
                  onChange={(e) =>
                    set(
                      e.target.value === ""
                        ? null
                        : r.type === "number"
                          ? Number(e.target.value)
                          : e.target.value,
                    )
                  }
                />
              )}
            </Field>
          );
        })}
        {editable && rows.some((r) => r.status === "active") && (
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {L("Save custom fields", "حفظ الحقول الإضافية")}
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}
