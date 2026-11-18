"use client";
import { useState } from "react";
import { Button, Card, Input, Select } from "./ui";
export default function Reception({
  api,
  ar,
  allowed,
  go,
}: {
  api: (p: string) => Promise<any>;
  ar: boolean;
  allowed: (r: string, a?: string) => boolean;
  go: (tab: string) => void;
}) {
  const L = (e: string, a: string) => (ar ? a : e),
    [type, setType] = useState(
      ["students", "guardians", "groups", "courses"].find((x) => allowed(x)) ||
        "",
    ),
    [data, setData] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Card className="mb-5 p-5">
      <h2 className="mb-4 font-semibold">
        {L("Front desk shortcuts", "اختصارات الاستقبال")}
      </h2>
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["students", L("Register / find student", "تسجيل / بحث طالب")],
          ["guardians", L("Guardians", "أولياء الأمور")],
          ["groups", L("Group availability", "المجموعات المتاحة")],
          ["finance", L("Collect payment", "تحصيل دفعة")],
          ["schedule", L("Attendance", "الحضور")],
        ]
          .filter(([key]) => allowed(key === "schedule" ? "sessions" : key))
          .map(([key, label]) => (
            <button
              key={key}
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-blue-700 dark:border-slate-700 dark:text-blue-300"
              onClick={() => go(key)}
            >
              {label}
            </button>
          ))}
      </div>
      {type && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const q = String(new FormData(e.currentTarget).get("q") || "");
              const r = await api(`/${type}?q=${encodeURIComponent(q)}`);
              setData(r.data);
              setError("");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Select
            aria-label={L("Lookup type", "نوع البحث")}
            className="sm:max-w-48"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setData([]);
            }}
          >
            {[
              ["students", L("Students", "الطلاب")],
              ["guardians", L("Guardians", "أولياء الأمور")],
              ["groups", L("Groups", "المجموعات")],
              ["courses", L("Courses", "الكورسات")],
            ]
              .filter(([key]) => allowed(key))
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </Select>
          <Input
            name="q"
            aria-label={L("Front desk search", "بحث الاستقبال")}
            placeholder={L("Name starts with…", "أول حروف الاسم…")}
            className="min-w-0 flex-1"
          />
          <Button disabled={busy}>{L("Find", "بحث")}</Button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error}
        </p>
      )}
      {data.map((r) => (
        <div
          key={r.id}
          className="mt-3 flex flex-wrap justify-between gap-2 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800"
        >
          <span className="font-semibold">
            {r.name} · {r.code}
          </span>
          <span>
            {r.phone || r.subject || ""}{" "}
            {type === "groups" && `${r.enrolled} / ${r.capacity}`}
          </span>
          <button
            className="text-blue-700 dark:text-blue-300"
            onClick={() => go(type)}
          >
            {L("Open module", "فتح القسم")}
          </button>
        </div>
      ))}
    </Card>
  );
}
