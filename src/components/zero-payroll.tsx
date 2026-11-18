"use client";
import { useState } from "react";
import { Dialog } from "./portals";
import { Button, Field, Input, inputClass } from "./ui";
type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
export function ZeroPayrollClosure({
  api,
  ar,
  id,
  kind,
  onSaved,
}: {
  api: Api;
  ar: boolean;
  id: string;
  kind: "payroll" | "staff-payroll";
  onSaved: () => void;
}) {
  const L = (e: string, a: string) => (ar ? a : e);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Button
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        {L("Close with no payment", "إغلاق بدون صرف")}
      </Button>
      {open && (
        <Dialog
          title={L(
            "Close zero payroll without payment",
            "إغلاق المرتب الصفري بدون صرف",
          )}
          close={() => {
            if (!busy) setOpen(false);
          }}
        >
          <p className="mb-5 text-sm leading-7 text-slate-500">
            {L(
              "This records a final no-payment closure for an approved zero-amount payroll. No cash or bank transaction, journal or paid status is created. A finance user separate from the preparer and approver must close it. The date must be from payroll month end through today. Closure cannot be edited or deleted.",
              "ده بيسجل إغلاق نهائي بدون صرف لمرتب معتمد قيمته صفر. مش بيتسجل تحرك نقدي أو بنكي أو قيد أو حالة مدفوع. مسؤول مالي غير المحضر والمعتمد لازم يقفله. التاريخ من نهاية شهر المرتب لحد النهارده. الإغلاق مش قابل للتعديل أو الحذف.",
            )}
          </p>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                await api("/" + kind + "/" + id + "/close-zero", "POST", {
                  date: fd.get("date"),
                  reason: fd.get("reason"),
                });
                setOpen(false);
                onSaved();
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label={L("Closure date", "تاريخ الإغلاق")}>
              <Input name="date" type="date" required />
            </Field>
            <Field label={L("No-payment reason", "سبب عدم الصرف")}>
              <textarea
                aria-label={L("No-payment reason", "سبب عدم الصرف")}
                name="reason"
                required
                minLength={5}
                maxLength={1000}
                className={inputClass + " min-h-24"}
              />
            </Field>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {L("Confirm no-payment closure", "تأكيد الإغلاق بدون صرف")}
            </Button>
          </form>
        </Dialog>
      )}
    </>
  );
}
