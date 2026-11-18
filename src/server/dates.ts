import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
/** Canonical date-only input, without JavaScript Date rollover or timezone conversion. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    Temporal.PlainDate.from(value, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
}
export const calendarDate = z
  .string()
  .refine(isCalendarDate, "Invalid calendar date; use YYYY-MM-DD");
