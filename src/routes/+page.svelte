<script lang="ts">
	import { COMPONENTS, stats, statsFor, type ComponentType } from "$lib/attendance";
	import {
		parseReport,
		toCourses,
		classesLeft,
		parseForgiveDate,
		FORGIVE_UNTIL,
		type ParsedCourse,
		type ParsedComponent
	} from "$lib/attendanceReport";
	import { remainingDays, totalDays, WEEKDAYS, DAY_NAMES } from "$lib/semester";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const KEY = "attendance.v2";
	const DEFAULT_TARGET = 70;
	const PRESETS = [70, 45, 65];

	/** ISO dates are for storing, DD/MM/YYYY is for reading */
	const dmy = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");

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

	const left = $derived(remainingDays(data.semester));
	// a first-half CCC stops where the calendar says the first half finishes
	const leftHalf = $derived(remainingDays(data.semester, new Date(), data.semester.half));
	const isCcc = (id: string) => id.startsWith("CCC") && data.semester.half !== "";
	const leftFor = (id: string) => (isCcc(id) && halfSem[id] ? leftHalf : left);
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

	// ponytail: localStorage — your numbers, your device.
	$effect(() => {
		const saved = localStorage.getItem(KEY);
		if (!saved) return;
		try {
			const v = JSON.parse(saved);
			if (typeof v.raw === "string") raw = v.raw;
			if (typeof v.target === "number") target = v.target;
			if (typeof v.waiver === "string") waiver = v.waiver;
			else if (typeof v.forgiveUntil === "string") waiver = dmy(v.forgiveUntil);
			if (v.picks && typeof v.picks === "object") picks = v.picks;
			if (v.shape && typeof v.shape === "object") shape = v.shape;
			if (v.hours && typeof v.hours === "object") hours = v.hours;
			if (v.counts && typeof v.counts === "object") counts = v.counts;
			if (typeof v.backfill === "boolean") backfill = v.backfill;
			if (v.halfSem && typeof v.halfSem === "object") halfSem = v.halfSem;
		} catch {
			// corrupt blob, start clean
		}
	});

	$effect(() => {
		localStorage.setItem(KEY, JSON.stringify({
			raw,
			// only a target you picked; a saved default would pin it past any change to DEFAULT_TARGET
			target: target === DEFAULT_TARGET ? undefined : target,
			waiver, picks, shape, hours, counts, backfill, halfSem }));
	});

	const forgiveUntil = $derived(isoOf(waiver));
	const rows = $derived(parseReport(raw, data.semester.start));
	const parsed = $derived(
		toCourses(rows, parseForgiveDate(forgiveUntil), data.semester, backfill)
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
						backfilled: 0
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
							counts[`${key(c.id, t)}/remaining`] ?? classesLeft(days, leftFor(c.id))
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

	/** forget the report and everything set up on top of it: days, hours, typed counts */
	function clearAll() {
		raw = "";
		picks = {};
		shape = {};
		hours = {};
		counts = {};
		opened = {};
		halfSem = {};
		backfill = true;
		// the save effect writes the empty state back; drop the blob so nothing stale lingers
		localStorage.removeItem(KEY);
	}

	/** back to whatever the report itself said */
	function resetCounts(id: string, type: ComponentType) {
		const out = { ...counts };
		for (const f of COUNTS) delete out[`${key(id, type)}/${f}`];
		counts = out;
	}
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
		</p>

		<textarea
			class="input src"
			rows={rows.length ? 3 : 8}
			spellcheck="false"
			placeholder={"Course Code\n17 Aug-1\n19 Aug-1\nCCC448 - LECCCF    P    A"}
			bind:value={raw}
		></textarea>

		<div class="paste-foot">
			{#if raw && !rows.length}
				<span class="miss">
					No course rows in that. Copy the whole report page, not just a selection.
				</span>
			{:else if rows.length}
				<span class="found">
					{rows.length} section{rows.length === 1 ? "" : "s"} · {courses.length} course{courses.length ===
					1
						? ""
						: "s"}
					{#if forgiven}· <b>{forgiven}</b> absence{forgiven === 1 ? "" : "s"} credited{/if}
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
								: "es"} added before the report starts{/if} ·
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
										title="{leftFor(course.id)[d]} {DAY_NAMES[d]}s left"
									>
										{DAY_NAMES[d]}<span class="d-n">{leftFor(course.id)[d]}</span>
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
						<span>Best case <b>{fmt(s.best)}%</b></span>
						<span>Skip everything left <b>{fmt(s.worst)}%</b></span>
					</div>
					{/if}
				</div>

				<p class="verdict" class:bad={s.impossible}>
					{#if !ok}
						&nbsp;
					{:else if s.impossible}
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
			end of the semester like any other.
		</p>
		<p>
			<b>Left</b> comes from the days under each component: the report's own
			dates say which weekdays it has met on, and the academic calendar says how
			many of those are still to come. Open <b>change days</b> to add or drop one,
			or type straight over the Left box. Attended, Missed and Leave are yours to
			correct too — the report is only the starting point.
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
</main>

<style>
	.att {
		flex: 1;
		width: 100%;
		max-width: 1140px;
		margin: 0 auto;
		padding: 4rem 1.5rem 3rem;
		overflow-x: clip;
	}

	.att-head {
		margin-bottom: 2rem;
	}

	.sub {
		margin-top: 0.5rem;
		color: var(--text-secondary);
		font-size: 0.9rem;
		max-width: 60ch;
	}

	.needs {
		color: var(--bad);
		max-width: 30ch;
	}

	.needs b {
		color: var(--bad);
		font-weight: 500;
	}

	.howto {
		margin-bottom: 0.5rem;
		font-size: 0.76rem;
		line-height: 1.6;
		color: var(--text-muted);
		max-width: 72ch;
	}

	.howto b {
		color: var(--text-secondary);
		font-weight: 500;
	}

	.howto a {
		color: var(--text);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	/* the paste box */
	.paste {
		margin-bottom: 1.25rem;
	}

	.src {
		font-family: var(--font-mono);
		font-size: 0.78rem;
		line-height: 1.6;
		resize: vertical;
		white-space: pre;
		overflow-wrap: normal;
		overflow-x: auto;
	}

	.paste-foot {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.5rem;
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.paste-foot .btn {
		margin-left: auto;
	}

	.found b {
		color: var(--text-secondary);
		font-weight: 500;
	}

	.miss {
		color: var(--bad);
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.9rem;
		margin-bottom: 1.25rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.bar-group {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.check {
		gap: 0.35rem;
		cursor: pointer;
	}

	.check input {
		accent-color: var(--text);
		cursor: pointer;
	}

	.bar-sep {
		width: 1px;
		align-self: stretch;
		background: var(--border);
	}

	.bar-group .btn {
		padding-inline: 0.6rem;
	}

	.bar-group .on {
		background: var(--text);
		color: var(--bg);
		border-color: var(--text);
	}

	.target-input {
		width: 4rem;
		padding-inline: 0.5rem;
		text-align: center;
		appearance: textfield;
		-moz-appearance: textfield;
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
		padding-inline: 0.6rem;
		font-family: var(--font-mono);
		font-size: 0.8rem;
	}

	.pcnt {
		margin-left: -0.25rem;
	}

	/* headline count */
	.tally {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1rem 1.25rem;
		margin-bottom: 1rem;
	}

	.tally-n {
		font-family: var(--font-mono);
		font-size: 1.75rem;
		letter-spacing: -0.02em;
	}

	.tally-of {
		color: var(--text-muted);
		font-size: 1.1rem;
	}

	.tally-label {
		display: flex;
		flex-direction: column;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.tally-sub {
		font-size: 0.68rem;
		line-height: 1.5;
		color: var(--text-muted);
		max-width: 70ch;
	}

	.tally.waiting {
		border-color: var(--bad);
	}

	.tally.waiting .tally-n,
	.tally.waiting b {
		color: var(--bad);
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(28rem, 100%), 1fr));
		/* every card the same size, whatever the tallest one needs */
		grid-auto-rows: 1fr;
		gap: 1rem;
	}

	.card {
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem;
	}

	.card-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.75rem;
		align-items: baseline;
		margin-bottom: 1rem;
	}

	.half {
		display: flex;
		align-items: center;
		font-size: 0.72rem;
		color: var(--text-secondary);
	}

	.name {
		font-size: 1rem;
		font-weight: 500;
		letter-spacing: -0.01em;
	}

	.sections {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		color: var(--text-muted);
		margin-left: auto;
	}

	.grid {
		display: grid;
		min-width: 0;
		grid-template-columns: 2.8rem repeat(5, minmax(0, 1fr)) 3.2rem;
		gap: 0.4rem;
		align-items: center;
		margin-bottom: 0.4rem;
	}

	.grid-head {
		font-size: 0.66rem;
		color: var(--text-muted);
		margin-bottom: 0.3rem;
		text-align: center;
	}

	.grid-head .col-pct {
		text-align: right;
	}

	.ctype {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.cell {
		display: flex;
		justify-content: center;
		min-width: 0;
		font-size: 0.8rem;
	}

	.cell.miss .n {
		color: var(--bad);
	}

	/* nothing is assumed about how long a class runs, so an empty one shouts */
	.hrs-cell.unset .n {
		border-color: var(--bad);
		color: var(--bad);
	}

	/* matches the height of the dropdowns beside it, so the row doesn't jump */
	.fixed-hr {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: 2.1rem;
		font-size: 0.8rem;
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
		padding: 0.45rem 0.25rem;
		text-align: center;
		font-family: var(--font-mono);
		font-size: 0.8rem;
	}

	/* which weekdays this component meets on, and how long a class runs — both
	   set once and then out of the way, so the cards stay the same shape */
	.picker {
		padding-left: 2.8rem;
		margin-bottom: 0.9rem;
	}

	.picker summary {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.25rem 0.5rem;
		border: 1px dashed var(--border-hover);
		border-radius: var(--radius-sm);
		list-style: none;
		cursor: pointer;
		font-size: 0.68rem;
		color: var(--text-muted);
		transition: all 0.15s;
	}

	.picker summary::-webkit-details-marker {
		display: none;
	}

	.picker summary::before {
		content: "+";
		font-size: 0.75rem;
		line-height: 1;
		opacity: 0.7;
	}

	.picker[open] summary::before {
		content: "−";
	}

	.picker summary.unset {
		border-color: var(--bad);
		border-style: solid;
		color: var(--bad);
	}

	.picker summary.unset .sum-days {
		color: var(--bad);
	}

	.picker summary:hover {
		border-color: var(--text-secondary);
		color: var(--text-secondary);
	}

	.sum-days {
		color: var(--text-secondary);
		letter-spacing: 0.03em;
	}

	.sum-hrs {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 0.66rem;
	}

	.pick-body {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.5rem 0 0.15rem;
	}

	.pick-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
	}

	.d {
		display: flex;
		align-items: baseline;
		gap: 0.3rem;
		padding: 0.2rem 0.4rem;
		background: var(--bg-input);
		border: 1px dashed var(--border-hover);
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		font-size: 0.68rem;
		letter-spacing: 0.03em;
		cursor: pointer;
		transition: all 0.15s;
	}

	.d:hover {
		border-color: var(--text-secondary);
		color: var(--text);
	}

	.d.on {
		background: var(--text);
		border-style: solid;
		border-color: var(--text);
		color: var(--bg);
	}

	.d-n {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		opacity: 0.6;
	}

	.tools {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.3rem;
	}

	.drop,
	.add-comp {
		padding: 0.2rem 0.45rem;
		background: none;
		border: none;
		color: var(--text-muted);
		font-size: 0.68rem;
		cursor: pointer;
		transition: color 0.15s;
	}


	.drop:hover,
	.add-comp:hover {
		color: var(--text);
	}

	.adds {
		display: flex;
		gap: 0.2rem;
		padding-left: 2.8rem;
		margin-top: -0.35rem;
	}

	.add-comp {
		border: 1px dashed var(--border-hover);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
	}

	.add-comp:hover {
		border-color: var(--text-secondary);
	}

	.col-pct {
		text-align: right;
		font-size: 0.78rem;
	}

	.mono {
		font-family: var(--font-mono);
		color: var(--text-secondary);
	}

	.mono.bad {
		color: var(--text-muted);
	}

	.m-label {
		display: none;
	}

	/* the totals sit on the floor of the card, so they line up across a row */
	.out {
		display: flex;
		align-items: baseline;
		gap: 1.25rem;
		flex-wrap: wrap;
		margin-top: auto;
		padding-top: 1.25rem;
		border-top: 1px solid var(--border);
	}

	.big {
		font-family: var(--font-mono);
		font-size: 1.75rem;
		letter-spacing: -0.02em;
	}

	.big.bad {
		color: var(--text-secondary);
	}

	.big-label {
		font-family: var(--font);
		font-size: 0.7rem;
		color: var(--text-muted);
		margin-left: 0.4rem;
	}

	.range {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.78rem;
		color: var(--text-muted);
	}

	.range b {
		color: var(--text-secondary);
		font-family: var(--font-mono);
		font-weight: 500;
	}

	.verdict {
		margin-top: 0.9rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
	}

	.verdict b {
		color: var(--text);
	}

	.verdict.bad {
		color: var(--text-muted);
	}

	.note {
		margin-top: 1.5rem;
		font-size: 0.78rem;
		line-height: 1.6;
		color: var(--text-muted);
		max-width: 65ch;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.note b {
		color: var(--text-secondary);
		font-weight: 500;
	}

	@media (max-width: 560px) {
		.att {
			padding: 2.5rem 1rem 2.5rem;
		}

		.card {
			padding: 1rem;
		}

		.bar {
			gap: 0.5rem;
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
			padding: 0.4rem 0.3rem 0.45rem;
			background: var(--bg-input);
			border: 1px dashed var(--border-hover);
			border-radius: var(--radius);
		}

		.cell .n {
			width: 100%;
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
			font-size: 0.68rem;
			letter-spacing: 0.04em;
			color: var(--text-muted);
			white-space: nowrap;
		}
	}
</style>
