<script lang="ts">
	const steps = [
		{ img: "step-1.jpg", text: "Open SNU Links and click Student Attendance Recording." },
		{ img: "step-2.jpg", text: "Reports → Course-wise Attendance View." },
		{ img: "step-3.jpg", text: "Select the whole page (⌘A / Ctrl+A) and copy (⌘C / Ctrl+C)." },
		{ img: "step-4.jpg", text: "Paste it into the tracker. Your courses appear." },
		{ img: "step-5.jpg", text: "Set Hour / class for each course — how long one class runs, off your timetable." },
		{ img: "step-6.jpg", text: "Read your total, and how many hours you can still skip." }
	];
</script>

<svelte:head>
	<title>How to use · Attendance Tracker</title>
	<meta name="description" content="Six steps from SNU Links to your attendance percentage." />
</svelte:head>

<main class="guide">
	<a class="back" href="/">← Tracker</a>

	<header>
		<h1>How to use it</h1>
		<p class="sub">Six steps. About a minute. <a href="/guide/attendance-tracker-guide.pdf" download>Download PDF</a></p>
	</header>

	<figure class="hero">
		<img src="/guide/walkthrough.gif" alt="Walkthrough: SNU Links to the tracker, pasting the report and picking Hour / class" />
	</figure>

	<ol class="steps">
		{#each steps as s, i}
			<li>
				<p><span class="n">{i + 1}</span>{s.text}</p>
				<img src="/guide/{s.img}" alt="Step {i + 1}: {s.text}" loading="lazy" />
			</li>
		{/each}
	</ol>

	<a class="btn go" href="/">Open the tracker</a>
</main>

<style>
	.guide {
		flex: 1;
		width: 100%;
		max-width: 880px;
		margin: 0 auto;
		padding: 3.5rem 1.5rem 2.5rem;
	}

	.back {
		font-size: var(--text-md);
		color: var(--accent);
		text-decoration: none;
	}

	header {
		margin: 1.25rem 0 1.5rem;
		text-align: center;
	}

	.sub {
		margin-top: 0.5rem;
		color: var(--text-secondary);
	}

	.sub a {
		color: var(--accent);
		text-decoration: none;
	}

	img {
		display: block;
		width: 100%;
		height: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--bg-card);
	}

	.hero {
		margin-bottom: 2.5rem;
	}

	.hero img {
		box-shadow: var(--shadow-lift);
	}

	.steps {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		list-style: none;
	}

	.steps p {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		margin-bottom: 0.75rem;
		font-weight: 500;
	}

	.n {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 999px;
		background: var(--accent);
		color: var(--accent-ink);
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.go {
		display: flex;
		width: fit-content;
		margin: 2.5rem auto 0;
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
		text-decoration: none;
	}

	.go:hover {
		background: var(--accent-hover);
		border-color: var(--accent-hover);
	}

	@media (max-width: 560px) {
		.guide {
			padding: 3rem 1rem 2rem;
		}
	}
</style>
