"use client";
import { useEffect, useState } from "react";
import { Card, Field, Input, Button, Select, inputClass } from "./ui";
type Row = Record<string, any>;
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
export function InvoicePrintHeader({
  snapshot,
  ar,
  draft = false,
}: {
  snapshot: Row | null;
  ar: boolean;
  draft?: boolean;
}) {
  if (!snapshot)
    return (
      <p className="my-4 text-xs text-slate-500">
        {draft
          ? ar
            ? "مسودة: بيانات الطباعة هتتثبت وقت الإصدار."
            : "Draft: print identity will be captured at issue."
          : ar
            ? "سجل قديم من غير نسخة محفوظة لبيانات الطباعة."
            : "Legacy record without a saved print-identity snapshot."}
      </p>
    );
  const color =
    (
      { blue: "#1d4ed8", navy: "#17233e", teal: "#0f766e" } as Record<
        string,
        string
      >
    )[snapshot.accent] ?? "#1d4ed8";
  return (
    <section
      data-print-identity
      className="my-4 border-b-2 pb-4"
      style={{ borderColor: color }}
    >
      <h2 className="text-xl font-semibold" style={{ color }}>
        {snapshot.issuer_name}
      </h2>
      {snapshot.contact_text && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-500">
          {snapshot.contact_text}
        </p>
      )}
    </section>
  );
}
export function InvoicePrintFooter({
  snapshot,
  ar,
  receipt = false,
}: {
  snapshot: Row | null;
  ar: boolean;
  receipt?: boolean;
}) {
  const value = receipt ? snapshot?.receipt_footer : snapshot?.invoice_footer;
  return value ? (
    <section className="my-4 border-t border-slate-200 pt-4">
      <h4 className="text-xs text-slate-500">
        {receipt
          ? ar
            ? "ملاحظة التحصيل"
            : "Receipt note"
          : ar
            ? "ملاحظة الفاتورة"
            : "Invoice note"}
      </h4>
      <p className="mt-2 whitespace-pre-wrap text-sm">{value}</p>
    </section>
  ) : null;
}
export function InvoicePrintSettings({
  api,
  ar,
  editable,
}: {
  api: Api;
  ar: boolean;
  editable: boolean;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/finance/print-settings")
      .then((r) => setData(r.data))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <Card className="p-5 lg:col-span-2">
      <h2 className="font-semibold">
        {L(
          "Invoice and receipt print settings",
          "إعدادات طباعة الفواتير والتحصيل",
        )}
      </h2>
      <p className="my-3 text-xs leading-6 text-slate-500">
        {L(
          "Plain text only. Settings are captured when an invoice is issued and cannot rewrite issued invoices or their receipt notes. Leave issuer blank to use the registered organization name. No tax calculations, legal invoice certification, arbitrary HTML or automatic external delivery.",
          "نص عادي بس. الإعدادات بتتثبت وقت إصدار الفاتورة، ومش بتغيّر الفواتير الصادرة أو ملاحظات تحصيلها. سيب اسم المُصدر فاضي لاستخدام اسم المؤسسة المسجل. مفيش حساب ضرايب أو اعتماد قانوني للفاتورة أو HTML أو إرسال خارجي تلقائي.",
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
              await api("/finance/print-settings", "PUT", data);
              setNotice(L("Print settings saved", "تم حفظ إعدادات الطباعة"));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={L("Invoice issuer name", "اسم مُصدر الفاتورة")}>
            <Input
              value={data.issuer_name}
              maxLength={160}
              disabled={!editable || busy}
              onChange={(e) =>
                setData({ ...data, issuer_name: e.target.value })
              }
            />
          </Field>
          <Field label={L("Print accent", "لون الطباعة")}>
            <Select
              aria-label={L("Print accent", "لون الطباعة")}
              value={data.accent}
              disabled={!editable || busy}
              onChange={(e) => setData({ ...data, accent: e.target.value })}
            >
              {[
                ["blue", L("Blue", "أزرق")],
                ["navy", L("Navy", "كحلي")],
                ["teal", L("Teal", "بترولي")],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          {(
            [
              [
                "contact_text",
                L("Printed contact details", "بيانات التواصل المطبوعة"),
                600,
              ],
              [
                "invoice_footer",
                L("Invoice footer note", "ملاحظة آخر الفاتورة"),
                1000,
              ],
              [
                "receipt_footer",
                L("Receipt footer note", "ملاحظة التحصيل المطبوعة"),
                1000,
              ],
            ] as const
          ).map(([key, label, max]) => (
            <Field key={key} label={label}>
              <textarea
                className={inputClass + " min-h-24"}
                maxLength={max}
                value={data[key]}
                disabled={!editable || busy}
                onChange={(e) => setData({ ...data, [key]: e.target.value })}
              />
            </Field>
          ))}
          {editable && (
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {L("Save print settings", "حفظ إعدادات الطباعة")}
              </Button>
            </div>
          )}
        </form>
      )}
    </Card>
  );
}
