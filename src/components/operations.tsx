"use client";
import { ProfilePhoto } from "./profile-photo";
import { useModalFocus } from "./modal-focus";
import { RecordCustomFields } from "./custom-fields";
import { ZeroPayrollClosure } from "./zero-payroll";
import { Temporal } from "@js-temporal/polyfill";
import { useEffect, useState } from "react";
import {
  Plus,
  X,
  Users,
  ChevronRight,
  MessageSquare,
  CalendarDays,
} from "lucide-react";
import { Button, Card, Field, Input, Select } from "./ui";
import type { T } from "./i18n";
import { printRecord, PayrollSnapshot } from "./finance-extra";
import Reception from "./reception";
type Row = Record<string, any>;
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
type FieldDef = {
  key: string;
  en: string;
  ar: string;
  type?: string;
  options?: string[];
  source?: string;
  required?: boolean;
};
const field = (
  key: string,
  en: string,
  ar: string,
  type = "text",
  required = false,
  options?: string[],
  source?: string,
): FieldDef => ({ key, en, ar, type, required, options, source });
const branch = field(
    "branch_id",
    "Branch",
    "الفرع",
    "select",
    true,
    undefined,
    "branches",
  ),
  employee = field(
    "employee_id",
    "Employee",
    "الموظف",
    "select",
    true,
    undefined,
    "employees",
  ),
  name = field("name", "Full name / title", "الاسم / العنوان", "text", true),
  notes = field("notes", "Notes", "ملاحظات"),
  email = field("email", "Email", "الإيميل", "email"),
  phone = field("phone", "Phone", "التليفون"),
  start = field("starts_on", "Starts on", "تاريخ البداية", "date", true),
  end = field("ends_on", "Ends on", "تاريخ النهاية", "date", true),
  date = field("date", "Date", "التاريخ", "date", true),
  job = field("job_title", "Job title", "الوظيفة", "text", true),
  code = field("code", "Code", "الكود", "text", true),
  sources = [
    "website",
    "facebook",
    "instagram",
    "whatsapp",
    "phone",
    "walk_in",
    "referral",
    "other",
  ];
