"use client";
import { useState, useEffect, useRef } from "react";
import { Button, Card, Field, Input, Select } from "./ui";
type Row = Record<string, any>;
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
export function EmployeeLoans({
  api,
  ar,
  allowed,
}: {
  api: Api;
  ar: boolean;
  allowed: (r: string, a?: string) => boolean;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [list, setList] = useState<Row | null>(null),
    [options, setOptions] = useState<Row | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(1),
    [version, setVersion] = useState(0),
    [creating, setCreating] = useState(false),
    [action, setAction] = useState("");
  const recoveryKey = useRef(""),
    revision = useRef(0);
  useEffect(() => {
    let active = true;
    setList(null);
    api("/employee-loans?page=" + page)
      .then((r) => {
        if (active) setList(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [page, version]);
  useEffect(() => {
    let active = true;
    api("/employee-loans/options")
      .then((r) => {
        if (active) setOptions(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [version]);
  async function select(id: string) {
    const ticket = ++revision.current;
    setDetail(null);
    setAction("");
    setError("");
    try {
      const r = await api("/employee-loans/" + id);
      if (ticket === revision.current) {
        setDetail(r);
        recoveryKey.current = crypto.randomUUID();
      }
    } catch (e) {
      if (ticket === revision.current) setError((e as Error).message);
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      d = Object.fromEntries(new FormData(form));
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (creating) {
        await api("/employee-loans", "POST", {
          ...d,
          principal: Number(d.principal),
        });
        setCreating(false);
      } else if (detail) {
        const path = "/employee-loans/" + detail.data.id;
        if (action === "disburse") await api(path + "/disburse", "POST", d);
        else if (action === "recovery")
          await api(path + "/recoveries", "POST", {
            ...d,
            amount: Number(d.amount),
            request_key: recoveryKey.current,
          });
        else
          await api(path + "/decision", "POST", {
            decision: action,
            note: d.note,
          });
        await select(detail.data.id);
      }
      setVersion((v) => v + 1);
      setAction("");
      setNotice(
        L(
          "Saved recorded operation. No real funds moved.",
          "تم حفظ العملية المسجلة. مفيش فلوس حقيقية اتنقلت.",
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const money = (n: number, currency: string) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) +
    " " +
    currency;
  const statusLabel = (s: string) =>
    ({
      draft: L("Draft", "مسودة"),
      approved: L("Approved", "معتمد"),
      rejected: L("Rejected", "مرفوض"),
      cancelled: L("Cancelled", "ملغي"),
      disbursed: L("Disbursed (recorded)", "مصروف (مسجل)"),
    })[s] ?? s;
  const kindLabel = (s: string) =>
    s === "advance" ? L("Advance", "سلفة") : L("Loan", "قرض");
  const methodLabel = (s: string) =>
    s === "bank" ? L("Bank", "بنك") : L("Cash", "كاش");
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h2 className="text-lg font-semibold">
          {L("Employee loans & advances", "قروض وسلف الموظفين")}
        </h2>
        <p className="mt-3 text-xs leading-6 text-slate-500">
          {L(
            "Interest-free recorded principal and cash/bank recovery only. Choose a dedicated custom asset receivable account in Finance settings first. A preparer, independent approver and separate disbursement recorder are required. No actual transfer, automatic payroll deduction, interest, tax or legal lending service. Linked teachers use their explicit employee record.",
            "أصل مبلغ مسجل من غير فوايد، والاسترداد كاش أو بنك. جهّز حساب أصل مخصص لمديونيات الموظفين من إعدادات الحسابات الأول. لازم مُعد ومراجع مستقل ومسجل صرف مختلف. مفيش تحويل حقيقي أو خصم تلقائي من المرتب أو فوايد أو ضرايب أو خدمة إقراض قانونية. المدرس المرتبط يستخدم سجل الموظف الصريح.",
          )}
        </p>
        <p className="mt-2 text-xs leading-6 text-slate-500">
          {L(
            "Posted records are immutable. No in-app reversal or write-off workflow yet; review mistakes with finance before recording. Do not also deduct a recovery in payroll.",
            "السجلات المرحلة ثابتة. لسه مفيش مسار عكس أو إعدام مديونية من الشاشة؛ راجع أي خطأ مع الحسابات قبل التسجيل. متسجلش نفس الاسترداد تاني كخصم في المرتب.",
          )}
        </p>
        {allowed("finance", "create") && (
          <Button
            className="mt-4"
            disabled={busy}
            onClick={() => {
              setCreating(true);
              setDetail(null);
              setError("");
              setNotice("");
            }}
          >
            {L("New employee loan / advance", "قرض أو سلفة جديدة")}
          </Button>
        )}
      </Card>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-teal-700">
          {L(
            "Saved recorded operation. No real funds moved.",
            "تم حفظ العملية المسجلة. مفيش فلوس حقيقية اتنقلت.",
          )}
        </p>
      )}
      {creating && options && (
        <Card className="p-5">
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field label={L("Employee", "الموظف")}>
              <Select name="employee_id" required>
                <option value="">{L("Choose employee", "اختار الموظف")}</option>
                {options.employees.map((e: Row) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {e.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={L("Type", "النوع")}>
              <Select name="kind">
                <option value="advance">{L("Advance", "سلفة")}</option>
                <option value="loan">{L("Loan", "قرض")}</option>
              </Select>
            </Field>
            <Field label={L("Principal", "أصل المبلغ")}>
              <Input
                name="principal"
                type="number"
                required
                min={1}
                max={1000000000}
                step={1}
              />
            </Field>
            <Field label={L("Receivable asset account", "حساب أصل المديونية")}>
              <Select name="receivable_account_id" required>
                <option value="">
                  {L("Choose custom asset account", "اختار حساب أصل مخصص")}
                </option>
                {options.accounts.map((a: Row) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={L("Requested on", "تاريخ الطلب")}>
              <Input
                type="date"
                name="requested_on"
                required
                defaultValue={options.today}
                max={options.today}
              />
            </Field>
            <Field label={L("Repayment due", "استحقاق السداد")}>
              <Input
                type="date"
                name="due_on"
                required
                defaultValue={options.today}
              />
            </Field>
            <Field label={L("Reason", "السبب")}>
              <Input name="reason" required maxLength={500} />
            </Field>
            <div className="flex items-end gap-3">
              <Button disabled={busy} type="submit">
                {L("Save draft", "حفظ مسودة")}
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                {L("Cancel", "إلغاء")}
              </Button>
            </div>
          </form>
        </Card>
      )}
      <Card className="p-5">
        <h3 className="font-semibold">
          {L(
            "Recorded requests, newest first",
            "الطلبات المسجلة، الأحدث الأول",
          )}
        </h3>
        {!list && (
          <p role="status" className="mt-3 text-sm">
            {L("Loading recorded requests…", "جاري تحميل الطلبات المسجلة…")}
          </p>
        )}
        {list?.data.length === 0 && (
          <p className="mt-3 text-sm">
            {L(
              "No recorded employee loans in your current scope.",
              "مفيش قروض موظفين مسجلة في نطاقك الحالي.",
            )}
          </p>
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {list?.data.map((p: Row) => (
            <button
              key={p.id}
              disabled={busy}
              onClick={() => {
                setCreating(false);
                void select(p.id);
              }}
              className="rounded-xl border border-slate-200 p-4 text-start dark:border-slate-700"
            >
              <p className="font-semibold">{p.employee_name}</p>
              <p className="mt-2 text-sm">
                {kindLabel(p.kind)} · {statusLabel(p.status)}
              </p>
              <p className="mt-2 text-xs" dir="ltr">
                {money(p.principal, p.currency)} · {L("Recovered", "مسترد")}{" "}
                {money(p.recovered, p.currency)}
              </p>
              <p className="mt-2 text-xs">
                {L("Due", "الاستحقاق")}: <bdi dir="ltr">{p.due_on}</bdi>
              </p>
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            disabled={busy || page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {L("Previous", "السابق")}
          </Button>
          <span className="text-xs">
            {L("Page", "صفحة")} {page}
          </span>
          <Button
            disabled={busy || !list?.has_more}
            onClick={() => setPage((p) => p + 1)}
          >
            {L("Next", "التالي")}
          </Button>
        </div>
      </Card>
      {detail && (
        <Card className="p-5">
          <h3 className="text-lg font-semibold">{detail.data.employee_name}</h3>
          <p className="mt-3 text-sm">{detail.data.reason}</p>
          <p className="mt-3 text-sm">
            {L("State", "الحالة")}: {statusLabel(detail.data.status)}
          </p>
          <p className="mt-3 flex flex-wrap gap-1 font-semibold">
            {L("Outstanding", "المتبقي")}:{" "}
            <bdi dir="ltr">
              {money(
                detail.data.status === "disbursed"
                  ? detail.data.principal - detail.data.recovered
                  : 0,
                detail.data.currency,
              )}
            </bdi>
          </p>
          <p className="mt-2 break-all text-xs text-slate-500" dir="ltr">
            {detail.data.id}
          </p>
          {detail.data.journal_id && (
            <p className="mt-2 break-all text-xs text-slate-500" dir="ltr">
              {L("Disbursement journal", "قيد الصرف")}: {detail.data.journal_id}
            </p>
          )}
          <div className="my-4 flex flex-wrap gap-2">
            {allowed("finance", "approve") &&
              detail.data.status === "draft" &&
              ["approved", "rejected"].map((a) => (
                <Button key={a} disabled={busy} onClick={() => setAction(a)}>
                  {a === "approved"
                    ? L("Approve request", "اعتماد الطلب")
                    : L("Reject request", "رفض الطلب")}
                </Button>
              ))}
            {allowed("finance", "approve") &&
              detail.data.status === "approved" && (
                <>
                  <Button disabled={busy} onClick={() => setAction("disburse")}>
                    {L("Record disbursement", "تسجيل صرف")}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => setAction("cancelled")}
                  >
                    {L("Cancel approved request", "إلغاء الطلب المعتمد")}
                  </Button>
                </>
              )}
            {allowed("finance", "create") &&
              detail.data.status === "disbursed" &&
              detail.data.recovered < detail.data.principal && (
                <Button disabled={busy} onClick={() => setAction("recovery")}>
                  {L("Record recovery", "تسجيل استرداد")}
                </Button>
              )}
          </div>
          {action && (
            <form
              onSubmit={submit}
              className="my-5 grid gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2"
            >
              <h4 className="font-semibold sm:col-span-2">
                {action === "disburse"
                  ? L("Record disbursement", "تسجيل صرف")
                  : action === "recovery"
                    ? L("Record recovery", "تسجيل استرداد")
                    : statusLabel(action)}
              </h4>
              {["disburse", "recovery"].includes(action) ? (
                <>
                  <Field label={L("Recorded date", "التاريخ المسجل")}>
                    <Input
                      name="date"
                      type="date"
                      required
                      min={
                        action === "disburse"
                          ? detail.data.requested_on
                          : detail.data.disbursed_on
                      }
                      max={options?.today}
                      defaultValue={options?.today}
                    />
                  </Field>
                  <Field label={L("Method", "الطريقة")}>
                    <Select name="method">
                      <option value="bank">{L("Bank", "بنك")}</option>
                      <option value="cash">{L("Cash", "كاش")}</option>
                    </Select>
                  </Field>
                  {action === "recovery" && (
                    <>
                      <Field label={L("Recovery amount", "مبلغ الاسترداد")}>
                        <Input
                          name="amount"
                          type="number"
                          min={1}
                          max={detail.data.principal - detail.data.recovered}
                          step={1}
                          required
                        />
                      </Field>
                      <Field label={L("Recovery reference", "مرجع الاسترداد")}>
                        <Input name="reference" required maxLength={500} />
                      </Field>
                    </>
                  )}
                </>
              ) : (
                <Field label={L("Decision note", "ملاحظة القرار")}>
                  <Input name="note" required maxLength={500} />
                </Field>
              )}
              <Button disabled={busy} type="submit">
                {L("Confirm recorded operation", "تأكيد العملية المسجلة")}
              </Button>
              <Button
                disabled={busy}
                type="button"
                onClick={() => setAction("")}
              >
                {L("Back", "رجوع")}
              </Button>
            </form>
          )}
          <h4 className="my-3 font-semibold">
            {L("Immutable recoveries", "الاستردادات الثابتة")}
          </h4>
          {detail.recoveries.map((r: Row) => (
            <div
              key={r.id}
              className="mt-3 rounded-lg border border-slate-200 p-3 text-sm"
            >
              <p dir="ltr">
                {r.date} · {money(r.amount, detail.data.currency)} ·{" "}
                {methodLabel(r.method)}
              </p>
              <p className="mt-2 break-words">{r.reference}</p>
              <p className="mt-2 break-all text-xs text-slate-500" dir="ltr">
                {r.journal_id}
              </p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
