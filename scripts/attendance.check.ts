// Runnable self-check for the attendance math. No framework.
//   node scripts/attendance.check.ts
import assert from "node:assert";
import { statsFor, stats, courseTotals, COMPONENTS, type Course } from "../src/lib/attendance.ts";

// --- single-bucket maths -------------------------------------------------
// nothing held yet
assert.equal(statsFor(0, 0, 0).current, null);

// 30 attended, 0 missed, nothing left
const done = statsFor(30, 0, 0);
assert.equal(done.current, 100);
assert.equal(done.canSkip, 0);
assert.equal(done.impossible, false);

// 20 attended / 10 missed (66.7%), 10 to come → need all 10
const tight = statsFor(20, 10, 10);
assert.equal(Math.round(tight.current! * 10) / 10, 66.7);
assert.equal(tight.mustAttend, 10);
assert.equal(tight.canSkip, 0);
assert.equal(tight.best, 75);
assert.equal(tight.impossible, false);

// same, only 5 to come → 0.75*35 = 26.25 > 25 attainable → unreachable
const lost = statsFor(20, 10, 5);
assert.equal(lost.impossible, true);
assert.equal(lost.mustAttend, 5);

// 40 attended / 0 missed, 20 to come → need 5, can skip 15
const rich = statsFor(40, 0, 20);
assert.equal(rich.mustAttend, 5);
assert.equal(rich.canSkip, 15);
assert.equal(rich.worst, (40 / 60) * 100);

// exact boundary, no rounding-up ghost class
assert.equal(statsFor(30, 10, 0).current, 75);
assert.equal(statsFor(30, 10, 0).mustAttend, 0);
assert.equal(statsFor(30, 10, 0).impossible, false);

// custom target
assert.equal(statsFor(0, 0, 10, 65).mustAttend, 7); // ceil(6.5)

// negatives are clamped, not propagated
assert.equal(statsFor(10, -5, 0).current, 100);

// --- components sum into the course, weighted by hours -------------------
const course: Course = {
	id: "x",
	name: "",
	components: [
		{ type: "LEC", attended: 20, missed: 2, remaining: 6, leaves: 2, hrs: 1 },
		{ type: "TUT", attended: 8, missed: 1, remaining: 2, leaves: 1, hrs: 1 },
		{ type: "PRAC", attended: 0, missed: 0, remaining: 0, leaves: 0, hrs: 1 }
	]
};
assert.deepEqual(courseTotals(course), { attended: 28, missed: 3, remaining: 8, leaves: 3 });
assert.deepEqual(stats(course), statsFor(28, 3, 8));

// excused hours never reach the denominator
const noLeave = { ...course, components: course.components.map((k) => ({ ...k, leaves: 0 })) };
assert.deepEqual(stats(noLeave), stats(course));

// hours per class: a 2-hour practical counts double
const weighted: Course = {
	id: "w",
	name: "",
	components: [
		{ type: "LEC", attended: 10, missed: 0, remaining: 0, leaves: 0, hrs: 1 },
		{ type: "TUT", attended: 0, missed: 0, remaining: 0, leaves: 0, hrs: 1 },
		{ type: "PRAC", attended: 3, missed: 2, remaining: 2, leaves: 1, hrs: 2 }
	]
};
assert.deepEqual(courseTotals(weighted), { attended: 16, missed: 4, remaining: 4, leaves: 2 });
assert.deepEqual(stats(weighted), statsFor(16, 4, 4));

// hrs 0 is treated as 1, never as "this component doesn't exist"
assert.equal(
	courseTotals({ ...weighted, components: weighted.components.map((k) => ({ ...k, hrs: 0 })) })
		.attended,
	13
);

assert.equal(COMPONENTS.length, 3);

console.log("attendance.check.ts OK");
