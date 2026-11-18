"use client";
import { useEffect, useState } from "react";
import { Button, Input, Select, Field, Card } from "./ui";
import { Dialog, Table } from "./portals";
type Row = Record<string, any>;
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
const statuses = ["present", "absent", "late", "excused", "left_early"];
const arabic: Row = {
  present: "حاضر",
  absent: "غايب",
  late: "متأخر",
  excused: "بعذر",
  left_early: "مشي بدري",
  pending: "قيد المراجعة",
  approved: "موافق عليه",
  rejected: "مرفوض",
};
export function AttendanceCorrectionForm({
  api,
  ar,
  row,
  close,
  done,
}: {
  api: Api;
  ar: boolean;
  row: Row;
  close: () => void;
  done: () => void;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={L("Request attendance correction", "طلب تصحيح الحضور")}
      close={close}
    >
      <p className="mb-4 text-sm">{row.name}</p>
      <p className="mb-4 text-xs leading-6 text-slate-500">
        {L(
          "The recorded value stays unchanged until another authorized reviewer approves. Existing arrival and departure times are preserved by this form.",
          "السجل الحالي مش هيتغير غير لما مراجع تاني مخوّل يوافق. النموذج بيحتفظ بأوقات الوصول والانصراف الحالية.",
        )}
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await api(
              "/attendance/" + row.attendance_id + "/corrections",
              "POST",
              {
                status: d.get("status"),
                arrival: row.arrival ?? null,
                departure: row.departure ?? null,
                notes: d.get("notes"),
                reason: d.get("reason"),
              },
            );
            done();
            close();
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={L("Corrected status", "الحالة الصحيحة")}>
          <Select
            name="status"
            aria-label={L("Corrected status", "الحالة الصحيحة")}
            defaultValue={row.status}
          >
            {statuses.map((s) => (
              <option key={s} value={s}>
                {ar ? arabic[s] : s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={L("Corrected notes", "الملاحظات الصحيحة")}>
          <Input name="notes" defaultValue={row.notes ?? ""} maxLength={1000} />
        </Field>
        <Field label={L("Reason for correction", "سبب التصحيح")}>
          <Input name="reason" required minLength={5} maxLength={1000} />
        </Field>
        <Button type="submit" disabled={busy}>
          {L("Submit correction request", "إرسال طلب التصحيح")}
        </Button>
      </form>
    </Dialog>
  );
}
export function AttendanceCorrectionQueue({
  api,
  ar,
  approve,
  version,
}: {
  api: Api;
  ar: boolean;
  approve: boolean;
  version: number;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [rows, setRows] = useState<Row[]>([]),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [review, setReview] = useState<Row | null>(null),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setRows((await api("/attendance-corrections")).data);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    if (open) void load();
  }, [open, version]);
  return (
    <Card className="mb-5 p-5">
      <button
        className="text-sm font-semibold text-blue-700"
        onClick={() => setOpen(!open)}
      >
        {L("Attendance correction requests", "طلبات تصحيح الحضور")}
      </button>
      {open && (
        <>
          <p className="my-3 text-xs leading-6 text-slate-500">
            {L(
              "Latest 100 requests in your branch scope. Approval needs attendance:approve and a different reviewer. Existing records cannot be changed by the bulk form.",
              "آخر 100 طلب في نطاق فروعك. الموافقة محتاجة صلاحية اعتماد الحضور ومراجع غير صاحب الطلب. نموذج الحضور الجماعي مش بيعدّل سجلات متسجلة.",
            )}
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Table
            heads={[
              L("Student", "الطالب"),
              L("Group", "المجموعة"),
              L("Change", "التغيير"),
              L("Reason", "السبب"),
              L("Status", "الحالة"),
              L("Review", "المراجعة"),
            ]}
            rows={rows.map((r) => [
              r.student_name,
              r.group_name,
              (ar ? arabic[r.old_status] : r.old_status) +
                " → " +
                (ar ? arabic[r.new_status] : r.new_status),
              r.reason,
              ar ? arabic[r.status] : r.status,
              approve && r.status === "pending" ? (
                <button className="text-blue-700" onClick={() => setReview(r)}>
                  {L("Review request", "مراجعة الطلب")}
                </button>
              ) : (
                r.decision_note
              ),
            ])}
          />
        </>
      )}
      {review && (
        <Dialog
          title={L("Review attendance correction", "مراجعة تصحيح الحضور")}
          close={() => setReview(null)}
        >
          <p className="mb-3">
            {review.student_name} · {review.requester}
          </p>
          <p className="mb-3 text-sm">{review.reason}</p>
          <p className="mb-4 text-sm">
            {review.old_status} → {review.new_status} · {review.notes}
          </p>
          {error && (
            <p role="alert" className="my-3 text-sm text-red-600">
              {error}
            </p>
          )}
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                await api(
                  "/attendance-corrections/" + review.id + "/decision",
                  "POST",
                  { decision: d.get("decision"), note: d.get("note") },
                );
                await load();
                setReview(null);
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label={L("Decision", "القرار")}>
              <Select name="decision" aria-label={L("Decision", "القرار")}>
                <option value="approved">{L("Approve", "موافقة")}</option>
                <option value="rejected">{L("Reject", "رفض")}</option>
              </Select>
            </Field>
            <Field label={L("Review note", "ملاحظة المراجعة")}>
              <Input name="note" required minLength={3} maxLength={1000} />
            </Field>
            <Button disabled={busy} type="submit">
              {L("Save independent decision", "حفظ قرار المراجعة")}
            </Button>
          </form>
        </Dialog>
      )}
    </Card>
  );
}
