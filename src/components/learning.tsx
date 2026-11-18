"use client";
import { ExamResultSheet } from "./exam-result-sheet";
import { useModalFocus } from "./modal-focus";
import {
  AttendanceCorrectionForm,
  AttendanceCorrectionQueue,
} from "./attendance-corrections";
import AttendanceScanner from "./attendance-scanner";
import { useEffect, useRef, useState, type FormEvent } from "react";
import "temporal-polyfill/global";
import FullCalendar, { type CalendarRef } from "@fullcalendar/react";
import dayGrid from "@fullcalendar/react/daygrid";
import timeGrid from "@fullcalendar/react/timegrid";
import interaction from "@fullcalendar/react/interaction";
import classicTheme from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import arLocale from "@fullcalendar/react/locales/ar";
import { Temporal } from "@js-temporal/polyfill";
import {
  Plus,
  X,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileQuestion,
  Filter,
  Trash2,
  Settings2,
  ArrowRight,
  Printer,
} from "lucide-react";
import { Button, Input, Select, Field, Card, inputClass } from "./ui";
import type { T } from "./i18n";
type Row = Record<string, any>;
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
function wallToEpoch(value: string, tz: string) {
  const p = Temporal.PlainDateTime.from(value);
  return (
    Number(
      p.toZonedDateTime(tz, { disambiguation: "reject" }).epochMilliseconds,
    ) / 1000
  );
}
function epochToWall(value: number, tz: string) {
  return Temporal.Instant.fromEpochMilliseconds(value * 1000)
    .toZonedDateTimeISO(tz)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}
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
        onClick={(e) => e.stopPropagation()}
        className="max-h-[93dvh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
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
export function Schedule({
  t,
  api,
  allowed,
  toast,
  timezone,
}: {
  t: T;
  api: Api;
  allowed: (r: string, a?: string) => boolean;
  toast: () => void;
  timezone: string;
}) {
  const ar = t.language === "English",
    L = (a: string, b: string) => (ar ? b : a);
  const [data, setData] = useState<Row[]>([]),
    [options, setOptions] = useState<Record<string, Row[]>>({}),
    [range, setRange] = useState({
      from: Math.floor(Date.now() / 1000) - 31 * 86400,
      to: Math.floor(Date.now() / 1000) + 62 * 86400,
    }),
    [editing, setEditing] = useState<Row | null>(null),
    [roster, setRoster] = useState<Row | null>(null),
    [correction, setCorrection] = useState<Row | null>(null),
    [rules, setRules] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0),
    [group, setGroup] = useState(""),
    [filters, setFilters] = useState(false),
    [view, setView] = useState("dayGridMonth");
  const calendar = useRef<CalendarRef>(null);
  const reload = () => setVersion((v) => v + 1);
  useEffect(() => {
    api("/academic/options")
      .then(setOptions)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    api(`/sessions?from=${range.from}&to=${range.to}&group=${group}`)
      .then((d) => setData(d.data))
      .catch((e) => setError(e.message));
  }, [range, group, version]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const raw = Object.fromEntries(new FormData(e.currentTarget)),
        g = options.groups?.find((g) => g.id === raw.group_id);
      const body = {
        ...raw,
        teacher_id: raw.teacher_id || g?.teacher_id,
        classroom_id: raw.classroom_id || g?.classroom_id,
        starts_at: wallToEpoch(String(raw.starts_at), timezone),
        ends_at: wallToEpoch(String(raw.ends_at), timezone),
        repeat_weeks: Number(raw.repeat_weeks ?? 1),
      };
      await api(
        `/sessions${editing?.id ? `/${editing.id}` : ""}`,
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
  async function attendance(s: Row) {
    setBusy(true);
    setError("");
    try {
      const r = await api(`/sessions/${s.id}/attendance`);
      setRoster(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveAttendance() {
    if (!roster) return;
    setBusy(true);
    setError("");
    try {
      const selected = roster.data.filter(
        (r: Row) => r.status && !r.attendance_id,
      );
      if (selected.length > 500)
        throw new Error(
          "Select 500 students or fewer per atomic attendance request",
        );
      await api(`/sessions/${roster.session.id}/attendance`, "POST", {
        rows: selected.map((r: Row) => ({
          student_id: r.student_id,
          status: r.status,
          arrival: r.arrival ?? null,
          departure: r.departure ?? null,
          notes: r.notes ?? "",
        })),
      });
      toast();
      setRoster(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {allowed("attendance") && (
        <AttendanceCorrectionQueue
          api={api}
          ar={ar}
          approve={allowed("attendance", "approve")}
          version={version}
        />
      )}
      {correction && (
        <AttendanceCorrectionForm
          api={api}
          ar={ar}
          row={correction}
          close={() => setCorrection(null)}
          done={reload}
        />
      )}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-[0.15em] text-teal-600">
            {L("LEARNING IN MOTION", "التعلّم شغّال")}
          </p>
          <h1 className="text-3xl font-semibold">
            {L("Timetable & attendance", "الجدول والحضور")}
          </h1>
          <p className="mt-2 text-xs text-slate-400">
            {timezone} ·{" "}
            {L(
              "Conflicts checked by the server and database.",
              "التعارضات بتتراجع على السيرفر وقاعدة البيانات.",
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {allowed("sessions", "manage") && (
            <button
              aria-label={L("Scheduling rules", "قواعد المواعيد")}
              onClick={async () => setRules(await api("/scheduling/rules"))}
              className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
            >
              <Settings2 size={17} />
            </button>
          )}
          {allowed("sessions", "create") && (
            <Button
              onClick={() => {
                setEditing({});
                setError("");
              }}
            >
              <Plus size={17} />
              {L("Schedule session", "إضافة حصة")}
            </Button>
          )}
        </div>
      </div>
      {error && !editing && !roster && !rules && (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <Card className="p-3 md:p-6">
        <div className="mb-5 flex flex-wrap justify-between gap-3">
          <Select
            aria-label={L("Calendar view", "طريقة عرض الجدول")}
            className="max-w-48"
            value={view}
            onChange={(e) => {
              setView(e.target.value);
              calendar.current?.getApi().changeView(e.target.value);
            }}
          >
            <option value="dayGridMonth">{L("Month", "شهري")}</option>
            <option value="timeGridWeek">{L("Week", "أسبوعي")}</option>
            <option value="timeGridDay">{L("Day", "يومي")}</option>
          </Select>
          <button
            className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"
            aria-label={L("Filters", "الفلاتر")}
            aria-expanded={filters}
            onClick={() => setFilters(!filters)}
          >
            <Filter size={17} />
          </button>
          {filters && (
            <div className="w-full">
              <Select
                aria-label={L("Group filter", "فلتر المجموعة")}
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              >
                <option value="">{L("All groups", "كل المجموعات")}</option>
                {options.groups?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        <div className="[&_.fc-toolbar-title]:text-base! [&_.fc-button]:border-0! [&_.fc-button]:bg-blue-700! [&_.fc-button]:text-xs! [&_.fc-col-header-cell]:py-3 [&_.fc-col-header-cell]:text-xs [&_.fc-col-header-cell]:font-normal [&_.fc-col-header-cell]:text-slate-500 [&_.fc-daygrid-day-number]:text-xs [&_.fc-scrollgrid]:rounded-xl [&_.fc-day-today]:bg-blue-50/50! dark:[&_.fc-day-today]:bg-blue-950/30!">
          <FullCalendar
            ref={calendar}
            plugins={[dayGrid, timeGrid, interaction, classicTheme]}
            initialView="dayGridMonth"
            timeZone={timezone}
            locale={ar ? arLocale : undefined}
            direction={ar ? "rtl" : "ltr"}
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "",
            }}
            height="auto"
            datesSet={(d) =>
              setRange({
                from: Math.floor(d.start.getTime() / 1000),
                to: Math.floor(d.end.getTime() / 1000),
              })
            }
            events={data.map((s) => ({
              id: s.id,
              title: `${s.group_name} · ${s.topic}`,
              start: new Date(s.starts_at * 1000).toISOString(),
              end: new Date(s.ends_at * 1000).toISOString(),
              backgroundColor:
                s.status === "cancelled"
                  ? "#94a3b8"
                  : s.status === "completed"
                    ? "#0d9488"
                    : "#1d4ed8",
              borderColor: "transparent",
            }))}
            eventContent={(info) => (
              <span className="block max-w-full truncate text-[10px]">
                <span
                  className={view === "dayGridMonth" ? "hidden sm:inline" : ""}
                >
                  {info.timeText} {info.event.title}
                </span>
                {view === "dayGridMonth" && (
                  <span className="sm:hidden" aria-label={info.event.title}>
                    ●
                  </span>
                )}
              </span>
            )}
            editable={allowed("sessions", "edit")}
            eventClick={(e) => {
              const row = data.find((s) => s.id === e.event.id);
              if (row) {
                setEditing(row);
                setError("");
              }
            }}
            eventDrop={async (e) => {
              const row = data.find((s) => s.id === e.event.id);
              if (!row) return;
              try {
                await api(`/sessions/${row.id}`, "PUT", {
                  ...row,
                  starts_at: Math.floor(e.event.start!.getTime() / 1000),
                  ends_at: Math.floor(e.event.end!.getTime() / 1000),
                  repeat_weeks: 1,
                });
                reload();
                toast();
              } catch (err) {
                e.revert();
                setError((err as Error).message);
              }
            }}
            eventResize={async (e) => {
              const row = data.find((s) => s.id === e.event.id);
              if (!row) return;
              try {
                await api(`/sessions/${row.id}`, "PUT", {
                  ...row,
                  starts_at: Math.floor(e.event.start!.getTime() / 1000),
                  ends_at: Math.floor(e.event.end!.getTime() / 1000),
                  repeat_weeks: 1,
                });
                reload();
                toast();
              } catch (err) {
                e.revert();
                setError((err as Error).message);
              }
            }}
          />
        </div>
      </Card>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {data.map((s) => (
          <Card
            key={s.id}
            className="flex items-center justify-between gap-3 p-4"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {s.group_name}
                {s.is_demo === 1 && (
                  <span className="ms-2 text-[9px] text-amber-600">Demo</span>
                )}
              </p>
              <p className="mt-2 text-[11px] text-slate-400">
                {new Intl.DateTimeFormat(ar ? "ar-EG-u-nu-latn" : "en-GB", {
                  timeZone: timezone,
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(s.starts_at * 1000)}
              </p>
              <p className="mt-1 text-[10px] text-slate-400">
                {s.teacher_name} · {s.room_name} · {s.status}
              </p>
            </div>
            {allowed("attendance") && (
              <button
                onClick={() => attendance(s)}
                className="rounded-xl bg-teal-50 p-3 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                aria-label={`${L("Attendance", "الحضور")} ${s.group_name}`}
              >
                <ClipboardCheck size={18} />
              </button>
            )}
          </Card>
        ))}
      </div>
      {editing && (
        <Dialog
          title={
            editing.id
              ? L("Edit session", "تعديل الحصة")
              : L("Schedule session", "إضافة حصة")
          }
          close={() => setEditing(null)}
        >
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <Field label={L("Group", "المجموعة")}>
              <Select
                name="group_id"
                required
                defaultValue={editing.group_id ?? ""}
              >
                <option value="">—</option>
                {options.groups?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={L("Replacement teacher (optional)", "مدرّس بديل (اختياري)")}
            >
              <Select name="teacher_id" defaultValue={editing.teacher_id ?? ""}>
                <option value="">{L("Group teacher", "مدرّس المجموعة")}</option>
                {options.teachers?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={L("Classroom (optional)", "القاعة (اختياري)")}>
              <Select
                name="classroom_id"
                defaultValue={editing.classroom_id ?? ""}
              >
                <option value="">
                  {L("Group classroom", "قاعة المجموعة")}
                </option>
                {options.classrooms?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={L("Topic", "الموضوع")}>
              <Input name="topic" defaultValue={editing.topic ?? ""} />
            </Field>
            <Field label={`${L("Start", "البداية")} · ${timezone}`}>
              <Input
                name="starts_at"
                type="datetime-local"
                required
                defaultValue={
                  editing.starts_at
                    ? epochToWall(editing.starts_at, timezone)
                    : ""
                }
              />
            </Field>
            <Field label={`${L("End", "النهاية")} · ${timezone}`}>
              <Input
                name="ends_at"
                type="datetime-local"
                required
                defaultValue={
                  editing.ends_at ? epochToWall(editing.ends_at, timezone) : ""
                }
              />
            </Field>
            {!editing.id && (
              <Field
                label={L(
                  "Repeat weekly (1–10 sessions)",
                  "تكرار أسبوعي (من 1 لـ10 حصص)",
                )}
              >
                <Input
                  name="repeat_weeks"
                  type="number"
                  min={1}
                  max={10}
                  defaultValue={1}
                />
              </Field>
            )}
            <Field label={t.status}>
              <Select
                name="status"
                defaultValue={editing.status ?? "scheduled"}
              >
                {["scheduled", "completed", "cancelled"].map((s) => (
                  <option key={s} value={s}>
                    {ar
                      ? (
                          {
                            scheduled: "في المعاد",
                            completed: "مكتملة",
                            cancelled: "ملغية",
                          } as Row
                        )[s]
                      : s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={L("Notes", "ملاحظات")}>
              <textarea
                name="notes"
                className={inputClass}
                defaultValue={editing.notes ?? ""}
              />
            </Field>
            {error && (
              <p role="alert" className="col-span-full text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="col-span-full flex justify-end gap-3">
              {editing.id && allowed("attendance") && (
                <Button
                  type="button"
                  className="bg-teal-600"
                  onClick={() => {
                    const row = editing;
                    setEditing(null);
                    void attendance(row);
                  }}
                >
                  <ClipboardCheck size={16} />
                  {L("Attendance", "الحضور")}
                </Button>
              )}
              {allowed("sessions", editing.id ? "edit" : "create") && (
                <Button type="submit" disabled={busy}>
                  {busy ? "…" : t.save}
                </Button>
              )}
            </div>
          </form>
        </Dialog>
      )}
      {roster && (
        <Dialog
          title={L("Session attendance", "حضور الحصة")}
          close={() => setRoster(null)}
        >
          {allowed("attendance", "edit") && (
            <AttendanceScanner
              ar={ar}
              onScan={(value) => {
                const id = value.startsWith("ELC:") ? value.slice(4) : value;
                const row = roster.data.find(
                  (r: Row) => r.student_id === id || r.code === id,
                );
                if (!row || row.attendance_id) return false;
                setRoster({
                  ...roster,
                  data: roster.data.map((r: Row) =>
                    r.student_id === row.student_id
                      ? { ...r, status: "present" }
                      : r,
                  ),
                });
                return true;
              }}
            />
          )}
          <p className="mb-4 rounded-xl bg-blue-50 p-3 text-xs leading-6 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            {L(
              "Initial attendance creates in-app guardian alerts, not external messages. Recorded rows are locked; request a correction for independent review. Up to 500 new records save atomically.",
              "الحضور الأول بيعمل تنبيه جوّه الموقع، مش رسالة خارجية. السجلات المتسجلة مقفولة؛ اطلب تصحيح لمراجعة مستقلة. لحد 500 سجل جديد بيتحفظوا مع بعض.",
            )}
          </p>
          <div className="grid gap-3">
            {roster.data.map((r: Row, i: number) => (
              <div
                key={r.student_id}
                className="grid items-center gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-2 dark:border-slate-700"
              >
                <div>
                  <p className="text-sm font-semibold">{r.name}</p>
                  <p className="text-[10px] text-slate-400">{r.code}</p>
                </div>
                <Select
                  aria-label={`${L("Status", "الحالة")} ${r.name}`}
                  disabled={!!r.attendance_id || !allowed("attendance", "edit")}
                  value={r.status ?? ""}
                  onChange={(e) =>
                    setRoster({
                      ...roster,
                      data: roster.data.map((s: Row, n: number) =>
                        n === i ? { ...s, status: e.target.value } : s,
                      ),
                    })
                  }
                >
                  <option value="">—</option>
                  {["present", "absent", "late", "excused", "left_early"].map(
                    (s) => (
                      <option key={s} value={s}>
                        {ar
                          ? (
                              {
                                present: "حاضر",
                                absent: "غايب",
                                late: "متأخر",
                                excused: "بعذر",
                                left_early: "مشي بدري",
                              } as Row
                            )[s]
                          : s}
                      </option>
                    ),
                  )}
                </Select>
                {r.attendance_id && allowed("attendance", "edit") && (
                  <button
                    className="text-start text-xs text-blue-700"
                    onClick={() => {
                      setCorrection(r);
                      setRoster(null);
                    }}
                  >
                    {L("Request correction", "طلب تصحيح")}
                  </button>
                )}
              </div>
            ))}
          </div>
          {!roster.data.length && (
            <p className="py-8 text-center text-sm text-slate-400">
              {t.noResults}
            </p>
          )}
          {error && (
            <p role="alert" className="my-4 text-sm text-red-600">
              {error}
            </p>
          )}
          {allowed("attendance", "edit") && (
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm dark:border-slate-700"
                onClick={() =>
                  setRoster({
                    ...roster,
                    data: roster.data.map((r: Row) => ({
                      ...r,
                      status: r.attendance_id ? r.status : "present",
                    })),
                  })
                }
              >
                {L("Mark all present", "الكل حاضر")}
              </button>
              <Button
                disabled={
                  busy ||
                  !roster.data.some((r: Row) => r.status && !r.attendance_id)
                }
                onClick={saveAttendance}
              >
                {busy ? "…" : t.save}
              </Button>
            </div>
          )}
        </Dialog>
      )}
      {rules && (
        <Dialog
          title={L("Availability & holidays", "التفرغ والإجازات")}
          close={() => setRules(null)}
        >
          <p className="mb-5 text-xs leading-6 text-slate-400">
            {L(
              "No availability rules means the teacher has no time restriction. Once rules exist, sessions must fit a listed window.",
              "لو مفيش قواعد تفرغ، المدرّس متاح من غير قيود وقت. أول ما تضيف مواعيد، الحصص لازم تكون جواها.",
            )}
          </p>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              const minute = (v: string) => {
                const [h, m] = v.split(":").map(Number);
                return h * 60 + m;
              };
              try {
                await api("/scheduling/availability", "POST", {
                  teacher_id: d.teacher_id,
                  weekday: Number(d.weekday),
                  from_minute: minute(String(d.from)),
                  to_minute: minute(String(d.to)),
                });
                setRules(await api("/scheduling/rules"));
                toast();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <Field label={L("Teacher", "المدرّس")}>
              <Select name="teacher_id" required>
                <option value="">—</option>
                {options.teachers?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={L("Day", "اليوم")}>
              <Select name="weekday">
                {[
                  "Sunday",
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                ].map((d, i) => (
                  <option key={d} value={i}>
                    {ar
                      ? [
                          "الأحد",
                          "الاثنين",
                          "الثلاثاء",
                          "الأربعاء",
                          "الخميس",
                          "الجمعة",
                          "السبت",
                        ][i]
                      : d}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={L("From", "من")}>
              <Input name="from" type="time" required />
            </Field>
            <Field label={L("To", "لحد")}>
              <Input name="to" type="time" required />
            </Field>
            <Button type="submit">
              {L("Add availability", "إضافة ميعاد تفرغ")}
            </Button>
          </form>
          <div className="my-5 grid gap-2">
            {rules.availability.map((r: Row) => (
              <div
                className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800"
                key={r.id}
              >
                <span>
                  {r.teacher_name} · {r.weekday} ·{" "}
                  {Math.floor(r.from_minute / 60)}:
                  {String(r.from_minute % 60).padStart(2, "0")} -{" "}
                  {Math.floor(r.to_minute / 60)}:
                  {String(r.to_minute % 60).padStart(2, "0")}
                </span>
                <button
                  aria-label={L("Delete rule", "حذف القاعدة")}
                  onClick={async () => {
                    await api(`/scheduling/availability/${r.id}`, "DELETE", {});
                    setRules(await api("/scheduling/rules"));
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <form
            className="grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2 dark:border-slate-800"
            onSubmit={async (e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              try {
                await api("/scheduling/holidays", "POST", {
                  ...d,
                  branch_id: d.branch_id || null,
                });
                setRules(await api("/scheduling/rules"));
                toast();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <Field label={L("Holiday name", "اسم الإجازة")}>
              <Input name="name" required />
            </Field>
            <Field label={L("Date", "التاريخ")}>
              <Input type="date" name="date" required />
            </Field>
            <Field label={t.branch}>
              <Select name="branch_id">
                <option value="">{t.allBranches}</option>
                {options.branches?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit">{L("Add holiday", "إضافة إجازة")}</Button>
          </form>
          <div className="mt-5 grid gap-2">
            {rules.holidays.map((h: Row) => (
              <div
                key={h.id}
                className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800"
              >
                <span>
                  {h.name} · {h.date}
                </span>
                <button
                  aria-label={L("Delete holiday", "حذف الإجازة")}
                  onClick={async () => {
                    await api(`/scheduling/holidays/${h.id}`, "DELETE", {});
                    setRules(await api("/scheduling/rules"));
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-600">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </>
  );
}
export function Assessments({
  t,
  api,
  allowed,
  toast,
  timezone,
}: {
  t: T;
  api: Api;
  allowed: (r: string, a?: string) => boolean;
  toast: () => void;
  timezone: string;
}) {
  const ar = t.language === "English",
    L = (a: string, b: string) => (ar ? b : a);
  const [data, setData] = useState<Row[]>([]),
    [groups, setGroups] = useState<Row[]>([]),
    [edit, setEdit] = useState<Row | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0),
    [qtype, setQtype] = useState("multiple_choice"),
    [performance, setPerformance] = useState<Row[] | null>(null);
  const reload = () => setVersion((v) => v + 1);
  useEffect(() => {
    api("/exams")
      .then((d) => setData(d.data))
      .catch((e) => setError(e.message));
    api("/academic/options")
      .then((d) => setGroups(d.groups ?? []))
      .catch((e) => setError(e.message));
  }, [version]);
  async function open(id: string) {
    setError("");
    setDetail(await api("/exams/" + id));
  }
  async function command(path: string, method: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await api(path, method, body);
      if (detail) await open(detail.data.id);
      reload();
      toast();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-[0.15em] text-teal-600">
            {L("MEASURE PROGRESS", "كل خطوة بتفرق")}
          </p>
          <h1 className="text-3xl font-semibold">
            {L("Exams & performance", "الامتحانات والمستوى")}
          </h1>
        </div>
        <div className="flex gap-3">
          {allowed("reports") && (
            <Button
              className="border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              onClick={async () =>
                setPerformance((await api("/academic/performance")).data)
              }
            >
              {L("Performance", "المستوى")}
            </Button>
          )}
          {allowed("exams", "create") && (
            <Button
              onClick={() => {
                setEdit({ max_score: 100, pass_score: 50, status: "draft" });
                setError("");
              }}
            >
              <Plus size={17} />
              {L("New exam", "امتحان جديد")}
            </Button>
          )}
        </div>
      </div>
      {error && !edit && !detail && (
        <p role="alert" className="mb-5 text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.map((e) => (
          <Card key={e.id} className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="rounded-xl bg-blue-50 p-3 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                <FileQuestion size={22} />
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] text-slate-500 dark:bg-slate-800">
                {e.status}
              </span>
            </div>
            <h2 className="text-lg font-semibold">{e.name}</h2>
            <p className="mt-2 text-xs text-slate-400">{e.group_name}</p>
            <p className="my-5 text-xs text-slate-500">
              {new Intl.DateTimeFormat(ar ? "ar-EG-u-nu-latn" : "en-GB", {
                timeZone: timezone,
                dateStyle: "medium",
                timeStyle: "short",
              }).format(e.scheduled_at * 1000)}
            </p>
            <div className="flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
              <span className="text-xs text-slate-400">
                {e.pass_score} / {e.max_score}
              </span>
              <button
                className="text-xs font-semibold text-blue-700 dark:text-blue-300"
                onClick={() => open(e.id)}
              >
                {L("Open exam", "فتح الامتحان")}
              </button>
            </div>
          </Card>
        ))}
      </div>
      {!data.length && (
        <Card className="p-14 text-center text-sm text-slate-400">
          {t.noResults}
        </Card>
      )}
      {edit && (
        <Dialog
          title={L("Exam settings", "إعدادات الامتحان")}
          close={() => setEdit(null)}
        >
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              try {
                const body = {
                  ...d,
                  scheduled_at: wallToEpoch(String(d.scheduled_at), timezone),
                  max_score: Number(d.max_score),
                  pass_score: Number(d.pass_score),
                };
                const ok = await command(
                  `/exams${edit.id ? `/${edit.id}` : ""}`,
                  edit.id ? "PUT" : "POST",
                  body,
                );
                if (ok) setEdit(null);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <Field label={t.name}>
              <Input name="name" required defaultValue={edit.name ?? ""} />
            </Field>
            <Field label={L("Group", "المجموعة")}>
              <Select
                name="group_id"
                required
                defaultValue={edit.group_id ?? ""}
              >
                <option value="">—</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={`${L("Date & time", "التاريخ والميعاد")} · ${timezone}`}
            >
              <Input
                type="datetime-local"
                name="scheduled_at"
                required
                defaultValue={
                  edit.scheduled_at
                    ? epochToWall(edit.scheduled_at, timezone)
                    : ""
                }
              />
            </Field>
            <Field label={L("Maximum score", "الدرجة النهائية")}>
              <Input
                name="max_score"
                type="number"
                min={1}
                step="any"
                required
                defaultValue={edit.max_score}
              />
            </Field>
            <Field label={L("Passing score", "درجة النجاح")}>
              <Input
                name="pass_score"
                type="number"
                min={0}
                step="any"
                required
                defaultValue={edit.pass_score}
              />
            </Field>
            <Field label={t.status}>
              <Select name="status" defaultValue={edit.status}>
                {(edit.id ? ["draft", "published", "closed"] : ["draft"]).map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </Select>
            </Field>
            {error && (
              <p role="alert" className="col-span-full text-sm text-red-600">
                {error}
              </p>
            )}
            <Button disabled={busy} type="submit">
              {t.save}
            </Button>
          </form>
        </Dialog>
      )}
      {detail && !edit && (
        <Dialog title={detail.data.name} close={() => setDetail(null)}>
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              {detail.data.status} · {detail.data.max_score}{" "}
              {L("points", "درجة")}
            </p>
            {allowed("exams", "edit") && (
              <button
                className="text-xs text-blue-700 dark:text-blue-300"
                onClick={() => setEdit(detail.data)}
              >
                {t.edit}
              </button>
            )}
          </div>
          <h3 className="mb-4 mt-6 font-semibold">
            {L("Questions", "الأسئلة")}
          </h3>
          <div className="grid gap-3">
            {detail.questions.map((q: Row) => (
              <div
                className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"
                key={q.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm">{q.prompt}</p>
                  {detail.data.status === "draft" &&
                    allowed("exams", "edit") && (
                      <button
                        aria-label={L("Delete question", "حذف السؤال")}
                        onClick={() =>
                          command(`/questions/${q.id}`, "DELETE", {})
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                </div>
                <p className="mt-2 text-[10px] text-slate-400">
                  {q.type} · {q.points}
                </p>
              </div>
            ))}
          </div>
          {detail.data.status === "draft" && allowed("exams", "edit") && (
            <form
              className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 dark:bg-slate-800"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  d = Object.fromEntries(new FormData(form));
                const ok = await command(
                  `/exams/${detail.data.id}/questions`,
                  "POST",
                  {
                    ...d,
                    points: Number(d.points),
                    position: detail.questions.length,
                    options: String(d.options ?? "")
                      .split("\n")
                      .filter(Boolean),
                  },
                );
                if (ok) form.reset();
              }}
            >
              <Field label={L("Question type", "نوع السؤال")}>
                <Select
                  name="type"
                  value={qtype}
                  onChange={(e) => setQtype(e.target.value)}
                >
                  {[
                    "multiple_choice",
                    "true_false",
                    "short_answer",
                    "essay",
                    "matching",
                    "fill_blanks",
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              <Field label={L("Points", "الدرجة")}>
                <Input
                  type="number"
                  name="points"
                  min={1}
                  step="any"
                  required
                />
              </Field>
              <Field label={L("Question", "السؤال")}>
                <textarea name="prompt" className={inputClass} required />
              </Field>
              {qtype === "multiple_choice" && (
                <Field
                  label={L(
                    "Options (one per line)",
                    "الاختيارات (كل اختيار في سطر)",
                  )}
                >
                  <textarea name="options" className={inputClass} required />
                </Field>
              )}
              {qtype !== "essay" && (
                <Field
                  label={
                    qtype === "matching"
                      ? L("Answer JSON object", "الإجابة بصيغة JSON object")
                      : qtype === "fill_blanks"
                        ? L("Answer JSON array", "الإجابة بصيغة JSON array")
                        : L("Correct answer", "الإجابة الصح")
                  }
                >
                  <Input name="correct_answer" required />
                </Field>
              )}
              <Button type="submit" disabled={busy}>
                {L("Add question", "إضافة سؤال")}
              </Button>
            </form>
          )}
          {detail.data.status !== "draft" &&
            (allowed("exams", "print") || allowed("exams", "export")) && (
              <ExamResultSheet
                key={detail.data.id}
                id={detail.data.id}
                api={api}
                ar={ar}
                allowed={allowed}
              />
            )}
          <h3 className="mb-4 mt-7 font-semibold">
            {L("Results & rankings", "النتايج والترتيب")}
          </h3>
          {detail.results.map((r: Row) => (
            <div
              key={r.id}
              className="mb-2 flex items-center justify-between rounded-xl bg-slate-50 p-4 text-xs dark:bg-slate-800"
            >
              <div>
                <p className="font-semibold">
                  {r.rank}. {r.student_name}
                </p>
                <p className="mt-1 text-slate-400">
                  {r.outcome} · {r.feedback}
                </p>
              </div>
              <span className="font-semibold" dir="ltr">
                {r.score} / {detail.data.max_score} · {r.percent}%
              </span>
            </div>
          ))}
          {detail.data.status === "published" && allowed("exams", "edit") && (
            <form
              className="mt-4 grid gap-3 sm:grid-cols-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const d = Object.fromEntries(new FormData(e.currentTarget));
                await command(`/exams/${detail.data.id}/results`, "POST", {
                  ...d,
                  score: Number(d.score),
                });
              }}
            >
              <Field label={L("Student", "الطالب")}>
                <Select name="student_id" required>
                  <option value="">—</option>
                  {detail.students.map((s: Row) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={L("Score", "الدرجة")}>
                <Input
                  type="number"
                  name="score"
                  min={0}
                  max={detail.data.max_score}
                  step="any"
                  required
                />
              </Field>
              <Field label={L("Feedback", "ملاحظات التصحيح")}>
                <Input name="feedback" />
              </Field>
              <Button disabled={busy} type="submit">
                {L("Record grade", "تسجيل الدرجة")}
              </Button>
            </form>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-600">
              {error}
            </p>
          )}
        </Dialog>
      )}
      {performance && (
        <Dialog
          title={L("Student performance", "مستوى الطلبة")}
          close={() => setPerformance(null)}
        >
          <div className="grid gap-3">
            {performance.map((s) => (
              <div
                className="grid grid-cols-3 items-center gap-2 rounded-xl bg-slate-50 p-4 text-xs dark:bg-slate-800"
                key={s.id}
              >
                <span className="font-semibold">{s.name}</span>
                <span>
                  {L("Attendance", "الحضور")}: {s.attendance_percent}%
                </span>
                <span>
                  {L("Exams", "الامتحانات")}:{" "}
                  {s.exam_percent === null ? "—" : s.exam_percent + "%"}
                </span>
              </div>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
