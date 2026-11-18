"use client";
import { preparePrivateImage } from "./private-image";
import { useEffect, useState } from "react";
import { Button, Input, Field } from "./ui";
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
type Props = {
  api: Api;
  entity: string;
  id: string;
  ar: boolean;
  editable?: boolean;
};
export function ProfilePhoto(props: Props) {
  return <Photo key={props.entity + ":" + props.id} {...props} />;
}
function Photo({ api, entity, id, ar, editable = false }: Props) {
  const L = (e: string, a: string) => (ar ? a : e),
    [photo, setPhoto] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const path = "/profile-photos/" + entity + "/" + id;
  async function load() {
    setPhoto(
      (await api(path.replace("/profile-photos/", "/portal/profile-photos/")))
        .data,
    );
  }
  useEffect(() => {
    let active = true;
    api(path.replace("/profile-photos/", "/portal/profile-photos/"))
      .then((r) => {
        if (active) setPhoto(r.data);
      })
      .catch((e) => {
        if (active) setError(e.message);
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
      setNotice(L("Profile photo saved", "تم حفظ صورة الملف"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h3 className="font-semibold">
        {L("Private profile photo", "صورة الملف الخاصة")}
      </h3>
      <div className="mt-3 flex flex-wrap items-start gap-4">
        {photo ? (
          <img
            src={"data:" + photo.mime + ";base64," + photo.data}
            alt={L("Saved profile photo", "صورة الملف المحفوظة")}
            className="h-28 w-28 rounded-xl object-cover"
            onError={() =>
              setError(
                L(
                  "Saved photo could not be displayed.",
                  "تعذر عرض الصورة المحفوظة.",
                ),
              )
            }
          />
        ) : (
          <div className="flex h-28 w-28 items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-500 dark:bg-slate-800">
            {L("No photo", "مفيش صورة")}
          </div>
        )}
        {editable && (
          <div className="grid max-w-md gap-3">
            <Field label={L("Choose profile photo", "اختار صورة الملف")}>
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
                "Resized to at most 384 pixels, converted to JPEG up to 32 KiB. This removes original file metadata and flattens transparency to white. Replaces the current photo without history. Private storage, 100 profiles per organization.",
                "بتتصغر لحد 384 بكسل وتتحول JPEG لحد 32 كيلوبايت. ده بيشيل بيانات الملف الأصلي وبيحوّل الشفافية لأبيض. بتستبدل الصورة الحالية من غير سجل نسخ. تخزين خاص، لحد 100 ملف في المؤسسة.",
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
                        "Remove this profile photo permanently?",
                        "مسح صورة الملف نهائياً؟",
                      ),
                    )
                  )
                    return;
                  setBusy(true);
                  setError("");
                  try {
                    await api(path, "DELETE");
                    setPhoto(null);
                    setNotice(L("Photo removed", "تم مسح الصورة"));
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {L("Remove profile photo", "مسح صورة الملف")}
              </Button>
            )}
          </div>
        )}
      </div>
      {busy && (
        <p role="status">{L("Saving photo...", "جاري حفظ الصورة...")}</p>
      )}
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
