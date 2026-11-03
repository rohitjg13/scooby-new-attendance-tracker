<script lang="ts">
	import { COMPONENTS, stats, statsFor, type ComponentType } from "$lib/attendance";
	import {
		parseReport,
		toCourses,
		classesLeft,
		nextDay,
		parseForgiveDate,
		FORGIVE_UNTIL,
		type ParsedCourse,
		type ParsedComponent
	} from "$lib/attendanceReport";
	import { remainingDays, totalDays, withoutDays, WEEKDAYS, DAY_NAMES } from "$lib/semester";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const KEY = "attendance.hours";
	const HALF_KEY = "attendance.halfSem";
	const APPROVED_KEY = "attendance.approved";
	const OLD_KEY = "attendance.v2";
	const DEFAULT_TARGET = 70;
	const PRESETS = [70, 45, 65];

	/** ISO dates are for storing, DD/MM/YYYY is for reading */
	const dmy = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
	// "2026-09-15" → "15th September"
	const longDate = (iso: string) => {
		const d = new Date(iso + "T00:00:00");
		const n = d.getDate();
		const th = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
		return `${n}${th} ${d.toLocaleDateString("en-GB", { month: "long" })}`;
	};

	/** DD/MM/YYYY back to ISO; "" for anything half-typed or impossible */
	function isoOf(text: string): string {
		const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
		if (!m) return "";
		const [d, mo, y] = m.slice(1).map(Number);
		if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
		return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
	}

	let raw = $state("");
	let target = $state(DEFAULT_TARGET);
	// The native date input renders in the browser's locale, which can't be set
	// from here, so the waiver date is a plain DD/MM/YYYY field instead.
	let waiver = $state(dmy(FORGIVE_UNTIL));
	/** "ECE301/LEC" → the weekdays you picked, overriding what the report showed */
	let picks = $state<Record<string, number[]>>({});
	/** course code → which components its card shows, once you've added or removed one */
	let shape = $state<Record<string, ComponentType[]>>({});
	/** "ECE301/PRAC" → how many hours one of its classes runs for */
	let hours = $state<Record<string, number>>({});
	/** "ECE301/LEC/attended" → what you typed over the report's own count */
	let counts = $state<Record<string, number>>({});
	/** credit the classes held before the report's first entry */
	let backfill = $state(true);
	/** which pickers you've opened or closed by hand; the rest follow hasHrs */
	let opened = $state<Record<string, boolean>>({});
	/** CCC course code → runs only the first half of the semester */
	let halfSem = $state<Record<string, boolean>>({});
	/** ISO date → why it's approved ("SWAYAM exam"); a day you were officially away,
	 *  so its classes count as neither attended nor missed. The note can be blank. */
	let approved = $state<Record<string, string>>({});
	const approvedDates = $derived(Object.keys(approved).sort());
	// the calendar with approved days struck off: nothing left to attend on them
	const sem = $derived(withoutDays(data.semester, approvedDates));

	// re-read the clock on every paste, so a tab left open overnight doesn't
	// count from yesterday (toCourses' heldToday already re-reads it per paste)
	const today = $derived.by(() => {
		void raw;
		return new Date();
	});
	const left = $derived(remainingDays(sem, today));
	// a first-half CCC stops where the calendar says the first half finishes;
	// a second-half one has already started past that, so it runs to the end
	const leftHalf = $derived(remainingDays(sem, today, data.semester.half));
	// a component whose report already has today's class counts from tomorrow
	const leftAfter = $derived(remainingDays(sem, nextDay(today)));
	const leftHalfAfter = $derived(remainingDays(sem, nextDay(today), data.semester.half));
	const isCcc = (id: string) => id.startsWith("CCC") && data.semester.half !== "";
	const leftFor = (c: ParsedCourse, held = false) =>
		isCcc(c.id) && halfSem[c.id] && !c.secondHalf
			? held ? leftHalfAfter : leftHalf
			: held ? leftAfter : left;
	const key = (id: string, type: ComponentType) => `${id}/${type}`;
	const HOURS = [1, 1.5, 2, 2.5, 3];
	const COUNTS = ["attended", "missed", "leaves", "remaining"] as const;
	type CountField = (typeof COUNTS)[number];
	// Until you say how long a class runs, there's no honest course total to show:
	// one hour per class is a guess, and a two-hour lecture makes it a wrong one.
	// A practical always counts as one hour, so there's nothing to ask about it.
	const hasHrs = (id: string, type: ComponentType) => type === "PRAC" || key(id, type) in hours;
	const ready = (c: ParsedCourse) => c.components.every((k) => hasHrs(c.id, k.type));

	// Closed until you open it. Has to be remembered rather than derived, or every
	// keystroke inside would spring it back.
	const isOpen = (id: string, type: ComponentType) => opened[key(id, type)] ?? false;

	// Only class hours, the half-semester CCC choice and approved days outlive a
	// reload; the report and everything else stay in memory. Hours and half-sem
	// go the moment the report text changes. Approved days don't: they're about
	// you, not the report, so a fresh paste tomorrow still needs them.
	function load(k: string) {
		try {
			const v = JSON.parse(localStorage.getItem(k) ?? "null");
			return v && typeof v === "object" ? v : null;
		} catch {
			return null; // corrupt blob, start clean
		}
	}

	function save(k: string, v: Record<string, unknown>) {
		if (Object.keys(v).length) localStorage.setItem(k, JSON.stringify(v));
		else localStorage.removeItem(k);
	}

	$effect(() => {
		localStorage.removeItem(OLD_KEY); // older builds saved the whole page
		hours = load(KEY) ?? {};
		halfSem = load(HALF_KEY) ?? {};
		approved = load(APPROVED_KEY) ?? {};
	});

	$effect(() => save(KEY, hours));
	$effect(() => save(HALF_KEY, halfSem));
	$effect(() => save(APPROVED_KEY, approved));

	const forgiveUntil = $derived(isoOf(waiver));
	const rows = $derived(parseReport(raw, data.semester.start));
	const parsed = $derived(
		toCourses(rows, parseForgiveDate(forgiveUntil), sem, backfill, new Set(approvedDates))
	);
	// The report is the starting point: which components a course has, and which
	// weekdays each meets on. Both are yours to change — a tutorial the report
	// doesn't track, a practical you don't have. "Left" follows from the days.
	const courses: ParsedCourse[] = $derived(
		parsed.map((c) => {
			const parsedComps = new Map(c.components.map((k) => [k.type, k]));
			const types = shape[c.id] ?? c.components.map((k) => k.type);
			return {
				...c,
				components: COMPONENTS.filter((t) => types.includes(t)).map((t) => {
					const base: ParsedComponent = parsedComps.get(t) ?? {
						type: t,
						attended: 0,
						missed: 0,
						leaves: 0,
						remaining: 0,
						hrs: 1,
						days: [],
						backfilled: 0,
						heldToday: false
					};
					const days = picks[key(c.id, t)] ?? base.days;
					return {
						...base,
						days,
						attended: counts[`${key(c.id, t)}/attended`] ?? base.attended,
						missed: counts[`${key(c.id, t)}/missed`] ?? base.missed,
						leaves: counts[`${key(c.id, t)}/leaves`] ?? base.leaves,
						hrs: t === "PRAC" ? 1 : (hours[key(c.id, t)] ?? base.hrs),
						remaining:
							counts[`${key(c.id, t)}/remaining`] ?? classesLeft(days, leftFor(c, base.heldToday))
					};
				})
			};
		})
	);

	const forgiven = $derived(courses.reduce((n, c) => n + c.forgiven, 0));
	const filled = $derived(courses.reduce((n, c) => n + c.backfilled, 0));
	const set = $derived(courses.filter(ready));
	const below = $derived(
		set.filter((c) => {
			const s = stats(c, target);
			return s.current !== null && s.current < target;
		}).length
	);

	const fmt = (n: number) => n.toFixed(1);

	function toggleDay(id: string, type: ComponentType, days: number[], d: number) {
		picks = {
			...picks,
			[key(id, type)]: days.includes(d)
				? days.filter((x) => x !== d)
				: WEEKDAYS.filter((x) => x === d || days.includes(x))
		};
		// the days are back in charge of "Left" now
		const { [`${key(id, type)}/remaining`]: _, ...rest } = counts;
		counts = rest;
	}

	function toggleHalf(c: ParsedCourse) {
		halfSem = { ...halfSem, [c.id]: !halfSem[c.id] };
		// a typed-over "Left" was for the other length of course; the calendar takes it back
		const out = { ...counts };
		for (const k of c.components) delete out[`${key(c.id, k.type)}/remaining`];
		counts = out;
	}

	const setTypes = (c: ParsedCourse, types: ComponentType[]) =>
		(shape = { ...shape, [c.id]: types });

	const setHrs = (id: string, type: ComponentType, v: number) =>
		(hours = { ...hours, [key(id, type)]: Math.max(0, v || 0) });


	const setCount = (id: string, type: ComponentType, field: CountField, v: number) =>
		(counts = { ...counts, [`${key(id, type)}/${field}`]: Math.max(0, v || 0) });

	const edited = (id: string, type: ComponentType) =>
		COUNTS.some((f) => `${key(id, type)}/${f}` in counts);

	/** forget the report and everything set up on top of it, saved hours and half-sem picks included */
	function clearAll() {
		raw = "";
		picks = {};
		shape = {};
		hours = {};
		counts = {};
		opened = {};
		halfSem = {};
		backfill = true;
	}

	/** a changed report is a new report: nothing set up for the old one carries over */
	function setRaw(text: string) {
		if (raw && text !== raw) clearAll();
		raw = text;
	}

	/** back to whatever the report itself said */
	function resetCounts(id: string, type: ComponentType) {
		const out = { ...counts };
		for (const f of COUNTS) delete out[`${key(id, type)}/${f}`];
		counts = out;
	}

	// --- approved days -------------------------------------------------------
	const pad = (n: number) => String(n).padStart(2, "0");
	const isoDay = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
	/** teaching day → the weekday whose timetable runs on it */
	const teaching = $derived(new Map(data.semester.days.map((d) => [d.date, d.weekday])));
	// The semester's months, carried on to December so the whole term is pickable.
	const calMonths = $derived.by(() => {
		if (!data.semester.start) return [];
		const [sy, sm] = data.semester.start.split("-").map(Number);
		const [ey, em] = (data.semester.end || data.semester.start).split("-").map(Number);
		const from = sy * 12 + sm - 1;
		const to = Math.max(ey * 12 + em - 1, sy * 12 + 11);
		return Array.from({ length: to - from + 1 }, (_, i) => ({
			y: Math.floor((from + i) / 12),
			m: (from + i) % 12
		}));
	});
	/** a month's date cells, Monday first; null is a blank before the 1st */
	function monthCells(y: number, m: number): (string | null)[] {
		const lead = (new Date(y, m, 1).getDay() + 6) % 7;
		const n = new Date(y, m + 1, 0).getDate();
		return [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => isoDay(y, m, i + 1))];
	}
	const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
	const shortDate = (iso: string) =>
		new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
			weekday: "short",
			day: "numeric",
			month: "short"
		});

	let calDialog = $state<HTMLDialogElement>();
	let calAt = $state(0);
	const todayIso = $derived(today.toLocaleDateString("en-CA"));

	function openCal() {
		// start on this month, or the one holding the latest approved day you'd be editing
		const at = (iso: string) =>
			calMonths.findIndex((c) => isoDay(c.y, c.m, 1).slice(0, 7) === iso.slice(0, 7));
		const here = at(todayIso);
		calAt = here >= 0 ? here : Math.max(0, at(approvedDates.at(-1) ?? ""));
		calDialog?.showModal();
	}

	function toggleApproved(iso: string) {
		if (iso in approved) {
			const { [iso]: _, ...rest } = approved;
			approved = rest;
		} else approved = { ...approved, [iso]: "" };
	}

	const setNote = (iso: string, note: string) => (approved = { ...approved, [iso]: note });
