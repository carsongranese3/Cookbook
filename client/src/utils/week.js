/**
 * Returns ISO dates for the Mon–Sun week containing the given date.
 * Today's date is compared using YYYY-MM-DD string.
 */
export function getCurrentWeekDates() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun … 6=Sat
  // We want Monday=0 offset
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(toISODate(d));
  }
  return dates;
}

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO() {
  return toISODate(new Date());
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function shortDayName(isoDate) {
  // isoDate = YYYY-MM-DD; day 0=Mon is index in week array
  const d = new Date(isoDate + 'T12:00:00');
  const dow = d.getDay(); // 0=Sun…6=Sat
  const idx = dow === 0 ? 6 : dow - 1;
  return DAY_NAMES[idx];
}

export function formatDayDate(isoDate) {
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