const fields: Record<string, FieldDef[]> = {
  employee_shifts: [
    employee,
    field("starts_at", "Shift starts", "بداية الوردية", "datetime-local", true),
    field("ends_at", "Shift ends", "نهاية الوردية", "datetime-local", true),
    notes,
  ],
  notification_templates: [
    branch,
    name,
    field("title", "Title", "العنوان", "text", true),
    field("body", "Message", "الرسالة", "text", true),
    field("channel", "Channel", "القناة", "select", true, [
      "in_app",
      "email",
      "sms",
      "whatsapp",
    ]),
  ],
  staff_payroll: [
    employee,
    field("month", "Payroll month", "شهر المرتب", "month", true),
    field("bonus", "Bonus", "مكافأة", "number", true),
    field("deduction", "Additional deduction", "خصم إضافي", "number", true),
    field("reason", "Adjustment reason", "سبب التعديل"),
    field(
      "loan_id",
      "Loan or advance to deduct (optional)",
      "سلفة أو قرض للخصم (اختياري)",
      "select",
      false,
      undefined,
      "loans",
    ),
    field(
      "loan_amount",
      "Loan deduction amount",
      "مبلغ الخصم من السلفة",
      "number",
    ),
  ],
  "staff-approve": [date],
  "staff-cancel": [
    field("reason", "Cancellation reason", "سبب الإلغاء", "text", true),
  ],
  "staff-pay": [
    date,
    field("method", "Method", "الطريقة", "select", true, ["cash", "bank"]),
  ],
  coupons: [
    branch,
    name,
    code,
    field("type", "Discount type", "نوع الخصم", "select", true, [
      "fixed",
      "percent",
    ]),
    field("value", "Value / percentage", "القيمة / النسبة", "number", true),
    start,
    end,
    field("max_uses", "Maximum uses", "أقصى استخدامات", "number", true),
    field("status", "Status", "الحالة", "select", true, ["active", "inactive"]),
  ],
  departments: [
    branch,
    name,
    field("manager", "Manager", "المدير"),
    field("status", "Status", "الحالة", "select", true, ["active", "inactive"]),
  ],
  employees: [
    branch,
    name,
    code,
    email,
    phone,
    job,
    field(
      "teacher_id",
      "Linked teacher",
      "حساب المدرّس المرتبط",
      "select",
      false,
      undefined,
      "teachers",
    ),
    field(
      "user_id",
      "Linked login",
      "حساب الدخول المرتبط",
      "select",
      false,
      undefined,
      "staff",
    ),
    field(
      "department_id",
      "Department",
      "القسم",
      "select",
      false,
      undefined,
      "departments",
    ),
    field("emergency_contact", "Emergency contact", "اتصال الطوارئ"),
    field("hired_on", "Hire date", "تاريخ التعيين", "date", true),
    field("status", "Employment status", "حالة التوظيف", "select", true, [
      "onboarding",
      "active",
      "on_leave",
      "resigned",
      "terminated",
    ]),
    notes,
  ],
  contracts: [
    employee,
    field("title", "Contract title", "عنوان العقد", "text", true),
    start,
    end,
    field("salary", "Monthly salary", "المرتب الشهري", "number", true),
    field(
      "workweek",
      "ISO weekdays (1=Mon, 7=Sun), e.g. 7,1,2,3,4",
      "أيام الشغل ISO (1=الاثنين، 7=الأحد)، مثال 7,1,2,3,4",
      "text",
      true,
    ),
    field(
      "overtime_rate",
      "Overtime hourly rate",
      "أجر ساعة الإضافي",
      "number",
      true,
    ),
    field("hours_per_day", "Hours per day", "ساعات اليوم", "number", true),
    notes,
  ],
  employee_attendance: [
    employee,
    date,
    field("arrival", "Arrival", "الحضور", "time"),
    field("departure", "Departure", "الانصراف", "time"),
    field("status", "Attendance status", "حالة الحضور", "select", true, [
      "present",
      "absent",
      "late",
      "excused",
    ]),
    notes,
  ],
  leave_requests: [
    employee,
    field("type", "Leave type", "نوع الإجازة", "select", true, [
      "vacation",
      "sick",
      "unpaid",
      "other",
    ]),
    start,
    end,
    field("reason", "Reason", "السبب", "text", true),
  ],
  employee_reviews: [
    employee,
    date,
    field("type", "Record type", "نوع السجل", "select", true, [
      "performance",
      "disciplinary",
      "onboarding",
      "resignation",
      "termination",
    ]),
    field("rating", "Rating 0–5", "التقييم 0–5", "number", true),
    field(
      "notes",
      "Review / history note",
      "تفاصيل التقييم / السجل",
      "text",
      true,
    ),
  ],
  applications: [
    branch,
    name,
    email,
    phone,
    job,
    field("interview_at", "Interview time", "ميعاد المقابلة", "datetime-local"),
    notes,
  ],
  campaigns: [
    branch,
    name,
    field("channel", "Channel", "القناة", "select", true, sources),
    start,
    end,
    field("budget", "Budget", "الميزانية", "number", true),
    field("status", "Status", "الحالة", "select", true, [
      "draft",
      "active",
      "paused",
      "completed",
    ]),
    notes,
  ],
  leads: [
    branch,
    name,
    phone,
    email,
    field("source", "Lead source", "مصدر العميل", "select", true, sources),
    field(
      "assigned_to",
      "Assigned adviser",
      "المسؤول عن المتابعة",
      "select",
      false,
      undefined,
      "staff",
    ),
    field(
      "campaign_id",
      "Campaign",
      "الحملة",
      "select",
      false,
      undefined,
      "campaigns",
    ),
    field("follow_up_on", "Follow-up date", "ميعاد المتابعة", "date"),
    notes,
  ],
  visits: [
    branch,
    name,
    phone,
    field("purpose", "Visit purpose", "سبب الزيارة", "text", true),
    field("host", "Host / appointment with", "المضيف / المقابلة مع"),
    field(
      "scheduled_at",
      "Appointment time",
      "ميعاد الزيارة",
      "datetime-local",
      true,
    ),
    notes,
  ],
  announcements: [
    field(
      "branch_id",
      "Branch (blank = all)",
      "الفرع (فاضي = الكل)",
      "select",
      false,
      undefined,
      "branches",
    ),
    field(
      "template_id",
      "Template (optional)",
      "قالب (اختياري)",
      "select",
      false,
      undefined,
      "notification_templates",
    ),
    field(
      "title",
      "Title (or use template)",
      "العنوان (أو اختار قالب)",
      "text",
      false,
    ),
    field(
      "body",
      "Message (or use template)",
      "الرسالة (أو اختار قالب)",
      "text",
      false,
    ),
    field("channel", "Delivery channel", "قناة التوصيل", "select", true, [
      "in_app",
      "email",
      "sms",
      "whatsapp",
    ]),
  ],
};
const names: Record<string, [string, string]> = {
  employees: ["Employees", "الموظفين"],
  employee_shifts: ["Staff shifts", "ورديات الموظفين"],
  notification_templates: ["Message templates", "قوالب الرسايل"],
  staff_payroll: ["Employee payroll", "مرتبات الموظفين"],
  departments: ["Departments", "الأقسام"],
  contracts: ["Contracts", "العقود"],
  employee_attendance: ["Staff attendance", "حضور الموظفين"],
  leave_requests: ["Leave requests", "طلبات الإجازة"],
  employee_reviews: ["Reviews & history", "التقييمات والسجل"],
  applications: ["Recruitment", "التوظيف"],
  leads: ["Admissions pipeline", "متابعة العملاء"],
  campaigns: ["Campaigns", "الحملات"],
  coupons: ["Coupons", "كوبونات الخصم"],
  visits: ["Reception & appointments", "الاستقبال والمواعيد"],
  inbox: ["My inbox", "صندوقي"],
  announcements: ["Announcements", "الإعلانات"],
  summary: ["Acquisition analytics", "تحليل التسجيل"],
};
const resource = (s: string) =>
  s === "staff_payroll"
    ? "payroll"
    : ["campaigns", "coupons"].includes(s)
      ? "marketing"
      : ["leads", "visits", "summary"].includes(s)
        ? "crm"
        : ["inbox", "announcements", "notification_templates"].includes(s)
          ? "notifications"
          : "hr";
