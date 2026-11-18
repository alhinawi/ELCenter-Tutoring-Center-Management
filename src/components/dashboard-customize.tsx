"use client";
import { useState } from "react";
import { Button, Card } from "./ui";
export function DashboardCustomize({
  api,
  data,
  reload,
  ar,
  labels,
}: {
  api: (p: string, m?: string, b?: unknown) => Promise<any>;
  data: any;
  reload: () => void;
  ar: boolean;
  labels: Record<string, string>;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [editing, setEditing] = useState(false),
    [widgets, setWidgets] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  async function save(reset = false) {
    setBusy(true);
    setError("");
    try {
      await api(
        "/dashboard/preferences",
        reset ? "DELETE" : "PUT",
        reset ? undefined : { widgets },
      );
      setEditing(false);
      setSaved(true);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            setWidgets(data.widgets);
            setEditing((v) => !v);
            setSaved(false);
            setError("");
          }}
          disabled={busy}
        >
          {L("Customize dashboard", "تخصيص لوحة المتابعة")}
        </Button>
        {saved && (
          <p role="status" className="text-sm text-teal-700">
            {L("Dashboard preferences saved", "اتحفظ تخصيص لوحة المتابعة")}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="my-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {editing && (
        <Card className="mt-4 p-5">
          <h2 className="font-semibold">
            {L("Your widget visibility and order", "إظهار وترتيب بطاقاتك")}
          </h2>
          <p className="my-3 text-xs text-slate-500">
            {L(
              "Saved to your membership only, across devices. This does not change permissions or hide data from the server. Empty selection is allowed.",
              "محفوظ لعضويتك بس على كل أجهزتك. ده مش بيغير الصلاحيات أو يخفي بيانات من الخادم. ممكن تخفي كل البطاقات.",
            )}
          </p>
          <div className="space-y-3">
            {[
              ...widgets,
              ...data.allowed_widgets.filter(
                (w: string) => !widgets.includes(w),
              ),
            ].map((w, i) => (
              <div
                key={w}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700"
              >
                <label className="flex min-w-40 flex-1 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={widgets.includes(w)}
                    disabled={busy}
                    onChange={(e) =>
                      setWidgets((v) =>
                        e.target.checked ? [...v, w] : v.filter((x) => x !== w),
                      )
                    }
                  />
                  {labels[w]}
                </label>
                <Button
                  disabled={busy || !widgets.includes(w) || i === 0}
                  aria-label={L("Move up: ", "لفوق: ") + labels[w]}
                  onClick={() =>
                    setWidgets((v) => {
                      const a = [...v];
                      [a[i - 1], a[i]] = [a[i], a[i - 1]];
                      return a;
                    })
                  }
                >
                  ↑
                </Button>
                <Button
                  disabled={
                    busy || !widgets.includes(w) || i >= widgets.length - 1
                  }
                  aria-label={L("Move down: ", "لتحت: ") + labels[w]}
                  onClick={() =>
                    setWidgets((v) => {
                      const a = [...v];
                      [a[i], a[i + 1]] = [a[i + 1], a[i]];
                      return a;
                    })
                  }
                >
                  ↓
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button disabled={busy} onClick={() => save()}>
              {L("Save dashboard", "حفظ لوحة المتابعة")}
            </Button>
            <Button disabled={busy} onClick={() => save(true)}>
              {L("Reset to defaults", "رجّع الافتراضي")}
            </Button>
            <Button disabled={busy} onClick={() => setEditing(false)}>
              {L("Cancel", "إلغاء")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
