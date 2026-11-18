"use client";
import { useModalFocus } from "./modal-focus";
import { OrganizationProfile } from "./organization-profile";
import Operations from "./operations";
import { CustomFieldDefinitions } from "./custom-fields";
import { SystemControls } from "./system-controls";
import Resources from "./resources";
import { Portal, LearningSpace, PortalAdmin } from "./portals";
import Finance from "./finance";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  GraduationCap,
  LayoutDashboard,
  Building2,
  Users,
  ShieldCheck,
  History,
  Settings,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Menu,
  X,
  LogOut,
  Sun,
  Moon,
  Globe,
  ChevronRight,
  MapPin,
  Clock,
  Check,
  LockKeyhole,
  ChevronDown,
  Activity,
  Layers,
  CheckCircle2,
  Ellipsis,
  Mail,
  Filter,
  CalendarDays,
} from "lucide-react";
import { Schedule, Assessments } from "./learning";
import Academic, { academicNames, type Entity } from "./academic";
import { copy, type Lang, type T } from "./i18n";
import { Button, Input, Select, Field, Card, inputClass } from "./ui";
type Row = Record<string, string | number | null>;
type User = {
  name: string;
  email: string;
  role_name: string;
  system_key: string;
  user_id: string;
  membership_id: string;
  permissions: string[];
  csrf: string;
  branch_id: string | null;
  role_id: string;
};
type Me = { user: User; organization: Row };
type Tab =
  | Entity
  | "resources"
  | "learning"
  | "portals"
  | "operations"
  | "finance"
  | "schedule"
  | "assessments"
  | "dashboard"
  | "branches"
  | "users"
  | "roles"
  | "audit"
  | "organization";
