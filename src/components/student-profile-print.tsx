"use client";
import { useRef, useState } from "react";
import { Button } from "./ui";
import { printIsolated } from "./student-card";
export function StudentProfilePrint({
  data,
  ar,
}: {
  data: Record<string, any>;
  ar: boolean;
}) {
  const ref = useRef<HTMLElement>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    L = (e: string, a: string) => (ar ? a : e);
  const fields = [
    ["code", L("Student code", "كود الطالب")],
    ["status", L("Recorded status", "الحالة المسجلة")],
    ["birth_date", L("Date of birth", "تاريخ الميلاد")],
    ["gender", L("Recorded gender", "النوع المسجل")],
    ["phone", L("Phone", "التليفون")],
    ["email", L("Email", "البريد")],
    ["address", L("Address", "العنوان")],
    ["school", L("School", "المدرسة")],
    ["grade", L("Grade", "الصف")],
    ["stage", L("Educational stage", "المرحلة التعليمية")],
    ["emergency_contact", L("Emergency contact", "تواصل الطوارئ")],
    ["created_at", L("Record created", "تاريخ إنشاء السجل")],
  ];
  return (
    <div className="space-y-5">
      <p className="text-xs leading-6 text-slate-500">
        {L(
          "Private current profile snapshot. Includes contact and emergency information. National ID, notes, guardians, photo, custom fields, academic history and finances are excluded. Keep printed/downloaded copies private. This is not a certified enrollment record.",
          "لقطة خاصة من ملف الطالب الحالي، فيها بيانات التواصل والطوارئ. مش بتشمل الرقم القومي أو الملاحظات أو أولياء الأمور أو الصورة أو الحقول الإضافية أو التاريخ الدراسي أو الحسابات. حافظ على خصوصية النسخ. ده مش إثبات قيد معتمد.",
        )}
      </p>
      <article
        ref={ref}
        data-student-profile-print
        className="bg-white p-5 text-slate-900"
      >
        <header className="border-b border-slate-200 pb-5">
          <p className="text-2xl font-bold text-blue-700">ELCenter</p>
          <p className="mt-2 text-sm">
            {data.organization_name} · {data.branch_name}
          </p>
          <h3 className="mt-4 break-words text-xl font-semibold">
            {data.name}
          </h3>
          <p className="mt-2 text-xs text-slate-500">
            {L("Private student profile", "ملف طالب خاص")}
          </p>
        </header>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          {fields.map(([k, label]) => (
            <div
              key={k}
              className="break-inside-avoid rounded-lg border border-slate-200 p-3"
            >
              <dt className="text-xs font-semibold text-slate-500">{label}</dt>
              <dd className="mt-2 whitespace-pre-wrap break-words text-sm">
                <bdi>{String(data[k] || L("Not recorded", "مش مسجل"))}</bdi>
              </dd>
            </div>
          ))}
        </dl>
        <footer className="mt-5 border-t border-slate-200 pt-4 text-xs text-slate-500">
          <p>
            {L(
              "Current record only. Printed copies are not recalled after updates.",
              "السجل الحالي بس. النسخ المطبوعة مش بتتسحب بعد التعديل.",
            )}
          </p>
          <p className="mt-2" dir="ltr">
            {new Date(data.generated_at * 1000).toISOString()}
          </p>
        </footer>
      </article>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            if (ref.current)
              await printIsolated(
                ref.current,
                "ELCenter private student profile",
              );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {L("Print profile / Save PDF", "طباعة الملف / حفظ PDF")}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
