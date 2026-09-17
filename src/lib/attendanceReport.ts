// Parses the text you copy off SAMS → Reports → Course-wise Attendance View,
// and turns it into the Course shape the attendance calculator already works in.
//
// The paste looks like this, per course-section:
//   Course Code
//   17 Aug-1
//   19 Aug-1
//   CCC448 - LECCCF    P    P
// i.e. a block of date lines, then one row that starts with the course and
// section and carries one status per date, in order.

import { COMPONENTS, type Component, type ComponentType } from "./attendance.ts";
import { remainingDays, WEEKDAYS, type Semester } from "./semester.ts";

/** University-wide attendance waiver: everything up to here is credited. */
export const FORGIVE_UNTIL = "2026-09-07";

export type Status = "present" | "absent" | "leave" | "ignored";

export type Session = {
	/** as printed, e.g. "17 Aug-1" */
	raw: string;
	/** null when the row had more statuses than dates */
	date: Date | null;
	status: Status;
};

export type Row = {
	/** e.g. "ECE301" */
	code: string;
	/** e.g. "LECL1" */
	section: string;
	type: ComponentType;
	sessions: Session[];
};

// SAMS prints one letter per cell. "Manual Present" still means you were there;
// "Not Registered" is a class that was never yours, so it leaves the maths alone.
const STATUS: Record<string, Status> = {
	P: "present",
	MP: "present",
	A: "absent",
	L: "leave",
	N: "ignored",
	NR: "ignored"
};

const DATE_LINE = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s*-\s*\d+$/;
const ROW_LINE = /^([A-Za-z]{2,5}\d{2,4}[A-Za-z]?)\s*-\s*([A-Za-z0-9]+)\s+(.+)$/;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A section label like "LECL1" / "PRAP4" / "TUTT2" says which component it is. */
function componentOf(section: string): ComponentType {
	const s = section.toUpperCase();
	if (s.startsWith("TUT")) return "TUT";
	if (s.startsWith("PRA") || s.startsWith("PRC") || s.startsWith("LAB")) return "PRAC";
	return "LEC";
}

/**
 * "17 Aug-1" carries no year. The semester start gives it one: anything in a
 * month before the starting month has rolled over into the next year.
 */
function sessionDate(raw: string, start: string): Date | null {
	const m = DATE_LINE.exec(raw);
	if (!m) return null;
	const month = MONTHS.indexOf(m[2].toLowerCase());
	if (month < 0) return null;
	const [sy, sm] = start.split("-").map(Number);
	return new Date(month < sm - 1 ? sy + 1 : sy, month, Number(m[1]));
}

export function parseReport(text: string, start: string): Row[] {
	const rows: Row[] = [];
	let dates: string[] = [];

	for (const line of text.split(/\r?\n/).map((l) => l.trim())) {
		if (!line) continue;

		if (DATE_LINE.test(line)) {
			dates.push(line);
			continue;
		}

		const m = ROW_LINE.exec(line);
		const cells = m ? m[3].trim().split(/\s+/) : [];
		// A row only counts if every cell after the section is a status letter —
		// that's what separates it from the headings and the footer.
		if (!m || !cells.length || !cells.every((c) => c.toUpperCase() in STATUS)) {
			dates = []; // any other line ("Course Code", a heading) ends the block
			continue;
		}

		rows.push({
			code: m[1].toUpperCase(),
			section: m[2],
			type: componentOf(m[2]),
			sessions: cells.map((c, i) => ({
				raw: dates[i] ?? "",
				date: dates[i] ? sessionDate(dates[i], start) : null,
				status: STATUS[c.toUpperCase()]
			}))
		});
		dates = [];
	}

	return rows;
}

/** The weekdays this component has met on, read off its dates. */
export function weekdaysOf(sessions: Session[]): number[] {
	const days = new Set<number>();
	for (const s of sessions) if (s.date) days.add(s.date.getDay());
	return WEEKDAYS.filter((d) => days.has(d));
}