const academicNav = [
  ...Object.keys(academicNames).map((key) => ({
    key: key as Entity,
    icon:
      key === "students" || key === "guardians"
        ? Users
        : key === "classrooms"
          ? Building2
          : GraduationCap,
    resource: key,
  })),
];
const nav = [
  { key: "dashboard", icon: LayoutDashboard, resource: "branches" },
  { key: "branches", icon: Building2, resource: "branches" },
  ...academicNav,
  { key: "schedule", icon: CalendarDays, resource: "sessions" },
  { key: "finance", icon: Building2, resource: "finance" },
  { key: "operations", icon: Users, resource: "hr" },
  { key: "learning", icon: GraduationCap, resource: "lms" },
  { key: "resources", icon: Layers, resource: "inventory" },
  { key: "portals", icon: Users, resource: "users" },
  { key: "assessments", icon: GraduationCap, resource: "exams" },
  { key: "users", icon: Users, resource: "users" },
  { key: "roles", icon: ShieldCheck, resource: "roles" },
  { key: "audit", icon: History, resource: "audit" },
  { key: "organization", icon: Settings, resource: "organization" },
] as const;
const images = [
  "/images/campus.jpg",
  "/images/students.jpg",
  "/images/study.jpg",
];
export default function Workspace() {
  const [lang, setLang] = useState<Lang>("en"),
    [dark, setDark] = useState(false),
    [me, setMe] = useState<Me | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [tab, setTab] = useState<Tab>("dashboard"),
    [mobile, setMobile] = useState(false),
    [notice, setNotice] = useState("");
  const t = copy[lang];
  useEffect(() => {
    const saved = localStorage.getItem("el_lang");
    setLang(
      saved === "ar" || saved === "en"
        ? saved
        : navigator.language.toLowerCase().startsWith("ar")
          ? "ar"
          : "en",
    );
    setDark(localStorage.getItem("el_theme") === "dark");
    void load();
  }, []);
  useEffect(() => {
    setNotice("");
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    localStorage.setItem("el_lang", lang);
  }, [lang]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.colorScheme = dark ? "dark" : "light";
    localStorage.setItem("el_theme", dark ? "dark" : "light");
  }, [dark]);
  async function load() {
    try {
      const r = await fetch("/api/me");
      if (r.ok) {
        setMe(await r.json());
        setError("");
      } else if (r.status !== 401)
        setError(
          ((await r.json()) as { error?: string }).error ??
            "Server unavailable",
        );
    } catch {
      setError("Could not connect to the server.");
    } finally {
      setReady(true);
    }
  }
  async function api(path: string, method = "GET", body?: unknown) {
    const r = await fetch(`/api${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": me?.user.csrf ?? "",
        "x-el-locale": lang,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const j: any = await r.json();
    if (!r.ok) {
      if (r.status === 401) setMe(null);
      throw new Error(j.error ?? t.error);
    }
    return j;
  }
  function toast() {
    setNotice(t.saved);
    setTimeout(() => setNotice(""), 3500);
  }
  const allowed = (resource: string, action = "view") =>
    !!me?.user.permissions.includes(`${resource}:${action}`);
  const chrome = (
    <div className="flex items-center gap-1">
      {me && (
        <SystemControls
          api={api}
          ar={lang === "ar"}
          admin={allowed("organization", "manage") && !me.user.branch_id}
          searchable={
            !["student", "parent_guardian", "teacher"].includes(
              me.user.system_key,
            )
          }
        />
      )}
      <button
        aria-label={dark ? t.light : t.dark}
        onClick={() => setDark(!dark)}
        className="rounded-xl p-3 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <button
        onClick={() => setLang(lang === "en" ? "ar" : "en")}
        className="flex items-center gap-2 rounded-xl p-3 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <Globe size={17} />
        {t.language}
      </button>
    </div>
  );
  if (!ready)
    return (
      <main className="flex min-h-screen items-center justify-center gap-3 dark:bg-slate-950 dark:text-white">
        <GraduationCap className="animate-pulse text-blue-600" />
        {t.loading}
      </main>
    );
  if (!me)
    return (
      <div className="min-h-screen dark:bg-slate-950 dark:text-slate-100">
        <header className="flex items-center justify-between px-5 py-4 md:px-10">
          <Brand t={t} />
          {chrome}
        </header>
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-8 lg:grid-cols-2 lg:items-center lg:gap-24 lg:px-10 lg:py-14">
          <section className="relative hidden min-h-[650px] overflow-hidden rounded-[2rem] bg-slate-950 text-white lg:block">
            <img
              src="/images/campus.jpg"
              alt="Graduates celebrating their learning journey"
              className="absolute inset-0 h-full w-full object-cover opacity-60"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-12">
              <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xs font-medium backdrop-blur">
                <span className="h-2 w-2 rounded-full bg-teal-300" />
                ELCenter
              </span>
              <h1 className="whitespace-pre-line text-5xl font-semibold leading-[1.25] tracking-tight">
                {t.authHero}
              </h1>
              <p className="mt-6 max-w-sm text-base leading-8 text-slate-200">
                {t.authText}
              </p>
              <div className="mt-10 flex items-center gap-3 text-sm text-slate-300">
                <ShieldCheck size={19} />
                {t.private}
              </div>
            </div>
          </section>
          <section className="mx-auto w-full max-w-md">
            <Auth t={t} api={api} onDone={load} error={error} />
          </section>
        </div>
      </div>
    );
  if (["student", "parent_guardian", "teacher"].includes(me.user.system_key))
    return (
      <Portal
        user={me.user}
        organization={me.organization}
        chrome={chrome}
        onLogout={() =>
          void api("/auth/logout", "POST", {}).then(() => setMe(null))
        }
        t={t}
        api={api}
        toast={toast}
        allowed={allowed}
        timezone={String(me.organization.timezone)}
        currency={String(me.organization.currency)}
      />
    );
  return (
    <div className="min-h-screen bg-[#f5f7fb] dark:bg-slate-950 dark:text-slate-100">
      {mobile && (
        <button
          aria-label={t.close}
          onClick={() => setMobile(false)}
          className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden"
        />
      )}
      <aside
        className={`${mobile ? "translate-x-0" : lang === "ar" ? "translate-x-full lg:translate-x-0" : "-translate-x-full lg:translate-x-0"} fixed inset-y-0 start-0 z-40 flex w-64 flex-col border-e border-slate-200 bg-white px-5 py-6 transition-transform dark:border-slate-800 dark:bg-slate-900`}
      >
        <div className="mb-10 flex items-center justify-between">
          <Brand t={t} />
          <button
            className="p-2 lg:hidden"
            aria-label={t.close}
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </button>
        </div>
        <p className="mb-3 px-3 text-[10px] font-bold tracking-[0.18em] text-slate-400">
          {t.workspace}
        </p>
        <nav className="min-h-0 space-y-1 overflow-y-auto">
          {nav
            .filter(
              (n) =>
                allowed(n.resource) ||
                (n.key === "finance" && allowed("payroll")) ||
                n.key === "operations" ||
                (n.key === "resources" &&
                  ["library", "support", "documents", "reports"].some((r) =>
                    allowed(r),
                  )),
            )
            .map(({ key, icon: Icon }) => (
              <button
                key={key}
                onClick={() => {
                  setTab(key);
                  setMobile(false);
                }}
                aria-current={tab === key ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start text-sm font-medium transition ${tab === key ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"}`}
              >
                <Icon size={19} />
                {key === "resources"
                  ? lang === "ar"
                    ? "الموارد والدعم"
                    : "Resources & service"
                  : key === "learning"
                    ? lang === "ar"
                      ? "مساحة التعلم"
                      : "Learning space"
                    : key === "portals"
                      ? lang === "ar"
                        ? "البوابات والطلبات"
                        : "Portals & requests"
                      : key in academicNames
                        ? academicNames[key as Entity][lang === "ar" ? 1 : 0]
                        : key === "operations"
                          ? lang === "ar"
                            ? "الفريق والتسجيل"
                            : "People & admissions"
                          : key === "finance"
                            ? lang === "ar"
                              ? "الحسابات والمرتبات"
                              : "Finance & payroll"
                            : key === "schedule"
                              ? lang === "ar"
                                ? "الجدول والحضور"
                                : "Timetable & attendance"
                              : key === "assessments"
                                ? lang === "ar"
                                  ? "الامتحانات والمستوى"
                                  : "Exams & performance"
                                : t[key as keyof T]}
                {tab === key && (
                  <span className="ms-auto h-1.5 w-1.5 rounded-full bg-blue-600" />
                )}
              </button>
            ))}
        </nav>
        <div className="mt-auto pt-8">
          <div className="mb-5 rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold">
              <LockKeyhole size={14} className="text-teal-600" />
              {t.private}
            </p>
            <p className="text-[11px] leading-5 text-slate-500">{t.realData}</p>
          </div>
          <div className="flex min-w-0 items-center gap-3 border-t border-slate-100 pt-5 dark:border-slate-800">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 font-semibold text-blue-700">
              {me.user.name.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{me.user.name}</p>
              <p className="truncate text-[11px] text-slate-400">
                {me.user.role_name}
              </p>
            </div>
            <button
              title={t.logout}
              aria-label={t.logout}
              className="p-2 text-slate-400 hover:text-red-600"
              onClick={async () => {
                try {
                  await api("/auth/logout", "POST", {});
                  setMe(null);
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="lg:ps-64">
        <header className="sticky top-0 z-20 flex min-h-[84px] items-center justify-between gap-2 border-b border-slate-200/70 bg-white/95 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 md:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="p-2 lg:hidden"
              aria-label={t.menu}
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <div className="hidden min-w-0 sm:block">
              <p className="max-w-[220px] truncate text-xs text-slate-400">
                {me.organization.display_name || me.organization.name}
              </p>
              <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
                <span className="hidden text-slate-400 sm:inline">
                  ELCenter
                </span>
                <ChevronRight
                  size={12}
                  className="hidden text-slate-300 sm:block"
                />
                {tab === "resources"
                  ? lang === "ar"
                    ? "الموارد والدعم"
                    : "Resources & service"
                  : tab === "learning"
                    ? lang === "ar"
                      ? "مساحة التعلم"
                      : "Learning space"
                    : tab === "portals"
                      ? lang === "ar"
                        ? "البوابات والطلبات"
                        : "Portals & requests"
                      : tab in academicNames
                        ? academicNames[tab as Entity][lang === "ar" ? 1 : 0]
                        : tab === "operations"
                          ? lang === "ar"
                            ? "الفريق والتسجيل"
                            : "People & admissions"
                          : tab === "finance"
                            ? lang === "ar"
                              ? "الحسابات والمرتبات"
                              : "Finance & payroll"
                            : tab === "schedule"
                              ? lang === "ar"
                                ? "الجدول والحضور"
                                : "Timetable & attendance"
                              : tab === "assessments"
                                ? lang === "ar"
                                  ? "الامتحانات والمستوى"
                                  : "Exams & performance"
                                : t[tab as keyof T]}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {chrome}
            <div className="hidden h-8 w-px bg-slate-100 sm:block dark:bg-slate-800" />
            <div className="hidden items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs sm:flex dark:border-slate-700">
              <Building2 size={15} className="text-blue-600" />
              {me.user.branch_id ? t.branch : t.allBranches}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-4 py-7 md:px-9 md:py-9">
          {error && (
            <div
              role="alert"
              className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700"
            >
              {error}
            </div>
          )}
          {tab === "resources" ? (
            <Resources
              t={t}
              api={api}
              toast={toast}
              allowed={allowed}
              timezone={String(me.organization.timezone)}
              currency={String(me.organization.currency)}
            />
          ) : tab === "learning" ? (
            <LearningSpace
              t={t}
              api={api}
              toast={toast}
              allowed={allowed}
              timezone={String(me.organization.timezone)}
              currency={String(me.organization.currency)}
            />
          ) : tab === "portals" ? (
            <PortalAdmin
              t={t}
              api={api}
              toast={toast}
              allowed={allowed}
              timezone={String(me.organization.timezone)}
              currency={String(me.organization.currency)}
            />
          ) : tab === "operations" ? (
            <Operations
              currency={String(me.organization.currency)}
              t={t}
              go={(key) => setTab(key as Tab)}
              api={api}
              allowed={allowed}
              toast={toast}
              timezone={String(me.organization.timezone)}
            />
          ) : tab === "finance" ? (
            <Finance
              headquarters={!me.user.branch_id}
              t={t}
              api={api}
              allowed={allowed}
              toast={toast}
              currency={String(me.organization.currency)}
              timezone={String(me.organization.timezone)}
            />
          ) : tab === "schedule" ? (
            <Schedule
              t={t}
              api={api}
              allowed={allowed}
              toast={toast}
              timezone={String(me.organization.timezone)}
            />
          ) : tab === "assessments" ? (
            <Assessments
              t={t}
              api={api}
              allowed={allowed}
              toast={toast}
              timezone={String(me.organization.timezone)}
            />
          ) : tab in academicNames ? (
            <Academic
              entity={tab as Entity}
              t={t}
              api={api}
              allowed={allowed}
              toast={toast}
            />
          ) : tab === "dashboard" ? (
            <Dashboard t={t} api={api} go={setTab} />
          ) : tab === "branches" ? (
            <Branches t={t} api={api} allowed={allowed} toast={toast} />
          ) : tab === "organization" ? (
            <Organization
              t={t}
              org={me.organization}
              api={api}
              reload={load}
              toast={toast}
              editable={allowed("organization", "edit")}
              manageFields={allowed("organization", "manage")}
            />
          ) : tab === "users" ? (
            <Team
              t={t}
              api={api}
              allowed={allowed}
              toast={toast}
              me={me.user}
            />
          ) : tab === "roles" ? (
            <Roles
              t={t}
              api={api}
              toast={toast}
              editable={allowed("roles", "edit")}
            />
          ) : (
            <Audit t={t} api={api} />
          )}
        </main>
        <footer className="px-5 py-6 text-center text-[11px] text-slate-400">
          {t.appVersion}
        </footer>
      </div>
      {notice && (
        <div
          role="status"
          className="fixed inset-x-5 bottom-5 z-50 mx-auto flex w-fit max-w-[90vw] items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm text-white shadow-lg"
        >
          <CheckCircle2 size={17} className="text-teal-300" />
          {notice}
        </div>
      )}
    </div>
  );
}
function Brand({ t }: { t: T }) {
  return (
    <a
      href="/"
      className="flex items-center gap-2.5"
      aria-label="ELCenter home"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-700 text-white shadow-lg shadow-blue-600/20">
        <GraduationCap size={24} />
      </div>
      <div>
        <p dir="ltr" className="text-xl font-bold leading-6 tracking-tight">
          EL<span className="text-blue-700 dark:text-blue-400">Center</span>
        </p>
        <p className="mt-0.5 text-[9px] text-slate-400">{t.brandLine}</p>
      </div>
    </a>
  );
}
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
function Auth({
  t,
  api,
  onDone,
  error,
}: {
  t: T;
  api: Api;
  onDone: () => Promise<void>;
  error: string;
}) {
  const [signup, setSignup] = useState(false),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const d = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(signup ? "/auth/register" : "/auth/login", "POST", d);
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function demo() {
    setBusy(true);
    setErr("");
    try {
      await api("/auth/demo", "POST", {});
      const session = (await (await fetch("/api/me")).json()) as any;
      if (session.user?.csrf)
        await fetch("/api/demo/academic-seed", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": session.user.csrf,
          },
          body: "{}",
        });
      if (session.user?.csrf)
        await fetch("/api/settings/demo/learning", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": session.user.csrf,
          },
          body: "{}",
        });
      if (session.user?.csrf)
        await fetch("/api/settings/demo/finance", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": session.user.csrf,
          },
          body: "{}",
        });
      if (session.user?.csrf)
        await fetch("/api/settings/demo/operations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": session.user.csrf,
          },
          body: "{}",
        });
      if (session.user?.csrf)
        await fetch("/api/settings/demo/portals", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": session.user.csrf,
          },
          body: "{}",
        });
      if (session.user?.csrf)
        await fetch("/api/settings/demo/resources", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": session.user.csrf,
          },
          body: "{}",
        });
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <span className="mb-5 inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 dark:bg-teal-950 dark:text-teal-300">
        <Layers size={13} />
        ELCenter
      </span>
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        {signup ? t.signupTitle : t.loginTitle}
      </h1>
      <p className="mb-8 mt-3 text-sm leading-7 text-slate-500">{t.authSub}</p>
      <div className="mb-7 flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {[false, true].map((s) => (
          <button
            key={String(s)}
            className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold ${s === signup ? "bg-white shadow-sm dark:bg-slate-700" : "text-slate-500"}`}
            onClick={() => setSignup(s)}
          >
            {s ? t.signup : t.login}
          </button>
        ))}
      </div>
      <form className="grid gap-5" onSubmit={submit}>
        {signup && (
          <>
            <Field label={t.fullName}>
              <Input name="name" autoComplete="name" required maxLength={160} />
            </Field>
            <Field label={t.orgName}>
              <Input name="organization" required maxLength={160} />
            </Field>
          </>
        )}
        <Field label={t.email}>
          <Input
            type="email"
            name="email"
            autoComplete="email"
            dir="ltr"
            placeholder="you@yourcenter.com"
            required
          />
        </Field>
        <Field label={signup ? t.password : t.newPassword}>
          <Input
            type="password"
            name="password"
            autoComplete={signup ? "new-password" : "current-password"}
            minLength={signup ? 12 : 1}
            maxLength={128}
            required
          />
        </Field>
        {!signup && (
          <Field
            label={
              t.language === "English"
                ? "كود المصادقة أو الاسترداد (لو مفعّل)"
                : "Authenticator or recovery code (if enabled)"
            }
          >
            <Input name="otp" autoComplete="one-time-code" maxLength={32} />
          </Field>
        )}
        {(err || error) && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {err || error}
          </p>
        )}
        <Button disabled={busy} type="submit" className="mt-1 w-full">
          {busy ? "…" : signup ? t.start : t.login}
          <ArrowRight size={16} />
        </Button>
      </form>
      <div className="my-7 border-t border-slate-200 dark:border-slate-800" />
      <Button
        disabled={busy}
        onClick={demo}
        className="w-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
      >
        <Layers size={16} />
        {t.demo}
      </Button>
      <p className="mx-auto mt-3 max-w-xs text-center text-xs leading-6 text-slate-400">
        {t.demoHelp}
      </p>
    </>
  );
}
function useLoad(api: Api, path: string) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    api(path)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [path, version]);
  return { data, error, reload: () => setVersion((v) => v + 1) };
}
function LoadState({ error, t }: { error: string; t: T }) {
  return error ? (
    <p role="alert" className="rounded-xl bg-red-50 p-5 text-sm text-red-700">
      {error}
    </p>
  ) : (
    <div className="grid gap-5 sm:grid-cols-3" aria-label={t.loading}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-36 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800"
        />
      ))}
    </div>
  );
}
function Heading({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {title}
        </h1>
        {sub && (
          <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500">
            {sub}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}
function Dashboard({ t, api, go }: { t: T; api: Api; go: (t: Tab) => void }) {
  const { data, error } = useLoad(api, "/dashboard");
  if (!data) return <LoadState t={t} error={error} />;
  const branches: Row[] = data.branches,
    active = branches.filter((b) => b.status === "active");
  return (
    <>
      <Heading title={t.overview} sub={t.ready}>
        <span className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs text-slate-500 dark:bg-slate-900">
          <span className="h-2 w-2 rounded-full bg-teal-500" />
          {t.private}
        </span>
      </Heading>
      <section className="relative mb-7 min-h-[230px] overflow-hidden rounded-2xl bg-slate-950 text-white">
        <img
          src="/images/students.jpg"
          alt="Students working together"
          className="absolute inset-y-0 end-0 h-full w-full object-cover opacity-25 md:w-3/5 md:opacity-60"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/70 to-slate-950/10 rtl:bg-gradient-to-l" />
        <div className="relative max-w-2xl p-7 md:p-9">
          <p className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-teal-300">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-300" />
            ELCenter
          </p>
          <h2 className="max-w-md text-2xl font-medium leading-[1.5] tracking-tight md:text-3xl">
            {t.welcome}
          </h2>
          <p className="mt-3 max-w-sm text-xs leading-6 text-slate-300">
            {t.subtitle}
          </p>
        </div>
      </section>
      <div className="mb-8 grid grid-cols-2 gap-3 xl:grid-cols-4 md:gap-5">
        {[
          {
            label: t.activeBranches,
            value: active.length,
            Icon: Building2,
            sub: t.network,
          },
          { label: t.team, value: data.members, Icon: Users, sub: t.members },
          {
            label: t.totalCapacity,
            value: active.reduce((n, b) => n + Number(b.capacity), 0),
            Icon: GraduationCap,
            sub: t.people,
          },
          {
            label: t.permissionsCount,
            value: data.roles,
            Icon: ShieldCheck,
            sub: t.system,
          },
        ].map(({ label, value, Icon, sub }) => (
          <Card key={label} className="p-4 md:p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="rounded-xl bg-blue-50 p-2.5 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                <Icon size={18} />
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
            </div>
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight" dir="ltr">
              {value.toLocaleString("en-US")}
            </p>
            <p className="mt-2 text-[10px] text-slate-400">{sub}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-5 md:p-6 dark:border-slate-800">
            <h2 className="text-base font-semibold">{t.branchNetwork}</h2>
            <button
              onClick={() => go("branches")}
              className="flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-400"
            >
              {t.viewAll}
              <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="divide-y divide-slate-100 px-5 dark:divide-slate-800">
            {branches.slice(0, 4).map((b, i) => (
              <div key={String(b.id)} className="flex items-center gap-4 py-5">
                <img
                  src={images[i % 3]}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-xl object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{b.name}</p>
                  <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-slate-400">
                    <MapPin size={11} />
                    {b.address || b.code}
                  </p>
                </div>
                <div className="text-end">
                  <p className="text-sm font-semibold">{b.capacity}</p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {t.capacity}
                  </p>
                </div>
                <span
                  className={`ms-2 hidden rounded-full px-2.5 py-1 text-[10px] sm:inline-block ${b.status === "active" ? "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300" : "bg-slate-100 text-slate-500"}`}
                >
                  {b.status === "active" ? t.active : t.inactive}
                </span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="border-b border-slate-100 p-5 md:p-6 dark:border-slate-800">
            <h2 className="text-base font-semibold">{t.recentActivity}</h2>
          </div>
          {data.activity.length ? (
            <div className="p-5">
              {data.activity.map((a: Row) => (
                <div key={String(a.id)} className="mb-5 flex gap-3">
                  <div className="mt-1 rounded-lg bg-blue-50 p-2 text-blue-600 dark:bg-blue-950">
                    <Activity size={14} />
                  </div>
                  <div>
                    <p className="text-xs font-medium">{a.actor}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {a.entity} · {a.action}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-400" dir="ltr">
                      {String(a.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[240px] flex-col items-center justify-center p-7 text-center">
              <span className="mb-4 rounded-full bg-slate-50 p-4 text-slate-300 dark:bg-slate-800">
                <History size={25} />
              </span>
              <p className="text-sm font-medium">{t.noActivity}</p>
              <p className="mt-2 max-w-[220px] text-xs leading-6 text-slate-400">
                {t.noActivitySub}
              </p>
            </div>
          )}
        </Card>
      </div>
      <div className="mt-6 flex gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-950 dark:bg-blue-950/30">
        <Layers size={18} className="mt-1 shrink-0 text-blue-600" />
        <div>
          <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">
            {t.foundation}
          </p>
          <p className="mt-1 text-xs leading-6 text-slate-500">
            {t.foundationHelp}
          </p>
        </div>
      </div>
    </>
  );
}
function Modal({
  title,
  close,
  children,
  t,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  t: T;
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
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={close}
            aria-label={t.close}
            className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={19} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </section>
    </div>
  );
}
function FormError({ message }: { message: string }) {
  return message ? (
    <p
      role="alert"
      className="col-span-full rounded-xl bg-red-50 p-4 text-sm text-red-700"
    >
      {message}
    </p>
  ) : null;
}
function Branches({
  t,
  api,
  allowed,
  toast,
}: {
  t: T;
  api: Api;
  allowed: (r: string, a?: string) => boolean;
  toast: () => void;
}) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [sort, setSort] = useState("name"),
    [editing, setEditing] = useState<Row | null>(null),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  const { data, error, reload } = useLoad(
    api,
    `/branches?q=${encodeURIComponent(q)}&page=${page}&sort=${sort}`,
  );
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setErr("");
    try {
      await api(
        `/branches${editing?.id ? `/${editing.id}` : ""}`,
        editing?.id ? "PUT" : "POST",
        { ...raw, capacity: Number(raw.capacity) },
      );
      setEditing(null);
      reload();
      toast();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title={t.branches} sub={t.subtitle}>
        {allowed("branches", "create") && (
          <Button
            onClick={() => {
              setEditing({});
              setErr("");
            }}
          >
            <Plus size={17} />
            {t.addBranch}
          </Button>
        )}
      </Heading>
      <Card className="mb-6 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search
              size={17}
              className="absolute start-3 top-3.5 text-slate-400"
            />
            <Input
              aria-label={t.search}
              placeholder={t.search}
              className="ps-10"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            aria-label={t.sort}
            className="w-auto"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="name">{t.name}</option>
            <option value="capacity">{t.capacity}</option>
          </Select>
        </div>
      </Card>
      {!data ? (
        <LoadState t={t} error={error} />
      ) : (
        <>
          <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {data.data.map((b: Row, i: number) => (
              <Card key={String(b.id)} className="overflow-hidden">
                <div className="relative h-36 overflow-hidden">
                  <img
                    src={images[i % 3]}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/50 to-transparent" />
                  <span
                    className="absolute bottom-4 start-4 rounded-md bg-white/95 px-2 py-1 text-[10px] font-bold text-slate-700"
                    dir="ltr"
                  >
                    {b.code}
                  </span>
                  <span
                    className={`absolute end-4 top-4 rounded-full px-3 py-1 text-[10px] font-semibold ${b.status === "active" ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-500"}`}
                  >
                    {b.status === "active" ? t.active : t.inactive}
                  </span>
                </div>
                <div className="p-5">
                  <h2 className="mb-2 text-lg font-semibold">{b.name}</h2>
                  <p className="flex min-h-10 items-start gap-2 text-xs leading-6 text-slate-500">
                    <MapPin size={14} className="mt-1 shrink-0" />
                    {b.address || "—"}
                  </p>
                  <div className="my-4 grid grid-cols-2 gap-3 border-y border-slate-100 py-4 dark:border-slate-800">
                    <div>
                      <p className="text-[10px] text-slate-400">{t.capacity}</p>
                      <p className="mt-1 text-sm font-semibold">
                        {b.capacity}{" "}
                        <span className="text-[10px] font-normal text-slate-400">
                          {t.people}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400">{t.hours}</p>
                      <p className="mt-1 text-xs" dir="ltr">
                        {b.opening_hours}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="max-w-[70%] truncate text-xs text-slate-500">
                      {b.manager || t.branch}
                    </p>
                    {allowed("branches", "edit") && (
                      <button
                        className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                        onClick={() => {
                          setEditing(b);
                          setErr("");
                        }}
                      >
                        {t.edit}
                        <span className="sr-only"> {b.name}</span>
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
          {!data.data.length && (
            <Card className="p-12 text-center text-sm text-slate-500">
              {t.noResults}
            </Card>
          )}
          <div className="mt-6 flex items-center justify-between gap-3 text-xs text-slate-500">
            <p>
              {t.page} {page} {t.of} {Math.max(1, Math.ceil(data.total / 12))}
            </p>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
                className="rounded-xl border border-slate-200 px-4 py-2 disabled:opacity-30"
              >
                {t.previous}
              </button>
              <button
                disabled={page * 12 >= data.total}
                onClick={() => setPage(page + 1)}
                className="rounded-xl border border-slate-200 px-4 py-2 disabled:opacity-30"
              >
                {t.next}
              </button>
            </div>
          </div>
        </>
      )}
      {editing && (
        <Modal
          title={editing.id ? t.edit : t.addBranch}
          close={() => setEditing(null)}
          t={t}
        >
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            {(
              [
                "name",
                "code",
                "address",
                "phone",
                "email",
                "manager",
                "opening_hours",
                "capacity",
              ] as const
            ).map((k) => (
              <Field key={k} label={t[k === "opening_hours" ? "hours" : k]}>
                <Input
                  name={k}
                  defaultValue={String(
                    editing[k] ??
                      (k === "capacity"
                        ? 100
                        : k === "opening_hours"
                          ? "09:00 - 21:00"
                          : ""),
                  )}
                  type={
                    k === "capacity"
                      ? "number"
                      : k === "email"
                        ? "email"
                        : "text"
                  }
                  min={k === "capacity" ? 1 : undefined}
                  max={k === "capacity" ? 100000 : undefined}
                  required={["name", "code", "capacity"].includes(k)}
                  maxLength={k === "address" ? 500 : 160}
                />
              </Field>
            ))}
            <Field label={t.status}>
              <Select
                name="status"
                defaultValue={String(editing.status ?? "active")}
              >
                <option value="active">{t.active}</option>
                <option value="inactive">{t.inactive}</option>
              </Select>
            </Field>
            <FormError message={err} />
            <div className="col-span-full mt-3 flex justify-end gap-3">
              <button
                type="button"
                className="px-4 text-sm text-slate-500"
                onClick={() => setEditing(null)}
              >
                {t.cancel}
              </button>
              <Button type="submit" disabled={busy}>
                {busy ? "…" : t.save}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function Organization({
  manageFields,
  t,
  org,
  api,
  reload,
  toast,
  editable,
}: {
  t: T;
  org: Row;
  api: Api;
  reload: () => Promise<void>;
  toast: () => void;
  editable: boolean;
  manageFields: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [err, setErr] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api(
        "/organization",
        "PUT",
        Object.fromEntries(new FormData(e.currentTarget)),
      );
      await reload();
      toast();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title={t.organization} sub={t.organizationHelp} />
      <OrganizationProfile
        onSaved={reload}
        api={api}
        ar={t.language === "English"}
        editable={editable}
      />
      <CustomFieldDefinitions
        api={api}
        ar={t.language === "English"}
        editable={manageFields}
      />
      {editable && (
        <Card className="mb-6 flex max-w-3xl items-center justify-between gap-5 p-6">
          <div>
            <h2 className="text-sm font-semibold">
              {t.language === "English" ? "الوضع التجريبي" : "Demo mode"}
            </h2>
            <p className="mt-2 max-w-lg text-xs leading-6 text-slate-500">
              {t.language === "English"
                ? "بيانات خيالية عشان تشوف السنتر وهو شغّال. الإيقاف بيحذف البيانات المعلّمة كتجريبية بس. لو بيانات حقيقية مرتبطة بيها، هنوقف الحذف لحد ما تفصل الروابط."
                : "Populate your center with flagged fictional records. Turning this off removes only demo records. If real records reference them, cleanup is blocked until those links are reassigned."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Demo mode"
            aria-checked={!!org.demo_enabled}
            disabled={busy}
            onClick={async () => {
              if (
                org.demo_enabled &&
                !window.confirm(
                  t.language === "English"
                    ? "نحذف البيانات التجريبية بس؟ البيانات الحقيقية مش هتتلمس."
                    : "Remove only flagged demo records? Real records will not be changed.",
                )
              )
                return;
              setBusy(true);
              setErr("");
              try {
                await api("/settings/demo", "PUT", {
                  enabled: !org.demo_enabled,
                });
                if (!org.demo_enabled) {
                  await api("/settings/demo/learning", "POST", {});
                  await api("/settings/demo/finance", "POST", {});
                  await api("/settings/demo/operations", "POST", {});
                  await api("/settings/demo/portals", "POST", {});
                  await api("/settings/demo/resources", "POST", {});
                }
                await reload();
                toast();
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className={`flex h-8 w-14 shrink-0 items-center rounded-full px-1 transition ${org.demo_enabled ? "justify-end bg-teal-500" : "justify-start bg-slate-200 dark:bg-slate-700"}`}
          >
            <span className="h-6 w-6 rounded-full bg-white shadow-sm" />
          </button>
        </Card>
      )}
      <Card className="max-w-3xl p-6 md:p-8">
        <form onSubmit={save} className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={t.orgName}>
              <Input
                name="name"
                defaultValue={String(org.name)}
                required
                disabled={!editable}
              />
            </Field>
          </div>
          <Field label={t.currency}>
            <Select
              name="currency"
              defaultValue={String(org.currency)}
              disabled={!editable}
            >
              {["EGP", "USD", "EUR", "SAR", "AED"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </Field>
          <Field label={t.timezone}>
            <Select
              name="timezone"
              defaultValue={String(org.timezone)}
              disabled={!editable}
            >
              {["Africa/Cairo", "UTC", "Asia/Riyadh", "Asia/Dubai"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </Field>
          <Field label={t.year}>
            <Input
              name="academic_year"
              defaultValue={String(org.academic_year)}
              pattern="[0-9]{4}/[0-9]{4}"
              placeholder="2026/2027"
              required
              disabled={!editable}
            />
          </Field>
          <FormError message={err} />
          {editable && (
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? "…" : t.save}
              </Button>
            </div>
          )}
        </form>
      </Card>
    </>
  );
}
function Team({
  t,
  api,
  allowed,
  toast,
  me,
}: {
  t: T;
  api: Api;
  allowed: (r: string, a?: string) => boolean;
  toast: () => void;
  me: User;
}) {
  const { data, error, reload } = useLoad(api, "/users"),
    roles = useLoad(api, "/roles"),
    branches = useLoad(api, "/branches"),
    [open, setOpen] = useState(false),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const d = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api("/users", "POST", { ...d, branch_id: d.branch_id || null });
      setOpen(false);
      reload();
      toast();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function status(u: Row) {
    if (u.status === "active" && !window.confirm(t.confirmSuspend)) return;
    try {
      await api(`/users/${u.id}/status`, "PATCH", {
        status: u.status === "active" ? "suspended" : "active",
      });
      reload();
      toast();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <>
      <Heading title={t.users} sub={t.memberHelp}>
        {allowed("users", "create") && (
          <Button
            onClick={() => {
              setOpen(true);
              setErr("");
            }}
          >
            <Plus size={17} />
            {t.addUser}
          </Button>
        )}
      </Heading>
      {!open && <FormError message={err} />}
      <Card className="overflow-hidden">
        {!data ? (
          <div className="p-5">
            <LoadState error={error} t={t} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[660px] text-start text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-800">
                <tr>
                  {[t.name, t.role, t.scope, t.status, t.actions].map((h) => (
                    <th key={h} className="px-5 py-4 text-start font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.data.map((u: Row) => (
                  <tr key={String(u.id)}>
                    <td className="px-5 py-5">
                      <p className="font-semibold">{u.name}</p>
                      <p className="mt-1 text-xs text-slate-400">{u.email}</p>
                    </td>
                    <td className="px-5 py-5 text-xs">{u.role_name}</td>
                    <td className="px-5 py-5 text-xs text-slate-500">
                      {u.branch_name || t.allScope}
                    </td>
                    <td className="px-5 py-5">
                      <span
                        className={`rounded-full px-3 py-1 text-[10px] ${u.status === "active" ? "bg-teal-50 text-teal-700" : "bg-red-50 text-red-600"}`}
                      >
                        {u.status === "active" ? t.active : t.suspended}
                      </span>
                    </td>
                    <td className="px-5 py-5">
                      {u.id !== me.membership_id &&
                        !["Business Owner", "Super Admin"].includes(
                          String(u.role_name),
                        ) &&
                        allowed("users", "edit") && (
                          <button
                            className="text-xs text-blue-700 dark:text-blue-300"
                            onClick={() => status(u)}
                          >
                            {u.status === "active" ? t.suspend : t.reactivate}
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && (
        <Modal t={t} title={t.addUser} close={() => setOpen(false)}>
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <Field label={t.name}>
              <Input name="name" required maxLength={160} />
            </Field>
            <Field label={t.email}>
              <Input name="email" type="email" required />
            </Field>
            <Field label={t.password}>
              <Input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </Field>
            <Field label={t.role}>
              <Select name="role_id" required>
                <option value="">—</option>
                {roles.data?.data.map((r: Row) => (
                  <option key={String(r.id)} value={String(r.id)}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.scope}>
              <Select name="branch_id">
                <option value="">{t.allScope}</option>
                {branches.data?.data.map((b: Row) => (
                  <option key={String(b.id)} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <FormError message={err} />
            <div className="col-span-full mt-3 flex justify-end">
              <Button disabled={busy} type="submit">
                {busy ? "…" : t.create}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function Roles({
  t,
  api,
  toast,
  editable,
}: {
  t: T;
  api: Api;
  toast: () => void;
  editable: boolean;
}) {
  const { data, error, reload } = useLoad(api, "/roles"),
    [edit, setEdit] = useState<Row | null>(null),
    [perms, setPerms] = useState<string[]>([]),
    [resource, setResource] = useState("branches"),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  const actionLabel: Record<string, string> = {
    view: t.view,
    create: t.createAction,
    edit: t.editAction,
    delete: t.delete,
    approve: t.approve,
    export: t.export,
    print: t.print,
    manage: t.manage,
    financial: t.financial,
  };
  function open(r: Row) {
    setEdit(r);
    setErr("");
    setPerms(
      data.permissions
        .filter((p: Row) => p.role_id === r.id)
        .map((p: Row) => `${p.resource}:${p.action}`),
    );
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api(
        `/roles${edit?.id ? `/${edit.id}` : ""}`,
        edit?.id ? "PUT" : "POST",
        { name: new FormData(e.currentTarget).get("name"), permissions: perms },
      );
      setEdit(null);
      reload();
      toast();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title={t.roles} sub={t.permissionHelp}>
        {editable && (
          <Button
            onClick={() => {
              setEdit({});
              setPerms([]);
              setErr("");
            }}
          >
            <Plus size={17} />
            {t.addRole}
          </Button>
        )}
      </Heading>
      {!data ? (
        <LoadState error={error} t={t} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.data.map((r: Row) => {
            const protectedRole = ["business_owner", "super_admin"].includes(
              String(r.system_key),
            );
            const count = data.permissions.filter(
              (p: Row) => p.role_id === r.id,
            ).length;
            return (
              <Card key={String(r.id)} className="p-5">
                <div className="mb-5 flex items-center justify-between">
                  <span className="rounded-xl bg-blue-50 p-3 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    <ShieldCheck size={20} />
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {r.system_key ? t.system : t.custom}
                  </span>
                </div>
                <h2 className="font-semibold">{r.name}</h2>
                <p className="mb-5 mt-2 text-xs text-slate-400">
                  {count} {t.permissions}
                </p>
                {protectedRole ? (
                  <span className="flex items-center gap-1 text-xs text-slate-400">
                    <LockKeyhole size={12} />
                    {t.protected}
                  </span>
                ) : editable ? (
                  <button
                    onClick={() => open(r)}
                    className="text-xs font-semibold text-blue-700 dark:text-blue-300"
                  >
                    {t.edit}
                  </button>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
      {edit && (
        <Modal
          title={edit.id ? t.edit : t.addRole}
          close={() => setEdit(null)}
          t={t}
        >
          <form onSubmit={save} className="grid gap-5">
            <Field label={t.name}>
              <Input
                name="name"
                defaultValue={String(edit.name ?? "")}
                required
              />
            </Field>
            <Field label={t.permission}>
              <Select
                value={resource}
                onChange={(e) => setResource(e.target.value)}
              >
                {data.resources.map((r: string) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {data.actions.map((a: string) => {
                const p = `${resource}:${a}`;
                return (
                  <label
                    key={a}
                    className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={perms.includes(p)}
                      onChange={(e) =>
                        setPerms((v) =>
                          e.target.checked
                            ? [...v, p]
                            : v.filter((x) => x !== p),
                        )
                      }
                      className="h-4 w-4 accent-blue-700"
                    />
                    {actionLabel[a]}
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-slate-400">
              {perms.length} {t.permissions}
            </p>
            <FormError message={err} />
            <Button disabled={busy} type="submit">
              {busy ? "…" : t.save}
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
function Audit({ t, api }: { t: T; api: Api }) {
  const { data, error } = useLoad(api, "/audit");
  return (
    <>
      <Heading title={t.audit} />
      <Card className="overflow-hidden">
        {!data ? (
          <div className="p-6">
            <LoadState error={error} t={t} />
          </div>
        ) : !data.data.length ? (
          <div className="p-12 text-center text-sm text-slate-400">
            {t.noActivity}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-start text-sm">
              <thead className="bg-slate-50 text-xs text-slate-400 dark:bg-slate-800">
                <tr>
                  {[t.actor, t.activity, t.entity, t.time].map((x) => (
                    <th key={x} className="p-4 text-start font-medium">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.data.map((a: Row) => (
                  <tr key={String(a.id)}>
                    <td className="p-4 text-xs font-semibold">{a.actor}</td>
                    <td className="p-4 text-xs">{a.action}</td>
                    <td className="p-4 text-xs">{a.entity}</td>
                    <td className="p-4 text-xs text-slate-400" dir="ltr">
                      {a.created_at}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