export default function Operations({
  t,
  api,
  allowed,
  toast,
  timezone,
  currency,
  go,
}: {
  t: T;
  api: Api;
  allowed: (r: string, a?: string) => boolean;
  toast: () => void;
  timezone: string;
  currency: string;
  go: (tab: string) => void;
}) {
  const ar = t.language === "English",
    L = (e: string, a: string) => (ar ? a : e);
  const [section, setSection] = useState(
      allowed("hr")
        ? "employees"
        : allowed("crm")
          ? "leads"
          : allowed("marketing")
            ? "campaigns"
            : "inbox",
    ),
    [data, setData] = useState<Row | null>(null),
    [options, setOptions] = useState<Record<string, Row[]>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [form, setForm] = useState<{ table: string; row?: Row } | null>(null),
    [detail, setDetail] = useState<Row | null>(null);
  const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
    dateTime = (n: number) =>
      new Intl.DateTimeFormat(ar ? "ar-EG-u-nu-latn" : "en-GB", {
        timeZone: timezone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(n * 1000);
  const money = (n: number) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) +
    " " +
    currency;
  const modalRef = useModalFocus(
    () => {
      setForm(null);
      setDetail(null);
      setError("");
    },
    !!(form || detail),
  );
  useEffect(() => {
    if (["hr", "crm", "marketing", "notifications"].some((r) => allowed(r)))
      api("/operations/options")
        .then((x) => setOptions((o) => ({ ...o, ...x })))
        .catch((e) => setError(e.message));
  }, [version]);
  useEffect(() => {
    if (allowed("payroll"))
      api("/staff-payroll/options")
        .then((x) =>
          setOptions((o) => ({
            ...o,
            employees: x.employees,
            loans: x.loans ?? [],
          })),
        )
        .catch((e) => setError(e.message));
  }, [version]);
  useEffect(() => {
    let active = true;
    setData(null);
    setDetail(null);
    setError("");
    const path =
      section === "staff_payroll"
        ? "/staff-payroll"
        : section === "inbox"
          ? `/notifications?page=${page}`
          : section === "announcements"
            ? "/announcements"
            : section === "summary"
              ? "/operations/summary"
              : `/operations/${section}?page=${page}&q=${encodeURIComponent(query)}`;
    api(path)
      .then((x) => {
        if (active) setData({ ...x, _section: section });
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [section, page, query, version]);
  async function command(path: string, method: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      const r = await api(path, method, body);
      setVersion((v) => v + 1);
      toast();
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const label = (s: string) =>
      names[s] ? L(...names[s]) : s.replaceAll("_", " "),
    employeeName = (id: string) =>
      options.employees?.find((x) => x.id === id)?.name ?? id,
    branchName = (id: string) =>
      options.branches?.find((x) => x.id === id)?.name ?? "";
  return (
    <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-widest text-teal-600">
            {L("PEOPLE, CONNECTED", "الناس هي الأساس")}
          </p>
          <h1 className="text-3xl font-semibold">
            {L("People & admissions", "الفريق والتسجيل")}
          </h1>
          <p className="mt-2 text-xs text-slate-400">
            {L(
              "From first conversation to a growing team.",
              "من أول تواصل لفريق بيكبر.",
            )}
          </p>
        </div>
        {fields[section] && allowed(resource(section), "create") && (
          <Button onClick={() => setForm({ table: section })}>
            <Plus size={17} />
            {L("New record", "سجل جديد")}
          </Button>
        )}
      </div>
      <nav className="mb-6 flex gap-2 overflow-x-auto pb-2">
        {Object.keys(names)
          .filter((s) => s === "inbox" || allowed(resource(s)))
          .map((s) => (
            <button
              key={s}
              aria-current={section === s ? "page" : undefined}
              onClick={() => {
                setSection(s);
                setPage(1);
                setQuery("");
              }}
              className={`shrink-0 rounded-xl px-4 py-3 text-xs font-semibold ${section === s ? "bg-blue-700 text-white" : "border border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900"}`}
            >
              {label(s)}
            </button>
          ))}
      </nav>
      {section === "visits" && (
        <Reception api={api} ar={ar} allowed={allowed} go={go} />
      )}
      {error && (
        <p
          role="alert"
          className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-600"
        >
          {error}
        </p>
      )}
      {!data || data._section !== section ? (
        <p className="py-12 text-center text-sm text-slate-400">
          {error ? "" : t.loading}
        </p>
      ) : section === "summary" ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {data.leads.map((s: Row) => (
              <Card key={s.stage} className="p-5">
                <p className="text-xs text-slate-400">{s.stage}</p>
                <p className="mt-3 text-2xl font-semibold">{s.count}</p>
              </Card>
            ))}
          </div>
          <Card className="p-5">
            <h2 className="mb-5 font-semibold">{label("campaigns")}</h2>
            {data.campaigns.map((c: Row) => (
              <div
                key={c.id}
                className="mb-4 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800"
              >
                <p className="font-semibold">{c.name}</p>
                <p className="mt-2 text-xs text-slate-400">
                  {L(
                    "Leads / conversions / budget",
                    "العملاء / التسجيلات / الميزانية",
                  )}
                  : {c.leads} / {c.conversions} / {money(c.budget)}
                </p>
                <p className="mt-2 text-xs">
                  {L("Conversion", "نسبة التسجيل")}:{" "}
                  {c.leads ? Math.round((c.conversions / c.leads) * 100) : 0}%
                </p>
              </div>
            ))}
          </Card>
        </>
      ) : (
        <>
          {section === "inbox" && (
            <Card className="mb-5 flex flex-wrap items-center justify-between gap-4 p-5">
              <p className="text-sm">
                {L(
                  "Receive in-app announcements",
                  "استقبال إعلانات داخل الموقع",
                )}
              </p>
              <button
                role="switch"
                aria-label="In-app notifications"
                aria-checked={!!data.preference?.in_app}
                onClick={() =>
                  command("/notifications/preferences", "PUT", {
                    in_app: !data.preference?.in_app,
                  })
                }
                className={`rounded-full px-4 py-2 text-xs ${data.preference?.in_app ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-600"}`}
              >
                {data.preference?.in_app ? L("On", "شغّال") : L("Off", "مقفول")}
              </button>
            </Card>
          )}
          {![
            "inbox",
            "announcements",
            "contracts",
            "employee_attendance",
            "leave_requests",
            "employee_reviews",
          ].includes(section) && (
            <form
              className="mb-5 flex gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                setPage(1);
                setQuery(String(new FormData(e.currentTarget).get("q") || ""));
              }}
            >
              <Input
                name="q"
                placeholder={L("Search by name", "دور بالاسم")}
                aria-label={L("Search by name", "دور بالاسم")}
              />
              <Button>{L("Search", "بحث")}</Button>
            </form>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {data.data?.map((r: Row) => (
              <Card key={r.id} className="min-w-0 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] text-slate-400">
                      {branchName(r.branch_id)} {r.code && "· " + r.code}
                    </p>
                    <h2 className="mt-1 break-words font-semibold">
                      {r.name ||
                        r.title ||
                        (r.employee_id && employeeName(r.employee_id)) ||
                        r.type ||
                        label(section)}
                    </h2>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-500 dark:bg-slate-800">
                    {r.cancellation_id
                      ? L("Cancelled", "ملغي")
                      : r.zero_closed_on
                        ? L("Closed / no payment", "مغلق / بدون صرف")
                        : r.stage || r.status || r.type || r.channel || ""}
                  </span>
                </div>
                {r.purpose && (
                  <p className="mt-3 text-sm">
                    {r.purpose}
                    {r.host && " · " + r.host}
                  </p>
                )}
                {r.job_title && (
                  <p className="mt-3 text-xs text-slate-400">{r.job_title}</p>
                )}
                {(r.phone || r.email) && (
                  <p
                    className="mt-3 break-all text-xs text-slate-400"
                    dir="ltr"
                  >
                    {r.phone} {r.email}
                  </p>
                )}
                {r.body && (
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-7">
                    {r.body}
                  </p>
                )}
                {(r.starts_on ||
                  r.date ||
                  r.follow_up_on ||
                  r.scheduled_at) && (
                  <p className="mt-3 text-xs text-slate-400">
                    {r.date ||
                      r.starts_on ||
                      r.follow_up_on ||
                      dateTime(r.scheduled_at)}
                    {r.ends_on && " → " + r.ends_on}
                  </p>
                )}
                {r.reason && <p className="mt-3 text-sm">{r.reason}</p>}
                {r.notes && (
                  <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-slate-400">
                    {r.notes}
                  </p>
                )}
                {section === "staff_payroll" && (
                  <>
                    <p className="mt-4 text-xl font-semibold" dir="ltr">
                      {money(r.total)}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">{r.month}</p>
                    {r.zero_closed_on && (
                      <p className="my-4 whitespace-pre-wrap break-words text-sm text-slate-500">
                        {L("Closed without payment", "اتقفل بدون صرف")} ·{" "}
                        {r.zero_closed_on}
                        <br />
                        {r.zero_closure_reason}
                      </p>
                    )}
                    <details className="mt-3 text-xs">
                      <summary>
                        {L("Calculation snapshot", "تفاصيل الحسبة")}
                      </summary>
                      <PayrollSnapshot
                        value={JSON.parse(r.calculation_json)}
                        ar={ar}
                        money={money}
                      />
                    </details>
                  </>
                )}
                {section === "employee_shifts" && (
                  <p className="mt-4 text-xs text-slate-400">
                    {dateTime(r.starts_at)} → {dateTime(r.ends_at)}
                  </p>
                )}
                {r.salary !== undefined && (
                  <p className="mt-4 text-lg font-semibold" dir="ltr">
                    {money(r.salary)}
                  </p>
                )}
                {r.minutes !== undefined && (
                  <p className="mt-3 text-xs">
                    {r.arrival} → {r.departure} · {r.minutes}{" "}
                    {L("minutes", "دقيقة")}
                  </p>
                )}
                {section === "announcements" && (
                  <p className="mt-4 text-xs text-slate-400">
                    {L("Stored / read / blocked", "اتخزنت / اتقرت / متوقفة")}:{" "}
                    {r.stored} / {r.read} / {r.blocked}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-3">
                  {section === "staff_payroll" && r.cancellation_id && (
                    <p className="w-full whitespace-pre-wrap break-words text-sm text-amber-700 dark:text-amber-300">
                      {L("Cancelled draft", "مسودة ملغاة")} ·{" "}
                      {r.cancellation_reason}
                      <br />
                      {L(
                        "Reserved loan deductions were released. Prepare a new payroll for this month if needed.",
                        "الخصومات المحجوزة من السلف اتحررت. جهّز مرتب جديد للشهر لو محتاج.",
                      )}
                    </p>
                  )}
                  {section === "staff_payroll" &&
                    r.status === "draft" &&
                    !r.cancellation_id &&
                    allowed("payroll", "create") && (
                      <Button
                        onClick={() =>
                          setForm({ table: "staff-cancel", row: r })
                        }
                      >
                        {L("Cancel draft", "إلغاء المسودة")}
                      </Button>
                    )}
                  {section === "staff_payroll" &&
                    r.status === "draft" &&
                    !r.cancellation_id &&
                    allowed("payroll", "approve") && (
                      <Button
                        onClick={() =>
                          setForm({ table: "staff-approve", row: r })
                        }
                      >
                        {L("Approve & accrue", "اعتماد واستحقاق")}
                      </Button>
                    )}
                  {section === "staff_payroll" &&
                    r.status === "approved" &&
                    !r.zero_closed_on &&
                    r.total === 0 &&
                    allowed("finance", "approve") && (
                      <ZeroPayrollClosure
                        api={api}
                        ar={ar}
                        id={r.id}
                        kind="staff-payroll"
                        onSaved={() => setVersion((v) => v + 1)}
                      />
                    )}
                  {section === "staff_payroll" &&
                    r.status === "approved" &&
                    !r.zero_closed_on &&
                    r.total > 0 &&
                    allowed("finance", "approve") && (
                      <Button
                        onClick={() => setForm({ table: "staff-pay", row: r })}
                      >
                        {L("Record payout", "تسجيل الصرف")}
                      </Button>
                    )}
                  {section === "employee_shifts" &&
                    r.status === "scheduled" &&
                    allowed("hr", "edit") &&
                    ["completed", "cancelled"].map((status) => (
                      <Button
                        key={status}
                        onClick={() =>
                          command(
                            `/operations/employee_shifts/${r.id}/status`,
                            "POST",
                            { status },
                          )
                        }
                      >
                        {status === "completed"
                          ? L("Complete", "تمت")
                          : L("Cancel shift", "إلغاء الوردية")}
                      </Button>
                    ))}
                  {section === "staff_payroll" && !r.cancellation_id && (
                    <button
                      className="text-xs text-blue-700 dark:text-blue-300"
                      onClick={(e) =>
                        printRecord(
                          L("Employee payslip", "بيان مرتب الموظف") +
                            " · " +
                            r.month,
                          e.currentTarget.closest("section")!,
                        )
                      }
                    >
                      {L("Print payslip", "طباعة بيان المرتب")}
                    </button>
                  )}
                  {section === "inbox" && !r.read_at && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        command(`/notifications/${r.id}/read`, "POST", {})
                      }
                    >
                      {L("Mark as read", "اتقرت")}
                    </Button>
                  )}
                  {["departments", "campaigns", "coupons", "visits"].includes(
                    section,
                  ) &&
                    allowed(resource(section), "edit") && (
                      <button
                        className="text-xs text-blue-700 dark:text-blue-300"
                        onClick={() => setForm({ table: section, row: r })}
                      >
                        {t.edit}
                      </button>
                    )}
                  {section === "employees" && (
                    <>
                      <button
                        className="text-xs text-blue-700 dark:text-blue-300"
                        onClick={() => setDetail(r)}
                      >
                        {L("Staff actions", "إجراءات الموظف")}
                      </button>
                      {allowed("hr", "edit") && (
                        <button
                          className="text-xs text-blue-700 dark:text-blue-300"
                          onClick={() =>
                            setForm({ table: "employees", row: r })
                          }
                        >
                          {t.edit}
                        </button>
                      )}
                    </>
                  )}
                  {section === "leave_requests" &&
                    r.status === "pending" &&
                    allowed("hr", "approve") &&
                    ["approved", "rejected"].map((decision) => (
                      <Button
                        key={decision}
                        disabled={busy}
                        onClick={() =>
                          command(
                            `/operations/leave_requests/${r.id}/decision`,
                            "POST",
                            { decision, note: "" },
                          )
                        }
                      >
                        {decision === "approved"
                          ? L("Approve", "اعتماد")
                          : L("Reject", "رفض")}
                      </Button>
                    ))}
                  {section === "leads" && (
                    <>
                      <button
                        className="text-xs text-blue-700 dark:text-blue-300"
                        onClick={async () => {
                          setDetail({
                            ...r,
                            interactions: (
                              await api(
                                `/operations/leads/${r.id}/interactions`,
                              )
                            ).data,
                          });
                        }}
                      >
                        {L("Open timeline", "فتح المتابعة")}
                      </button>
                      {!r.student_id && allowed("crm", "edit") && (
                        <>
                          <button
                            className="text-xs text-blue-700 dark:text-blue-300"
                            onClick={() =>
                              setForm({ table: "lead-stage", row: r })
                            }
                          >
                            {L("Move stage", "تغيير المرحلة")}
                          </button>
                          {allowed("students", "create") && (
                            <Button
                              onClick={() =>
                                setForm({ table: "convert", row: r })
                              }
                            >
                              {L("Register student", "تسجيل كطالب")}
                            </Button>
                          )}
                        </>
                      )}
                    </>
                  )}
                  {section === "applications" &&
                    r.stage !== "hired" &&
                    allowed("hr", "edit") && (
                      <>
                        <button
                          className="text-xs text-blue-700 dark:text-blue-300"
                          onClick={() =>
                            setForm({ table: "application-stage", row: r })
                          }
                        >
                          {L("Move stage", "تغيير المرحلة")}
                        </button>
                        {r.stage === "offer" && allowed("hr", "approve") && (
                          <Button
                            onClick={() => setForm({ table: "hire", row: r })}
                          >
                            {L("Hire candidate", "تعيين المتقدم")}
                          </Button>
                        )}
                      </>
                    )}
                  {section === "visits" &&
                    !r.checked_out &&
                    allowed("crm", "edit") && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          command(`/operations/visits/${r.id}/check`, "POST", {
                            action: r.checked_in ? "out" : "in",
                          })
                        }
                      >
                        {r.checked_in
                          ? L("Check out", "تسجيل انصراف")
                          : L("Check in", "تسجيل وصول")}
                      </Button>
                    )}
                </div>
              </Card>
            ))}
          </div>
          {!data.data?.length && (
            <Card className="p-12 text-center text-sm text-slate-400">
              {t.noResults}
            </Card>
          )}
          {!["inbox", "announcements"].includes(section) && (
            <div className="mt-5 flex items-center justify-between text-xs text-slate-400">
              <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                {t.previous}
              </button>
              <span>{page}</span>
              <button
                disabled={!data.has_more}
                onClick={() => setPage(page + 1)}
              >
                {t.next}
              </button>
            </div>
          )}
        </>
      )}
      {(form || detail) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm">
          <section
            ref={modalRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={form ? label(form.table) : detail?.name}
            className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
          >
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="font-semibold">
                {form ? label(form.table) : detail?.name}
              </h2>
              <button
                aria-label="Close"
                className="p-2"
                onClick={() => {
                  setForm(null);
                  setDetail(null);
                  setError("");
                }}
              >
                <X size={18} />
              </button>
            </header>
            <div className="p-5">
              {form ? (
                <form
                  className="grid gap-4 sm:grid-cols-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const d: Row = Object.fromEntries(
                        new FormData(e.currentTarget),
                      ),
                      table = form.table;
                    let path = "/operations/" + table,
                      method = "POST";
                    const defs =
                      fields[table] ??
                      (table === "convert"
                        ? [code, field("grade", "Grade", "الصف")]
                        : table === "hire"
                          ? [
                              code,
                              field(
                                "hired_on",
                                "Hire date",
                                "تاريخ التعيين",
                                "date",
                                true,
                              ),
                            ]
                          : [
                              field(
                                "stage",
                                "Stage",
                                "المرحلة",
                                "select",
                                true,
                                table === "lead-stage"
                                  ? [
                                      "new",
                                      "contacted",
                                      "interested",
                                      "trial_booked",
                                      "trial_attended",
                                      "negotiation",
                                      "lost",
                                    ]
                                  : [
                                      "applied",
                                      "screening",
                                      "interview",
                                      "offer",
                                      "rejected",
                                    ],
                              ),
                              ...(table === "lead-stage"
                                ? [
                                    field(
                                      "follow_up_on",
                                      "Follow-up date",
                                      "ميعاد المتابعة",
                                      "date",
                                    ),
                                  ]
                                : [
                                    field(
                                      "interview_at",
                                      "Interview time",
                                      "ميعاد المقابلة",
                                      "datetime-local",
                                    ),
                                  ]),
                            ]);
                    for (const f of defs) {
                      if (f.type === "number") d[f.key] = Number(d[f.key]);
                      if (f.type === "datetime-local")
                        d[f.key] = d[f.key]
                          ? Number(
                              Temporal.PlainDateTime.from(
                                d[f.key],
                              ).toZonedDateTime(timezone).epochMilliseconds,
                            ) / 1000
                          : null;
                    }
                    if (
                      [
                        "employees",
                        "departments",
                        "campaigns",
                        "coupons",
                        "visits",
                      ].includes(table) &&
                      form.row?.id
                    ) {
                      path += "/" + form.row.id;
                      method = "PUT";
                    }
                    if (table === "announcements") path = "/announcements";
                    if (table === "staff_payroll") {
                      path = "/staff-payroll";
                      d.loan_deductions = d.loan_id
                        ? [{ loan_id: d.loan_id, amount: d.loan_amount }]
                        : [];
                      delete d.loan_id;
                      delete d.loan_amount;
                    }
                    if (
                      table === "staff-approve" ||
                      table === "staff-pay" ||
                      table === "staff-cancel"
                    )
                      path = `/staff-payroll/${form.row?.id}/${table === "staff-approve" ? "approve" : table === "staff-cancel" ? "cancel" : "pay"}`;
                    if (table === "convert")
                      path = `/operations/leads/${form.row?.id}/convert`;
                    if (table === "hire")
                      path = `/operations/applications/${form.row?.id}/hire`;
                    if (table.endsWith("-stage")) {
                      path = `/operations/${table === "lead-stage" ? "leads" : "applications"}/${form.row?.id}/stage`;
                      method = "PUT";
                    }
                    const result = await command(path, method, d);
                    if (result) {
                      setForm(null);
                      setDetail(null);
                    }
                  }}
                >
                  {(
                    fields[form.table] ??
                    (form.table === "convert"
                      ? [code, field("grade", "Grade", "الصف")]
                      : form.table === "hire"
                        ? [
                            code,
                            field(
                              "hired_on",
                              "Hire date",
                              "تاريخ التعيين",
                              "date",
                              true,
                            ),
                          ]
                        : [
                            field(
                              "stage",
                              "Stage",
                              "المرحلة",
                              "select",
                              true,
                              form.table === "lead-stage"
                                ? [
                                    "new",
                                    "contacted",
                                    "interested",
                                    "trial_booked",
                                    "trial_attended",
                                    "negotiation",
                                    "lost",
                                  ]
                                : [
                                    "applied",
                                    "screening",
                                    "interview",
                                    "offer",
                                    "rejected",
                                  ],
                            ),
                            ...(form.table === "lead-stage"
                              ? [
                                  field(
                                    "follow_up_on",
                                    "Follow-up date",
                                    "ميعاد المتابعة",
                                    "date",
                                  ),
                                ]
                              : [
                                  field(
                                    "interview_at",
                                    "Interview time",
                                    "ميعاد المقابلة",
                                    "datetime-local",
                                  ),
                                ]),
                          ])
                  )
                    .filter(
                      (f) =>
                        !(
                          form.table === "employees" &&
                          form.row &&
                          [
                            "branch_id",
                            "code",
                            "hired_on",
                            "department_id",
                            "teacher_id",
                            "user_id",
                          ].includes(f.key)
                        ),
                    )
                    .map((f) => (
                      <Field key={f.key} label={L(f.en, f.ar)}>
                        {f.type === "select" ? (
                          <Select
                            name={f.key}
                            required={f.required}
                            defaultValue={form.row?.[f.key] ?? ""}
                          >
                            <option value="">—</option>
                            {f.source
                              ? options[f.source]
                                  ?.filter(
                                    (o) =>
                                      !form.row?.branch_id ||
                                      !o.branch_id ||
                                      o.branch_id === form.row.branch_id,
                                  )
                                  .map((o) => (
                                    <option key={o.id} value={o.id}>
                                      {o.name}
                                    </option>
                                  ))
                              : f.options?.map((o) => (
                                  <option key={o}>{o}</option>
                                ))}
                          </Select>
                        ) : (
                          <Input
                            name={f.key}
                            type={f.type}
                            required={f.required}
                            min={f.type === "number" ? 0 : undefined}
                            defaultValue={
                              (f.type === "datetime-local" &&
                              typeof form.row?.[f.key] === "number"
                                ? Temporal.Instant.fromEpochMilliseconds(
                                    form.row[f.key] * 1000,
                                  )
                                    .toZonedDateTimeISO(timezone)
                                    .toPlainDateTime()
                                    .toString()
                                    .slice(0, 16)
                                : form.row?.[f.key]) ??
                              (f.type === "date"
                                ? today
                                : f.type === "number"
                                  ? f.key === "hours_per_day"
                                    ? 8
                                    : 0
                                  : "")
                            }
                          />
                        )}
                      </Field>
                    ))}
                  {form.table === "announcements" && (
                    <p className="col-span-full text-xs leading-6 text-slate-400">
                      {L(
                        "Only in-app delivery is connected. Other channels log blocked delivery, never sent.",
                        "التوصيل داخل الموقع بس هو المتاح. باقي القنوات بتتسجل متوقفة، مش مبعوتة.",
                      )}
                    </p>
                  )}
                  {error && (
                    <p
                      role="alert"
                      className="col-span-full text-sm text-red-600"
                    >
                      {error}
                    </p>
                  )}
                  <Button
                    type="submit"
                    disabled={busy}
                    className="col-span-full"
                  >
                    {t.save}
                  </Button>
                </form>
              ) : detail && section === "employees" ? (
                <div className="space-y-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      "contracts",
                      "employee_attendance",
                      "leave_requests",
                      "employee_reviews",
                    ].map((table) => (
                      <Button
                        key={table}
                        onClick={() =>
                          setForm({
                            table,
                            row: {
                              employee_id: detail.id,
                              branch_id: detail.branch_id,
                            },
                          })
                        }
                      >
                        {label(table)}
                      </Button>
                    ))}
                  </div>
                  <ProfilePhoto
                    api={api}
                    ar={ar}
                    entity="employees"
                    id={detail.id}
                    editable={allowed("hr", "edit")}
                  />
                  <RecordCustomFields
                    api={api}
                    ar={ar}
                    entity="employees"
                    id={detail.id}
                    editable={allowed("hr", "edit")}
                  />
                </div>
              ) : detail && section === "leads" ? (
                <>
                  <form
                    className="mb-5 grid gap-3"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const d = Object.fromEntries(
                        new FormData(e.currentTarget),
                      );
                      const result = await command(
                        `/operations/leads/${detail.id}/interactions`,
                        "POST",
                        d,
                      );
                      if (result) setDetail(null);
                    }}
                  >
                    <Field label={L("Interaction type", "نوع التواصل")}>
                      <Select name="type">
                        {["call", "message", "visit", "note"].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={L("Conversation note", "ملخص التواصل")}>
                      <Input name="notes" required />
                    </Field>
                    <Button disabled={busy}>
                      {L("Save interaction", "حفظ التواصل")}
                    </Button>
                  </form>
                  {detail.interactions?.map((i: Row) => (
                    <div
                      key={i.id}
                      className="mb-3 rounded-xl bg-slate-50 p-4 text-xs dark:bg-slate-800"
                    >
                      <p>
                        {i.type} · {i.created_at}
                      </p>
                      <p className="mt-2 leading-6 text-slate-400">{i.notes}</p>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
