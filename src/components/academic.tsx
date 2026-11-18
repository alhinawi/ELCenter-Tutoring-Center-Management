"use client";
import { useModalFocus } from "./modal-focus";
import { CoursePackages } from "./course-packages";
import { CoursePrerequisites } from "./course-prerequisites";
import { RecordCustomFields } from "./custom-fields";
import { useEffect, useState, type FormEvent } from "react";
import {
  Plus,
  Search,
  Download,
  Upload,
  ArrowRightLeft,
  UserRound,
  Users,
  BookOpen,
  GraduationCap,
  Building2,
  ChevronRight,
  X,
  CheckCircle2,
  Printer,
  Filter,
} from "lucide-react";
import { Button, Input, Select, Field, Card, inputClass } from "./ui";
import type { T } from "./i18n";
type Row = Record<string, any>;
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
type FieldDef = {
  key: string;
  en: string;
  ar: string;
  type?: string;
  required?: boolean;
  options?: string[];
  relation?: string;
  default?: string | number;
};
export const academicNames = {
  students: ["Students", "الطلبة"],
  guardians: ["Guardians", "أولياء الأمور"],
  teachers: ["Teachers", "المدرّسين"],
  courses: ["Courses", "الكورسات"],
  groups: ["Groups", "المجموعات"],
  classrooms: ["Classrooms", "القاعات"],
} as const;
export type Entity = keyof typeof academicNames;
const field = (
  key: string,
  en: string,
  ar: string,
  extra: Partial<FieldDef> = {},
): FieldDef => ({ key, en, ar, ...extra });
const base = [
  field("name", "Full name / title", "الاسم", { required: true }),
  field("code", "Code", "الكود", { required: true }),
  field("branch_id", "Home branch", "الفرع الأساسي", {
    relation: "branches",
    required: true,
  }),
];
const contact = [
  field("phone", "Phone", "الموبايل"),
  field("email", "Email", "الإيميل", { type: "email" }),
  field("address", "Address", "العنوان"),
];
const notes = field("notes", "Notes", "ملاحظات", { type: "textarea" });
const status = (options: string[]) =>
  field("status", "Status", "الحالة", { options, default: "active" });
