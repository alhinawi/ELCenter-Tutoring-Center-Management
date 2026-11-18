"use client";
import { useState, useEffect } from "react";
import { Button, Field, Input } from "./ui";
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
export function MfaSettings({ api, ar }: { api: Api; ar: boolean }) {
  const L = (e: string, a: string) => (ar ? a : e),
    [state, setState] = useState<{
      enabled: boolean;
      configured: boolean;
      recovery_remaining: number;
    } | null>(null),
    [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null),
    [codes, setCodes] = useState<string[]>([]),
    [qr, setQr] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setState(await api("/security/mfa"));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h3 className="font-semibold">
        {L("Authenticator app (optional)", "تطبيق المصادقة (اختياري)")}
      </h3>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {state && (
        <>
          <p className="text-sm leading-7 text-slate-500">
            {state.enabled
              ? L(
                  "Authenticator enabled. Unused recovery codes: ",
                  "المصادقة مفعلة. أكواد الاسترداد غير المستخدمة: ",
                ) + state.recovery_remaining
              : L(
                  "Use a 6-digit authenticator code at sign-in. Keep recovery codes somewhere safe. Setup requires encrypted server storage.",
                  "استخدم كود مصادقة من 6 أرقام وقت الدخول. احتفظ بأكواد الاسترداد في مكان آمن. الإعداد محتاج تخزين مشفر على السيرفر.",
                )}
          </p>
          {codes.length > 0 && (
            <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-amber-900">
              <p className="text-sm font-semibold">
                {L(
                  "Save these recovery codes now. They are shown only once, and each works once. Anyone with one and your password can sign in.",
                  "احفظ أكواد الاسترداد دلوقتي. بتظهر مرة واحدة، وكل كود يستخدم مرة واحدة. أي شخص عنده كود وكلمة المرور يقدر يدخل.",
                )}
              </p>
              <pre dir="ltr" className="overflow-x-auto text-xs leading-7">
                {codes.join("\n")}
              </pre>
              <Button
                onClick={() => {
                  const url = URL.createObjectURL(
                      new Blob([codes.join("\n")], { type: "text/plain" }),
                    ),
                    a = document.createElement("a");
                  a.href = url;
                  a.download = "elcenter-recovery-codes.txt";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                {L("Download recovery codes", "تنزيل أكواد الاسترداد")}
              </Button>
              <button
                className="ms-3 text-sm underline"
                onClick={() => setCodes([])}
              >
                {L("I saved them. Hide codes.", "حفظتهم. إخفاء الأكواد.")}
              </button>
            </div>
          )}
          {setup ? (
            <>
              <p className="text-sm leading-7">
                {L(
                  "Scan with your authenticator or enter this key manually. Setup expires after 10 minutes.",
                  "امسح الصورة بتطبيق المصادقة أو أدخل المفتاح يدويًا. الإعداد بينتهي بعد 10 دقايق.",
                )}
              </p>
              {qr && (
                <img
                  src={qr}
                  alt={L("Authenticator setup QR", "رمز إعداد المصادقة")}
                  className="h-48 w-48"
                />
              )}
              <Input
                aria-label={L(
                  "Manual authenticator key",
                  "مفتاح المصادقة اليدوي",
                )}
                value={setup.secret}
                readOnly
                dir="ltr"
              />
              <form
                className="grid gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    const form = e.currentTarget,
                      fd = new FormData(form),
                      r = await api(
                        "/security/mfa/confirm",
                        "POST",
                        Object.fromEntries(fd),
                      );
                    setCodes(r.recovery_codes);
                    setSetup(null);
                    setQr("");
                    form.reset();
                    await load();
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Field
                  label={L(
                    "Confirm current password",
                    "أكد كلمة المرور الحالية",
                  )}
                >
                  <Input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </Field>
                <Field
                  label={L(
                    "6-digit authenticator code",
                    "كود المصادقة من 6 أرقام",
                  )}
                >
                  <Input
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    pattern="[0-9]{6}"
                    maxLength={6}
                  />
                </Field>
                <Button disabled={busy} type="submit">
                  {L("Confirm authenticator", "تأكيد المصادقة")}
                </Button>
              </form>
            </>
          ) : (
            <form
              className="grid gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const form = e.currentTarget,
                    fd = new FormData(form);
                  if (state.enabled) {
                    await api(
                      "/security/mfa/disable",
                      "POST",
                      Object.fromEntries(fd),
                    );
                    setCodes([]);
                    await load();
                  } else {
                    const r = await api(
                      "/security/mfa/setup",
                      "POST",
                      Object.fromEntries(fd),
                    );
                    setSetup(r);
                    const { default: QRCode } = await import("qrcode");
                    setQr(
                      await QRCode.toDataURL(r.uri, { width: 192, margin: 1 }),
                    );
                  }
                  form.reset();
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field
                label={L(
                  "Password for authenticator change",
                  "كلمة المرور لتغيير المصادقة",
                )}
              >
                <Input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              {state.enabled && (
                <Field
                  label={L(
                    "Authenticator or unused recovery code",
                    "كود المصادقة أو كود استرداد غير مستخدم",
                  )}
                >
                  <Input
                    name="code"
                    autoComplete="one-time-code"
                    maxLength={32}
                    required
                  />
                </Field>
              )}
              <Button
                disabled={busy || (!state.configured && !state.enabled)}
                type="submit"
              >
                {state.enabled
                  ? L(
                      "Disable authenticator and revoke other sessions",
                      "إيقاف المصادقة وإلغاء الجلسات التانية",
                    )
                  : L("Set up authenticator", "إعداد المصادقة")}
              </Button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
