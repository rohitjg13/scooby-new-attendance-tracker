<script lang="ts">
	import { onMount } from "svelte";
	import "../app.css";
	let { children } = $props();

	// Two states. Until you pick one, the CSS follows your system on its own —
	// so the first render is right, and this only has to know which way the
	// button should flip.
	let theme = $state<"light" | "dark">("light");

	onMount(() => {
		const saved = localStorage.getItem("theme");
		theme =
			saved === "light" || saved === "dark"
				? saved
				: matchMedia("(prefers-color-scheme: dark)").matches
					? "dark"
					: "light";
	});

	function toggle() {
		theme = theme === "dark" ? "light" : "dark";
		document.documentElement.setAttribute("data-theme", theme);
		localStorage.setItem("theme", theme);
	}
</script>

<svelte:head>
	<meta name="theme-color" content="#fffdf6" media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content="#0d0c09" media="(prefers-color-scheme: dark)" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link
		rel="preconnect"
		href="https://fonts.gstatic.com"
		crossorigin="anonymous"
	/>
	<link
		href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Libre+Franklin:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="app-container">
	<button
		class="theme"
		onclick={toggle}
		title={theme === "dark" ? "Switch to light" : "Switch to dark"}
		aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
	>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
			{#if theme === "dark"}
				<circle cx="12" cy="12" r="4" />
				<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
			{:else}
				<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
			{/if}
		</svg>
	</button>

	{@render children()}

	<footer class="footer">
		<span class="rule"></span>
		<p>
			Built and maintained by <a
				href="https://github.com/rohitjg13"
				target="_blank"
				rel="noopener noreferrer">Rohit J G</a
			>
		</p>
	</footer>
</div>

<style>
	.app-container {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	.footer {
		display: flex;
		flex-direction: column;
		align-items: center;
		margin-top: auto;
		padding: 2.5rem 1.5rem 2rem;
		text-align: center;
		color: var(--text-muted);
		font-size: 0.8rem;
	}

	/* Top right of every page. Below the modals, which sit at 1000+, so it
	   can never float over a dialog. */
	.theme {
		position: fixed;
		top: 0.6rem;
		right: 0.6rem;
		z-index: 90;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 2px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-card);
		color: var(--text-secondary);
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.theme:hover {
		color: var(--accent);
		border-color: var(--accent);
	}

	.theme svg {
		width: 16px;
		height: 16px;
	}

	.rule {
		display: block;
		width: 28px;
		height: 1px;
		margin: 0 auto 1.25rem;
		background: var(--border-hover);
	}

	.footer a {
		color: var(--text-secondary);
		text-decoration: none;
		border-bottom: 1px solid var(--border-hover);
		transition: color 0.15s;
	}

	.footer a:hover {
		color: var(--accent);
		border-color: var(--accent);
	}
</style>
