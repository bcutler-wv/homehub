import { useState, useEffect } from "react";

export const fmt = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(n);

export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar day something belongs to, in the viewer's timezone.
 *
 * This used to slice toISOString(), which is UTC: west of Greenwich every
 * evening rolled over early, so after 8pm New York time "today" was tomorrow —
 * the wrong day column was highlighted and completions were keyed a day ahead.
 * A bare YYYY-MM-DD is already a calendar day and is passed through, since
 * parsing it would reinterpret it as UTC midnight and shift it back again.
 */
export const dateKey = (date) => {
  if (typeof date === "string" && DATE_ONLY.test(date)) return date;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
};

export const getWeekDays = () => {
  const today = new Date();
  return Array.from({ length: 7 }).map((_, idx) => {
    const day = new Date(today);
    day.setDate(today.getDate() + idx);
    return {
      key: dateKey(day),
      label: day.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
      short: day.toLocaleDateString("en-US", { weekday: "short" }),
      isToday: idx === 0,
    };
  });
};

export const displayStatus = (inv) => {
  if (!inv.dueDate) return inv.status;
  return new Date(inv.dueDate) < new Date() && inv.status !== "paid" ? "overdue" : inv.status;
};

export const statusStyle = (s) =>
  ({
    paid: { bg: "#d1fae5", color: "#065f46", label: "Paid" },
    unpaid: { bg: "#fef3c7", color: "#92400e", label: "Unpaid" },
    overdue: { bg: "#fee2e2", color: "#991b1b", label: "Overdue" },
  }[s] || { bg: "#f3f4f6", color: "#374151", label: s });

export const useTodayKey = () => {
  const [today, setToday] = useState(() => dateKey(new Date()));
  useEffect(() => {
    const id = setInterval(() => {
      const k = dateKey(new Date());
      setToday(prev => prev === k ? prev : k);
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  return today;
};
