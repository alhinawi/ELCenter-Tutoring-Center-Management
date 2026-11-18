"use client";
import { useEffect, useState } from "react";
import { ShieldCheck, Search, Clock } from "lucide-react";
import { MfaSettings } from "./mfa-settings";
import { Button, Card, Field, Input, Select } from "./ui";
import { Dialog, Table, Badge } from "./portals";
type Row = Record<string, any>;
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
export function SystemControls({
  api,
  ar,
  admin,
  searchable,
}: {
  api: Api;
  ar: boolean;
  admin: boolean;
  searchable: boolean;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [mode, setMode] = useState(""),
    [sessions, setSessions] = useState<Row[]>([]),
    [history, setHistory] = useState<Row[]>([]),
    [jobs, setJobs] = useState<Row | null>(null),
    [results, setResults] = useState<Record<string, Row[]>>({}),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh(m = mode) {
    setError("");
    try {
      if (m === "security") setSessions((await api("/security/sessions")).data);
      if (m === "automation") setJobs(await api("/system/automation"));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    if (mode) void refresh();
  }, [mode]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (searchable && (e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setMode("search");
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [searchable]);
  async function act(p: string, b: Row, m = "POST") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(p, m, b);
      await refresh();
      setNotice(L("Saved successfully", "تم الحفظ"));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        aria-label={L("Account security", "أمان الحساب")}
        className="rounded-xl p-3 hover:bg-slate-100 dark:hover:bg-slate-800"
        onClick={() => setMode("security")}
      >
        <ShieldCheck size={18} />
      </button>
      {searchable && (
        <button
          aria-label={L("Global search", "البحث الشامل")}
          onClick={() => setMode("search")}
          className="rounded-xl p-3 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Search size={18} />
        </button>
      )}
      {admin && (
        <button
          aria-label={L("Automation controls", "إعدادات الأتمتة")}
          onClick={() => setMode("automation")}
          className="rounded-xl p-3 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Clock size={18} />
        </button>
      )}
      {mode && (
        <Dialog
          title={
            mode === "security"
              ? L("Account security", "أمان الحساب")
              : mode === "search"
                ? L("Global search", "البحث الشامل")
                : L("Automation controls", "إعدادات الأتمتة")
          }
          close={() => {
            setMode("");
            setNotice("");
            setError("");
          }}
        >
          {error && (
            <p
              role="alert"
              className="my-3 rounded-xl bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="my-3 text-sm text-teal-700">
              {notice}
            </p>
          )}
          {mode === "security" ? (
            <div className="space-y-6">
              <p className="text-sm leading-7 text-slate-500">
                {L(
                  "Active sign-ins on your account. Revoke unfamiliar sessions. Password changes revoke your other sessions.",
                  "جلسات الدخول النشطة لحسابك. الغِ أي جلسة مش مألوفة. تغيير كلمة المرور يلغي الجلسات التانية.",
                )}
              </p>
              <div className="space-y-3">
                {sessions.map((s) => (
                  <section
                    key={s.id}
                    className="space-y-3 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <strong>
                        {s.current
                          ? L("This session", "الجلسة دي")
                          : L("Other session", "جلسة تانية")}
                      </strong>
                      {!s.current && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void act("/security/sessions/revoke", { id: s.id })
                          }
                        >
                          {L("Revoke", "إلغاء")}
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {new Date(
                        s.created_at.replace(" ", "T") + "Z",
                      ).toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB")}
                    </p>
                    <details>
                      <summary className="cursor-pointer text-xs text-blue-700">
                        {L("Browser details", "تفاصيل المتصفح")}
                      </summary>
                      <p className="mt-2 break-all text-xs leading-6 text-slate-500">
                        {s.user_agent ||
                          L("Unknown browser", "متصفح غير معروف")}
                      </p>
                    </details>
                  </section>
                ))}
              </div>
              <details className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <summary className="cursor-pointer text-sm font-semibold">
                  {L(
                    "Recent successful sign-ins",
                    "عمليات الدخول الناجحة الأخيرة",
                  )}
                </summary>
                <ul className="mt-3 divide-y divide-slate-100">
                  {history.map((r, i) => (
                    <li
                      key={i}
                      className="space-y-1 py-3 text-xs text-slate-500"
                    >
                      <p>
                        {new Date(r.created_at * 1000).toLocaleString(
                          ar ? "ar-EG-u-nu-latn" : "en-GB",
                        )}
                      </p>
                      <p dir="ltr">
                        {r.ip || L("IP unavailable", "عنوان الشبكة غير متاح")}
                      </p>
                      <p className="break-all leading-6">{r.user_agent}</p>
                    </li>
                  ))}
                </ul>
              </details>
              <MfaSettings api={api} ar={ar} />
              <form
                className="grid gap-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget,
                    fd = new FormData(form);
                  if (fd.get("new_password") !== fd.get("confirm")) {
                    setError(
                      L(
                        "New passwords do not match",
                        "كلمتا المرور مش متطابقتين",
                      ),
                    );
                    return;
                  }
                  await act("/security/password", {
                    current_password: fd.get("current_password"),
                    new_password: fd.get("new_password"),
                  });
                  form.reset();
                }}
              >
                <h3 className="font-semibold">
                  {L("Change password", "تغيير كلمة المرور")}
                </h3>
                <Field label={L("Current password", "كلمة المرور الحالية")}>
                  <Input
                    name="current_password"
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={128}
                  />
                </Field>
                <Field
                  label={L(
                    "New password, at least 12 characters",
                    "كلمة المرور الجديدة، 12 حرف على الأقل",
                  )}
                >
                  <Input
                    name="new_password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                  />
                </Field>
                <Field
                  label={L("Confirm new password", "تأكيد كلمة المرور الجديدة")}
                >
                  <Input
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                  />
                </Field>
                <Button disabled={busy} type="submit">
                  {L(
                    "Change password and revoke other sessions",
                    "غيّر كلمة المرور والغِ الجلسات التانية",
                  )}
                </Button>
              </form>
            </div>
          ) : mode === "search" ? (
            <div className="space-y-5">
              <form
                className="flex gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setError("");
                  try {
                    const q = String(new FormData(e.currentTarget).get("q"));
                    setResults(
                      (await api("/search?q=" + encodeURIComponent(q))).data,
                    );
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                <Input
                  autoFocus
                  aria-label={L("Search records", "ابحث في السجلات")}
                  name="q"
                  placeholder={L(
                    "Start of a name or reference, 2+ characters",
                    "بداية الاسم أو المرجع، حرفين على الأقل",
                  )}
                  required
                  minLength={2}
                  maxLength={80}
                />
                <Button type="submit">{L("Search", "بحث")}</Button>
              </form>
              <p className="text-xs text-slate-500">
                {L(
                  "Up to eight prefix matches in each permitted module. Ctrl/Cmd+K opens search.",
                  "لحد 8 نتائج ببداية النص في كل قسم متاح لصلاحياتك. Ctrl/Cmd+K يفتح البحث.",
                )}
              </p>
              {Object.entries(results).map(([kind, rows]) => (
                <section key={kind}>
                  <h3 className="mb-2 font-semibold">
                    {(
                      {
                        students: L("Students", "الطلاب"),
                        guardians: L("Guardians", "أولياء الأمور"),
                        teachers: L("Teachers", "المدرسين"),
                        employees: L("Employees", "الموظفين"),
                        courses: L("Courses", "الكورسات"),
                        groups: L("Groups", "المجموعات"),
                        branches: L("Branches", "الفروع"),
                        invoices: L("Invoices", "الفواتير"),
                        payments: L("Payments", "المدفوعات"),
                        journals: L("Transactions", "القيود"),
                        support_tickets: L("Tickets", "التذاكر"),
                        documents: L("Documents", "المستندات"),
                      } as Row
                    )[kind] ?? kind}
                  </h3>
                  {rows.length ? (
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:border-slate-700">
                      {rows.map((r) => (
                        <li className="break-words p-3 text-sm" key={r.id}>
                          {r.label}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-400">
                      {L("No matches", "مفيش نتائج")}
                    </p>
                  )}
                </section>
              ))}
            </div>
          ) : (
            jobs && (
              <div className="space-y-5">
                <p className="text-sm leading-7 text-slate-500">
                  {L(
                    "Only in-app reminders: expiring documents to their uploader, due invoices/library returns to linked families, assigned lead follow-ups, contract expiry to HR, low stock to inventory staff, upcoming exams to linked families, and saved report digests. No email, SMS or WhatsApp is sent. Up to 100 records per kind each run. A separately deployed scheduler is required for automatic runs.",
                    "تذكيرات داخل التطبيق بس: انتهاء المستندات للي رفعها، الفواتير والكتب المستحقة للأسر المرتبطة، متابعة العملاء للمسؤول، انتهاء العقود للموارد البشرية، المخزون المنخفض للمخازن، الامتحانات القريبة للأسر المرتبطة، وملخصات التقارير المحفوظة. مفيش إرسال بريد أو SMS أو واتساب. لحد 100 سجل من كل نوع في التشغيل. التشغيل التلقائي محتاج نشر خدمة الجدولة بشكل منفصل.",
                  )}
                </p>
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={!!jobs.enabled}
                    disabled={busy}
                    onChange={(e) =>
                      void act(
                        "/system/automation",
                        { enabled: e.target.checked },
                        "PUT",
                      )
                    }
                  />
                  {L(
                    "Allow the scheduler to process this organization",
                    "اسمح للجدولة بمعالجة المؤسسة دي",
                  )}
                </label>
                <form
                  className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
                  key={JSON.stringify(jobs.rules)}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    void act(
                      "/system/automation",
                      {
                        enabled: !!jobs.enabled,
                        lead_followups: fd.has("lead_followups"),
                        contract_expiry: fd.has("contract_expiry"),
                        low_stock: fd.has("low_stock"),
                        contract_days: Number(fd.get("contract_days")),
                        upcoming_exams: fd.has("upcoming_exams"),
                        exam_days: Number(fd.get("exam_days")),
                      },
                      "PUT",
                    );
                  }}
                >
                  <h3 className="font-semibold">
                    {L("Reminder rules", "قواعد التذكيرات")}
                  </h3>
                  {(
                    [
                      [
                        "lead_followups",
                        L("Assigned lead follow-ups", "متابعة العملاء للمسؤول"),
                      ],
                      [
                        "contract_expiry",
                        L(
                          "Contract expiry for HR",
                          "انتهاء العقود للموارد البشرية",
                        ),
                      ],
                      [
                        "upcoming_exams",
                        L(
                          "Upcoming exams for linked families",
                          "الامتحانات القريبة للأسر المرتبطة",
                        ),
                      ],
                      [
                        "low_stock",
                        L(
                          "Low stock for inventory staff",
                          "المخزون المنخفض لمسؤولي المخازن",
                        ),
                      ],
                    ] as const
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center gap-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        name={key}
                        defaultChecked={!!jobs.rules[key]}
                        disabled={busy}
                      />
                      {label}
                    </label>
                  ))}
                  <Field
                    label={L(
                      "Contract notice days (1–90)",
                      "التنبيه قبل انتهاء العقد بالأيام (1–90)",
                    )}
                  >
                    <Input
                      name="contract_days"
                      type="number"
                      min={1}
                      max={90}
                      step={1}
                      required
                      defaultValue={jobs.rules.contract_days}
                    />
                  </Field>
                  <Field
                    label={L(
                      "Exam notice days (1–14)",
                      "التنبيه قبل الامتحان بالأيام (1–14)",
                    )}
                  >
                    <Input
                      name="exam_days"
                      type="number"
                      required
                      min={1}
                      max={14}
                      step={1}
                      defaultValue={jobs.rules.exam_days}
                    />
                  </Field>
                  <p className="text-xs leading-6 text-slate-500">
                    {L(
                      "Exam notices go only to currently enrolled linked students and guardians, once per exam, student, recipient and scheduled time. Published upcoming exams only. A reschedule gets a fresh notice, not a cancellation alert.",
                      "تذكير الامتحان للطلاب المسجلين حالياً وأولياء الأمور المرتبطين بس، مرة لكل امتحان وطالب ومستلم وميعاد. الامتحانات المنشورة والقادمة بس. تغيير الميعاد بيعمل تذكير جديد، مش إشعار إلغاء.",
                    )}
                  </p>
                  <p className="text-xs leading-6 text-slate-500">
                    {L(
                      "Staff rules default off. Lead reminders are once per due date and recipient. Contracts are once per end date and recipient. Low stock is once per branch, item and recipient each month, including zero at a zero reorder level. Only existing stock balance records are checked. Saving rules does not run them. Manual runs also respect these rules.",
                      "القواعد دي مقفولة افتراضياً. متابعة العميل مرة لكل ميعاد ومسؤول، والعقد مرة لكل تاريخ انتهاء ومستلم. المخزون مرة لكل فرع وصنف ومستلم في الشهر، حتى الصفر لو حد الطلب صفر. الفحص لأرصدة المخزون الموجودة بس. حفظ القواعد مش بيشغلها. التشغيل اليدوي بيحترم القواعد دي كمان.",
                    )}
                  </p>
                  <Button type="submit" disabled={busy}>
                    {L("Save reminder rules", "احفظ قواعد التذكير")}
                  </Button>
                </form>
                <Button
                  disabled={busy}
                  onClick={() => void act("/system/automation/run", {})}
                >
                  {L(
                    "Run in-app reminders now",
                    "شغّل التذكيرات الداخلية دلوقتي",
                  )}
                </Button>
                <Table
                  heads={[
                    L("Run started", "بداية التشغيل"),
                    L("Created reminders", "التذكيرات الجديدة"),
                  ]}
                  rows={jobs.runs.map((r: Row) => [
                    new Date(r.started_at * 1000).toLocaleString(
                      ar ? "ar-EG-u-nu-latn" : "en-GB",
                    ),
                    r.created_count,
                  ])}
                />
              </div>
            )
          )}
        </Dialog>
      )}
    </>
  );
}
export function ReportSchedules({
  api,
  ar,
  canCreate,
  canEdit,
}: {
  api: Api;
  ar: boolean;
  canCreate: boolean;
  canEdit: boolean;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [rows, setRows] = useState<Row[]>([]),
    [snapshots, setSnapshots] = useState<Row[]>([]),
    [error, setError] = useState("");
  async function load() {
    try {
      setRows((await api("/reports/schedules")).data);
      setSnapshots((await api("/reports/snapshots")).data);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <Card className="space-y-4 p-5">
      <h3 className="font-semibold">
        {L("Scheduled report digests", "ملخصات التقارير المجدولة")}
      </h3>
      <p className="text-xs leading-7 text-slate-500">
        {L(
          "Saves current capacity, range sessions and permitted collections to a private digest when automation runs. Daily, weekly and monthly windows start at local midnight. Not an emailed spreadsheet.",
          "بيحفظ السعة الحالية وحصص الفترة والتحصيل المتاح لصلاحياتك في ملخص خاص وقت تشغيل الأتمتة. الفترة اليومية والأسبوعية والشهرية بتبدأ من منتصف الليل بتوقيت المؤسسة. مش ملف بيتبعت بالبريد.",
        )}
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {canCreate && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const fd = new FormData(e.currentTarget);
              await api("/reports/schedules", "POST", Object.fromEntries(fd));
              await load();
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          <Field label={L("Digest name", "اسم الملخص")}>
            <Input name="name" required maxLength={120} />
          </Field>
          <Field label={L("Frequency", "التكرار")}>
            <Select name="frequency">
              <option value="daily">{L("Daily", "يومي")}</option>
              <option value="weekly">{L("Weekly", "أسبوعي")}</option>
              <option value="monthly">{L("Monthly", "شهري")}</option>
            </Select>
          </Field>
          <Button type="submit">{L("Schedule digest", "جدولة الملخص")}</Button>
        </form>
      )}
      <Table
        heads={[
          L("Name", "الاسم"),
          L("Frequency", "التكرار"),
          L("Status", "الحالة"),
          L("Action", "الإجراء"),
        ]}
        rows={rows.map((r) => [
          r.name,
          r.frequency === "daily"
            ? L("Daily", "يومي")
            : r.frequency === "weekly"
              ? L("Weekly", "أسبوعي")
              : L("Monthly", "شهري"),
          <Badge ar={ar} value={r.status} />,
          canEdit ? (
            <button
              className="text-blue-700"
              onClick={async () => {
                try {
                  await api("/reports/schedules/" + r.id, "PUT", {
                    status: r.status === "active" ? "paused" : "active",
                  });
                  await load();
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              {r.status === "active"
                ? L("Pause", "إيقاف")
                : L("Resume", "استئناف")}
            </button>
          ) : (
            "—"
          ),
        ])}
      />
      {snapshots.map((s) => (
        <section
          key={s.id}
          className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
        >
          <h4 className="font-semibold">
            {s.name} · {s.period}
          </h4>
          <p className="text-xs text-slate-500">
            {s.payload.from} / {s.payload.to}
          </p>
          <p className="text-sm">
            {L("Groups / seats", "المجموعات / المقاعد")}:{" "}
            {s.payload.academic.groups} / {s.payload.academic.seats}
          </p>
          <p className="text-sm">
            {L("Sessions / completed", "الحصص / المكتمل")}:{" "}
            {s.payload.teaching.sessions} / {s.payload.teaching.completed}
          </p>
          {s.payload.finance && (
            <p className="text-sm">
              {L(
                "Net recorded collections, not profit",
                "صافي التحصيل المسجل، مش الأرباح",
              )}
              : {s.payload.finance.net_collections}
            </p>
          )}
        </section>
      ))}
    </Card>
  );
}
