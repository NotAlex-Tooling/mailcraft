<!-- Root layout component that imports global styles and renders page content -->
<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>mailcraft</title>
	<meta name="description" content="Generate, discover, and verify possible email addresses" />
</svelte:head>

{@render children()}
