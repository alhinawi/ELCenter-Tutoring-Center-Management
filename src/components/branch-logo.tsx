"use client";
import { preparePrivateImage } from "./private-image";
import { useEffect, useState, useRef } from "react";
import { Button, Input, Field } from "./ui";
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
type Props = {
  api: Api;
  id: string;
  ar: boolean;
  editable?: boolean;
};
export function BranchLogoSettings(props: Props) {
  return <Logo key={props.id} {...props} />;
}
function Logo({ api, id, ar, editable = false }: Props) {
  const L = (e: string, a: string) => (ar ? a : e),
    [photo, setPhoto] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const path = "/branches/" + id + "/logo";
  const revision = useRef(0);
  async function load() {
    const ticket = ++revision.current,
      r = await api(path);
    if (ticket === revision.current) setPhoto(r.data);
  }
  useEffect(() => {
    let active = true;
    const ticket = ++revision.current;
    api(path)
      .then((r) => {
        if (active && ticket === revision.current) setPhoto(r.data);
      })
      .catch((e) => {
        if (active && ticket === revision.current) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [path]);
  async function upload(file: File) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const encoded = await preparePrivateImage(file, L);
      await api(path, "PUT", {
        mime: "image/jpeg",
        data: encoded,
      });
      await load();
      window.dispatchEvent(new Event("elcenter-branch-logo-" + id));
      setNotice(L("Branch logo saved", "تم حفظ شعار الفرع"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h3 className="font-semibold">
        {L("Private branch logo", "شعار الفرع الخاص")}
      </h3>
      <div className="mt-3 flex flex-wrap items-start gap-4">
        {photo ? (
          <img
            src={"data:" + photo.mime + ";base64," + photo.data}
            alt={L("Saved branch logo", "شعار الفرع المحفوظ")}
            className="h-28 w-28 rounded-xl object-contain bg-white"
            onError={() =>
              setError(
                L(
                  "Saved logo could not be displayed.",
                  "تعذر عرض الشعار المحفوظ.",
                ),
              )
            }
          />
        ) : (
          <div className="flex h-28 w-28 items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-500 dark:bg-slate-800">
            {L("No branch logo", "مفيش شعار للفرع")}
          </div>
        )}
        {editable && (
          <div className="grid max-w-md gap-3">
            <Field label={L("Choose branch logo", "اختار شعار الفرع")}>
              <Input
                type="file"
                accept="image/png,image/jpeg"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = "";
                }}
              />
            </Field>
            <p className="text-xs leading-6 text-slate-500">
              {L(
                "Resized to at most 384 pixels, converted to JPEG up to 32 KiB. This removes original file metadata and flattens transparency to white. Replaces the current branch logo without history. Private storage, one current logo per branch. Public login pages, portals and invoice snapshots do not change.",
                "بتتصغر لحد 384 بكسل وتتحول JPEG لحد 32 كيلوبايت. ده بيشيل بيانات الملف الأصلي وبيحوّل الشفافية لأبيض. بيستبدل شعار الفرع الحالي من غير سجل نسخ. تخزين خاص، شعار حالي واحد لكل فرع. صفحات الدخول والبوابات ونسخ الفواتير مش بتتغير.",
              )}
            </p>
            {photo && (
              <Button
                disabled={busy}
                type="button"
                onClick={async () => {
                  if (
                    !confirm(
                      L(
                        "Remove this branch logo permanently?",
                        "مسح شعار الفرع نهائياً؟",
                      ),
                    )
                  )
                    return;
                  setBusy(true);
                  setError("");
                  try {
                    await api(path, "DELETE");
                    revision.current++;
                    setPhoto(null);
                    setNotice(L("Branch logo removed", "تم مسح شعار الفرع"));
                    window.dispatchEvent(
                      new Event("elcenter-branch-logo-" + id),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {L("Remove branch logo", "مسح شعار الفرع")}
              </Button>
            )}
          </div>
        )}
      </div>
      {busy && <p role="status">{L("Saving logo...", "جاري حفظ الشعار...")}</p>}
      {notice && (
        <p role="status" className="mt-3 text-sm text-teal-700">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}

export function BranchLogo({
  api,
  id,
  ar,
}: {
  api: Api;
  id: string;
  ar: boolean;
}) {
  const [photo, setPhoto] = useState<any>(null);
  useEffect(() => {
    let active = true,
      revision = 0;
    async function load() {
      const ticket = ++revision;
      try {
        const r = await api("/branches/" + id + "/logo");
        if (active && ticket === revision) setPhoto(r.data);
      } catch {
        if (active && ticket === revision) setPhoto(null);
      }
    }
    void load();
    const event = "elcenter-branch-logo-" + id;
    window.addEventListener(event, load);
    return () => {
      active = false;
      window.removeEventListener(event, load);
    };
  }, [id]);
  return photo ? (
    <img
      alt={ar ? "شعار الفرع" : "Branch logo"}
      src={"data:" + photo.mime + ";base64," + photo.data}
      className="h-12 w-12 shrink-0 rounded-lg bg-white object-contain"
      onError={() => setPhoto(null)}
    />
  ) : null;
}
