// Runnable self-check for the semester day counter. No framework.
//   node scripts/semester.check.ts
import assert from "node:assert";
import { semesterFrom, remainingDays, countBy, totalDays } from "../src/lib/semester.ts";

// A miniature calendar in the shape the PDF parser produces. Classes run
// Mon–Sat; the rows below are the only days that are anything but ordinary.
const rows = [
	{ date: "2026-08-10", text: "Summer Last Teaching Day", category: "deadline", label: "" },
	{ date: "2026-08-17", text: "Start of classes for all students", category: "deadline", label: "" },
	{ date: "2026-08-18", text: "", category: "event", label: "" },
	{ date: "2026-08-19", text: "", category: "event", label: "" },
	{ date: "2026-08-20", text: "Raksha Bandhan", category: "holiday", label: "Restricted Holidays" },
	{ date: "2026-08-21", text: "Gandhi Jayanti", category: "holiday", label: "University Holidays" },
	{ date: "2026-08-22", text: "First Half Finishes", category: "deadline", label: "" },
	{ date: "2026-08-23", text: "", category: "event", label: "" }, // Sunday
	{ date: "2026-08-24", text: "Mid Term Examinations", category: "exam", label: "" },
	{ date: "2026-08-25", text: "Buffer day for class", category: "break", label: "" },
	{ date: "2026-08-26", text: "End Term Break/Buffer Day", category: "break", label: "" },
	{ date: "2026-08-27", text: "Last Teaching Day as per Tuesday Schedule", category: "deadline", label: "" },
	{ date: "2026-08-28", text: "End Term Examinations", category: "exam", label: "" }
];

const sem = semesterFrom(rows);

// the window is the calendar's own, not the whole file
assert.equal(sem.start, "2026-08-17");
assert.equal(sem.end, "2026-08-27");
assert.ok(!sem.days.some((d) => d.date < sem.start || d.date > sem.end));

// Mon 17, Tue 18, Wed 19, Thu 20 (restricted holiday, classes run),
// Sat 22, Tue 25 (buffer FOR class), Thu 27 (runs Tuesday's schedule)
assert.deepEqual(
	sem.days.map((d) => d.date),
	["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-22", "2026-08-25", "2026-08-27"]
);

// a University Holiday, a Sunday, an exam day and an end-term buffer are all out
for (const gone of ["2026-08-21", "2026-08-23", "2026-08-24", "2026-08-26", "2026-08-28"])
	assert.ok(!sem.days.some((d) => d.date === gone), gone);

// 27 Aug is a Thursday running Tuesday's timetable, so it counts as a Tuesday
assert.equal(sem.days.find((d) => d.date === "2026-08-27")!.weekday, 2);
assert.deepEqual(countBy(sem.days), { 1: 1, 2: 3, 3: 1, 4: 1, 5: 0, 6: 1 });
assert.equal(totalDays(countBy(sem.days)), 7);

const on = (iso: string) => {
	const [y, m, d] = iso.split("-").map(Number);
	return new Date(y, m - 1, d);
};

// day one: nothing has gone by yet
assert.deepEqual(remainingDays(sem, on("2026-08-17")), countBy(sem.days));

// today still counts — Monday the 17th is not yet spent
assert.equal(remainingDays(sem, on("2026-08-17"))[1], 1);
assert.equal(remainingDays(sem, on("2026-08-18"))[1], 0);

// the first half's end is read off the calendar, and a half-semester course
// stops counting there: from Tue 18, only Tue 18, Wed 19, Thu 20 and Sat 22 remain
assert.equal(sem.half, "2026-08-22");
assert.equal(totalDays(remainingDays(sem, on("2026-08-18"), sem.half)), 4);
// once that day has gone there's nothing left of a half-semester course at all
assert.equal(totalDays(remainingDays(sem, on("2026-08-25"), sem.half)), 0);
// a calendar that doesn't mark a first half has no cut-off to offer
assert.equal(semesterFrom(rows.filter((r) => r.date !== "2026-08-22")).half, "");

// Sunday the 23rd and Monday the 24th see the same past: nothing is held between
assert.deepEqual(remainingDays(sem, on("2026-08-23")), remainingDays(sem, on("2026-08-24")));

// a holiday still ahead of you is not a class you can attend: from Fri 21 on,
// only Sat 22, Tue 25 and Thu 27 are left
assert.equal(totalDays(remainingDays(sem, on("2026-08-21"))), 3);

// never goes negative, long after the semester ends
assert.equal(totalDays(remainingDays(sem, on("2027-06-01"))), 0);

// nothing to parse → an empty semester rather than a throw
const none = semesterFrom([]);
assert.deepEqual(none.days, []);
assert.equal(totalDays(remainingDays(none, on("2026-08-17"))), 0);

console.log("semester.check.ts OK");
