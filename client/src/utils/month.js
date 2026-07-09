// Month-calendar helpers for the Meal Plan screen. Mirrors the local-date
// convention in week.js: dates are always built from local Y/M/D components
// (never toISOString()) and parsed back with 'T12:00:00' to dodge UTC drift.
import { toISODate } from './week.js';

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The calendar year/month (0-indexed) containing today. */
export function getCurrentYearMonth() {
  const today = new Date();
  return { year: today.getFullYear(), month: today.getMonth() };
}

/** Returns { year, month } shifted by `delta` months (can be negative), normalized. */
export function addMonths(year, month, delta) {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** "July 2026" */
export function getMonthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Mon-first grid of ISO dates covering the given month: the Monday on/before
 * the 1st through the Sunday on/after the last day (5 or 6 rows of 7),
 * ascending.
 */
export function getMonthGridDates(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);

  const firstDow = first.getDay(); // 0=Sun … 6=Sat
  const startOffset = firstDow === 0 ? -6 : 1 - firstDow;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() + startOffset);

  const lastDow = last.getDay();
  const endOffset = lastDow === 0 ? 0 : 7 - lastDow;
  const gridEnd = new Date(last);
  gridEnd.setDate(last.getDate() + endOffset);

  const dates = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    dates.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

/** Whether the ISO date falls within the given viewed year/month. */
export function isSameMonth(isoDate, year, month) {
  const d = new Date(isoDate + 'T12:00:00');
  return d.getFullYear() === year && d.getMonth() === month;
}

/** Day-of-month number, e.g. 7. */
export function dayNumber(isoDate) {
  const d = new Date(isoDate + 'T12:00:00');
  return d.getDate();
}

/** "Monday, July 7" — used as the day-sheet / add-meal title on phone. */
export function formatSheetDate(isoDate) {
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
