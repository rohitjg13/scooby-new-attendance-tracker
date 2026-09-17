// Teaching days, counted off the academic calendar rather than typed in.
// The calendar PDF names the day classes start, the day they stop, and every
// holiday, exam and break in between, so the per-weekday totals are something
// we can derive — and they re-derive themselves when a newer PDF is dropped in.
//
// Building the list is server work (the PDF is parsed at build time); counting
// what's left of it is the browser's, since only the browser knows "today".

export const DAY_NAMES: Record<number, string> = {
	1: "Mon",
	2: "Tue",
	3: "Wed",
	4: "Thu",
	5: "Fri",
	6: "Sat"
};

export const WEEKDAYS = [1, 2, 3, 4, 5, 6];

/** One instructional day: the date, and whose timetable actually runs on it. */
export type TeachingDay = {
	/** ISO date, e.g. "2026-08-17" */
	date: string;
	/** Date#getDay() of the schedule being followed — usually the date's own
	 *  weekday, but a calendar can say "Last Teaching Day as per Tuesday
	 *  Schedule", and it's Tuesday's classes that are held. */
	weekday: number;
};

export type Semester = {
	/** first day of classes */
	start: string;
	/** last teaching day */
	end: string;
	/** the day the first half finishes — where a half-semester CCC stops; "" if the calendar doesn't say */
	half: string;
	days: TeachingDay[];
};

/** What the builder needs off each calendar row. */
type CalendarRow = { date: string; text: string; category: string; label: string };

const dow = (iso: string) => new Date(iso + "T00:00:00").getDay();
const SCHEDULE_OF = /as per (\w{3})\w*day/i;

/**
 * Classes are held on a day unless the calendar says otherwise. Exams, breaks
 * and Sundays are out; so are University Holidays, while Restricted Holidays
 * are working days here (the university stays open, the classes run). A buffer
 * day is out too, unless its own text says it's a buffer *for class*.
 */
function isTeaching(d: CalendarRow): boolean {
	if (dow(d.date) === 0) return false;
	if (d.category === "exam") return false;
	if (d.category === "holiday") return d.label !== "University Holidays";
	if (d.category === "break") return /buffer/i.test(d.text) && !/break/i.test(d.text);
	return true;
}

/**
 * Calendar rows → the semester's teaching days. The window runs from the day
 * classes start to the last teaching day; anything the calendar prints outside
 * that (the previous semester's tail, the exam fortnight, result dates) is not
 * a day you attend a class on.
 */
export function semesterFrom(rows: CalendarRow[]): Semester {
	const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
	const start = sorted.find((d) => /start of classes/i.test(d.text))?.date ?? sorted[0]?.date ?? "";
	const end = sorted.findLast((d) => /last teaching day/i.test(d.text))?.date ?? sorted.at(-1)?.date ?? "";
	const half = sorted.find((d) => /first half finishes/i.test(d.text))?.date ?? "";

	const days: TeachingDay[] = [];
	for (const d of sorted) {
		if (d.date < start || d.date > end || !isTeaching(d)) continue;
		const named = SCHEDULE_OF.exec(d.text)?.[1];
		const weekday = named
			? Object.entries(DAY_NAMES).find(([, n]) => n.toLowerCase() === named.toLowerCase())?.[0]
			: undefined;
		days.push({ date: d.date, weekday: weekday ? Number(weekday) : dow(d.date) });
	}
	return { start, end, half, days };
}

/** Per-weekday totals for the whole semester, however much of it is left. */
export const countBy = (days: TeachingDay[]): Record<number, number> => {
	const out: Record<number, number> = {};
	for (const d of WEEKDAYS) out[d] = 0;
	for (const d of days) if (out[d.weekday] !== undefined) out[d.weekday] += 1;
	return out;
};

/**
 * Weekdays still to come, today included — a class today hasn't happened yet.
 * Unlike subtracting elapsed weekdays from a fixed total, this drops a holiday
 * that's still ahead of you rather than counting it as a class you can attend.
 * `until` cuts the count off early, for a course that ends before the semester.
 */
export function remainingDays(
	sem: Semester,
	today = new Date(),
	until = ""
): Record<number, number> {
	const iso = today.toLocaleDateString("en-CA"); // local "today", not UTC
	return countBy(sem.days.filter((d) => d.date >= iso && (!until || d.date <= until)));
}

export const totalDays = (days: Record<number, number>) =>
	WEEKDAYS.reduce((n, d) => n + (days[d] ?? 0), 0);
