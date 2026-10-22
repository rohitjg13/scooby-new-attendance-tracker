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
	<meta name="theme-color" content="#f5f5f7" media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
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
			> (Secretary of IT) in collaboration with the Secretaries of Academics
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
		top: 1rem;
		right: 1rem;
		z-index: 90;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: color-mix(in srgb, var(--bg-card) 80%, transparent);
		backdrop-filter: saturate(180%) blur(20px);
		-webkit-backdrop-filter: saturate(180%) blur(20px);
		box-shadow: var(--shadow);
		color: var(--text-secondary);
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.theme:hover {
		color: var(--accent);
		border-color: var(--border-hover);
	}

	.theme svg {
		width: 17px;
		height: 17px;
	}

	.rule {
		display: block;
		width: 40px;
		height: 1px;
		margin: 0 auto 1.25rem;
		background: var(--border);
	}

	.footer a {
		color: var(--text-secondary);
		font-weight: 500;
		text-decoration: none;
		transition: color 0.15s;
	}

	.footer a:hover {
		color: var(--accent);
	}
</style>
