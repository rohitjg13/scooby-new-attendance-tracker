// Runnable self-check for the SAMS report parser.
//   node scripts/attendanceReport.check.ts
import assert from "node:assert";
import {
	parseReport,
	toCourses,
	countSessions,
	weekdaysOf,
	classesLeft,
	backfillCount,
	parseForgiveDate,
	FORGIVE_UNTIL
} from "../src/lib/attendanceReport.ts";
import { stats } from "../src/lib/attendance.ts";
import { semesterFrom, type Semester } from "../src/lib/semester.ts";

const PASTE = `Shiv Nadar (Institution of Eminence Deemed To Be University)
Mark Attendance
Reports 
Condonement
Admit Card
Student Attendance Recording System
 ROHIT JG
Course-wise Attendance View

        Present            Manual Present            Absent            Leave            Not Registered
Course Code    
17 Aug-1
19 Aug-1
24 Aug-1
26 Aug-1
31 Aug-1
02 Sep-1
07 Sep-1
09 Sep-1
CCC448 - LECCCF    P    P    P    P    P    P    A    P
Course Code    
18 Aug-1
20 Aug-1
25 Aug-1
27 Aug-1
01 Sep-1
03 Sep-1
08 Sep-1
10 Sep-1
ECE301 - LECL1    A    P    P    P    P    A    P    A
Course Code    
21 Aug-1
28 Aug-1
11 Sep-1
ECE301 - PRAP4    P    P    P
Course Code    
26 Aug-1
02 Sep-1
09 Sep-1
ECE302 - PRAP1    P    P    P

Please Note: The report only displays status of attendance where SAMS application is used
© 2026 by Shiv Nadar (Institution of Eminence Deemed To Be University).`;

// The real Monsoon 2026 window, trimmed to the stretch these asserts touch.
const sem: Semester = semesterFrom([
	{ date: "2026-08-17", text: "Start of classes for all students", category: "deadline", label: "" },
	...Array.from({ length: 40 }, (_, i) => {
		const d = new Date(2026, 7, 18 + i);
		return { date: d.toLocaleDateString("en-CA"), text: "", category: "event", label: "" };
	}),
	{ date: "2026-09-26", text: "Last Teaching Day", category: "deadline", label: "" }
]);

const rows = parseReport(PASTE, "2026-08-17");
assert.equal(rows.length, 4);
assert.deepEqual(
	rows.map((r) => `${r.code}/${r.section}/${r.type}`),
	["CCC448/LECCCF/LEC", "ECE301/LECL1/LEC", "ECE301/PRAP4/PRAC", "ECE302/PRAP1/PRAC"]
);

// dates line up with statuses, in order
assert.equal(rows[0].sessions.length, 8);
assert.equal(rows[0].sessions[6].raw, "07 Sep-1");
assert.equal(rows[0].sessions[6].status, "absent");
assert.equal(rows[0].sessions[0].date!.getFullYear(), 2026);
assert.equal(rows[0].sessions[0].date!.getMonth(), 7); // August
assert.equal(rows[0].sessions[0].date!.getDate(), 17);

// headings and the footer are not rows
assert.ok(!rows.some((r) => r.section.includes("Note")));

// --- the waiver ----------------------------------------------------------
const cutoff = parseForgiveDate(FORGIVE_UNTIL);

// CCC448: the only A is 07 Sep, which the waiver covers → 8/8
const ccc = countSessions(rows[0].sessions, cutoff);
assert.deepEqual([ccc.attended, ccc.missed, ccc.forgiven], [8, 0, 1]);

// without it, that A counts
const rawCcc = countSessions(rows[0].sessions, null);
assert.deepEqual([rawCcc.attended, rawCcc.missed, rawCcc.forgiven], [7, 1, 0]);

// ECE301 LEC: A on 18 Aug and 03 Sep forgiven, A on 10 Sep is not
const lec = countSessions(rows[1].sessions, cutoff);
assert.deepEqual([lec.attended, lec.missed, lec.forgiven], [7, 1, 2]);

// --- which weekdays, and how many are left --------------------------------
// ECE301 LECL1 sits on Tuesdays and Thursdays, PRAP4 on Fridays
assert.deepEqual(weekdaysOf(rows[1].sessions), [2, 4]);
assert.deepEqual(weekdaysOf(rows[2].sessions), [5]);
// one class per remaining occurrence of each of those days
assert.equal(classesLeft([2, 4], { 1: 0, 2: 9, 3: 0, 4: 10, 5: 0, 6: 0 }), 19);
assert.equal(classesLeft([5], { 1: 9, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }), 0);
assert.equal(classesLeft([], { 1: 9, 2: 9, 3: 9, 4: 9, 5: 9, 6: 9 }), 0);

// --- folded into courses -------------------------------------------------
// --- classes held before the report even starts ---------------------------
// ECE301's practical is a Friday class whose report begins on 21 Aug, the first
// Friday of term, so there is nothing earlier to credit.
assert.equal(backfillCount(rows[2].sessions, [5], sem, cutoff), 0);

// A Monday class whose report only starts on 7 Sep missed 17/24/31 Aug
const lateMonday = [{ raw: "07 Sep-1", date: new Date(2026, 8, 7), status: "present" as const }];
assert.equal(backfillCount(lateMonday, [1], sem, cutoff), 3);

// without a waiver there is nothing to credit them under
assert.equal(backfillCount(lateMonday, [1], sem, null), 0);
// and a component with no days picked can't have missed anything
assert.equal(backfillCount(lateMonday, [], sem, cutoff), 0);

const courses = toCourses(rows, cutoff, sem, false);
assert.deepEqual(courses.map((c) => c.name), ["CCC448", "ECE301", "ECE302"]);

const ece301 = courses[1];
assert.deepEqual(ece301.components.map((c) => c.type), ["LEC", "PRAC"]);
assert.deepEqual(ece301.components.map((c) => c.days), [[2, 4], [5]]);
assert.equal(ece301.forgiven, 2);
// 7 + 3 attended out of 11 counted
assert.equal(Math.round(stats(ece301).current! * 10) / 10, 90.9);

// the back-fill is off above; on, ECE301's lecture picks up nothing (its report
// starts on the term's first Tuesday) and the total is unchanged
const filled = toCourses(rows, cutoff, sem, true);
assert.equal(filled[1].backfilled, 0);
assert.equal(filled[1].components[0].attended, ece301.components[0].attended);

// nothing to parse → nothing back
assert.deepEqual(parseReport("just some text\nCourse Code", "2026-08-17"), []);

console.log("attendanceReport: ok");
