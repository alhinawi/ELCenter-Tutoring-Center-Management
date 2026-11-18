"use client";
import { useState, useEffect } from "react";
import { Card, Field, Input, Button } from "./ui";
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
export function ReceiptNumberSettings({
  api,
  ar,
  editable,
}: {
  api: Api;
  ar: boolean;
  editable: boolean;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [data, setData] = useState<any>(null),
    [expected, setExpected] = useState(1),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const d = (await api("/finance/receipt-numbering")).data;
    setData(d);
    setExpected(d.next_number);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  return (
    <Card className="p-5 lg:col-span-2">
      <h2 className="font-semibold">
        {L("Receipt numbering", "ترقيم إيصالات القبض")}
      </h2>
      <p className="my-3 text-xs leading-6 text-slate-500">
        {L(
          "Optional organization-wide sequence for new real receipts, reserved only after the payment record and accounting entry succeed. Demo receipts, refunds and old records never consume a number. Turning it off keeps the immutable receipt ID. No manual override, branch/year reset or legal certification. Exhaustion or collision rejects the entire receipt without recording money. The counter cannot move backwards.",
          "تسلسل اختياري للمؤسسة للإيصالات الحقيقية الجديدة، بيتحجز بعد نجاح تسجيل التحصيل والقيد المحاسبي. التجريبي والاسترداد والسجلات القديمة مش بيستهلكوا رقم. إيقافه بيسيّب معرّف الإيصال الثابت. مفيش رقم يدوي أو تصفير سنوي أو لكل فرع أو اعتماد قانوني. نفاد الأرقام أو التعارض بيرفض التحصيل كله من غير تسجيل فلوس. العداد مش بيرجع لورا.",
        )}
      </p>
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
      {data && (
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setNotice("");
            try {
              await api("/finance/receipt-numbering", "PUT", {
                enabled: !!data.enabled,
                prefix: data.prefix,
                next_number: Number(data.next_number),
                expected_next: expected,
              });
              await load();
              setNotice(L("Receipt numbering saved", "تم حفظ ترقيم الإيصالات"));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={!!data.enabled}
              disabled={!editable || busy}
              onChange={(e) => setData({ ...data, enabled: e.target.checked })}
            />
            {L(
              "Use automatic receipt numbers",
              "تفعيل ترقيم إيصالات القبض تلقائياً",
            )}
          </label>
          <Field label={L("Receipt number prefix", "بادئة رقم الإيصال")}>
            <Input
              value={data.prefix}
              disabled={!editable || busy}
              required
              maxLength={16}
              pattern="[A-Z0-9][A-Z0-9/_-]{0,15}"
              dir="ltr"
              onChange={(e) => setData({ ...data, prefix: e.target.value })}
            />
          </Field>
          <Field
            label={L(
              "Next receipt sequence number",
              "الرقم التالي في تسلسل الإيصالات",
            )}
          >
            <Input
              type="number"
              value={data.next_number}
              disabled={!editable || busy}
              required
              min={expected}
              max={999999999}
              step={1}
              onChange={(e) =>
                setData({ ...data, next_number: Number(e.target.value) })
              }
            />
          </Field>
          <p className="text-xs text-slate-500 sm:col-span-2">
            {L("Preview only, not reserved", "معاينة بس، الرقم مش محجوز")}:{" "}
            <span dir="ltr">
              {data.prefix}
              {String(data.next_number).padStart(6, "0")}
            </span>
          </p>
          <div className="flex gap-3 sm:col-span-2">
            {editable && (
              <Button type="submit" disabled={busy}>
                {L("Save receipt numbering", "حفظ ترقيم الإيصالات")}
              </Button>
            )}
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setError("");
                load().catch((e) => setError(e.message));
              }}
            >
              {L("Refresh receipt numbering", "تحديث ترقيم الإيصالات")}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
