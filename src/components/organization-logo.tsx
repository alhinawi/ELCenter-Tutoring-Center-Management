"use client";
import { useState, useEffect } from "react";
import { Button, Field, Input } from "./ui";
import { preparePrivateImage } from "./private-image";
type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
function useLogo(api: Api) {
  const [photo, setPhoto] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      revision = 0;
    async function load() {
      const ticket = ++revision;
      try {
        const r = await api("/portal/organization-logo");
        if (active && ticket === revision) {
          setPhoto(r.data);
          setError("");
        }
      } catch (e) {
        if (active && ticket === revision) {
          setPhoto(null);
          setError((e as Error).message);
        }
      }
    }
    void load();
    window.addEventListener("elcenter-logo-changed", load);
    return () => {
      active = false;
      window.removeEventListener("elcenter-logo-changed", load);
    };
  }, []);
  return { photo, error };
}
export function OrganizationLogo({
  api,
  ar = false,
}: {
  api: Api;
  ar?: boolean;
}) {
  const { photo } = useLogo(api);
  return photo ? (
    <img
      alt={ar ? "شعار المؤسسة" : "Organization logo"}
      src={"data:" + photo.mime + ";base64," + photo.data}
      className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain"
    />
  ) : null;
}
export function OrganizationLogoSettings({
  api,
  ar,
  editable,
}: {
  api: Api;
  ar: boolean;
  editable: boolean;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    { photo, error: readError } = useLogo(api),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  function changed() {
    window.dispatchEvent(new Event("elcenter-logo-changed"));
  }
  return (
    <section className="my-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h3 className="font-semibold">
        {L("Organization logo", "شعار المؤسسة")}
      </h3>
      <p className="my-3 text-xs leading-6 text-slate-500">
        {L(
          "One private current logo, visible to signed-in members of this organization. PNG/JPEG up to 8 MiB is resized to at most 384 pixels and JPEG up to 32 KiB. Original metadata is removed and transparency becomes white. Replacement has no history. Existing invoice print snapshots, public sign-in pages and branch logos do not change.",
          "شعار حالي واحد خاص، بيظهر لأعضاء المؤسسة بعد الدخول. PNG/JPEG لحد 8 ميجا بيتصغر لحد 384 بكسل وJPEG لحد 32 كيلوبايت. بيانات الملف الأصلية بتتشال والشفافية بتبقى أبيض. الاستبدال من غير سجل نسخ. نسخ طباعة الفواتير القديمة وصفحات الدخول العامة وشعارات الفروع مش بتتغير.",
        )}
      </p>
      {photo ? (
        <img
          alt={L("Saved organization logo", "شعار المؤسسة المحفوظ")}
          src={"data:" + photo.mime + ";base64," + photo.data}
          className="my-3 h-28 w-40 rounded-lg bg-white object-contain"
        />
      ) : (
        <p className="my-3 text-sm text-slate-500">
          {L("No organization logo", "مفيش شعار للمؤسسة")}
        </p>
      )}
      {editable && (
        <div className="grid max-w-lg gap-3">
          <Field label={L("Choose organization logo", "اختار شعار المؤسسة")}>
            <Input
              type="file"
              accept="image/png,image/jpeg"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setBusy(true);
                setError("");
                setNotice("");
                try {
                  const data = await preparePrivateImage(file, L);
                  await api("/organization/logo", "PUT", {
                    mime: "image/jpeg",
                    data,
                  });
                  changed();
                  setNotice(
                    L("Organization logo saved", "تم حفظ شعار المؤسسة"),
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </Field>
          {photo && (
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (
                  !confirm(
                    L(
                      "Remove the organization logo permanently?",
                      "مسح شعار المؤسسة نهائياً؟",
                    ),
                  )
                )
                  return;
                setBusy(true);
                setError("");
                setNotice("");
                try {
                  await api("/organization/logo", "DELETE");
                  changed();
                  setNotice(
                    L("Organization logo removed", "تم مسح شعار المؤسسة"),
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {L("Remove organization logo", "مسح شعار المؤسسة")}
            </Button>
          )}
        </div>
      )}
      {(error || readError) && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error || readError}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-teal-700">
          {notice}
        </p>
      )}
    </section>
  );
}
