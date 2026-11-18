"use client";
import { useState, useEffect } from "react";
import { Card, Field, Input, Button } from "./ui";
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
export function InvoiceNumberSettings({
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
    const d = (await api("/finance/numbering")).data;
    setData(d);
    setExpected(d.next_number);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  return (
    <Card className="p-5 lg:col-span-2">
      <h2 className="font-semibold">
        {L("Invoice numbering", "ترقيم الفواتير")}
      </h2>
      <p className="my-3 text-xs leading-6 text-slate-500">
        {L(
          "Optional organization-wide sequence, without branch/year resets. Leave a new invoice number blank to use it; manual numbers stay available. Numbers are reserved only when draft creation succeeds. Issued and existing invoices never change. Do not reuse a manual number in the sequence range: collisions reject the create instead of silently skipping. The counter cannot move backwards. Receipt numbering is not included.",
          "تسلسل اختياري للمؤسسة كلها، من غير تصفير سنوي أو لكل فرع. سيب رقم الفاتورة الجديدة فاضي لاستخدامه؛ الترقيم اليدوي لسه متاح. الرقم بيتحجز لما إنشاء المسودة ينجح بس. الفواتير الموجودة والصادرة مش بتتغير. متستخدمش رقم يدوي من نفس نطاق التسلسل؛ التعارض بيرفض الإنشاء بدل تخطي أرقام بصمت. العداد مش بيرجع لورا. ترقيم إيصالات القبض مش ضمن الإعداد ده.",
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
              await api("/finance/numbering", "PUT", {
                enabled: !!data.enabled,
                prefix: data.prefix,
                next_number: Number(data.next_number),
                expected_next: expected,
              });
              await load();
              setNotice(L("Numbering saved", "تم حفظ الترقيم"));
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
            {L("Use automatic invoice numbers", "تفعيل ترقيم الفواتير تلقائياً")}
          </label>
          <Field label={L("Invoice number prefix", "بادئة رقم الفاتورة")}>
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
              "Next invoice sequence number",
              "الرقم التالي في تسلسل الفواتير",
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
                {L("Save numbering", "حفظ الترقيم")}
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
              {L("Refresh numbering", "تحديث الترقيم")}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
