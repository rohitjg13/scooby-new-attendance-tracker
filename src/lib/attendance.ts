// Pure attendance math. A course has up to three components (LEC / TUT / PRAC);
// attendance is judged on the course total, so the components are summed.
// You enter what you attended and what you missed — excused hours (menstrual or
// medical leave) go in their own bucket and count as neither, so they never
// reach the denominator.
// Counts are per class; each component carries how many hours a class is worth
// (hrs = 1 means you typed hours straight in), and the totals are in hours.

export const COMPONENTS = ["LEC", "TUT", "PRAC"] as const;
export type ComponentType = (typeof COMPONENTS)[number];

export type Component = {
	type: ComponentType;
	attended: number;
	/** missed and counted against you */
	missed: number;
	remaining: number;
	/** excused — counted as neither attended nor missed */
	leaves: number;
	/** hours each class of this component is worth (1 = you're entering hours directly) */
	hrs: number;
};

export type Course = {
	id: string;
	name: string;
	components: Component[];
};

export type Stats = {
	/** attended / (attended + missed), 0-100. null when nothing countable was held. */
	current: number | null;
	/** best you can still finish at, 0-100 */
	best: number;
	/** worst you can finish at (skip everything left), 0-100 */
	worst: number;
	/** how much of what's left you must attend to hit target */
	mustAttend: number;
	/** how much of it you can skip and stay at/above target */
	canSkip: number;
	/** target unreachable even attending everything left */
	impossible: boolean;
};

export function newCourse(name = ""): Course {
	return {
		id: crypto.randomUUID(),
		name,
		components: COMPONENTS.map((type) => ({
			type,
			attended: 0,
			missed: 0,
			remaining: 0,
			leaves: 0,
			hrs: 1
		}))
	};
}

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

/** Component (or course) totals → stats. Exported so the UI can show either. */
export function statsFor(
	attendedIn: number,
	missedIn: number,
	remainingIn: number,
	target = 75
): Stats {
	const attended = Math.max(0, attendedIn);
	const counted = attended + Math.max(0, missedIn);
	const remaining = Math.max(0, remainingIn);
	const total = counted + remaining;
	const p = target / 100;

	// smallest x with (attended + x) / total >= p
	const raw = Math.ceil(p * total - attended - 1e-9);

	return {
		current: counted > 0 ? pct(attended, counted) : null,
		best: total > 0 ? pct(attended + remaining, total) : 0,
		worst: total > 0 ? pct(attended, total) : 0,
		mustAttend: Math.min(Math.max(0, raw), remaining),
		canSkip: Math.max(0, remaining - Math.max(0, raw)),
		impossible: raw > remaining
	};
}

/** Everything in hours: a component's counts are weighted by its hours-per-class. */
export function courseTotals(c: Course) {
	return c.components.reduce(
		(t, k) => {
			const w = k.hrs > 0 ? k.hrs : 1;
			return {
				attended: t.attended + Math.max(0, k.attended) * w,
				missed: t.missed + Math.max(0, k.missed) * w,
				remaining: t.remaining + Math.max(0, k.remaining) * w,
				leaves: t.leaves + Math.max(0, k.leaves) * w
			};
		},
		{ attended: 0, missed: 0, remaining: 0, leaves: 0 }
	);
}

export function stats(c: Course, target = 75): Stats {
	const t = courseTotals(c);
	return statsFor(t.attended, t.missed, t.remaining, target);
}
