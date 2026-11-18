"use client";
import { FamilyRequestHistory } from "./family-request-history";
import { FamilySchedule } from "./family-schedule";
import { FamilyInvoiceHistory } from "./family-invoice-history";
import { FamilyAttendanceHistory } from "./family-attendance-history";
import { FamilyResultHistory } from "./family-result-history";
import { OrganizationLogo } from "./organization-logo";
import { ProfilePhoto } from "./profile-photo";
import { useModalFocus } from "./modal-focus";
import { InvoicePrintHeader, InvoicePrintFooter } from "./invoice-print";
import { Support, Documents } from "./resources";
import { Temporal } from "@js-temporal/polyfill";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  ArrowLeft,
  GraduationCap,
  CalendarDays,
  CheckCircle2,
  FileText,
  MessageSquare,
  Users,
  Plus,
  ExternalLink,
  Bell,
  LogOut,
} from "lucide-react";
import { Button, Card, Field, Input, Select, inputClass } from "./ui";
import type { T } from "./i18n";
import { PayrollSnapshot, printRecord } from "./finance-extra";
type Row = Record<string, any>;
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
type Props = {
  t: T;
  api: Api;
  toast: (s: string) => void;
  timezone: string;
  currency: string;
  allowed: (r: string, a?: string) => boolean;
};
const statusNames: Record<string, [string, string]> = {
  open: ["Open", "مفتوح"],
  in_progress: ["In progress", "جاري العمل"],
  waiting: ["Waiting", "في الانتظار"],
  resolved: ["Resolved", "تم الحل"],
  ordered: ["Ordered", "مطلوب"],
  received: ["Received", "تم الاستلام"],
  available: ["Available", "متاح"],
  loaned: ["Loaned", "مستعار"],
  fulfilled: ["Fulfilled", "تم التنفيذ"],
  cancelled: ["Cancelled", "ملغي"],
  dispatched: ["Dispatched", "تم التسليم"],
  returned: ["Returned", "تم الإرجاع"],
  assigned: ["Assigned", "مخصص"],
  maintenance: ["Maintenance", "صيانة"],
  retired: ["Retired", "خارج الخدمة"],
  active: ["Active", "نشط"],
  inactive: ["Inactive", "غير نشط"],

  published: ["Published", "منشور"],
  draft: ["Draft", "مسودة"],
  closed: ["Closed", "مغلق"],
  pending: ["Pending", "قيد المراجعة"],
  accepted: ["Accepted", "مقبول"],
  approved: ["Approved", "موافق عليه"],
  closed_zero: ["Closed / no payment", "مغلق / بدون صرف"],
  rejected: ["Rejected", "مرفوض"],
  present: ["Present", "حاضر"],
  absent: ["Absent", "غائب"],
  late: ["Late", "متأخر"],
  excused: ["Excused", "بعذر"],
  left_early: ["Left early", "انصرف مبكرا"],
  scheduled: ["Scheduled", "مجدول"],
  completed: ["Completed", "مكتمل"],
  paid: ["Paid", "مدفوع"],
  issued: ["Issued", "صادرة"],
  void: ["Void", "ملغاة"],
  final: ["Final", "نهائي"],
  pending_review: ["Needs review", "يحتاج مراجعة"],
  meeting: ["Meeting", "مقابلة"],
  contact: ["Contact", "تواصل"],
  absence_excuse: ["Absence excuse", "عذر غياب"],
  article: ["Article", "شرح مكتوب"],
  video: ["Video", "فيديو"],
  live: ["Live class", "حصة مباشرة"],
  paused: ["Paused", "متوقف"],
  low: ["Low", "منخفضة"],
  normal: ["Normal", "عادية"],
  high: ["High", "مرتفعة"],
  urgent: ["Urgent", "عاجلة"],
  lost: ["Lost", "مفقود"],
  archived: ["Archived", "مؤرشف"],
  material: ["Material", "مادة تعليمية"],
  visible: ["Visible", "ظاهر"],
  hidden: ["Hidden", "مخفي"],
};
export function Badge({ value, ar }: { value: string; ar: boolean }) {
  return (
    <span className="inline-block rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-200">
      {statusNames[value]?.[ar ? 1 : 0] ?? value}
    </span>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="p-6 text-sm leading-7 text-slate-500">{children}</p>;
}
export function Table({
  heads,
  rows,
}: {
  heads: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-start text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-950">
          <tr>
            {heads.map((h) => (
              <th
                className="whitespace-nowrap px-4 py-3 text-start font-medium"
                key={h}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className="border-t border-slate-100 dark:border-slate-800"
            >
              {r.map((v, k) => (
                <td key={k} className="px-4 py-4 align-top">
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}
export function Portal({
  user,
  organization,
  chrome,
  onLogout,
  ...p
}: Props & {
  user: Row;
  organization: Row;
  chrome: ReactNode;
  onLogout: () => void;
}) {
  const ar = p.t.language === "English",
    L = (e: string, a: string) => (ar ? a : e);
  const [home, setHome] = useState<Row | null>(null),
    [family, setFamily] = useState<Row | null>(null),
    [child, setChild] = useState(""),
    [error, setError] = useState(""),
    [mode, setMode] = useState("overview"),
    [notices, setNotices] = useState<Row[]>([]),
    [invoice, setInvoice] = useState<Row | null>(null),
    [library, setLibrary] = useState<Row[]>([]),
    [correction, setCorrection] = useState<Row | null>(null);
  const teacher = user.system_key === "teacher";
  const date = (n: number) =>
    new Date(n * 1000).toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB", {
      timeZone: p.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    });
  const money = (n: number) =>
    new Intl.NumberFormat(ar ? "ar-EG-u-nu-latn" : "en-GB", {
      maximumFractionDigits: 0,
    }).format(n) +
    " " +
    p.currency;
  const familyRequest = useRef(0);
  async function load() {
    const request = ++familyRequest.current;
    setFamily(null);
    setInvoice(null);
    try {
      setError("");
      const h = await p.api(teacher ? "/portal/teacher" : "/portal");
      if (request !== familyRequest.current) return;
      setHome(h);
      const ns = await p.api("/notifications");
      if (request !== familyRequest.current) return;
      setNotices(ns.data);
      if (!teacher && h.children.length) {
        const id = h.children.some((r: Row) => r.id === child)
          ? child
          : h.children[0].id;
        setChild(id);
        const result = await p.api("/portal/students/" + id);
        if (request === familyRequest.current) setFamily(result);
      }
    } catch (e) {
      if (request === familyRequest.current) setError(String(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function choose(id: string) {
    const request = ++familyRequest.current;
    setChild(id);
    setError("");
    setInvoice(null);
    setFamily(null);
    try {
      const result = await p.api("/portal/students/" + id);
      if (request === familyRequest.current) setFamily(result);
    } catch (e) {
      if (request === familyRequest.current) setError(String(e));
    }
  }
  useEffect(() => {
    if (mode === "library" && child && !teacher)
      p.api("/portal/library/" + child)
        .then((r) => setLibrary(r.data))
        .catch((e) => setError(String(e)));
  }, [mode, child]);
  const tabs = [
    ["overview", L("My day", "يومي")],
    ["learning", L("Learning space", "مساحة التعلم")],
    ["notices", L("Inbox", "الوارد")],
    ["support", L("Support", "الدعم")],
    ["documents", L("Documents", "المستندات")],
    ...(!teacher ? [["library", L("Library history", "سجل المكتبة")]] : []),
  ];
  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-blue-700 p-2.5 text-white">
              <GraduationCap size={23} />
            </span>
            <div>
              <strong>ELCenter</strong>
              <p className="text-xs text-slate-500">
                {teacher
                  ? L("Teacher workspace", "مساحة المدرس")
                  : user.system_key === "student"
                    ? L("Student portal", "بوابة الطالب")
                    : L("Family portal", "بوابة ولي الأمر")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {chrome}
            <button
              className="rounded-xl p-3 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={L("Sign out", "تسجيل الخروج")}
              onClick={onLogout}
            >
              <LogOut size={19} />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 md:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-slate-950 p-7 text-white md:p-10">
          <img
            src="/images/study.jpg"
            alt=""
            className="absolute inset-y-0 end-0 h-full w-1/2 object-cover opacity-25"
          />
          <div className="relative">
            <div className="mb-3">
              <OrganizationLogo api={p.api} ar={ar} />
            </div>
            <p className="mb-3 text-xs font-medium text-blue-200">
              {organization.name}
            </p>
            <h1 className="text-2xl font-semibold md:text-3xl">
              {L("Welcome back, ", "أهلا بيك، ")}
              {user.name}
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-7 text-slate-300">
              {teacher
                ? L(
                    "Your classes, coursework and students, all in one place.",
                    "مجموعاتك وواجباتك وطلابك في مكان واحد.",
                  )
                : L(
                    "A clear view of learning, progress and the days ahead.",
                    "كل تفاصيل الدراسة والتقدم والأيام الجاية قدامك.",
                  )}
            </p>
          </div>
        </div>
        {error && (
          <div
            role="alert"
            className="rounded-xl bg-red-50 p-4 text-sm text-red-700"
          >
            {error}
          </div>
        )}
        {!home && !error && (
          <Empty>{L("Loading your workspace…", "جاري تحميل مساحتك…")}</Empty>
        )}
        {home && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <nav className="flex max-w-full flex-wrap gap-1 rounded-xl bg-white p-1 dark:bg-slate-900">
                {tabs.map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setMode(key)}
                    className={
                      "rounded-lg px-4 py-2.5 text-sm font-medium " +
                      (mode === key
                        ? "bg-blue-700 text-white"
                        : "text-slate-500")
                    }
                  >
                    {label}
                    {key === "notices" && notices.length > 0
                      ? " (" + notices.length + ")"
                      : ""}
                  </button>
                ))}
              </nav>
              {!teacher && (
                <label className="flex items-center gap-3 text-sm">
                  <Users size={18} />
                  {L("Student", "الطالب")}
                  <Select
                    value={child}
                    onChange={(e) => void choose(e.target.value)}
                  >
                    {home.children.map((c: Row) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
            </div>
            {teacher && mode === "home" && (
              <ProfilePhoto
                api={p.api}
                ar={ar}
                entity="teachers"
                id={home.profile.id}
              />
            )}
            {mode === "support" ? (
              <Support
                {...p}
                portal
                studentId={child}
                branchId={home.profile.branch_id}
              />
            ) : mode === "documents" ? (
              <Documents
                {...p}
                portal
                targetKind={teacher ? "teacher" : "student"}
                targetId={teacher ? home.profile.id : child}
                branchId={
                  teacher ? home.profile.branch_id : family?.student.branch_id
                }
              />
            ) : mode === "library" ? (
              <Panel
                title={L(
                  "Borrowing history, latest 100",
                  "سجل الاستعارة، آخر 100",
                )}
              >
                <Table
                  heads={[
                    L("Book", "الكتاب"),
                    L("Borrowed", "الاستعارة"),
                    L("Due", "الموعد"),
                    L("Returned", "الإرجاع"),
                    L("Recorded penalty", "الغرامة المسجلة"),
                  ]}
                  rows={library.map((r) => [
                    r.title,
                    r.borrowed_on,
                    r.due_on,
                    r.returned_on ?? L("On loan", "قيد الاستعارة"),
                    money(r.penalty_total),
                  ])}
                />
              </Panel>
            ) : mode === "learning" ? (
              <LearningSpace {...p} studentId={child} />
            ) : mode === "notices" ? (
              <Panel title={L("Private inbox", "الوارد الخاص")}>
                {notices.length ? (
                  notices.map((n) => (
                    <div
                      key={n.id}
                      className="border-b border-slate-100 p-5 dark:border-slate-800"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-medium">{n.title}</h3>
                        {!n.read_at && (
                          <button
                            className="text-xs text-blue-700"
                            onClick={() =>
                              void p
                                .api(
                                  "/notifications/" + n.id + "/read",
                                  "POST",
                                  {},
                                )
                                .then(load)
                                .catch((e) => setError(String(e)))
                            }
                          >
                            {L("Mark read", "تحديد كمقروء")}
                          </button>
                        )}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-500">
                        {n.body}
                      </p>
                    </div>
                  ))
                ) : (
                  <Empty>{L("No messages yet.", "مفيش رسايل لسه.")}</Empty>
                )}
              </Panel>
            ) : teacher ? (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    [
                      L("Group preview (up to 100)", "معاينة مجموعات (لحد100)"),
                      home.groups.length,
                    ],
                    [
                      L("Session preview (up to 100)", "معاينة حصص (لحد100)"),
                      home.sessions.length,
                    ],
                    [
                      L("Exam preview (up to 100)", "معاينة امتحانات (لحد100)"),
                      home.exams.length,
                    ],
                  ].map(([label, n]) => (
                    <Card className="p-5" key={label}>
                      <p className="text-sm text-slate-500">{label}</p>
                      <p className="mt-2 text-3xl font-semibold">{n}</p>
                    </Card>
                  ))}
                </div>
                <Panel title={L("Your timetable", "جدولك")}>
                  <FamilySchedule
                    key={home.profile.id}
                    id={home.profile.id}
                    name={home.profile.name}
                    api={p.api}
                    ar={ar}
                    teacher
                    attendance={(id) => <AttendanceButton {...p} id={id} />}
                  />
                </Panel>
                <Panel
                  title={L("Leave requests", "طلبات الإجازة")}
                  action={
                    home.can_request_leave ? (
                      <ActionForm
                        timezone={p.timezone}
                        title={L("Request leave", "طلب إجازة")}
                        ar={ar}
                        fields={[
                          [
                            "type",
                            L("Type", "النوع"),
                            "select",
                            ["vacation", "sick", "unpaid", "other"],
                          ],
                          ["starts_on", L("Starts on", "من تاريخ"), "date"],
                          ["ends_on", L("Ends on", "إلى تاريخ"), "date"],
                          ["reason", L("Reason", "السبب")],
                        ]}
                        submit={async (d) => {
                          await p.api("/portal/teacher/leave", "POST", d);
                          await load();
                        }}
                      />
                    ) : undefined
                  }
                >
                  {home.leaves?.length ? (
                    <Table
                      heads={[
                        L("Type", "النوع"),
                        L("From", "من"),
                        L("Until", "إلى"),
                        L("Status", "الحالة"),
                      ]}
                      rows={home.leaves.map((r: Row) => [
                        r.type,
                        r.starts_on,
                        r.ends_on,
                        <Badge value={r.status} ar={ar} />,
                      ])}
                    />
                  ) : (
                    <Empty>
                      {L(
                        "HR must link your active employee profile to enable leave requests.",
                        "يلزم ربط ملف الموظف النشط عن طريق الموارد البشرية لتفعيل طلبات الإجازة.",
                      )}
                    </Empty>
                  )}
                </Panel>
                <Panel title={L("Salary statements", "مفردات المرتب")}>
                  {home.payroll.length ? (
                    home.payroll.map((r: Row) => (
                      <details
                        key={r.month}
                        id={"teacher-payslip-" + r.month}
                        className="border-b border-slate-100 p-5 dark:border-slate-800"
                      >
                        <summary className="flex cursor-pointer items-center justify-between gap-3">
                          <strong>{r.month}</strong>
                          <span>{money(r.total)}</span>
                          <Badge value={r.status} ar={ar} />
                        </summary>
                        <div className="mt-5">
                          <p className="text-sm">
                            {home.profile.name} · {r.month}
                          </p>
                          <dl className="my-4 grid grid-cols-2 gap-3 text-sm">
                            <dt>{L("Base pay", "الأجر الأساسي")}</dt>
                            <dd>{money(r.base_amount)}</dd>
                            <dt>{L("Bonus", "المكافآت")}</dt>
                            <dd>{money(r.bonus)}</dd>
                            <dt>{L("Deduction", "الخصومات")}</dt>
                            <dd>{money(r.deduction)}</dd>
                            <dt>{L("Net total", "الصافي")}</dt>
                            <dd>{money(r.total)}</dd>
                          </dl>
                          <PayrollSnapshot
                            value={JSON.parse(r.calculation_json)}
                            ar={ar}
                            money={money}
                          />
                          <Button
                            className="mt-4"
                            onClick={() =>
                              printRecord(
                                L("Salary statement ", "مفردات مرتب ") +
                                  r.month,
                                document.getElementById(
                                  "teacher-payslip-" + r.month,
                                )!,
                              )
                            }
                          >
                            {L("Print / Save PDF", "طباعة / حفظ PDF")}
                          </Button>
                        </div>
                      </details>
                    ))
                  ) : (
                    <Empty>
                      {L(
                        "No salary statements have been prepared.",
                        "لم يتم تجهيز مفردات مرتب بعد.",
                      )}
                    </Empty>
                  )}
                </Panel>
              </>
            ) : family ? (
              <>
                <Card className="p-5">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <ProfilePhoto
                        api={p.api}
                        ar={ar}
                        entity="students"
                        id={family.student.id}
                      />
                      <h2 className="font-semibold">{family.student.name}</h2>
                      <p className="mt-2 text-sm text-slate-500">
                        <bdi>{family.student.code}</bdi> ·{" "}
                        {[
                          family.student.school,
                          family.student.grade,
                          family.student.stage,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="text-sm text-slate-500">
                      <p>{family.student.phone}</p>
                      <p>{family.student.email}</p>
                    </div>
                  </div>
                </Card>

                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    [L("Enrolled groups", "المجموعات"), family.summary.groups],
                    [L("Published results", "النتائج"), family.summary.results],
                    [
                      L("Outstanding balance", "المبلغ المتبقي"),
                      money(family.summary.outstanding),
                    ],
                  ].map(([label, n]) => (
                    <Card className="p-5" key={label}>
                      <p className="text-sm text-slate-500">{label}</p>
                      <p className="mt-2 text-2xl font-semibold">{n}</p>
                    </Card>
                  ))}
                </div>
                <p className="text-xs leading-6 text-slate-500">
                  {L(
                    "Overview totals include all eligible records. Group lists remain bounded previews: first100 active/completed enrollments by group name. The schedule below has complete bounded date windows. Results, attendance, invoices and your own center requests below have separate complete page navigation. Lists and totals are live reads, not an archived statement.",
                    "إجماليات الملخص بتشمل كل السجلات المناسبة. قوائم المجموعات معاينات محدودة: أول100 تسجيل نشط أو مكتمل بترتيب المجموعة. الجدول تحت بفترات تاريخ كاملة ضمن الحدود. النتايج والحضور والفواتير وطلباتك للمركز تحت ليهم صفحات مستقلة للسجل كله. القوائم والإجماليات قراءة مباشرة مش كشف مؤرشف.",
                  )}
                </p>
                <div className="grid gap-6 lg:grid-cols-2">
                  <Panel title={L("Upcoming sessions", "الحصص الجاية")}>
                    <FamilySchedule
                      key={family.student.id}
                      id={family.student.id}
                      name={family.student.name}
                      api={p.api}
                      ar={ar}
                    />
                  </Panel>
                  <Panel title={L("Academic results", "النتائج الدراسية")}>
                    <FamilyResultHistory
                      key={family.student.id}
                      id={family.student.id}
                      name={family.student.name}
                      api={p.api}
                      ar={ar}
                      timezone={p.timezone}
                    />
                  </Panel>
                </div>
                <Panel title={L("Attendance history", "سجل الحضور")}>
                  <FamilyAttendanceHistory
                    key={family.student.id}
                    id={family.student.id}
                    name={family.student.name}
                    api={p.api}
                    ar={ar}
                    timezone={p.timezone}
                    correction={setCorrection}
                  />
                </Panel>
                <Panel
                  title={L(
                    "Invoices & recorded payments",
                    "الفواتير والمدفوعات المسجلة",
                  )}
                >
                  <FamilyInvoiceHistory
                    key={family.student.id}
                    id={family.student.id}
                    name={family.student.name}
                    api={p.api}
                    ar={ar}
                    view={async (id) => {
                      const request = familyRequest.current;
                      setInvoice(null);
                      setError("");
                      try {
                        const result = await p.api("/portal/invoices/" + id);
                        if (request === familyRequest.current)
                          setInvoice(result);
                      } catch (e) {
                        if (request === familyRequest.current)
                          setError(String(e));
                      }
                    }}
                  />
                </Panel>
                <Panel title={L("Contact your center", "التواصل مع المركز")}>
                  <div className="p-5">
                    <ActionForm
                      timezone={p.timezone}
                      title={L("New request", "طلب جديد")}
                      submit={async (d) => {
                        await p.api("/portal/requests", "POST", {
                          ...d,
                          student_id: child,
                        });
                        await load();
                      }}
                      fields={[
                        [
                          "kind",
                          L("Request type", "نوع الطلب"),
                          "select",
                          ["absence_excuse", "meeting", "contact"],
                        ],
                        ["subject", L("Subject", "الموضوع")],
                        ["body", L("Message", "الرسالة"), "textarea"],
                        [
                          "requested_on",
                          L(
                            "Requested date (optional)",
                            "التاريخ المطلوب (اختياري)",
                          ),
                          "date",
                        ],
                      ]}
                      ar={ar}
                    />
                  </div>
                  <FamilyRequestHistory
                    key={family.student.id}
                    id={family.student.id}
                    name={family.student.name}
                    ar={ar}
                    api={p.api}
                    timezone={p.timezone}
                    version={familyRequest.current}
                  />
                </Panel>
              </>
            ) : (
              <Empty>
                {L(
                  "Ask an administrator to link your student profile.",
                  "اطلب من الإدارة ربط حسابك بملف الطالب.",
                )}
              </Empty>
            )}
          </>
        )}
        {invoice && (
          <Dialog title={invoice.data.number} close={() => setInvoice(null)}>
            <div id="portal-invoice">
              <InvoicePrintHeader snapshot={invoice.print_snapshot} ar={ar} />
              <p>
                {invoice.student.name} · {invoice.data.date} ·{" "}
                {invoice.data.number}
              </p>
              <div className="mt-4">
                <Table
                  heads={[
                    L("Item", "البند"),
                    L("Quantity", "الكمية"),
                    L("Price", "السعر"),
                  ]}
                  rows={invoice.items.map((i: Row) => [
                    i.description,
                    i.quantity,
                    money(i.unit_price),
                  ])}
                />
              </div>
              <p className="my-5 font-semibold">
                {L("Total", "الإجمالي")}: {money(invoice.data.total)}
              </p>
              <InvoicePrintFooter snapshot={invoice.print_snapshot} ar={ar} />
              {invoice.installments.length > 0 && (
                <>
                  <h3 className="mb-3 font-semibold">
                    {L("Installment plan", "خطة الأقساط")}
                  </h3>
                  <Table
                    heads={[
                      L("Due date", "تاريخ الاستحقاق"),
                      L("Amount", "المبلغ"),
                    ]}
                    rows={invoice.installments.map((r: Row) => [
                      r.due_date,
                      money(r.amount),
                    ])}
                  />
                </>
              )}
              <h3 className="font-semibold">
                {L(
                  "Recorded receipts / refunds",
                  "المقبوضات والمبالغ المستردة المسجلة",
                )}
              </h3>
              <Table
                heads={[
                  L("Receipt number / ID", "رقم / معرّف الإيصال"),
                  L("Date", "التاريخ"),
                  L("Type", "النوع"),
                  L("Amount", "المبلغ"),
                ]}
                rows={invoice.payments.map((r: Row) => [
                  r.receipt_number ?? r.id,
                  r.date,
                  r.kind === "receipt"
                    ? L("Receipt", "إيصال قبض")
                    : L("Refund", "استرداد"),
                  money(r.amount),
                ])}
              />
              {!!invoice.payments.length && (
                <InvoicePrintFooter
                  snapshot={invoice.print_snapshot}
                  ar={ar}
                  receipt
                />
              )}
            </div>
            <Button
              onClick={() =>
                printRecord(
                  invoice.data.number,
                  document.getElementById("portal-invoice")!,
                )
              }
            >
              {L("Print / Save PDF", "طباعة / حفظ PDF")}
            </Button>
          </Dialog>
        )}
        {correction && (
          <PortalCorrectionDialog
            ar={ar}
            api={p.api}
            attendance={correction}
            close={() => {
              setCorrection(null);
              void load();
            }}
          />
        )}
      </main>
    </div>
  );
}
type Def = [string, string, string?, string[]?];
export function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useModalFocus(close);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-950/50 p-3 md:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl md:p-7 dark:bg-slate-900"
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button
            className="rounded-lg px-3 py-2 text-xl text-slate-500"
            aria-label="Close"
            onClick={close}
          >
            ×
          </button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
export function ActionForm({
  title,
  fields,
  submit,
  ar,
  initial = {},
  timezone = "Africa/Cairo",
}: {
  title: string;
  fields: Def[];
  submit: (d: Row) => Promise<void>;
  ar: boolean;
  initial?: Row;
  timezone?: string;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={16} />
        {title}
      </Button>
      {open && (
        <Dialog title={title} close={() => setOpen(false)}>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget),
                d: Row = {};
              try {
                for (const [k, , type] of fields) {
                  const v = String(f.get(k) ?? "");
                  d[k] =
                    type === "number"
                      ? Number(v)
                      : type === "datetime-local"
                        ? Math.floor(
                            Temporal.PlainDateTime.from(v).toZonedDateTime(
                              timezone,
                              { disambiguation: "reject" },
                            ).epochMilliseconds / 1000,
                          )
                        : v;
                }
                await submit(d);
                setOpen(false);
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {fields.map(([key, label, type = "text", options]) => (
              <Field label={label} key={key}>
                {type === "select" ? (
                  <Select
                    aria-label={label}
                    name={key}
                    defaultValue={initial[key] ?? options?.[0]}
                  >
                    {options?.map((o) => (
                      <option key={o} value={o}>
                        {statusNames[o]?.[ar ? 1 : 0] ?? o}
                      </option>
                    ))}
                  </Select>
                ) : type === "textarea" ? (
                  <textarea
                    name={key}
                    className={inputClass + " min-h-32"}
                    maxLength={20000}
                    required={
                      !label.includes("optional") && !label.includes("اختياري")
                    }
                    defaultValue={initial[key] ?? ""}
                  />
                ) : (
                  <Input
                    name={key}
                    type={type}
                    min={type === "number" ? 0 : undefined}
                    step={type === "number" ? "1" : undefined}
                    required={
                      !label.includes("optional") && !label.includes("اختياري")
                    }
                    defaultValue={initial[key] ?? ""}
                  />
                )}
              </Field>
            ))}
            {error && (
              <p
                role="alert"
                className="rounded-xl bg-red-50 p-3 text-sm text-red-700"
              >
                {error}
              </p>
            )}
            <Button disabled={busy} type="submit">
              {busy ? (ar ? "جاري الحفظ…" : "Saving…") : ar ? "حفظ" : "Save"}
            </Button>
          </form>
        </Dialog>
      )}
    </>
  );
}
function AttendanceButton(p: Props & { id: string }) {
  const ar = p.t.language === "English",
    L = (e: string, a: string) => (ar ? a : e);
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [correction, setCorrection] = useState<Row | null>(null);
  return (
    <>
      <button
        className="font-medium text-blue-700"
        onClick={() =>
          void p
            .api("/lms/sessions/" + p.id + "/attendance")
            .then(setData)
            .catch((e) => setError(String(e)))
        }
      >
        {L("Record attendance", "تسجيل الحضور")}
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
      {data && (
        <Dialog
          title={L("Class attendance", "حضور الحصة")}
          close={() => setData(null)}
        >
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await p.api("/lms/sessions/" + p.id + "/attendance", "POST", {
                  rows: data.data
                    .filter((s: Row) => !s.attendance_id)
                    .map((s: Row) => ({
                      student_id: s.student_id,
                      status: f.get(s.student_id),
                      notes: "",
                    })),
                });
                p.toast(p.t.saved);
                setData(null);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            {data.data.map((s: Row) => (
              <Field key={s.student_id} label={s.name + " · " + s.code}>
                <Select
                  name={s.student_id}
                  defaultValue={s.status ?? "present"}
                  disabled={!!s.attendance_id}
                >
                  {["present", "absent", "late", "excused", "left_early"].map(
                    (v) => (
                      <option key={v} value={v}>
                        {statusNames[v][ar ? 1 : 0]}
                      </option>
                    ),
                  )}
                </Select>
                {s.attendance_id && (
                  <button
                    type="button"
                    className="mt-2 text-sm font-medium text-blue-700 dark:text-blue-300"
                    onClick={() => {
                      setData(null);
                      setCorrection({ ...s, id: s.attendance_id });
                    }}
                  >
                    {L("Request correction / history", "طلب تصحيح / السجل")}
                  </button>
                )}
              </Field>
            ))}
            {error && (
              <p role="alert" className="text-red-700">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={!data.data.some((s: Row) => !s.attendance_id)}
            >
              {L("Save new attendance", "حفظ الحضور الجديد")}
            </Button>
          </form>
        </Dialog>
      )}
      {correction && (
        <PortalCorrectionDialog
          ar={ar}
          api={p.api}
          attendance={correction}
          close={() => setCorrection(null)}
        />
      )}
    </>
  );
}
export function LearningSpace(p: Props & { studentId?: string }) {
  const ar = p.t.language === "English",
    L = (e: string, a: string) => (ar ? a : e);
  const [groups, setGroups] = useState<Row[]>([]),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [lesson, setLesson] = useState<Row | null>(null),
    [assignment, setAssignment] = useState<Row | null>(null),
    [quiz, setQuiz] = useState<Row | null>(null),
    [roster, setRoster] = useState<Row[] | null>(null);
  const date = (n: number) =>
    new Date(n * 1000).toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB", {
      timeZone: p.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    });
  const qp = p.studentId ? "?student_id=" + p.studentId : "";
  async function load(id = selected) {
    try {
      setError("");
      if (id) {
        setDetail(await p.api("/lms/groups/" + id + qp));
        setSelected(id);
      } else {
        setGroups((await p.api("/lms/groups")).data);
        setDetail(null);
        setSelected("");
      }
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void load("");
  }, [p.studentId]);
  const lessonFields: Def[] = [
    ["title", L("Title", "العنوان")],
    ["description", L("Description (optional)", "الوصف (اختياري)")],
    [
      "kind",
      L("Type", "النوع"),
      "select",
      ["article", "video", "live", "material"],
    ],
    ["content", L("Article text / notes", "نص الشرح / ملاحظات"), "textarea"],
    [
      "url",
      L("HTTPS external link (optional)", "رابط خارجي HTTPS (اختياري)"),
      "url",
    ],
    ["position", L("Order", "الترتيب"), "number"],
    [
      "status",
      L("Status", "الحالة"),
      "select",
      ["draft", "published", "archived"],
    ],
  ];
  const assignmentFields: Def[] = [
    ["title", L("Title", "العنوان")],
    ["instructions", L("Instructions", "التعليمات"), "textarea"],
    ["due_at", L("Deadline", "آخر موعد"), "datetime-local"],
    ["max_score", L("Maximum score", "الدرجة النهائية"), "number"],
    [
      "status",
      L("Status", "الحالة"),
      "select",
      ["draft", "published", "closed"],
    ],
  ];
  const examFields: Def[] = [
    ["name", L("Exam name", "اسم الامتحان")],
    ["scheduled_at", L("Start time", "موعد البداية"), "datetime-local"],
    ["max_score", L("Maximum score", "الدرجة النهائية"), "number"],
    ["pass_score", L("Passing score", "درجة النجاح"), "number"],
  ];
  return (
    <div className="space-y-5">
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {!detail ? (
        <>
          <div>
            <h1 className="text-2xl font-semibold">
              {L("A space to keep growing", "مساحة تكمل فيها تعلمك")}
            </h1>
            <p className="mt-2 text-sm leading-7 text-slate-500">
              {L(
                "Open your class for lessons, coursework, quizzes and conversations.",
                "افتح مجموعتك للشرح والواجبات والاختبارات والمناقشات.",
              )}
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((g, i) => (
              <Card className="overflow-hidden" key={g.id}>
                <div className="relative h-36 overflow-hidden bg-blue-950">
                  <img
                    src={
                      [
                        "/images/study.jpg",
                        "/images/students.jpg",
                        "/images/campus.jpg",
                      ][i % 3]
                    }
                    alt=""
                    className="h-full w-full object-cover opacity-65"
                  />
                  <span className="absolute start-4 top-4 rounded-lg bg-white/90 p-2 text-blue-700">
                    <BookOpen size={19} />
                  </span>
                </div>
                <div className="p-5">
                  <p className="text-xs text-slate-500">{g.course_name}</p>
                  <h2 className="mt-2 text-lg font-semibold">{g.name}</h2>
                  <p className="mb-5 mt-2 text-sm text-slate-500">
                    {g.teacher_name}
                  </p>
                  <Button onClick={() => void load(g.id)}>
                    {L("Open class", "فتح المجموعة")}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
          {!groups.length && (
            <Card>
              <Empty>
                {L(
                  "No assigned or enrolled classes. Ask your center to check your profile link.",
                  "مفيش مجموعات مرتبطة بحسابك. راجع الإدارة للتأكد من ربط الملف.",
                )}
              </Empty>
            </Card>
          )}
        </>
      ) : (
        <>
          <button
            onClick={() => void load("")}
            className="flex items-center gap-2 text-sm font-medium text-blue-700"
          >
            <ArrowLeft size={16} />
            {L("All classes", "كل المجموعات")}
          </button>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs text-slate-500">
                {detail.group.course_name}
              </p>
              <h1 className="mt-2 text-2xl font-semibold">
                {detail.group.name}
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                {detail.group.teacher_name} · {detail.group.branch_name}
              </p>
            </div>
            {detail.can_teach && (
              <div className="flex flex-wrap gap-2">
                <ActionForm
                  timezone={p.timezone}
                  title={L("New lesson", "درس جديد")}
                  fields={lessonFields}
                  ar={ar}
                  initial={{ position: 0 }}
                  submit={async (d) => {
                    await p.api("/lms/lessons", "POST", {
                      ...d,
                      group_id: selected,
                    });
                    await load();
                  }}
                />
                <ActionForm
                  timezone={p.timezone}
                  title={L("New assignment", "واجب جديد")}
                  fields={assignmentFields}
                  ar={ar}
                  initial={{ max_score: 20 }}
                  submit={async (d) => {
                    await p.api("/lms/assignments", "POST", {
                      ...d,
                      group_id: selected,
                    });
                    await load();
                  }}
                />
                <button
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm"
                  onClick={() =>
                    void p
                      .api("/lms/groups/" + selected + "/roster")
                      .then((r) => setRoster(r.data))
                      .catch((e) => setError(String(e)))
                  }
                >
                  {L("Class roster", "قائمة الطلاب")}
                </button>
              </div>
            )}
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Panel
              title={L(
                "Lessons & learning materials",
                "الدروس والمواد التعليمية",
              )}
            >
              {detail.lessons.length ? (
                detail.lessons.map((r: Row, i: number) => (
                  <button
                    key={r.id}
                    className="flex w-full items-center gap-4 border-b border-slate-100 p-5 text-start hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
                    onClick={() =>
                      void p
                        .api("/lms/lessons/" + r.id)
                        .then((j) => setLesson(j.data))
                        .catch((e) => setError(String(e)))
                    }
                  >
                    <span className="rounded-xl bg-slate-100 p-3 text-sm font-semibold text-slate-500 dark:bg-slate-800">
                      {detail.progress.some(
                        (x: Row) => x.lesson_id === r.id,
                      ) ? (
                        <CheckCircle2 size={20} className="text-teal-600" />
                      ) : (
                        String(i + 1).padStart(2, "0")
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block text-sm">{r.title}</strong>
                      <span className="mt-1 block text-xs leading-6 text-slate-500">
                        {r.description}
                      </span>
                    </span>
                    <Badge
                      value={detail.can_teach ? r.status : r.kind}
                      ar={ar}
                    />
                  </button>
                ))
              ) : (
                <Empty>
                  {L("No lessons published yet.", "مفيش دروس منشورة لسه.")}
                </Empty>
              )}
              {(detail.can_submit || p.studentId) && (
                <p className="px-5 py-4 text-xs text-slate-500">
                  {L("Completed lessons", "الدروس المكتملة")}:{" "}
                  <bdi>
                    {detail.progress.length} / {detail.lessons.length}
                  </bdi>
                </p>
              )}
            </Panel>
            <Panel title={L("Assignments", "الواجبات")}>
              {detail.assignments.length ? (
                detail.assignments.map((r: Row) => (
                  <button
                    key={r.id}
                    className="block w-full border-b border-slate-100 p-5 text-start hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
                    onClick={() =>
                      void p
                        .api("/lms/assignments/" + r.id + qp)
                        .then(setAssignment)
                        .catch((e) => setError(String(e)))
                    }
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong className="text-sm">{r.title}</strong>
                      <Badge value={r.status} ar={ar} />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {L("Due", "آخر موعد")}: {date(r.due_at)} · {r.max_score}{" "}
                      {L("points", "درجة")}
                    </p>
                  </button>
                ))
              ) : (
                <Empty>{L("No assignments yet.", "مفيش واجبات لسه.")}</Empty>
              )}
            </Panel>
          </div>
          <Panel
            title={L("Quizzes & exams", "الاختبارات والامتحانات")}
            action={
              detail.can_teach ? (
                <ActionForm
                  timezone={p.timezone}
                  title={L("Draft exam", "امتحان جديد")}
                  fields={examFields}
                  ar={ar}
                  initial={{ max_score: 10, pass_score: 5 }}
                  submit={async (d) => {
                    const r = await p.api("/lms/exams", "POST", {
                      ...d,
                      group_id: selected,
                      status: "draft",
                    });
                    await load();
                    setQuiz(await p.api("/lms/exams/" + r.id));
                  }}
                />
              ) : undefined
            }
          >
            {detail.quizzes.length ? (
              <Table
                heads={[
                  L("Exam", "الامتحان"),
                  L("Start", "البداية"),
                  L("Status", "الحالة"),
                  L("Action", "الإجراء"),
                ]}
                rows={detail.quizzes.map((r: Row) => [
                  r.name,
                  date(r.scheduled_at),
                  <Badge value={r.status} ar={ar} />,
                  <button
                    className="font-medium text-blue-700"
                    onClick={() =>
                      void p
                        .api("/lms/exams/" + r.id + qp)
                        .then(setQuiz)
                        .catch((e) => setError(String(e)))
                    }
                  >
                    {detail.can_teach
                      ? L("Manage exam", "إدارة الامتحان")
                      : L("Open exam", "فتح الامتحان")}
                  </button>,
                ])}
              />
            ) : (
              <Empty>
                {L("No published quizzes.", "مفيش اختبارات منشورة.")}
              </Empty>
            )}
          </Panel>
          <Panel
            title={L("Class announcements", "إعلانات المجموعة")}
            action={
              detail.can_teach ? (
                <ActionForm
                  timezone={p.timezone}
                  title={L("New announcement", "إعلان جديد")}
                  ar={ar}
                  fields={[
                    ["title", L("Title", "العنوان")],
                    ["body", L("Message", "الرسالة"), "textarea"],
                  ]}
                  submit={async (d) => {
                    const r = await p.api(
                      "/lms/groups/" + selected + "/announcements",
                      "POST",
                      d,
                    );
                    p.toast(
                      L("Stored in class inboxes: ", "تم التخزين في الوارد: ") +
                        r.stored,
                    );
                    await load();
                  }}
                />
              ) : undefined
            }
          >
            {detail.announcements?.length ? (
              detail.announcements.map((r: Row) => (
                <div
                  key={r.id}
                  className="border-b border-slate-100 p-5 dark:border-slate-800"
                >
                  <h3 className="font-medium">{r.title}</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-500">
                    {r.body}
                  </p>
                </div>
              ))
            ) : (
              <Empty>
                {L("No class announcements yet.", "مفيش إعلانات للمجموعة لسه.")}
              </Empty>
            )}
          </Panel>
          <Documents
            {...p}
            portal={true}
            targetKind="group"
            targetId={detail.group.id}
            branchId={detail.group.branch_id}
            canUpload={detail.can_teach}
          />
          <Panel title={L("Class conversation", "مناقشة المجموعة")}>
            <div className="space-y-4 p-5">
              {detail.discussions.map((r: Row) => (
                <div
                  className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950"
                  key={r.id}
                >
                  <div className="flex justify-between gap-3">
                    <span className="text-sm font-semibold">{r.author}</span>
                    {detail.can_teach && (
                      <button
                        className="text-xs text-blue-700"
                        onClick={() =>
                          void p
                            .api(
                              "/lms/discussions/" + r.id + "/moderate",
                              "POST",
                              {
                                status:
                                  r.status === "hidden" ? "visible" : "hidden",
                              },
                            )
                            .then(() => load())
                            .catch((e) => setError(String(e)))
                        }
                      >
                        {r.status === "hidden"
                          ? L("Restore", "إظهار")
                          : L("Hide", "إخفاء")}
                      </button>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-500">
                    {r.body}
                  </p>
                </div>
              ))}
              {!detail.discussions.length && (
                <p className="text-sm text-slate-500">
                  {L(
                    "Start a thoughtful conversation with your class.",
                    "ابدأ مناقشة مفيدة مع مجموعتك.",
                  )}
                </p>
              )}
              {(detail.can_teach || detail.can_submit) && (
                <ActionForm
                  timezone={p.timezone}
                  title={L("Post a message", "إضافة رسالة")}
                  fields={[["body", L("Message", "الرسالة"), "textarea"]]}
                  ar={ar}
                  submit={async (d) => {
                    await p.api(
                      "/lms/groups/" + selected + "/discussions",
                      "POST",
                      d,
                    );
                    await load();
                  }}
                />
              )}
            </div>
          </Panel>
        </>
      )}
      {lesson && (
        <Dialog title={lesson.title} close={() => setLesson(null)}>
          <p className="mb-4 text-sm text-slate-500">{lesson.description}</p>
          <div className="whitespace-pre-wrap rounded-xl bg-slate-50 p-5 text-sm leading-8 dark:bg-slate-950">
            {lesson.content}
          </div>
          {lesson.url && (
            <a
              className="my-5 flex items-center gap-2 text-sm font-medium text-blue-700"
              href={lesson.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} />
              {L(
                "Open external learning resource",
                "فتح المورد التعليمي الخارجي",
              )}
            </a>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            {detail?.can_submit && (
              <Button
                onClick={() =>
                  void p
                    .api("/lms/lessons/" + lesson.id + "/complete", "POST", {})
                    .then(async () => {
                      await load();
                      setLesson(null);
                    })
                    .catch((e) => setError(String(e)))
                }
              >
                {L("Mark complete", "تم الانتهاء")}
              </Button>
            )}
            {detail?.can_teach && (
              <ActionForm
                timezone={p.timezone}
                title={L("Edit lesson", "تعديل الدرس")}
                fields={lessonFields}
                ar={ar}
                initial={lesson}
                submit={async (d) => {
                  await p.api("/lms/lessons/" + lesson.id, "PUT", {
                    ...d,
                    group_id: selected,
                  });
                  setLesson(null);
                  await load();
                }}
              />
            )}
          </div>
        </Dialog>
      )}
      {assignment && (
        <Dialog title={assignment.data.title} close={() => setAssignment(null)}>
          <p className="whitespace-pre-wrap text-sm leading-8">
            {assignment.data.instructions}
          </p>
          <p className="my-4 text-xs text-slate-500">
            {L("Deadline", "آخر موعد")}: {date(assignment.data.due_at)} ·{" "}
            {assignment.data.max_score} {L("points", "درجة")}
          </p>
          {assignment.can_submit && !assignment.submissions.length && (
            <ActionForm
              timezone={p.timezone}
              title={L("Submit once", "تسليم نهائي مرة واحدة")}
              fields={[
                ["body", L("Your work", "إجابتك"), "textarea"],
                [
                  "url",
                  L("HTTPS work link (optional)", "رابط HTTPS للعمل (اختياري)"),
                  "url",
                ],
              ]}
              ar={ar}
              submit={async (d) => {
                await p.api(
                  "/lms/assignments/" + assignment.data.id + "/submit",
                  "POST",
                  d,
                );
                setAssignment(
                  await p.api("/lms/assignments/" + assignment.data.id + qp),
                );
              }}
            />
          )}
          {assignment.submissions.map((s: Row) => (
            <div
              className="my-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
              key={s.id}
            >
              <h3 className="font-medium">{s.student_name}</h3>
              <p className="my-3 whitespace-pre-wrap text-sm leading-7 text-slate-500">
                {s.body}
              </p>
              {s.url && (
                <a
                  className="text-sm text-blue-700"
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {L("Open submitted resource", "فتح رابط التسليم")} ↗
                </a>
              )}
              <p className="my-3 text-sm">
                {s.score == null
                  ? L("Awaiting feedback", "في انتظار التصحيح")
                  : s.score + " / " + assignment.data.max_score}
              </p>
              <p className="mb-3 whitespace-pre-wrap text-sm text-slate-500">
                {s.feedback}
              </p>
              {assignment.can_grade && (
                <ActionForm
                  timezone={p.timezone}
                  title={L("Grade & feedback", "التصحيح والملاحظات")}
                  ar={ar}
                  fields={[
                    ["score", L("Score", "الدرجة"), "number"],
                    ["feedback", L("Feedback", "الملاحظات"), "textarea"],
                  ]}
                  initial={s}
                  submit={async (d) => {
                    await p.api(
                      "/lms/submissions/" + s.id + "/grade",
                      "POST",
                      d,
                    );
                    setAssignment(
                      await p.api(
                        "/lms/assignments/" + assignment.data.id + qp,
                      ),
                    );
                  }}
                />
              )}
            </div>
          ))}
          {assignment.can_grade && (
            <ActionForm
              timezone={p.timezone}
              title={L("Edit assignment", "تعديل الواجب")}
              ar={ar}
              fields={assignmentFields}
              initial={{
                ...assignment.data,
                due_at: Temporal.Instant.fromEpochMilliseconds(
                  assignment.data.due_at * 1000,
                )
                  .toZonedDateTimeISO(p.timezone)
                  .toPlainDateTime()
                  .toString()
                  .slice(0, 16),
              }}
              submit={async (d) => {
                await p.api("/lms/assignments/" + assignment.data.id, "PUT", {
                  ...d,
                  group_id: selected,
                });
                setAssignment(null);
                await load();
              }}
            />
          )}
        </Dialog>
      )}
      {quiz && (
        <QuizDialog
          {...p}
          value={quiz}
          teaching={!!detail?.can_teach}
          close={() => setQuiz(null)}
          reload={async () => {
            setQuiz(await p.api("/lms/exams/" + quiz.data.id + qp));
            await load();
          }}
        />
      )}
      {roster && (
        <Dialog
          title={L("Class roster", "قائمة الطلاب")}
          close={() => setRoster(null)}
        >
          <Table
            heads={[
              L("Name", "الاسم"),
              L("Code", "الكود"),
              L("Enrollment", "التسجيل"),
              L("Exam average", "متوسط الامتحانات"),
              L("Attendance", "الحضور"),
            ]}
            rows={roster.map((r) => [
              r.name,
              r.code,
              r.status,
              r.average_percent == null ? "—" : r.average_percent + "%",
              r.attendance_percent == null ? "—" : r.attendance_percent + "%",
            ])}
          />
        </Dialog>
      )}
    </div>
  );
}
function QuizDialog(
  p: Props & {
    value: Row;
    teaching: boolean;
    close: () => void;
    reload: () => Promise<void>;
  },
) {
  const ar = p.t.language === "English",
    L = (e: string, a: string) => (ar ? a : e),
    q = p.value;
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title={q.data.name} close={p.close}>
      <div className="mb-5 flex items-center gap-3">
        <Badge ar={ar} value={q.data.status} />
        <p className="text-sm text-slate-500">
          {q.data.max_score} {L("points", "درجة")}
        </p>
      </div>
      {q.result && (
        <div className="mb-5 rounded-xl bg-blue-50 p-4 text-sm dark:bg-blue-950">
          {q.result.status === "final"
            ? L("Your score: ", "درجتك: ") +
              q.result.score +
              " / " +
              q.data.max_score
            : L(
                "Submitted. Awaiting teacher review.",
                "تم التسليم. في انتظار مراجعة المدرس.",
              )}
          {q.result.feedback && <p className="mt-2">{q.result.feedback}</p>}
        </div>
      )}
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const f = new FormData(e.currentTarget);
          try {
            await p.api("/lms/exams/" + q.data.id + "/submit", "POST", {
              answers: q.questions.map((x: Row) => ({
                question_id: x.id,
                answer: String(f.get(x.id) ?? ""),
              })),
            });
            await p.reload();
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {q.questions.map((x: Row, i: number) => (
          <div
            key={x.id}
            className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"
          >
            <p className="mb-3 whitespace-pre-wrap text-sm font-medium">
              {i + 1}. {x.prompt}{" "}
              <span className="text-xs text-slate-400">({x.points})</span>
            </p>
            {p.teaching ? (
              <p className="text-sm text-slate-500">
                {L("Answer key: ", "الإجابة الصحيحة: ")}
                {x.correct_answer}
              </p>
            ) : q.can_submit ? (
              x.type === "multiple_choice" ? (
                <Select aria-label={x.prompt} name={x.id}>
                  <option value="">
                    {L("Choose an answer", "اختر إجابة")}
                  </option>
                  {JSON.parse(x.options_json).map((o: string) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              ) : x.type === "true_false" ? (
                <Select aria-label={x.prompt} name={x.id}>
                  <option value="true">{L("True", "صح")}</option>
                  <option value="false">{L("False", "غلط")}</option>
                </Select>
              ) : (
                <Field label={L("Your answer", "إجابتك")}>
                  <textarea
                    name={x.id}
                    className={inputClass}
                    maxLength={10000}
                    required
                  />
                  {["matching", "fill_blanks"].includes(x.type) && (
                    <span className="text-xs text-slate-500">
                      {L(
                        "Use the JSON format described in the question.",
                        "استخدم صيغة JSON الموضحة في السؤال.",
                      )}
                    </span>
                  )}
                </Field>
              )
            ) : null}
          </div>
        ))}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {q.can_submit && (
          <Button type="submit" disabled={busy}>
            {L(
              "Submit final answers once",
              "تسليم الإجابات النهائية مرة واحدة",
            )}
          </Button>
        )}
      </form>
      {p.teaching && (
        <div className="mt-5 space-y-5">
          {q.data.status === "draft" && (
            <>
              <ActionForm
                timezone={p.timezone}
                title={L("Add question", "إضافة سؤال")}
                ar={ar}
                fields={[
                  [
                    "type",
                    L("Type", "النوع"),
                    "select",
                    [
                      "multiple_choice",
                      "true_false",
                      "short_answer",
                      "essay",
                      "matching",
                      "fill_blanks",
                    ],
                  ],
                  ["prompt", L("Question text", "نص السؤال"), "textarea"],
                  [
                    "options",
                    L(
                      "Choices, one per line (optional)",
                      "الاختيارات، اختيار في كل سطر (اختياري)",
                    ),
                    "textarea",
                  ],
                  [
                    "correct_answer",
                    L(
                      "Correct answer / JSON key (optional)",
                      "الإجابة الصحيحة / JSON (اختياري)",
                    ),
                  ],
                  ["points", L("Points", "الدرجة"), "number"],
                ]}
                initial={{ points: 1 }}
                submit={async (d) => {
                  await p.api(
                    "/lms/exams/" + q.data.id + "/questions",
                    "POST",
                    { ...d, options: d.options.split("\n").filter(Boolean) },
                  );
                  await p.reload();
                }}
              />
              <Button
                onClick={() =>
                  void p
                    .api("/lms/exams/" + q.data.id, "PUT", {
                      ...q.data,
                      status: "published",
                    })
                    .then(p.reload)
                    .catch((e) => setError(String(e)))
                }
              >
                {L("Publish exam", "نشر الامتحان")}
              </Button>
            </>
          )}
          {q.data.status === "published" && (
            <Button
              onClick={() =>
                void p
                  .api("/lms/exams/" + q.data.id, "PUT", {
                    ...q.data,
                    status: "closed",
                  })
                  .then(p.reload)
                  .catch((e) => setError(String(e)))
              }
            >
              {L("Close submissions", "إغلاق الامتحان")}
            </Button>
          )}
          <h3 className="font-semibold">
            {L("Results & teacher review", "النتائج ومراجعة المدرس")}
          </h3>
          {q.data.status === "published" && q.students?.length > 0 && (
            <form
              className="grid gap-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-950"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                try {
                  await p.api("/lms/exams/" + q.data.id + "/results", "POST", {
                    student_id: f.get("student_id"),
                    score: Number(f.get("score")),
                    feedback: f.get("feedback"),
                  });
                  await p.reload();
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              <h4 className="text-sm font-semibold">
                {L("Record a manual result", "تسجيل درجة يدويا")}
              </h4>
              <Field label={L("Student", "الطالب")}>
                <Select name="student_id">
                  {q.students.map((x: Row) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={L("Score", "الدرجة")}>
                <Input
                  required
                  type="number"
                  name="score"
                  min={0}
                  max={q.data.max_score}
                />
              </Field>
              <Field label={L("Feedback", "الملاحظات")}>
                <Input name="feedback" maxLength={2000} />
              </Field>
              <Button type="submit">{L("Save result", "حفظ الدرجة")}</Button>
            </form>
          )}
          {q.results?.map((r: Row) => (
            <div
              className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"
              key={r.id}
            >
              <div className="flex justify-between gap-3">
                <strong>{r.student_name}</strong>
                <Badge value={r.status} ar={ar} />
              </div>
              <p className="my-3 text-sm">
                {r.score} / {q.data.max_score}
              </p>
              {q.answers
                .filter((a: Row) => a.student_id === r.student_id)
                .map((a: Row) => (
                  <p
                    key={a.question_id}
                    className="mb-3 whitespace-pre-wrap text-sm text-slate-500"
                  >
                    {
                      q.questions.find((x: Row) => x.id === a.question_id)
                        ?.prompt
                    }
                    : {a.answer}
                  </p>
                ))}
              {q.data.status === "published" && (
                <ActionForm
                  timezone={p.timezone}
                  title={L("Review final grade", "مراجعة الدرجة النهائية")}
                  ar={ar}
                  fields={[
                    ["score", L("Final score", "الدرجة النهائية"), "number"],
                    ["feedback", L("Feedback", "الملاحظات"), "textarea"],
                  ]}
                  initial={r}
                  submit={async (d) => {
                    await p.api(
                      "/lms/exams/" + q.data.id + "/results",
                      "POST",
                      { ...d, student_id: r.student_id },
                    );
                    await p.reload();
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
export function PortalAdmin(p: Props) {
  const ar = p.t.language === "English",
    L = (e: string, a: string) => (ar ? a : e);
  const [links, setLinks] = useState<Row[]>([]),
    [options, setOptions] = useState<Row | null>(null),
    [requestVersion, setRequestVersion] = useState(0),
    [error, setError] = useState("");
  async function load() {
    try {
      setError("");
      if (p.allowed("users", "manage")) {
        setLinks((await p.api("/portal-links")).data);
        setOptions(await p.api("/portal-links/options"));
      }
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {L("Portals & family requests", "البوابات وطلبات أولياء الأمور")}
        </h1>
        <p className="mt-2 text-sm leading-7 text-slate-500">
          {L(
            "Create a login in Team & access, then explicitly link its identity here. Email matching never grants access.",
            "أنشئ حسابا من الفريق والصلاحيات، وبعدها اربطه بالملف هنا. تطابق الإيميل لوحده لا يمنح أي صلاحيات.",
          )}
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {options && (
        <Panel title={L("Verified profile links", "روابط الحسابات بالملفات")}>
          <div className="p-5">
            <form
              className="grid gap-4 md:grid-cols-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget),
                  u = options.users.find((r: Row) => r.id === f.get("user_id")),
                  kind =
                    u.system_key === "parent_guardian"
                      ? "guardian"
                      : u.system_key;
                try {
                  await p.api("/portal-links", "POST", {
                    user_id: u.id,
                    kind,
                    profile_id: f.get("profile_id"),
                  });
                  await load();
                  p.toast(p.t.saved);
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              <Field label={L("Login", "الحساب")}>
                <Select
                  name="user_id"
                  required
                  onChange={(e) => {
                    const user = options.users.find(
                      (r: Row) => r.id === e.target.value,
                    );
                    setOptions({
                      ...options,
                      selectedKind: user?.system_key,
                      selectedUser: e.target.value,
                    });
                  }}
                  value={options.selectedUser ?? ""}
                >
                  <option value="">{L("Select login", "اختر الحساب")}</option>
                  {options.users.map((r: Row) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · {r.system_key}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={L("Actual profile", "الملف الفعلي")}>
                <Select required name="profile_id">
                  <option value="">{L("Select profile", "اختر الملف")}</option>
                  {(
                    options[
                      options.selectedKind === "teacher"
                        ? "teachers"
                        : options.selectedKind === "parent_guardian"
                          ? "guardians"
                          : "students"
                    ] ?? []
                  ).map((r: Row) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" className="self-end">
                {L("Link identity", "ربط الحساب")}
              </Button>
            </form>
          </div>
          <Table
            heads={[
              L("Login", "الحساب"),
              L("Profile", "الملف"),
              L("Type", "النوع"),
              L("Access", "الوصول"),
            ]}
            rows={links.map((r) => [
              r.user_name,
              r.profile_name,
              r.kind,
              <button
                className="text-sm text-red-700"
                onClick={() => {
                  if (
                    confirm(
                      L(
                        "Remove this identity link and end its sessions?",
                        "إلغاء ربط الحساب وإنهاء جلساته؟",
                      ),
                    )
                  )
                    void p
                      .api("/portal-links/" + r.id, "DELETE")
                      .then(load)
                      .catch((e) => setError(String(e)));
                }}
              >
                {L("Unlink & sign out", "إلغاء الربط والخروج")}
              </button>,
            ])}
          />
        </Panel>
      )}
      {p.allowed("students") && (
        <Panel title={L("Family requests", "طلبات الأسرة")}>
          <FamilyRequestHistory
            staff
            id="staff"
            name={L("Staff review", "مراجعة الموظفين")}
            ar={ar}
            api={p.api}
            timezone={p.timezone}
            version={requestVersion}
            action={(r) =>
              r.status === "pending" && p.allowed("students", "approve") ? (
                <ActionForm
                  timezone={p.timezone}
                  title={L("Respond", "الرد على الطلب")}
                  ar={ar}
                  fields={[
                    [
                      "status",
                      L("Decision", "القرار"),
                      "select",
                      ["accepted", "rejected", "closed"],
                    ],
                    ["response", L("Response", "الرد"), "textarea"],
                  ]}
                  submit={async (d) => {
                    await p.api(
                      "/portal-requests/" + r.id + "/decision",
                      "POST",
                      d,
                    );
                    setRequestVersion((v) => v + 1);
                  }}
                />
              ) : null
            }
          />
        </Panel>
      )}
    </div>
  );
}

function PortalCorrectionDialog({
  ar,
  api,
  attendance,
  close,
}: {
  ar: boolean;
  api: Api;
  attendance: Row;
  close: () => void;
}) {
  const L = (e: string, a: string) => (ar ? a : e);
  const [history, setHistory] = useState<Row[] | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const path = "/portal/attendance/" + attendance.id + "/corrections";
  async function load() {
    try {
      const data = await api(path);
      setHistory(data.data);
      setPending(data.pending);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void load();
  }, [attendance.id]);
  return (
    <Dialog
      title={L("Attendance correction request", "طلب تصحيح حضور")}
      close={close}
    >
      <p className="mb-4 text-sm leading-7 text-slate-500">
        {L(
          "A separate authorized reviewer must approve. This request does not change saved attendance. Only status can be requested here; recorded times and internal notes stay unchanged. Up to 100 correction requests per account in 24 hours.",
          "مسؤول تاني عنده صلاحية لازم يوافق. الطلب مش بيغير الحضور المحفوظ. هنا تقدر تطلب تغيير الحالة بس؛ الأوقات والملاحظات الداخلية مش بتتغير. لحد 100 طلب للحساب خلال 24 ساعة.",
        )}
      </p>
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-3 text-sm text-teal-700">
          {notice}
        </p>
      )}
      {history !== null && (
        <>
          {pending ? (
            <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800 dark:bg-slate-800 dark:text-blue-200">
              {L(
                "A correction is already pending. Please wait for the review.",
                "فيه طلب تصحيح قيد المراجعة بالفعل. استنى نتيجة المراجعة.",
              )}
            </p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                setBusy(true);
                setError("");
                try {
                  await api(path, "POST", {
                    status: fd.get("status"),
                    reason: fd.get("reason"),
                  });
                  setNotice(
                    L(
                      "Request submitted for independent review.",
                      "الطلب اتسجل للمراجعة المستقلة.",
                    ),
                  );
                  await load();
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field
                label={L("Requested attendance status", "حالة الحضور المطلوبة")}
              >
                <Select
                  name="status"
                  aria-label={L(
                    "Requested attendance status",
                    "حالة الحضور المطلوبة",
                  )}
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    {L("Choose status", "اختار الحالة")}
                  </option>
                  {["present", "absent", "late", "excused", "left_early"]
                    .filter((v) => v !== attendance.status)
                    .map((v) => (
                      <option key={v} value={v}>
                        {statusNames[v][ar ? 1 : 0]}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label={L("Reason for correction", "سبب التصحيح")}>
                <textarea
                  aria-label={L("Reason for correction", "سبب التصحيح")}
                  name="reason"
                  required
                  minLength={5}
                  maxLength={1000}
                  className={inputClass + " min-h-24"}
                />
              </Field>
              <Button type="submit" disabled={busy}>
                {L("Submit correction request", "ابعت طلب التصحيح")}
              </Button>
            </form>
          )}
          <h3 className="mb-3 mt-6 font-semibold">
            {L("Your requests (latest 30)", "طلباتك (آخر 30)")}
          </h3>
          {history.length ? (
            <div className="space-y-3">
              {history.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"
                >
                  <div className="flex flex-wrap gap-2">
                    <Badge value={r.new_status} ar={ar} />
                    <Badge value={r.status} ar={ar} />
                  </div>
                  <p className="my-2 whitespace-pre-wrap break-words text-sm">
                    {r.reason}
                  </p>
                  {r.decision_note && (
                    <p className="whitespace-pre-wrap break-words text-sm text-slate-500">
                      {L("Review response: ", "رد المراجع: ")}
                      {r.decision_note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              {L(
                "No requests from this account yet.",
                "مفيش طلبات من الحساب ده لسه.",
              )}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