/**
 * Classes still to come: one per remaining occurrence of each weekday the
 * component meets on — the same sum the other calculator's day picker does.
 */
export const classesLeft = (days: number[], left: Record<number, number>) =>
	days.reduce((n, d) => n + (left[d] ?? 0), 0);

/**
 * Classes the calendar says were held before the report's first entry for this
 * component. The report only starts where the portal started recording, but
 * the course started when the semester did, so those sit in nobody's column.
 * They're inside the waiver window by definition of being early, so the waiver
 * credits them — and the cut-off keeps them from being invented for a course
 * that genuinely began later in the term.
 */
export function backfillCount(
	sessions: Session[],
	days: number[],
	sem: Semester,
	forgiveUntil: Date | null
): number {
	if (!days.length || !forgiveUntil) return 0;
	const first = sessions.map((s) => s.date).filter(Boolean) as Date[];
	if (!first.length) return 0;
	const earliest = new Date(Math.min(...first.map((d) => d.getTime()))).toLocaleDateString("en-CA");
	const until = forgiveUntil.toLocaleDateString("en-CA");

	return sem.days.filter(
		(d) => d.date < earliest && d.date <= until && days.includes(d.weekday)
	).length;
}

/** Absences on or before the waiver date are credited as attended. */
export function countSessions(sessions: Session[], forgiveUntil: Date | null) {
	let attended = 0;
	let missed = 0;
	let leaves = 0;
	let forgiven = 0;

	for (const s of sessions) {
		if (s.status === "ignored") continue;
		if (s.status === "leave") leaves += 1;
		else if (s.status === "present") attended += 1;
		else if (forgiveUntil && s.date && s.date <= forgiveUntil) {
			attended += 1;
			forgiven += 1;
		} else missed += 1;
	}
	return { attended, missed, leaves, forgiven };
}

/** A component plus the weekdays it meets on, which is what "left" is counted from. */
export type ParsedComponent = Component & {
	days: number[];
	/** classes the calendar says were held before the report's first entry */
	backfilled: number;
};

// Not `Course & {…}`: intersecting the two component arrays loses `days` when
// you map over them. This is structurally a Course, which is all stats() wants.
export type ParsedCourse = {
	id: string;
	name: string;
	components: ParsedComponent[];
	/** absences the waiver turned into attendance, for the "credited" line */
	forgiven: number;
	/** classes credited because they predate what the report shows at all */
	backfilled: number;
	sections: string[];
};

/** Rows → one card per course code, its sections folded into LEC/TUT/PRAC. */
export function toCourses(
	rows: Row[],
	forgiveUntil: Date | null,
	sem: Semester,
	backfill = true
): ParsedCourse[] {
	const left = remainingDays(sem);
	const byCode = new Map<string, Row[]>();
	for (const r of rows) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);

	return [...byCode].map(([code, rs]) => {
		const components: ParsedComponent[] = [];
		let forgiven = 0;
		let backfilled = 0;

		for (const type of COMPONENTS) {
			const mine = rs.filter((r) => r.type === type);
			if (!mine.length) continue;
			const sessions = mine.flatMap((r) => r.sessions);
			const c = countSessions(sessions, forgiveUntil);
			const days = weekdaysOf(sessions);
			const early = backfill ? backfillCount(sessions, days, sem, forgiveUntil) : 0;
			forgiven += c.forgiven;
			backfilled += early;
			components.push({
				type,
				attended: c.attended + early,
				missed: c.missed,
				leaves: c.leaves,
				days,
				backfilled: early,
				remaining: classesLeft(days, left),
				hrs: 1
			});
		}

		return {
			id: code,
			name: code,
			components,
			forgiven,
			backfilled,
			sections: rs.map((r) => r.section)
		};
	});
}

export const parseForgiveDate = (iso: string): Date | null => {
	if (!iso) return null;
	const [y, m, d] = iso.split("-").map(Number);
	// end of that day, so the cutoff date itself is included
	return y && m && d ? new Date(y, m - 1, d, 23, 59, 59) : null;
};