</script>

<svelte:head>
	<title>Attendance Tracker</title>
	<meta
		name="description"
		content="Paste your SAMS course-wise attendance report and get every course's percentage, with the attendance waiver up to 7 September already applied."
	/>
</svelte:head>

<main class="att">
	<header class="att-head">
		<h1>Attendance Tracker</h1>
		<p class="sub">
			Paste your course-wise attendance report and it reads every course off it.
			Absences up to the waiver date are credited back to you, which the portal
			hasn't done yet.
		</p>
	</header>

	<section class="paste">
		<p class="howto">
			<a href="https://snulinks.snu.edu.in/" target="_blank" rel="noopener">SNU Links</a>
			→ Student Attendance Recording → Reports → <b>Course-wise Attendance View</b>.
			Select the whole page, copy, and paste it here. Nothing leaves your browser.
			<a href="/guide">See how, step by step →</a>
		</p>

		<textarea
			class="input src"
			rows={rows.length ? 3 : 8}
			spellcheck="false"
			placeholder={"Course Code\n17 Aug-1\n19 Aug-1\nCCC448 - LECCCF    P    A"}
			value={raw}
			oninput={(e) => setRaw(e.currentTarget.value)}
		></textarea>

		<div class="paste-foot">
			{#if raw && !rows.length}
				<span class="miss">
					No course rows in that. Copy the whole report page, not just a selection.
				</span>
			{/if}
			{#if raw}
				<button class="btn btn-sm" onclick={clearAll}>
					Clear
				</button>
			{/if}
		</div>
	</section>

	<div class="bar">
		<span class="bar-group">
			<label for="target">Target</label>
			<input
				id="target"
				class="input target-input"
				type="number"
				min="1"
				max="100"
				bind:value={target}
			/>
			<span class="pcnt">%</span>
			{#each PRESETS as preset}
				<button
					class="btn btn-sm"
					class:on={target === preset}
					onclick={() => (target = preset)}>{preset}</button
				>
			{/each}
		</span>

		<span class="bar-sep"></span>

		<span class="bar-group">
			<label for="waiver">Waiver up to</label>
			<input
				id="waiver"
				class="input date-input"
				class:bad-date={waiver.trim() !== "" && !forgiveUntil}
				type="text"
				inputmode="numeric"
				placeholder="DD/MM/YYYY"
				bind:value={waiver}
			/>
			{#if waiver}
				<button class="btn btn-sm" onclick={() => (waiver = "")}>Off</button>
			{:else}
				<button class="btn btn-sm" onclick={() => (waiver = dmy(FORGIVE_UNTIL))}>
					{dmy(FORGIVE_UNTIL)}
				</button>
			{/if}
		</span>

		<span class="bar-sep"></span>

		<span class="bar-group">
			<span class="bar-label">Approved days</span>
			<button
				class="btn btn-sm"
				class:has={approvedDates.length > 0}
				onclick={openCal}
				title="Days you were officially away, like a SWAYAM exam. Their classes count as neither attended nor missed"
			>
				{approvedDates.length
					? `${approvedDates.length} day${approvedDates.length === 1 ? "" : "s"}`
					: "+ Add"}
			</button>
		</span>

		{#if waiver}
			<span class="bar-sep"></span>
			<label class="bar-group check">
				<input type="checkbox" bind:checked={backfill} />
				Credit classes before the report starts
			</label>
		{/if}
	</div>

	{#if courses.length}
		{@const waiting = courses.length - set.length}
		<section class="tally" class:waiting={waiting > 0}>
			{#if waiting}
				<span class="tally-n">{waiting}</span>
				<span class="tally-label">
					<span>course{waiting === 1 ? "" : "s"} still need an <b>Hour / class</b></span>
					<span class="tally-sub">
						A two-hour lecture weighs twice what a one-hour one does, so a course total
						waits for that number rather than assuming one hour and getting it wrong.
					</span>
				</span>
			{:else}
				<span class="tally-n">
					{set.length - below}<span class="tally-of">/{set.length}</span>
				</span>
				<span class="tally-label">
					courses at or above {target}%
					<span class="tally-sub">
						{forgiven} absence{forgiven === 1 ? "" : "s"} credited{#if filled}, {filled} class{filled ===
							1
								? ""
								: "es"} added before the report starts{/if}{#if approvedDates.length}, {approvedDates.length}
							approved day{approvedDates.length === 1 ? "" : "s"} excused{/if} ·
						{totalDays(left)} teaching days left of {dmy(data.semester.start)} – {dmy(
							data.semester.end
						)}
					</span>
				</span>
			{/if}
		</section>
	{/if}

	<div class="cards">
		{#each courses as course (course.id)}
			{@const s = stats(course, target)}
			{@const ok = ready(course)}
			<section class="card">
				<div class="card-head">
					<h2 class="name">{course.name}</h2>
					<span class="sections">{course.sections.join(" · ")}</span>
					{#if isCcc(course.id)}
						<label
							class="check half"
							title="Counts only up to {dmy(data.semester.half)}, when the first half finishes"
						>
							<input
								type="checkbox"
								checked={!!halfSem[course.id]}
								onchange={() => toggleHalf(course)}
							/>
							Half-sem CCC
						</label>
					{/if}
				</div>

				{#if course.lateStart}
					<p class="late">
						You got enrolled into this course on <b>{longDate(course.lateStart)}</b>, which is
						after the waiver date. Currently attendance is being counted from
						<b>{longDate(data.semester.start)}</b> to <b>{longDate(forgiveUntil)}</b>, and then from
						<b>{longDate(course.lateStart)}</b> onwards. Since the accommodation for such cases is
						yet to be finalised, we are considering the worst case, so that you'll be
						unaffected either way.
					</p>
				{/if}

				<div class="grid grid-head">
					<span></span>
					<span>Attended</span>
					<span>Missed</span>
					<span>Left</span>
					<span title="Leave — doesn't count against you">Leave</span>
					<span title="How long one class of this component runs">Hour / class</span>
					<span class="col-pct">Now</span>
				</div>

				{#each course.components as comp (comp.type)}
					{@const cs = statsFor(comp.attended, comp.missed, comp.remaining, target)}
					{@const hrsSet = hasHrs(course.id, comp.type)}
					<div class="grid">
						<span class="ctype">{comp.type}</span>
						<label class="cell">
							<span class="m-label">Attended</span>
							<input
								class="input n"
								type="number"
								min="0"
								value={comp.attended}
								oninput={(e) => setCount(course.id, comp.type, "attended", +e.currentTarget.value)}
							/>
						</label>
						<label class="cell" class:miss={comp.missed > 0}>
							<span class="m-label">Missed</span>
							<input
								class="input n"
								type="number"
								min="0"
								value={comp.missed}
								oninput={(e) => setCount(course.id, comp.type, "missed", +e.currentTarget.value)}
							/>
						</label>
						<label class="cell">
							<span class="m-label">Left</span>
							<input
								class="input n"
								type="number"
								min="0"
								title="Counted off the days below — type over it if that's not the pattern"
								value={comp.remaining}
								oninput={(e) => setCount(course.id, comp.type, "remaining", +e.currentTarget.value)}
							/>
						</label>
						<label class="cell">
							<span class="m-label">Leave</span>
							<input
								class="input n"
								type="number"
								min="0"
								title="Menstrual or medical leave — counts as neither attended nor missed"
								value={comp.leaves}
								oninput={(e) => setCount(course.id, comp.type, "leaves", +e.currentTarget.value)}
							/>
						</label>
						{#if comp.type === "PRAC"}
							<span class="cell hrs-cell" title="A practical always counts as one hour">
								<span class="m-label">Hour / class</span>
								<span class="mono fixed-hr">1</span>
							</span>
						{:else}
						<label class="cell hrs-cell" class:unset={!hrsSet}>
							<span class="m-label">Hour / class</span>
							<!-- a dropdown, not a number box: a scroll wheel passing over it can't change it -->
							<select
								class="input n hrs-sel"
								title="How long one {comp.type} class runs. Nothing is assumed — set it."
								value={hrsSet ? String(comp.hrs) : ""}
								onchange={(e) => setHrs(course.id, comp.type, +e.currentTarget.value)}
							>
								<option value="" disabled>?</option>
								{#each HOURS as h}
									<option value={String(h)}>{h}</option>
								{/each}
								{#if hrsSet && !HOURS.includes(comp.hrs)}
									<!-- saved back when this was a free number box -->
									<option value={String(comp.hrs)}>{comp.hrs}</option>
								{/if}
							</select>
						</label>
						{/if}
						<span class="col-pct mono" class:bad={cs.current !== null && cs.current < target}>
							{cs.current === null ? "—" : fmt(cs.current) + "%"}
						</span>
					</div>

					<details
						class="picker"
						open={isOpen(course.id, comp.type)}
						ontoggle={(e) =>
							(opened = {
								...opened,
								[key(course.id, comp.type)]: e.currentTarget.open
							})}
					>
						<summary class:unset={!comp.days.length}>
							<span class="sum-days">
								{comp.days.length
									? comp.days.map((d) => DAY_NAMES[d]).join(" · ")
									: "No days picked"}
							</span>
							<span class="sum-hrs">change days</span>
						</summary>

						<div class="pick-body">
							<div class="pick-row">
								{#each WEEKDAYS as d}
									<button
										class="d"
										class:on={comp.days.includes(d)}
										onclick={() => toggleDay(course.id, comp.type, comp.days, d)}
										aria-pressed={comp.days.includes(d)}
										title="{leftFor(course, comp.heldToday)[d]} {DAY_NAMES[d]}s left"
									>
										{DAY_NAMES[d]}<span class="d-n">{leftFor(course, comp.heldToday)[d]}</span>
									</button>
								{/each}
							</div>

							<span class="tools">
								{#if edited(course.id, comp.type)}
									<button
										class="drop"
										onclick={() => resetCounts(course.id, comp.type)}
										title="Back to what the report says">Reset counts</button
									>
								{/if}
								<button
									class="drop"
									onclick={() =>
										setTypes(
											course,
											course.components.map((k) => k.type).filter((t) => t !== comp.type)
										)}
									title="This course has no {comp.type}">Remove {comp.type}</button
								>
							</span>
						</div>
					</details>
				{/each}

				{#if course.components.length < COMPONENTS.length}
					{@const missing = COMPONENTS.filter(
						(t) => !course.components.some((k) => k.type === t)
					)}
					<div class="adds">
						{#each missing as t}
							<button
								class="add-comp"
								onclick={() =>
									setTypes(course, [...course.components.map((k) => k.type), t])}
								>+ {t}</button
							>
						{/each}
					</div>
				{/if}

				<div class="out">
					<div class="big" class:bad={ok && s.current !== null && s.current < target}>
						{!ok || s.current === null ? "—" : fmt(s.current) + "%"}
						<span class="big-label">course total</span>
					</div>
					{#if !ok}
						<div class="range">
							<span class="needs">Fill in <b>Hour / class</b> and this total appears.</span>
						</div>
					{:else}
					<div class="range">
						<span>Attend all remaining: <b>{fmt(s.best)}%</b></span>
						<span>Miss all remaining: <b>{fmt(s.worst)}%</b></span>
					</div>
					{/if}
				</div>

				{#if ok && s.current !== null}
					<div class="meter" class:bad={s.current < target} aria-hidden="true">
						<span style="width: {Math.min(100, s.current)}%"></span>
						<i style="left: {Math.min(100, target)}%"></i>
					</div>
				{/if}

				{#if ok}
				<p class="verdict" class:bad={s.impossible}>
					{#if s.impossible}
						Can't reach {target}% any more — best you can finish at is {fmt(s.best)}%.
					{:else if s.mustAttend > 0}
						Attend <b>{fmt(s.mustAttend)} hrs</b> of what's left
						{#if s.canSkip > 0}— you can skip <b>{fmt(s.canSkip)} hrs</b>.
						{:else}— every single one.{/if}
					{:else if s.canSkip > 0}
						You're clear. You can skip <b>{fmt(s.canSkip)} hrs</b> more and still hold {target}%.
					{:else}
						Nothing left to attend.
					{/if}
				</p>
				{/if}
			</section>
		{/each}
	</div>

	<div class="note">
		<p>
			<b>Credit classes before the report starts</b> — the portal only shows a
			course from whenever it began recording, but the course itself started when
			the semester did. This counts the calendar's teaching days on that
			component's own weekdays, from the first day of classes up to whenever its
			report begins, as attended. It stops at the waiver date, so a course that
			genuinely started later in the term doesn't collect classes it never held.
			Turn it off if your course did start late.
		</p>
		<p>
			<b>Half-sem CCC</b> — tick it on a CCC that only runs the first half of the
			semester, and its Left stops at {dmy(data.semester.half)}, when the calendar
			says the first half finishes. Leave it unticked and the course runs to the
			end of the semester like any other. A CCC whose report starts after 1st
			October is a second-half course, so its Left runs to the end either way.
		</p>
		<p>
			<b>Left</b> comes from the days under each component: the report's own
			dates say which weekdays it has met on, and the academic calendar says how
			many of those are still to come. Open <b>change days</b> to add or drop one,
			or type straight over the Left box. Attended, Missed and Leave are yours to
			correct too — the report is only the starting point.
		</p>
		<p>
			<b>Approved days</b> are for days you were officially away, like a SWAYAM exam.
			Pick them on the calendar and every class on that day is taken
			out of the sum altogether: one you already had shows up under Leave whatever
			the report marked it, and one still to come drops out of Left. They're kept
			in this browser and stay when you paste a fresh report.
		</p>
		<p>
			<b>+ TUT</b>, <b>+ PRAC</b> and <b>+ LEC</b> add a component the report
			doesn't carry — a tutorial that isn't tracked yet, say. <b>Remove</b> takes
			one off a course that doesn't have it. Anything the report did carry comes
			back with its numbers intact if you add it again.
		</p>
		<p>
			<b>Credited</b> — absences on or before the waiver date, counted as
			attended. The portal will catch up eventually; until it does, this is what
			your percentage actually is.
		</p>
		<p>
			<b>Hour / class</b> — how long one lecture or tutorial runs. Nothing is
			assumed, so the box starts on "?" and the course total waits for it. A
			practical always counts as one hour, so it has no box. Every total on the card
			is in hours. A lecture that meets twice on the same day is the same thing:
			give it two hours.
		</p>
		<p>
			Shiv Nadar IoE expects you at every scheduled class. Nothing here is an
			allowance to skip — the only absences you're permitted are the ones covered
			by a waiver you've actually been granted. This page just does the arithmetic
			on where that leaves you.
		</p>
		<p>
			LEC, TUT and PRAC are added up, since attendance is judged on the course
			total. A tutorial and a practical on the same day stay separate — the
			report gives each its own row, so each keeps its own P and A.
			<b>Leave</b> counts as neither attended nor missed. Saved in this browser only.
		</p>
	</div>

	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<dialog
		bind:this={calDialog}
		class="cal"
		aria-labelledby="cal-title"
		onclick={(e) => e.target === calDialog && calDialog.close()}
	>
		<div class="cal-box">
			<div class="cal-head">
				<h2 id="cal-title">Approved days</h2>
				<button class="cal-x" onclick={() => calDialog?.close()} aria-label="Close">×</button>
			</div>
			<p class="cal-sub">
				Pick the days you were officially away, such as a SWAYAM exam or any
				other approved leave. Every class on those days counts as neither attended
				nor missed, the same as Leave.
			</p>

			{#if calMonths.length}
				{@const cm = calMonths[calAt]}
				<div class="cal-nav">
					<button
						class="cal-arrow"
						onclick={() => (calAt -= 1)}
						disabled={calAt === 0}
						aria-label="Previous month">‹</button
					>
					<span class="cal-month">
						{new Date(cm.y, cm.m, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
					</span>
					<button
						class="cal-arrow"
						onclick={() => (calAt += 1)}
						disabled={calAt === calMonths.length - 1}
						aria-label="Next month">›</button
					>
				</div>

				<div class="cal-grid">
					{#each DOW as d}
						<span class="cal-dow">{d.slice(0, 1)}</span>
					{/each}
					{#each monthCells(cm.y, cm.m) as iso, i (iso ?? `blank-${i}`)}
						{#if !iso}
							<span></span>
						{:else}
							{@const wd = teaching.get(iso)}
							{@const own = new Date(iso + "T00:00:00").getDay()}
							<button
								class="cal-day"
								class:on={iso in approved}
								class:today={iso === todayIso}
								disabled={wd === undefined && !(iso in approved)}
								aria-pressed={iso in approved}
								aria-label={shortDate(iso)}
								title={wd === undefined
									? "No classes on this day"
									: wd !== own
										? `${DAY_NAMES[wd]} timetable runs on this day`
										: undefined}
								onclick={() => toggleApproved(iso)}>{Number(iso.slice(8))}</button
							>
						{/if}
					{/each}
				</div>
			{/if}

			{#if approvedDates.length}
				<ul class="cal-list">
					{#each approvedDates as iso (iso)}
						<li>
							<span class="cal-date">{shortDate(iso)}</span>
							<input
								class="input cal-note"
								type="text"
								placeholder="e.g. SWAYAM exam"
								aria-label="Note for {shortDate(iso)}"
								value={approved[iso]}
								oninput={(e) => setNote(iso, e.currentTarget.value)}
							/>
							<button
								class="drop"
								onclick={() => toggleApproved(iso)}
								aria-label="Remove {shortDate(iso)}">Remove</button
							>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="cal-empty">No approved days yet. Tap a date to add one.</p>
			{/if}

			<div class="cal-foot">
				{#if approvedDates.length}
					<button class="drop" onclick={() => (approved = {})}>Clear all</button>
				{/if}
				<button class="btn btn-sm cal-done" onclick={() => calDialog?.close()}>Done</button>
			</div>
		</div>
	</dialog>
</main>

<style>
	.att {
		flex: 1;
		width: 100%;
		max-width: 1180px;
		margin: 0 auto;
		padding: 3.5rem 1.5rem 2.5rem;
		overflow-x: clip;
	}

	.att-head {
		margin-bottom: 1.75rem;
		text-align: center;
	}

	.sub {
		margin: 0.75rem auto 0;
		color: var(--text-secondary);
		font-size: 0.95rem;
		max-width: 58ch;
	}

	.needs {
		color: var(--bad);
		max-width: 30ch;
	}

	.needs b {
		color: var(--bad);
		font-weight: 600;
	}

	.howto {
		margin-bottom: 0.75rem;
		font-size: var(--text-sm);
		line-height: 1.6;
		color: var(--text-muted);
	}

	.howto b {
		color: var(--text);
		font-weight: 500;
	}

	.howto a {
		color: var(--accent);
		font-weight: 500;
		text-decoration: none;
	}

	.howto a:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	/* the paste box */
	.paste {
		margin-bottom: 1rem;
		padding: 1.25rem;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lift);
	}

	.src {
		font-family: var(--font-code);
		font-size: 0.78rem;
		line-height: 1.6;
		resize: vertical;
		white-space: pre;
		overflow-wrap: normal;
		overflow-x: auto;
		background: var(--bg-sunken);
		border-style: dashed;
	}

	.src:focus {
		background: var(--bg-input);
		border-style: solid;
	}

	.paste-foot {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.75rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.paste-foot:empty {
		display: none;
	}

	.paste-foot .btn {
		margin-left: auto;
	}

	.miss {
		color: var(--bad);
	}

	/* controls toolbar */
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1rem;
		margin-bottom: 1.5rem;
		padding: 0.7rem 1rem;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow);
		font-size: var(--text-md);
		color: var(--text-secondary);
	}

	.bar-group {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.bar-group > label,
	.bar-label {
		font-weight: 500;
		color: var(--text);
	}

	.bar-group .btn.has {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-dim);
	}

	.check {
		gap: 0.45rem;
		cursor: pointer;
	}

	.check input {
		width: 15px;
		height: 15px;
		accent-color: var(--accent);
		cursor: pointer;
	}

	.bar-sep {
		width: 1px;
		height: 1.5rem;
		background: var(--border);
	}

	.bar-group .btn {
		padding-inline: 0.8rem;
		box-shadow: none;
		min-height: var(--h-md);
	}

	.bar-group .on {
		background: var(--accent);
		color: var(--accent-ink);
		border-color: var(--accent);
	}

	.target-input {
		width: 3.75rem;
		padding: 0 0.5rem;
		text-align: center;
		font-family: var(--font-mono);
		font-weight: 600;
		appearance: textfield;
		-moz-appearance: textfield;
		height: var(--h-md);
	}

	/* the spinner eats the room the number needs */
	.target-input::-webkit-outer-spin-button,
	.target-input::-webkit-inner-spin-button {
		appearance: none;
		margin: 0;
	}

	.bad-date {
		border-color: var(--bad);
		color: var(--bad);
	}

	.date-input {
		width: 8.5rem;
		padding: 0 0.6rem;
		font-family: var(--font-mono);
		font-size: var(--text-md);
		height: var(--h-md);
	}

	.pcnt {
		margin-left: -0.15rem;
		color: var(--text-muted);
	}

	/* headline count */
	.tally {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.25rem;
		margin-bottom: 1rem;
		border-radius: var(--radius-lg);
		border: 1px solid var(--border);
		background: var(--bg-card);
		box-shadow: var(--shadow);
	}

	.tally-n {
		font-family: var(--font-mono);
		font-size: 2.25rem;
		font-weight: 600;
		letter-spacing: -0.025em;
		line-height: 1;
		color: var(--accent);
	}

	.tally-of {
		color: var(--text-muted);
		font-size: 1.25rem;
		font-weight: 400;
	}

	.tally-label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--text);
	}

	.tally-sub {
		font-size: var(--text-sm);
		font-weight: 400;
		line-height: 1.5;
		color: var(--text-muted);
		max-width: 75ch;
	}

	.tally.waiting {
		border-color: color-mix(in srgb, var(--bad) 35%, var(--border));
	}

	.tally.waiting .tally-n,
	.tally.waiting b {
		color: var(--bad);
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(30rem, 100%), 1fr));
		gap: 1rem;
	}

	.card {
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 1.1rem 1.15rem 1rem;
		box-shadow: var(--shadow);
		transition:
			box-shadow 0.2s,
			border-color 0.2s;
	}

	.card:hover {
		border-color: var(--border-hover);
		box-shadow: var(--shadow-lift);
	}

	.card-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.half {
		display: flex;
		align-items: center;
		padding: 0 0.65rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		height: var(--h-sm);
	}

	.late {
		margin: -0.15rem 0 0.75rem;
		padding: 0.7rem 0.85rem;
		border-radius: var(--radius);
		background: var(--warn-dim);
		font-size: var(--text-sm);
		line-height: 1.55;
		color: var(--text-secondary);
	}

	.late b {
		color: var(--warn);
		font-weight: 600;
	}

	.name {
		font-size: 1.05rem;
		font-weight: 600;
		letter-spacing: -0.015em;
	}

	.sections {
		padding: 0 0.65rem;
		border-radius: 999px;
		background: var(--bg-sunken);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--text-muted);
		margin-left: auto;
		height: var(--h-sm);
		display: inline-flex;
		align-items: center;
	}

	.grid {
		display: grid;
		min-width: 0;
		grid-template-columns: 3rem repeat(5, minmax(0, 1fr)) 3.4rem;
		gap: 0.4rem;
		align-items: center;
		margin-bottom: 0.4rem;
	}

	.grid-head {
		font-size: var(--text-xs);
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin-bottom: 0.35rem;
		text-align: center;
	}

	.grid-head .col-pct {
		text-align: right;
	}

	.ctype {
		justify-self: start;
		padding: 0 0.5rem;
		border-radius: var(--radius-sm);
		background: var(--accent-dim);
		color: var(--accent);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		height: var(--h-sm);
		display: inline-flex;
		align-items: center;
	}

	.cell {
		display: flex;
		justify-content: center;
		min-width: 0;
		font-size: var(--text-md);
	}

	.cell.miss .n {
		color: var(--bad);
	}

	/* nothing is assumed about how long a class runs, so an empty one shouts */
	.hrs-cell.unset .n {
		border-color: var(--bad);
		background: var(--bad-dim);
		color: var(--bad);
	}

	/* matches the height of the dropdowns beside it, so the row doesn't jump */
	.fixed-hr {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: var(--h-md);
		font-size: var(--text-md);
	}

	.hrs-sel {
		cursor: pointer;
		text-align-last: center;
	}

	/* the list itself shouldn't inherit the unset field's red */
	.hrs-sel option {
		color: var(--text);
	}

	.n {
		min-width: 0;
		padding: 0 0.25rem;
		text-align: center;
		font-family: var(--font-mono);
		font-size: var(--text-md);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		border-color: transparent;
		height: var(--h-md);
	}

	.n:hover {
		border-color: var(--border-hover);
	}

	/* which weekdays this component meets on — set once and then out of the
	   way, so the cards stay the same shape */
	.picker {
		padding-left: 3.4rem;
		margin-bottom: 0.55rem;
	}

	.picker summary {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0 0.7rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		list-style: none;
		cursor: pointer;
		font-size: var(--text-sm);
		color: var(--text-muted);
		transition:
			border-color 0.15s,
			color 0.15s,
			background 0.15s;
		min-height: var(--h-sm);
	}

	.picker summary::-webkit-details-marker {
		display: none;
	}

	.picker summary::before {
		content: '';
		width: 6px;
		height: 6px;
		border-right: 1.5px solid currentColor;
		border-bottom: 1.5px solid currentColor;
		transform: rotate(-45deg);
		transition: transform 0.2s;
		opacity: 0.7;
	}

	.picker[open] summary::before {
		transform: rotate(45deg);
	}

	.picker summary.unset {
		border-color: color-mix(in srgb, var(--bad) 40%, var(--border));
		background: var(--bad-dim);
		color: var(--bad);
	}

	.picker summary.unset .sum-days {
		color: var(--bad);
	}

	.picker summary:hover {
		border-color: var(--border-hover);
		background: var(--bg-hover);
		color: var(--text-secondary);
	}

	.sum-days {
		color: var(--text-secondary);
		font-weight: 500;
		letter-spacing: 0.02em;
	}

	.sum-hrs {
		margin-left: auto;
		font-size: var(--text-sm);
	}

	.pick-body {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.6rem 0 0.15rem;
	}

	.pick-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
	}

	.d {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0 0.65rem;
		background: var(--bg-sunken);
		border: 1px solid transparent;
		border-radius: 999px;
		color: var(--text-secondary);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
		height: var(--h-sm);
	}

	.d:hover {
		border-color: var(--border-hover);
		color: var(--text);
	}

	.d.on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
	}

	.d-n {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		opacity: 0.65;
	}

	.tools {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.3rem;
	}

	.drop,
	.add-comp {
		height: var(--h-sm);
		padding: 0 0.7rem;
		background: none;
		border: none;
		border-radius: 999px;
		color: var(--text-muted);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
		transition:
			color 0.15s,
			background 0.15s;
	}

	.drop:hover {
		background: var(--bad-dim);
		color: var(--bad);
	}

	.adds {
		display: flex;
		gap: 0.3rem;
		padding-left: 3.4rem;
		margin-bottom: 0.55rem;
	}

	/* breathing room above the totals' rule, whatever comes last before it */
	.card > :has(+ .out) {
		margin-bottom: 1rem;
	}

	.add-comp {
		border: 1px dashed var(--border-hover);
		font-family: var(--font-mono);
	}

	.add-comp:hover {
		border-color: var(--accent);
		border-style: solid;
		background: var(--accent-dim);
		color: var(--accent);
	}

	.col-pct {
		text-align: right;
		font-size: var(--text-md);
		font-weight: 500;
	}

	.mono {
		font-family: var(--font-mono);
		color: var(--text);
	}

	.mono.bad {
		color: var(--bad);
	}

	.m-label {
		display: none;
	}

	/* the totals sit on the floor of the card, so they line up across a row */
	.out {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.25rem;
		flex-wrap: wrap;
		margin-top: auto;
		padding-top: 0.85rem;
		border-top: 1px solid var(--border);
	}

	.big {
		display: flex;
		flex-direction: column;
		font-family: var(--font-mono);
		font-size: 2rem;
		font-weight: 600;
		letter-spacing: -0.025em;
		line-height: 1;
		color: var(--ok);
	}

	.big.bad {
		color: var(--bad);
	}

	.big-label {
		order: -1;
		margin-bottom: 0.35rem;
		font-family: var(--font);
		font-size: var(--text-xs);
		font-weight: 500;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.range {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.2rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.range b {
		color: var(--text);
		font-family: var(--font-mono);
		font-weight: 600;
	}

	/* where the course total sits against the target */
	.meter {
		position: relative;
		height: 4px;
		margin-top: 0.75rem;
		border-radius: 999px;
		background: var(--bg-sunken);
	}

	.meter span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--ok);
		transition: width 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.meter.bad span {
		background: var(--bad);
	}

	.meter i {
		position: absolute;
		top: -3px;
		bottom: -3px;
		width: 2px;
		margin-left: -1px;
		border-radius: 1px;
		background: var(--text);
		opacity: 0.6;
	}

	.verdict {
		margin-top: 0.65rem;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius);
		background: var(--bg-sunken);
		font-size: var(--text-md);
		color: var(--text-secondary);
	}

	.verdict b {
		color: var(--text);
		font-weight: 600;
	}

	.verdict.bad {
		background: var(--bad-dim);
		color: var(--bad);
	}

	.note {
		margin-top: 2rem;
		columns: 20rem;
		column-gap: 0.75rem;
		font-size: var(--text-sm);
		line-height: 1.6;
		color: var(--text-muted);
	}

	.note p {
		break-inside: avoid;
		margin-bottom: 0.75rem;
		padding: 0.85rem 1rem;
		border-radius: var(--radius-lg);
		background: var(--bg-card);
	}

	.note b {
		color: var(--text);
		font-weight: 600;
	}

	/* approved days: a small calendar in a modal */
	.cal {
		margin: auto;
		width: min(24rem, calc(100% - 2rem));
		max-height: calc(100% - 2rem);
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--bg-card);
		color: var(--text);
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
	}

	.cal::backdrop {
		background: rgba(0, 0, 0, 0.35);
	}

	.cal-box {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 1.1rem 1.15rem 1rem;
	}

	.cal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.cal-head h2 {
		font-size: 1.05rem;
	}

	.cal-x,
	.cal-arrow {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--h-md);
		height: var(--h-md);
		border: none;
		border-radius: 999px;
		background: var(--bg-sunken);
		color: var(--text-secondary);
		font: inherit;
		font-size: 1.15rem;
		line-height: 1;
		cursor: pointer;
	}

	.cal-x:hover,
	.cal-arrow:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text);
	}

	.cal-arrow:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.cal-sub,
	.cal-empty {
		font-size: var(--text-sm);
		line-height: 1.55;
		color: var(--text-muted);
	}

	.cal-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.cal-month {
		font-size: var(--text-md);
		font-weight: 600;
	}

	.cal-grid {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 0.25rem;
	}

	.cal-dow {
		padding-bottom: 0.15rem;
		text-align: center;
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--text-muted);
	}

	.cal-day {
		aspect-ratio: 1;
		min-height: 2.1rem;
		border: 1px solid transparent;
		border-radius: 999px;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--text-md);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
	}

	.cal-day:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--border-hover);
	}

	/* a Sunday, a holiday, or outside the term: nothing to excuse */
	.cal-day:disabled {
		color: var(--text-muted);
		opacity: 0.4;
		cursor: default;
	}

	.cal-day.today {
		border-color: var(--border-strong);
		font-weight: 600;
	}

	.cal-day.on,
	.cal-day.on:hover {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
		opacity: 1;
	}

	.cal-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		max-height: 12rem;
		overflow-y: auto;
		list-style: none;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
	}

	.cal-list li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.cal-date {
		flex: none;
		width: 6.5rem;
		font-size: var(--text-sm);
		font-weight: 500;
	}

	.cal-note {
		flex: 1;
		min-width: 0;
		height: var(--h-md);
		padding: 0 0.6rem;
	}

	.cal-foot {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.cal-done {
		margin-left: auto;
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
	}

	.cal-done:hover {
		background: var(--accent-hover);
		border-color: var(--accent-hover);
	}

	@media (max-width: 560px) {
		.att {
			padding: 3rem 1rem 2rem;
		}

		h1 {
			font-size: 1.85rem;
		}

		.card,
		.paste {
			padding: 1rem;
		}

		.bar {
			gap: 0.6rem;
		}

		.bar-sep {
			display: none;
		}

		.bar-group {
			flex: 1 0 100%;
		}

		/* the field takes whatever the label and button leave */
		.date-input {
			flex: 1;
			width: auto;
		}

		.grid-head {
			display: none;
		}

		/* tiles once the columns won't fit */
		.grid {
			grid-template-columns: repeat(6, minmax(0, 1fr));
			gap: 0.5rem;
			padding-bottom: 0.75rem;
			margin-bottom: 0.75rem;
			border-bottom: 1px solid var(--border);
		}

		/* the total's own rule follows straight after, so don't draw two */
		.grid:has(+ .out) {
			border-bottom: none;
			padding-bottom: 0;
		}

		.ctype {
			grid-column: 1 / 4;
		}

		.col-pct {
			grid-column: 4 / 7;
			grid-row: 1;
		}

		/* three tiles, then Leave and the wider Hours tile fill the next row */
		.cell {
			grid-column: span 2;
		}

		.hrs-cell {
			grid-column: span 4;
		}

		.picker,
		.adds {
			padding-left: 0;
		}

		.cell {
			flex-direction: column;
			align-items: center;
			gap: 0.1rem;
			min-width: 0;
			padding: 0.45rem 0.3rem 0.5rem;
			background: var(--bg-sunken);
			border: 1px solid transparent;
			border-radius: var(--radius);
		}

		.cell:focus-within {
			border-color: var(--accent);
		}

		.cell .n {
			width: 100%;
			height: auto;
			padding: 0;
			border: none;
			background: transparent;
			line-height: 1.3;
			appearance: textfield;
			-moz-appearance: textfield;
		}

		.cell .n:focus {
			box-shadow: none;
		}

		/* spinners eat width the number needs */
		.cell .n::-webkit-outer-spin-button,
		.cell .n::-webkit-inner-spin-button {
			appearance: none;
			margin: 0;
		}

		.m-label {
			display: block;
			font-size: var(--text-xs);
			font-weight: 500;
			letter-spacing: 0.04em;
			text-transform: uppercase;
			color: var(--text-muted);
			white-space: nowrap;
		}

		.range {
			align-items: flex-start;
		}
	}
</style>
