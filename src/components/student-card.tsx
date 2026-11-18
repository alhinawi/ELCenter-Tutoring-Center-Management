"use client";
import { useState, useRef } from "react";
import { Button } from "./ui";
type Row = Record<string, any>;
/** Isolated cloned card only, styled with the application's existing Tailwind sheet. */
async function printCard(card: HTMLElement) {
  const frame = document.createElement("iframe");
  frame.title = "ELCenter student card print";
  frame.className = "fixed start-0 top-0 h-px w-px opacity-0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    throw new Error("Print document unavailable");
  }
  doc.documentElement.lang = document.documentElement.lang;
  doc.documentElement.dir = document.documentElement.dir;
  const title = doc.createElement("title");
  title.textContent = "ELCenter student card";
  doc.head.appendChild(title);
  const loads: Promise<unknown>[] = [];
  document.head
    .querySelectorAll('link[rel="stylesheet"],style')
    .forEach((node) => {
      const copy = node.cloneNode(true) as HTMLElement;
      if (copy instanceof HTMLLinkElement && node instanceof HTMLLinkElement)
        copy.href = node.href;
      if (copy instanceof HTMLLinkElement)
        loads.push(
          new Promise<void>((resolve, reject) => {
            copy.onload = () => resolve();
            copy.onerror = () =>
              reject(new Error("Print styles could not load"));
          }),
        );
      doc.head.appendChild(copy);
    });
  doc.body.className = document.body.className + " bg-white text-slate-900";
  doc.body.appendChild(card.cloneNode(true));
  try {
    await Promise.race([
      Promise.all(loads),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Print styles timed out")), 10000),
      ),
    ]);
    await doc.fonts.ready;
    await Promise.all(Array.from(doc.images).map((img) => img.decode()));
    frame.contentWindow?.focus();
    frame.contentWindow?.addEventListener("afterprint", () => frame.remove(), {
      once: true,
    });
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60000);
  } catch (e) {
    frame.remove();
    throw e;
  }
}
export function StudentCard({ data, ar }: { data: Row; ar: boolean }) {
  const ref = useRef<HTMLElement>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    L = (e: string, a: string) => (ar ? a : e);
  return (
    <div className="grid gap-5">
      <section
        ref={ref}
        data-student-id-card
        className="mx-auto w-full max-w-sm break-inside-avoid rounded-2xl border border-slate-200 bg-white p-7 text-center text-slate-900 print:mx-0 print:mt-4"
      >
        <p className="text-2xl font-bold text-blue-700">ELCenter</p>
        <p className="mt-2 break-words text-sm font-semibold">
          {data.organization_name}
        </p>
        <p className="mt-1 break-words text-xs text-slate-500">
          {data.branch_name}
        </p>
        <h3 className="mt-5 break-words text-xl font-semibold">{data.name}</h3>
        <p className="mt-2 text-sm font-semibold text-slate-700" dir="ltr">
          {data.code}
        </p>
        <img
          src={data.src}
          alt={L("Student identification QR code", "كود QR لتعريف الطالب")}
          className="mx-auto my-4 h-40 w-40"
        />
        <p className="text-xs text-slate-500">
          {L("Recorded status", "الحالة المسجلة")}: {data.status}
        </p>
        <p className="mt-3 text-[10px] leading-5 text-slate-500">
          {L(
            "Identifier only, not proof of identity, active enrollment or access permission.",
            "معرّف بس، مش إثبات هوية أو تسجيل نشط أو صلاحية دخول.",
          )}
        </p>
        <p className="mt-2 text-[10px] text-slate-500" dir="ltr">
          {new Date(data.generated_at * 1000).toISOString()}
        </p>
      </section>
      <p className="text-xs leading-6 text-slate-500">
        {L(
          "Current record snapshot. Print only this card or save it as PDF from your browser. Keep physical copies private; changes or suspension do not recall printed copies.",
          "لقطة من السجل الحالي. اطبع الكارت بس أو احفظه PDF من المتصفح. حافظ على خصوصية النسخ؛ التعديل أو الإيقاف مش بيسحب النسخ المطبوعة.",
        )}
      </p>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            if (ref.current) await printCard(ref.current);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {L("Print student card / Save PDF", "طباعة كارت الطالب / حفظ PDF")}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
