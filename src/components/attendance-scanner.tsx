"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Input } from "./ui";
export default function AttendanceScanner({
  onScan,
  ar,
}: {
  onScan: (value: string) => boolean;
  ar: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [value, setValue] = useState(""),
    [active, setActive] = useState(false),
    [message, setMessage] = useState("");
  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setActive(false);
  }
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  function scan(value: string) {
    const found = onScan(value.trim());
    setMessage(
      found
        ? ar
          ? "الطالب اتحدد حاضر. احفظ عشان تأكد."
          : "Student marked present. Save to confirm."
        : ar
          ? "الكود مش مؤهل في الحصة دي أو الحضور متسجل بالفعل. استخدم طلب التصحيح للسجلات المتسجلة."
          : "This code is not eligible here or attendance is already recorded. Use a correction request for recorded rows.",
    );
    if (found) {
      setValue("");
      stop();
    }
  }
  async function start() {
    try {
      const Detector = (window as any).BarcodeDetector;
      if (!Detector) {
        setMessage(
          ar
            ? "قراءة QR بالكاميرا مش متاحة في المتصفح ده. استخدم قارئ أكواد أو اكتب كود الطالب."
            : "Camera QR detection is not supported in this browser. Use a scanner or enter the student code.",
        );
        return;
      }
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      setActive(true);
      requestAnimationFrame(async () => {
        if (video.current) {
          video.current.srcObject = stream.current;
          await video.current.play();
          const detector = new Detector({ formats: ["qr_code"] });
          timer.current = setInterval(async () => {
            if (video.current?.readyState === 4)
              try {
                const values = await detector.detect(video.current);
                if (values[0]?.rawValue) scan(values[0].rawValue);
              } catch {
                stop();
                setMessage(
                  ar
                    ? "الكاميرا مش متاحة. استخدم كود الطالب."
                    : "Camera is unavailable. Use the student code.",
                );
              }
          }, 400);
        }
      });
    } catch {
      stop();
      setMessage(
        ar
          ? "تعذّر فتح الكاميرا. استخدم قارئ أكواد أو كود الطالب."
          : "Could not open the camera. Use a scanner or student code.",
      );
    }
  }
  return (
    <section className="mb-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h3 className="mb-3 text-sm font-semibold">
        {ar ? "مسح QR أو كارت الطالب" : "QR / student ID scanning"}
      </h3>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          scan(value);
        }}
      >
        <Input
          className="min-w-40 flex-1"
          aria-label={ar ? "كود الطالب أو QR" : "Student code or QR"}
          placeholder={
            ar ? "كود الطالب أو محتوى QR" : "Student code or QR payload"
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit">{ar ? "تحديد" : "Mark"}</Button>
        <Button
          type="button"
          className="bg-slate-700"
          onClick={active ? stop : start}
        >
          {active
            ? ar
              ? "قفل الكاميرا"
              : "Stop camera"
            : ar
              ? "فتح الكاميرا"
              : "Scan with camera"}
        </Button>
      </form>
      {active && (
        <video
          ref={video}
          playsInline
          muted
          className="mt-3 max-h-64 w-full rounded-xl bg-black"
        />
      )}
      {message && (
        <p role="status" className="mt-3 text-xs text-slate-500">
          {message}
        </p>
      )}
    </section>
  );
}
