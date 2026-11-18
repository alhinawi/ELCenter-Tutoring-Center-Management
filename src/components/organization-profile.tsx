"use client";
import { OrganizationLogoSettings } from "./organization-logo";
import { useEffect, useState } from "react";
import { Card, Button, Field, Input, Select } from "./ui";
type Row = Record<string, any>;
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
export function OrganizationProfile({
  onSaved,
  api,
  ar,
  editable,
}: {
  onSaved: () => Promise<void>;
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
    api("/organization/profile")
      .then((r) => setData(r.data))
      .catch((e) => setError(String(e)));
  }, []);
  const fields = [
    ["display_name", "Display name", "الاسم الظاهر", 160],
    ["tagline", "Tagline", "وصف مختصر", 200],
    ["contact_email", "Contact email", "إيميل التواصل", 254],
    ["contact_phone", "Contact phone", "رقم التواصل", 60],
    ["address", "Business address", "عنوان المؤسسة", 500],
    ["website", "Website, HTTPS", "الموقع، HTTPS", 300],
  ] as const;
  return (
    <Card className="my-6 p-6 md:p-8">
      <h2 className="font-semibold">
        {L("Organization profile", "ملف المؤسسة")}
      </h2>
      <p className="my-3 text-xs leading-6 text-slate-500">
        {L(
          "Display identity and contact details. Fiscal start month and default correspondence language are saved reference settings, not automatic ledger period changes or a browser language override.",
          "هوية المؤسسة وبيانات التواصل. شهر بداية السنة المالية ولغة المراسلات الافتراضية إعدادات مرجعية محفوظة، مش تعديل تلقائي للفترات المالية أو لغة المتصفح.",
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
      <OrganizationLogoSettings api={api} ar={ar} editable={editable} />
      {data && (
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setNotice("");
            try {
              await api("/organization/profile", "PUT", data);
              await onSaved();
              setNotice(L("Profile settings saved", "تم حفظ ملف المؤسسة"));
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {fields.map(([key, en, arabic, max]) => (
            <Field key={key} label={L(en, arabic)}>
              <Input
                value={data[key] ?? ""}
                maxLength={max}
                disabled={!editable || busy}
                type={
                  key === "contact_email"
                    ? "email"
                    : key === "website"
                      ? "url"
                      : "text"
                }
                onChange={(e) => setData({ ...data, [key]: e.target.value })}
              />
            </Field>
          ))}
          <Field
            label={L(
              "Default correspondence language",
              "لغة المراسلات الافتراضية",
            )}
          >
            <Select
              disabled={!editable || busy}
              aria-label={L(
                "Default correspondence language",
                "لغة المراسلات الافتراضية",
              )}
              value={data.default_language}
              onChange={(e) =>
                setData({ ...data, default_language: e.target.value })
              }
            >
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </Select>
          </Field>
          <Field
            label={L(
              "Financial year starts in month",
              "شهر بداية السنة المالية",
            )}
          >
            <Select
              disabled={!editable || busy}
              aria-label={L(
                "Financial year starts in month",
                "شهر بداية السنة المالية",
              )}
              value={data.financial_year_start_month}
              onChange={(e) =>
                setData({
                  ...data,
                  financial_year_start_month: Number(e.target.value),
                })
              }
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </Select>
          </Field>
          {editable && (
            <div className="sm:col-span-2">
              <Button disabled={busy} type="submit">
                {L("Save profile settings", "حفظ ملف المؤسسة")}
              </Button>
            </div>
          )}
        </form>
      )}
    </Card>
  );
}