export const definitions: Record<Entity, FieldDef[]> = {
  students: [
    ...base,
    ...contact,
    field("birth_date", "Date of birth", "تاريخ الميلاد", { type: "date" }),
    field("gender", "Gender", "النوع", {
      options: ["", "male", "female", "other"],
    }),
    field("national_id", "National ID (optional)", "الرقم القومي (اختياري)"),
    field("school", "School", "المدرسة"),
    field("grade", "Academic grade", "الصف الدراسي"),
    field("stage", "Educational stage", "المرحلة الدراسية"),
    field("emergency_contact", "Emergency contact", "تواصل الطوارئ"),
    status([
      "new",
      "active",
      "inactive",
      "suspended",
      "graduated",
      "withdrawn",
      "pending",
    ]),
    notes,
  ],
  guardians: [
    base[0],
    base[2],
    ...contact,
    status(["active", "inactive"]),
    notes,
  ],
  teachers: [
    ...base,
    contact[0],
    contact[1],
    field("qualification", "Qualifications", "المؤهلات"),
    field("specialization", "Specialization", "التخصص"),
    field("experience", "Years of experience", "سنين الخبرة", {
      type: "number",
      default: 0,
    }),
    status(["active", "inactive"]),
    notes,
  ],
  courses: [
    ...base,
    field("subject", "Subject", "المادة"),
    field("stage", "Educational stage", "المرحلة"),
    field("grade", "Academic grade", "الصف"),
    field("description", "Description", "الوصف", { type: "textarea" }),
    field("curriculum", "Curriculum", "المنهج"),
    field("duration", "Duration (weeks)", "المدة (أسابيع)", {
      type: "number",
      default: 12,
    }),
    field("sessions", "Number of sessions", "عدد الحصص", {
      type: "number",
      default: 12,
    }),
    field("price", "Course price", "سعر الكورس", {
      type: "number",
      default: 0,
    }),
    field("capacity", "Capacity", "السعة", { type: "number", default: 30 }),
    field("registration_start", "Registration opens", "بداية التسجيل", {
      type: "date",
    }),
    field("registration_end", "Registration closes", "نهاية التسجيل", {
      type: "date",
    }),
    status(["active", "inactive", "archived"]),
  ],
  classrooms: [
    ...base,
    field("floor", "Floor", "الدور"),
    field("capacity", "Capacity", "السعة", { type: "number", default: 30 }),
    field("equipment", "Equipment", "التجهيزات", { type: "textarea" }),
    status(["active", "inactive", "maintenance"]),
  ],
  groups: [
    ...base,
    field("course_id", "Course", "الكورس", {
      relation: "courses",
      required: true,
    }),
    field("teacher_id", "Teacher", "المدرّس", {
      relation: "teachers",
      required: true,
    }),
    field("classroom_id", "Classroom", "القاعة", {
      relation: "classrooms",
      required: true,
    }),
    field("capacity", "Maximum capacity", "أقصى عدد", {
      type: "number",
      default: 20,
    }),
    field("start_date", "Start date", "تاريخ البداية", {
      type: "date",
      required: true,
    }),
    field("end_date", "End date", "تاريخ النهاية", {
      type: "date",
      required: true,
    }),
    field(
      "session_minutes",
      "Session duration (minutes)",
      "مدة الحصة (دقايق)",
      { type: "number", default: 90 },
    ),
    field("price", "Group price", "سعر المجموعة", {
      type: "number",
      default: 0,
    }),
    status(["active", "inactive", "completed"]),
  ],
};
const statuses: Record<string, string> = {
  active: "شغّال",
  inactive: "متوقف",
  new: "جديد",
  suspended: "موقوف",
  graduated: "متخرج",
  withdrawn: "منسحب",
  pending: "مستني التسجيل",
  archived: "مؤرشف",
  maintenance: "صيانة",
  completed: "مكتمل",
  waiting: "قائمة انتظار",
  transferred: "اتنقل",
  male: "ذكر",
  female: "أنثى",
  other: "آخر",
  approved: "مقبول",
  rejected: "مرفوض",
};
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useModalFocus(close);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm"
      onClick={close}
    >
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-semibold">{title}</h2>
          <button aria-label="Close" onClick={close} className="p-2">
            <X size={19} />
          </button>
        </header>
        <div className="p-5">{children}</div>
      </section>
    </div>
  );
}
export default function Academic({
  entity,
  t,
  api,
  allowed,
  toast,
}: {
  entity: Entity;
  t: T;
  api: Api;
  allowed: (r: string, a?: string) => boolean;
  toast: () => void;
}) {
  const ar = t.language === "English",
    L = (en: string, arabic: string) => (ar ? arabic : en);
  const [data, setData] = useState<Row | null>(null),
    [options, setOptions] = useState<Record<string, Row[]>>({}),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [branch, setBranch] = useState(""),
    [sort, setSort] = useState("name"),
    [version, setVersion] = useState(0),
    [editing, setEditing] = useState<Row | null>(null),
    [details, setDetails] = useState<Row | null>(null),
    [detailData, setDetailData] = useState<Row | null>(null),
    [transfers, setTransfers] = useState<Row[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [showFilters, setShowFilters] = useState(false),
    [idCard, setIdCard] = useState<{
      src: string;
      name: string;
      code: string;
    } | null>(null);
  const title = academicNames[entity][ar ? 1 : 0],
    fields = definitions[entity];
  const reload = () => setVersion((v) => v + 1);
  useEffect(() => {
    setData(null);
    setEditing(null);
    setDetails(null);
    setDetailData(null);
    setTransfers(null);
    setPage(1);
    setQ("");
  }, [entity]);
  useEffect(() => {
    let live = true;
    api(`/academic/options`)
      .then((d) => {
        if (live) setOptions(d);
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [entity, version]);
  useEffect(() => {
    let live = true;
    setError("");
    api(
      `/${entity}?q=${encodeURIComponent(q)}&page=${page}&branch=${branch}&sort=${sort}`,
    )
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [entity, q, page, branch, sort, version]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const raw = Object.fromEntries(new FormData(e.currentTarget));
    const body: Row = { ...raw };
    for (const f of fields)
      if (f.type === "number") body[f.key] = Number(raw[f.key]);
    try {
      await api(
        `/${entity}${editing?.id ? `/${editing.id}` : ""}`,
        editing?.id ? "PUT" : "POST",
        body,
      );
      setEditing(null);
      reload();
      toast();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function view(row: Row) {
    setDetails(row);
    setDetailData(null);
    setError("");
    try {
      const j = await api(`/${entity}/${row.id}`);
      if (entity === "groups")
        j.enrollments = (await api(`/groups/${row.id}/enrollments`)).data;
      setDetailData(j);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function command(path: string, body: unknown) {
    setError("");
    setBusy(true);
    try {
      await api(path, "POST", body);
      reload();
      toast();
      if (details) await view(details);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportExcel() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/${entity}/export`);
      if (!r.ok)
        throw new Error(
          L("Export permission required", "محتاج صلاحية التصدير"),
        );
      const text = await r.text();
      const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${entity}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importExcel(file: File) {
    setBusy(true);
    setError("");
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Maximum file size: 5 MB");
      const read = (await import("read-excel-file/browser")).readSheet;
      const rows = await read(file, 1);
      const headers = rows[0].map((x) => String(x));
      if (!headers.includes("name") || !headers.includes("code"))
        throw new Error(
          L(
            "Use name and code column headers. Optional: phone, email, grade, branch_id. Maximum 160 rows.",
            "استخدم عناوين الأعمدة name و code. اختياري: phone و email و grade و branch_id. أقصى عدد 160 صف.",
          ),
        );
      const data = rows
        .slice(1)
        .filter((r) => r.some(Boolean))
        .map((r) => {
          const d: Row = { branch_id: branch || options.branches?.[0]?.id };
          headers.forEach((h, i) => {
            if (
              ["name", "code", "phone", "email", "grade", "branch_id"].includes(
                h,
              ) &&
              r[i] !== null
            )
              d[h] = String(r[i]);
          });
          return d;
        });
      await api("/students/import", "POST", { rows: data });
      reload();
      toast();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-600">
            {L("ACADEMIC OPERATIONS", "الشغل الأكاديمي")}
          </p>
          <h1 className="text-3xl font-semibold">{title}</h1>
          <p className="mt-2 text-xs text-slate-500">
            {L(
              "Connected records. Real relationships. One learning community.",
              "سجلات متوصلة وعلاقات واضحة. مجتمع تعلّم واحد.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {entity === "courses" && (
            <CoursePackages
              api={api}
              ar={ar}
              options={options}
              create={allowed("courses", "create")}
              edit={allowed("courses", "edit")}
              enroll={allowed("groups", "edit") && allowed("finance", "create")}
            />
          )}
          {entity === "students" && (
            <button
              className="rounded-xl border border-slate-200 bg-white p-3 text-slate-500 dark:border-slate-700 dark:bg-slate-900"
              title={L("Transfers", "طلبات النقل")}
              aria-label={L("Transfers", "طلبات النقل")}
              onClick={async () => setTransfers((await api("/transfers")).data)}
            >
              <ArrowRightLeft size={17} />
            </button>
          )}
          {allowed(entity, "export") && (
            <button
              onClick={exportExcel}
              disabled={busy}
              className="rounded-xl border border-slate-200 bg-white p-3 text-slate-500 dark:border-slate-700 dark:bg-slate-900"
              title={t.export}
              aria-label={t.export}
            >
              <Download size={17} />
            </button>
          )}
          {entity === "students" && allowed(entity, "create") && (
            <label
              title={L(
                "Import Excel (name, code, phone, email, grade)",
                "استيراد إكسل (name, code, phone, email, grade)",
              )}
              className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3 text-slate-500 dark:border-slate-700 dark:bg-slate-900"
            >
              <Upload size={17} />
              <span className="sr-only">
                {L("Import Excel", "استيراد إكسل")}
              </span>
              <input
                type="file"
                accept=".xlsx"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importExcel(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {allowed(entity, "create") && (
            <Button
              onClick={() => {
                setEditing({ branch_id: branch || options.branches?.[0]?.id });
                setError("");
              }}
            >
              <Plus size={17} />
              {L("Add record", "إضافة سجل")}
            </Button>
          )}
        </div>
      </div>
      {error && !editing && !details && (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
          <div className="relative min-w-[180px] flex-1">
            <Search
              size={17}
              className="absolute start-3 top-3.5 text-slate-400"
            />
            <Input
              className="ps-10"
              aria-label={L("Search records", "البحث في السجلات")}
              placeholder={L("Search by name…", "دوّر بالاسم…")}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            aria-label={L("Filters", "الفلاتر")}
            aria-expanded={showFilters}
            className="rounded-xl border border-slate-200 p-3 text-slate-500 dark:border-slate-700"
          >
            <Filter size={17} />
          </button>
          {showFilters && (
            <div className="flex w-full flex-wrap gap-3">
              <div className="min-w-40 flex-1">
                <Select
                  aria-label={t.branch}
                  value={branch}
                  onChange={(e) => {
                    setBranch(e.target.value);
                    setPage(1);
                  }}
                  className="w-auto"
                >
                  <option value="">{t.allBranches}</option>
                  {options.branches?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-40">
                <Select
                  aria-label={t.sort}
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="w-auto"
                >
                  <option value="name">{t.name}</option>
                  <option value="created_at">
                    {L("Newest", "تاريخ الإضافة")}
                  </option>
                  <option value="status">{t.status}</option>
                </Select>
              </div>
            </div>
          )}
        </div>
        {!data ? (
          <p className="p-10 text-center text-sm text-slate-400">{t.loading}</p>
        ) : data.data.length ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[600px] text-start text-sm">
                <thead className="bg-slate-50 text-xs text-slate-400 dark:bg-slate-800">
                  <tr>
                    {[
                      t.name,
                      t.branch,
                      entity === "groups"
                        ? t.capacity
                        : entity === "courses"
                          ? L("Price", "السعر")
                          : L("Contact / code", "التواصل / الكود"),
                      t.status,
                      t.actions,
                    ].map((h, i) => (
                      <th className="px-5 py-4 text-start font-medium" key={i}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.data.map((r: Row) => (
                    <tr
                      key={r.id}
                      className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-5 py-4">
                        <button
                          onClick={() => view(r)}
                          className="flex items-center gap-3 text-start font-semibold"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                            {entity === "students" ||
                            entity === "guardians" ||
                            entity === "teachers" ? (
                              <UserRound size={17} />
                            ) : (
                              <BookOpen size={17} />
                            )}
                          </span>
                          <span>
                            {r.name}
                            {r.is_demo === 1 && (
                              <span className="ms-2 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-normal text-amber-700">
                                Demo
                              </span>
                            )}
                            <span className="mt-1 block text-[10px] font-normal text-slate-400">
                              {r.code ?? r.email}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500">
                        {options.branches?.find((b) => b.id === r.branch_id)
                          ?.name ?? "—"}
                      </td>
                      <td className="px-5 py-4 text-xs" dir="ltr">
                        {entity === "groups"
                          ? `${r.enrolled} / ${r.capacity}`
                          : entity === "courses"
                            ? Number(r.price).toLocaleString("en-US")
                            : r.phone || r.code || "—"}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] ${r.status === "active" ? "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}
                        >
                          {ar ? (statuses[r.status] ?? r.status) : r.status}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {allowed(entity, "edit") && (
                          <button
                            onClick={() => {
                              setEditing(r);
                              setError("");
                            }}
                            className="text-xs font-semibold text-blue-700 dark:text-blue-300"
                          >
                            {t.edit}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
              {data.data.map((r: Row) => (
                <div key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      onClick={() => view(r)}
                      className="text-start text-sm font-semibold"
                    >
                      {r.name}
                      {r.is_demo === 1 && (
                        <span className="ms-2 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-normal text-amber-700">
                          Demo
                        </span>
                      )}
                      <span className="mt-1 block text-[10px] font-normal text-slate-400">
                        {r.code ?? r.email}
                      </span>
                    </button>
                    <span className="rounded-full bg-teal-50 px-2 py-1 text-[10px] text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                      {ar ? statuses[r.status] : r.status}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-slate-400">
                    {options.branches?.find((b) => b.id === r.branch_id)
                      ?.name ?? "—"}
                  </p>
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs text-slate-500" dir="ltr">
                      {entity === "groups"
                        ? `${r.enrolled} / ${r.capacity}`
                        : entity === "courses"
                          ? Number(r.price).toLocaleString("en-US")
                          : (r.phone ?? "")}
                    </p>
                    {allowed(entity, "edit") && (
                      <button
                        className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                        onClick={() => {
                          setEditing(r);
                          setError("");
                        }}
                      >
                        {t.edit}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center px-5 py-16 text-center">
            <span className="mb-4 rounded-2xl bg-blue-50 p-4 text-blue-400 dark:bg-blue-950">
              <BookOpen size={28} />
            </span>
            <p className="text-sm font-medium">{t.noResults}</p>
            <p className="mt-2 max-w-sm text-xs leading-6 text-slate-400">
              {L(
                "Add your first record to start connecting your academic operations.",
                "ضيف أول سجل عشان تبدأ توصل الشغل الأكاديمي ببعضه.",
              )}
            </p>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-slate-100 p-4 text-xs text-slate-400 dark:border-slate-800">
          <span>
            {data?.total ?? 0} {L("records", "سجل")}
          </span>
          <div className="flex gap-3">
            <button
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
              className="rounded-lg border border-slate-200 px-3 py-2 disabled:opacity-30 dark:border-slate-700"
            >
              {t.previous}
            </button>
            <button
              disabled={page * 20 >= (data?.total ?? 0)}
              onClick={() => setPage(page + 1)}
              className="rounded-lg border border-slate-200 px-3 py-2 disabled:opacity-30 dark:border-slate-700"
            >
              {t.next}
            </button>
          </div>
        </div>
      </Card>
      {editing && (
        <Dialog
          title={editing.id ? t.edit : L("Add record", "إضافة سجل")}
          close={() => setEditing(null)}
        >
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => (
              <Field key={f.key} label={ar ? f.ar : f.en}>
                {f.relation ? (
                  <Select
                    name={f.key}
                    defaultValue={editing[f.key] ?? ""}
                    required={f.required}
                  >
                    <option value="">—</option>
                    {options[f.relation]
                      ?.filter(
                        (r) =>
                          r.status === undefined ||
                          r.status === "active" ||
                          r.id === editing[f.key],
                      )
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </Select>
                ) : f.options ? (
                  <Select
                    name={f.key}
                    defaultValue={editing[f.key] ?? f.default ?? ""}
                  >
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {ar ? (statuses[o] ?? o) : o || "—"}
                      </option>
                    ))}
                  </Select>
                ) : f.type === "textarea" ? (
                  <textarea
                    className={inputClass}
                    name={f.key}
                    defaultValue={editing[f.key] ?? ""}
                    maxLength={500}
                  />
                ) : (
                  <Input
                    name={f.key}
                    defaultValue={editing[f.key] ?? f.default ?? ""}
                    type={f.type ?? "text"}
                    required={f.required}
                    min={f.type === "number" ? 0 : undefined}
                    step={f.type === "number" ? 1 : undefined}
                    maxLength={500}
                  />
                )}
              </Field>
            ))}
            {error && (
              <p role="alert" className="col-span-full text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="col-span-full mt-3 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-3 text-sm text-slate-400"
              >
                {t.cancel}
              </button>
              <Button type="submit" disabled={busy}>
                {busy ? "…" : t.save}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {details && (
        <Dialog
          title={details.name}
          close={() => {
            setDetails(null);
            setError("");
          }}
        >
          {!detailData ? (
            <p>{t.loading}</p>
          ) : (
            <div className="grid gap-6">
              <div className="grid gap-3 sm:grid-cols-2">
                {fields
                  .filter((f) => !["branch_id", "notes"].includes(f.key))
                  .map((f) => (
                    <div
                      key={f.key}
                      className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"
                    >
                      <p className="text-[10px] text-slate-400">
                        {ar ? f.ar : f.en}
                      </p>
                      <p className="mt-1 break-words text-sm">
                        {ar && f.key === "status"
                          ? statuses[detailData.data[f.key]]
                          : f.relation
                            ? (options[f.relation]?.find(
                                (r) => r.id === detailData.data[f.key],
                              )?.name ?? "—")
                            : String(detailData.data[f.key] ?? "") || "—"}
                      </p>
                    </div>
                  ))}
              </div>
              {detailData.guardians && (
                <section>
                  <h3 className="mb-3 font-semibold">
                    {L("Guardians", "أولياء الأمور")}
                  </h3>
                  {detailData.guardians.map((g: Row) => (
                    <p
                      key={g.id}
                      className="mb-2 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-700"
                    >
                      {g.name} · {g.phone} · {g.relationship}
                    </p>
                  ))}
                  {allowed("students", "edit") && (
                    <form
                      className="flex flex-wrap gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const d = Object.fromEntries(
                          new FormData(e.currentTarget),
                        );
                        void command(`/students/${details.id}/guardians`, d);
                      }}
                    >
                      <Select
                        name="guardian_id"
                        required
                        className="min-w-[140px] flex-1"
                      >
                        <option value="">
                          {L("Choose guardian", "اختار ولي الأمر")}
                        </option>
                        {options.guardians?.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </Select>
                      <Input
                        name="relationship"
                        required
                        placeholder={L("Relationship", "صلة القرابة")}
                        className="w-36"
                      />
                      <Button disabled={busy} type="submit">
                        <Plus size={17} />
                      </Button>
                    </form>
                  )}
                </section>
              )}
              {detailData.enrollments && (
                <section>
                  <h3 className="mb-3 font-semibold">
                    {entity === "groups"
                      ? L(
                          "Enrollment & waiting list",
                          "التسجيل وقائمة الانتظار",
                        )
                      : L("Academic history", "السجل الأكاديمي")}
                  </h3>
                  {detailData.enrollments.map((e: Row) => (
                    <div
                      key={e.id}
                      className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-700"
                    >
                      <div>
                        <p className="font-semibold">
                          {e.group_name ?? e.name}
                        </p>
                        <p className="mt-1 text-slate-400">
                          {e.course_name ?? e.code} ·{" "}
                          {ar ? statuses[e.status] : e.status}
                        </p>
                      </div>
                      {entity === "students" &&
                        e.status === "active" &&
                        allowed("groups", "edit") && (
                          <form
                            className="flex w-full gap-2"
                            onSubmit={(ev) => {
                              ev.preventDefault();
                              void command(
                                `/enrollments/${e.id}/transfer`,
                                Object.fromEntries(
                                  new FormData(ev.currentTarget),
                                ),
                              );
                            }}
                          >
                            <Select name="group_id" required>
                              <option value="">
                                {L("Transfer to group", "نقل لمجموعة تانية")}
                              </option>
                              {options.groups
                                ?.filter(
                                  (g) =>
                                    g.id !== e.group_id &&
                                    g.branch_id === details.branch_id,
                                )
                                .map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.name}
                                  </option>
                                ))}
                            </Select>
                            <Button disabled={busy} type="submit">
                              <ArrowRightLeft size={16} />
                            </Button>
                          </form>
                        )}
                      {entity === "groups" && allowed("groups", "edit") && (
                        <Select
                          aria-label={t.status}
                          className="w-auto"
                          value={e.status}
                          onChange={async (ev) => {
                            try {
                              await api(`/enrollments/${e.id}`, "PATCH", {
                                status: ev.target.value,
                              });
                              await view(details);
                              reload();
                              toast();
                            } catch (err) {
                              setError((err as Error).message);
                            }
                          }}
                        >
                          {["active", "waiting", "withdrawn", "completed"].map(
                            (s) => (
                              <option key={s} value={s}>
                                {ar ? statuses[s] : s}
                              </option>
                            ),
                          )}
                        </Select>
                      )}
                    </div>
                  ))}
                  {entity === "groups" && allowed("groups", "edit") && (
                    <form
                      className="flex flex-wrap gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void command(
                          `/groups/${details.id}/enrollments`,
                          Object.fromEntries(new FormData(e.currentTarget)),
                        );
                      }}
                    >
                      <Select
                        name="student_id"
                        className="min-w-[160px] flex-1"
                        required
                      >
                        <option value="">
                          {L("Choose student", "اختار الطالب")}
                        </option>
                        {options.students
                          ?.filter((s) => s.branch_id === details.branch_id)
                          .map((s) => (
                            <option value={s.id} key={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </Select>
                      <Select name="status" className="w-auto">
                        <option value="active">{t.active}</option>
                        <option value="waiting">
                          {L("Waiting list", "قائمة الانتظار")}
                        </option>
                      </Select>
                      <Button disabled={busy} type="submit">
                        <Plus size={17} />
                      </Button>
                    </form>
                  )}
                </section>
              )}
              {entity === "students" && allowed("students", "edit") && (
                <section>
                  <h3 className="mb-3 font-semibold">
                    {L("Request branch transfer", "طلب نقل لفرع تاني")}
                  </h3>
                  <form
                    className="grid gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void command("/transfers", {
                        ...Object.fromEntries(new FormData(e.currentTarget)),
                        student_id: details.id,
                      });
                    }}
                  >
                    <Select name="to_branch" required>
                      <option value="">
                        {L("Destination branch", "الفرع الجديد")}
                      </option>
                      {options.branches
                        ?.filter((b) => b.id !== details.branch_id)
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                    </Select>
                    <Input
                      name="reason"
                      required
                      placeholder={L("Reason for transfer", "سبب النقل")}
                    />
                    <Button disabled={busy} type="submit">
                      {L("Submit for approval", "إرسال للاعتماد")}
                    </Button>
                  </form>
                </section>
              )}
              <RecordCustomFields
                api={api}
                ar={ar}
                entity={entity}
                id={details.id}
                editable={allowed(entity, "edit")}
              />
              {entity === "courses" && (
                <CoursePrerequisites
                  api={api}
                  ar={ar}
                  id={details.id}
                  options={options.courses ?? []}
                  editable={allowed("courses", "edit")}
                />
              )}
              {entity === "courses" && allowed("courses", "create") && (
                <form
                  className="grid gap-3 sm:grid-cols-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void command(
                      `/courses/${details.id}/duplicate`,
                      Object.fromEntries(new FormData(e.currentTarget)),
                    );
                  }}
                >
                  <Input
                    name="name"
                    required
                    placeholder={L("Duplicate course name", "اسم نسخة الكورس")}
                  />
                  <Input
                    name="code"
                    required
                    placeholder={L("New code", "كود جديد")}
                  />
                  <Button disabled={busy} type="submit">
                    {L("Duplicate", "نسخ الكورس")}
                  </Button>
                </form>
              )}
              {(entity === "teachers" || entity === "courses") &&
                allowed(entity, "edit") && (
                  <form
                    className="flex flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const d = Object.fromEntries(
                        new FormData(e.currentTarget),
                      );
                      void command(`/${entity}/${details.id}/branches`, {
                        ...d,
                        price: Number(d.price ?? 0),
                      });
                    }}
                  >
                    <Select
                      name="branch_id"
                      className="min-w-[160px] flex-1"
                      required
                    >
                      <option value="">
                        {L("Assign another branch", "تعيين لفرع تاني")}
                      </option>
                      {options.branches?.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                    {entity === "courses" && (
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        name="price"
                        defaultValue={0}
                        aria-label={L("Branch price", "سعر الفرع")}
                        className="w-32"
                      />
                    )}
                    <Button disabled={busy} type="submit">
                      {L("Assign", "تعيين")}
                    </Button>
                  </form>
                )}
              {entity === "students" && (
                <Button
                  onClick={async () => {
                    const qr = await import("qrcode");
                    const src = await qr.toDataURL("ELC:" + details.id, {
                      width: 320,
                      margin: 2,
                      errorCorrectionLevel: "M",
                    });
                    setIdCard({ src, name: details.name, code: details.code });
                  }}
                >
                  {L("Student ID card", "كارت الطالب")}
                </Button>
              )}
              {allowed(entity, "print") && (
                <Button
                  onClick={() => window.print()}
                  className="w-fit bg-slate-700"
                >
                  <Printer size={16} />
                  {t.print}
                </Button>
              )}
              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
            </div>
          )}
        </Dialog>
      )}
      {idCard && (
        <Dialog
          title={L("Student ID card", "كارت الطالب")}
          close={() => setIdCard(null)}
        >
          <div className="mx-auto max-w-sm rounded-2xl border border-slate-200 bg-white p-7 text-center text-slate-900">
            <p className="text-2xl font-bold text-blue-700">ELCenter</p>
            <span className="mx-auto my-5 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-700">
              <GraduationCap size={34} />
            </span>
            <h3 className="text-xl font-semibold">{idCard.name}</h3>
            <p className="mt-2 text-sm text-slate-500" dir="ltr">
              {idCard.code}
            </p>
            <img
              src={idCard.src}
              alt={L("Student identification QR code", "كود QR لتعريف الطالب")}
              className="mx-auto mt-5 h-48 w-48"
            />
            <p className="text-[10px] text-slate-400">
              {L(
                "Scan at reception to mark attendance.",
                "امسح الكود في الاستقبال عشان تسجّل الحضور.",
              )}
            </p>
          </div>
        </Dialog>
      )}
      {transfers && (
        <Dialog
          title={L("Branch transfers", "طلبات نقل الفروع")}
          close={() => setTransfers(null)}
        >
          <div className="grid gap-3">
            {!transfers.length && (
              <p className="py-8 text-center text-sm text-slate-400">
                {t.noResults}
              </p>
            )}
            {transfers.map((r) => (
              <Card key={r.id} className="p-4">
                <p className="font-semibold">{r.student_name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {r.destination} · {ar ? statuses[r.status] : r.status}
                </p>
                <p className="my-3 text-xs">{r.reason}</p>
                {r.status === "pending" && allowed("students", "approve") && (
                  <div className="flex gap-3">
                    {["approved", "rejected"].map((d) => (
                      <Button
                        key={d}
                        disabled={busy}
                        onClick={async () => {
                          await command(`/transfers/${r.id}/decision`, {
                            decision: d,
                          });
                          setTransfers((await api("/transfers")).data);
                        }}
                        className={d === "rejected" ? "bg-slate-500" : ""}
                      >
                        {ar ? statuses[d] : d}
                      </Button>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
