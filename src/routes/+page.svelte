<!-- Email generation, verification, and search interface for discovering possible email addresses -->
<script lang="ts">
	import { browser } from '$app/environment';
	import {
		generateEmails,
		matchesQuery,
		CATEGORIES,
		ALGORITHM,
		type GeneratedEmail,
		type UserInput
	} from '$lib/email-generator';
	import { PROVIDERS, PROVIDER_REFERENCE } from '$lib/providers';

	let theme = $state<'dark' | 'light'>('dark');
	if (browser) {
		const saved = localStorage.getItem('mc-theme');
		if (saved === 'light' || saved === 'dark') theme = saved;
	}

	// Toggles between the dark and light themes and persists the choice.
	function toggleTheme() {
		theme = theme === 'dark' ? 'light' : 'dark';
		if (browser) localStorage.setItem('mc-theme', theme);
	}
	$effect(() => {
		if (browser) document.documentElement.setAttribute('data-theme', theme);
	});

	let query = $state('');

	const QUICK_DOMAINS = [
		'gmail.com',
		'outlook.com',
		'hotmail.com',
		'live.com',
		'yahoo.com',
		'ymail.com',
		'icloud.com',
		'me.com',
		'aol.com',
		'protonmail.com',
		'proton.me',
		'zoho.com',
		'mail.com',
		'gmx.com'
	];

	const AU_DOMAINS = [
		'bigpond.com',
		'optusnet.com.au',
		'bigpond.net.au',
		'tpg.com.au',
		'iinet.net.au'
	];

	const GLOBAL_DOMAINS = [
		'qq.com',
		'163.com',
		'mail.ru',
		'yandex.ru',
		'yahoo.co.jp'
	];

	let showGlobalDomains = $state(false);

	let customDomainInput = $state('');
	let customDomains = $state<string[]>([]);

	let firstName = $state('');
	let lastName = $state('');
	let middleName = $state('');
	let nickname = $state('');
	let birthYear = $state('');
	let birthMonth = $state('');
	let birthDay = $state('');
	let postcode = $state('');
	let showMore = $state(false);

	let nicknameInvalid = $derived(nickname.trim() !== '' && /[^a-z0-9._-]/i.test(nickname.trim()));

	let providerFilter = $state('all');
	let showReference = $state(false);
	let selectedEmail = $state<string | null>(null);
	let showDomains = $state(false);
	let disabledCategories = $state<Set<string>>(new Set());

	interface ExistenceResult {
		exists: boolean | null;
		provider: string;
		details?: Record<string, unknown>;
		rateLimited?: boolean;
	}

	interface VerifyResult {
		email: string;
		verdict: string;
		breachCount: number;
		layers: {
			syntax: { valid: boolean; error?: string };
			mx: { valid: boolean };
			disposable: { isDisposable: boolean };
			breaches: {
				xposedOrNot: { found: boolean; breaches?: string[] };
				leakCheck: { found: boolean; sources?: string[] };
				hibp: { found: boolean; breaches?: string[]; enabled: boolean };
			};
			existence: ExistenceResult[];
		};
	}

	let verificationResults = $state<Record<string, VerifyResult>>({});
	let verifying = $state(false);
	let verifyProgress = $state({ done: 0, total: 0 });
	let verifyingSingle = $state('');
	let existenceEnabled = $state(true);

	// Restores application state from URL query parameters.
	function initFromURL() {
		if (!browser) return;
		const p = new URLSearchParams(window.location.search);
		if (p.get('fn')) firstName = p.get('fn')!;
		if (p.get('ln')) lastName = p.get('ln')!;
		if (p.get('mn')) { middleName = p.get('mn')!; showMore = true; }
		if (p.get('nick')) { nickname = p.get('nick')!; showMore = true; }
		if (p.get('y')) birthYear = p.get('y')!;
		if (p.get('m')) { birthMonth = p.get('m')!; showMore = true; }
		if (p.get('d')) { birthDay = p.get('d')!; showMore = true; }
		if (p.get('pc')) { postcode = p.get('pc')!; showMore = true; }
		if (p.get('q')) query = p.get('q')!;
		if (p.get('cd')) {
			customDomains = p.get('cd')!.split(',').filter(Boolean);
			if (customDomains.length > 0) showDomains = true;
		}
	}

	initFromURL();

	// Writes current state to URL query parameters for shareable links.
	function updateURL() {
		if (!browser) return;
		const p = new URLSearchParams();
		if (firstName.trim()) p.set('fn', firstName.trim());
		if (lastName.trim()) p.set('ln', lastName.trim());
		if (middleName.trim()) p.set('mn', middleName.trim());
		if (nickname.trim()) p.set('nick', nickname.trim());
		if (birthYear.trim()) p.set('y', birthYear.trim());
		if (birthMonth.trim()) p.set('m', birthMonth.trim());
		if (birthDay.trim()) p.set('d', birthDay.trim());
		if (postcode.trim()) p.set('pc', postcode.trim());
		if (query.trim()) p.set('q', query.trim());
		if (customDomains.length > 0) p.set('cd', customDomains.join(','));
		const qs = p.toString();
		const newUrl = qs ? `?${qs}` : window.location.pathname;
		window.history.replaceState({}, '', newUrl);
	}

	$effect(() => {
		firstName; lastName; middleName; nickname;
		birthYear; birthMonth; birthDay; postcode;
		query; customDomains;
		updateURL();
	});

	let shareLink = $state('');

	// Copies the current URL with state to the clipboard for sharing.
	function copyShareLink() {
		if (!browser) return;
		updateURL();
		navigator.clipboard.writeText(window.location.href).then(() => {
			shareLink = 'copied!';
			setTimeout(() => (shareLink = ''), 2000);
		});
	}

	let allGenerated = $derived.by((): GeneratedEmail[] => {
		if (!firstName.trim() || !lastName.trim()) return [];

		const input: UserInput = {
			firstName: firstName.trim(),
			lastName: lastName.trim()
		};

		if (middleName.trim()) input.middleName = middleName.trim();
		if (nickname.trim() && !nicknameInvalid) input.nickname = nickname.trim();
		if (birthYear.trim()) input.birthYear = parseInt(birthYear.trim());
		if (birthMonth.trim()) input.birthMonth = parseInt(birthMonth.trim());
		if (birthDay.trim()) input.birthDay = parseInt(birthDay.trim());
		if (postcode.trim()) input.postcode = postcode.trim();
		if (customDomains.length > 0) input.customDomains = customDomains;
		if (disabledCategories.size > 0) input.disabledCategories = [...disabledCategories];

		return generateEmails(input);
	});

	let suggestions = $derived.by((): GeneratedEmail[] => {
		const q = query.trim().toLowerCase();
		if (!q) return allGenerated;
		return allGenerated.filter((r) => matchesQuery(r.email, q));
	});

	let filteredSuggestions = $derived(
		providerFilter === 'all'
			? suggestions
			: suggestions.filter((r) => r.provider === providerFilter)
	);

	let manualEmail = $derived.by((): GeneratedEmail | null => {
		const q = query.trim().toLowerCase();
		if (!q.includes('@') || q.includes('*') || q.includes('_')) return null;
		if (!/^[a-z0-9.+_-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(q)) return null;
		if (filteredSuggestions.some((r) => r.email === q)) return null;
		return { email: q, provider: q.substring(q.indexOf('@') + 1), pattern: 'manual entry', category: 'Manual', score: 0, commonality: 0, identifiability: 0 };
	});

	let rankedSuggestions = $derived.by((): GeneratedEmail[] => {
		verificationResults;
		const ranked = filteredSuggestions.map((r) => ({ r, rank: CONFIDENCE_RANK[confidenceOf(r.email)] }));
		ranked.sort((a, b) => (b.rank - a.rank) || (b.r.score - a.r.score));
		return ranked.map((x) => x.r);
	});

	let displaySuggestions = $derived(
		manualEmail ? [manualEmail, ...rankedSuggestions] : rankedSuggestions
	);

	let providers = $derived([...new Set(suggestions.map((r) => r.provider))]);

	let selectedResult = $derived(
		selectedEmail ? displaySuggestions.find((r) => r.email === selectedEmail) ?? null : null
	);

	let selectedVerification = $derived(
		selectedEmail ? verificationResults[selectedEmail] ?? null : null
	);

	type Confidence = 'confirmed' | 'likely' | 'plausible' | 'invalid' | 'unverified';

	const CONFIDENCE_RANK: Record<Confidence, number> = {
		confirmed: 4,
		likely: 3,
		plausible: 2,
		unverified: 1,
		invalid: 0
	};

	// Derives the evidence-based confidence level for an email from its verification result.
	function confidenceOf(email: string): Confidence {
		const v = verificationResults[email];
		if (!v) return 'unverified';
		if (v.verdict === 'invalid') return 'invalid';
		if (v.breachCount > 0) return 'confirmed';
		if (v.layers.existence?.some((e: ExistenceResult) => e.exists === true)) return 'likely';
		return 'plausible';
	}

	// Returns the label and theme classes used to render a confidence level.
	function confidenceMeta(c: Confidence): { label: string; chip: string; border: string; dot: string } {
		switch (c) {
			case 'confirmed':
				return { label: 'real', chip: 'border-[var(--ok-border)] bg-[var(--ok-bg)] text-[var(--ok)]', border: 'border-l-[var(--ok-solid)]', dot: 'bg-[var(--ok-solid)]' };
			case 'likely':
				return { label: 'likely', chip: 'border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info)]', border: 'border-l-[var(--info-solid)]', dot: 'bg-[var(--info-solid)]' };
			case 'plausible':
				return { label: 'plausible', chip: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]', border: 'border-l-[var(--border-strong)]', dot: 'bg-[var(--text-faint)]' };
			case 'invalid':
				return { label: 'invalid', chip: 'border-[var(--bad-border)] bg-[var(--bad-bg)] text-[var(--bad)]', border: 'border-l-transparent', dot: 'bg-[var(--bad-solid)]' };
			default:
				return { label: 'unverified', chip: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-faint)]', border: 'border-l-transparent', dot: 'bg-[var(--text-faint)]' };
		}
	}

	const PRIOR_TIER_THRESHOLDS = { likely: 0.7, possible: 0.45 };

	// Maps a structural prior score to a labelled tier shown on unverified rows.
	function priorTier(score: number): { label: string; cls: string } {
		if (score >= PRIOR_TIER_THRESHOLDS.likely) return { label: 'likely pattern', cls: 'text-[var(--text)]' };
		if (score >= PRIOR_TIER_THRESHOLDS.possible) return { label: 'possible', cls: 'text-[var(--text-muted)]' };
		return { label: 'unlikely', cls: 'text-[var(--text-faint)]' };
	}

	let showAlgorithm = $state(false);
	const CONFIDENCE_TIERS: { key: Confidence; weight: number; blurb: string }[] = [
		{ key: 'confirmed', weight: CONFIDENCE_RANK.confirmed, blurb: 'Appears in a breach corpus. A real person used the address to register somewhere, so the inbox exists.' },
		{ key: 'likely', weight: CONFIDENCE_RANK.likely, blurb: 'A linked account was found by an existence probe (Spotify, Adobe, and any others wired in).' },
		{ key: 'plausible', weight: CONFIDENCE_RANK.plausible, blurb: 'Valid syntax and a live MX record, but no usage evidence was found.' },
		{ key: 'unverified', weight: CONFIDENCE_RANK.unverified, blurb: 'Not checked yet. Ordered by the structural prior until verified.' },
		{ key: 'invalid', weight: CONFIDENCE_RANK.invalid, blurb: 'Failed a syntax, MX, or disposable check. Sorted to the bottom and dimmed.' }
	];

	// Toggles the selected email in the detail sidebar.
	function selectEmail(email: string) {
		selectedEmail = selectedEmail === email ? null : email;
	}

	let queryIsComplete = $derived.by(() => {
		const q = query.trim();
		if (!q.includes('@')) return false;
		if (q.includes('*') || q.includes('_')) return false;
		return /^[a-z0-9.+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(q);
	});

	let hasWildcards = $derived(query.includes('*') || query.includes('_'));

	type SegmentType = 'literal' | 'wildcard' | 'at' | 'domain';

	let patternSegments = $derived.by((): { char: string; type: SegmentType }[] => {
		const q = query;
		if (!q) return [];
		const atIdx = q.indexOf('@');
		return [...q].map((char, i) => {
			if (char === '@') return { char, type: 'at' as SegmentType };
			if (atIdx >= 0 && i > atIdx) return { char, type: 'domain' as SegmentType };
			if (char === '*' || char === '_') return { char, type: 'wildcard' as SegmentType };
			return { char, type: 'literal' as SegmentType };
		});
	});

	// Toggles a pattern category on or off for email generation filtering.
	function toggleCategory(cat: string) {
		const next = new Set(disabledCategories);
		if (next.has(cat)) next.delete(cat);
		else next.add(cat);
		disabledCategories = next;
	}

	// Adds a user-entered custom domain to the generation list.
	function addCustomDomain() {
		const d = customDomainInput.trim().toLowerCase();
		if (d && !customDomains.includes(d) && d.includes('.')) {
			customDomains = [...customDomains, d];
			customDomainInput = '';
		}
	}

	// Removes a custom domain from the generation list.
	function removeCustomDomain(domain: string) {
		customDomains = customDomains.filter((d) => d !== domain);
	}

	// Appends or replaces the domain portion of the search query.
	function appendDomain(domain: string) {
		const q = query.trim();
		const atIdx = q.indexOf('@');
		if (atIdx >= 0) {
			query = q.substring(0, atIdx + 1) + domain;
		} else {
			query = q + '@' + domain;
		}
	}

	// Verifies the email currently typed in the query input.
	async function handleVerifyQuery() {
		if (!queryIsComplete) return;
		await handleVerifySingle(query.trim().toLowerCase());
	}

	let verifyAbort = $state<AbortController | null>(null);

	// Verifies the top 10 unverified emails in the current results.
	async function handleVerifyTop() {
		if (displaySuggestions.length === 0) return;
		verifying = true;

		const emails = displaySuggestions
			.filter((r) => !verificationResults[r.email])
			.slice(0, 10)
			.map((r) => r.email);

		verifyProgress = { done: 0, total: emails.length };

		for (const email of emails) {
			verifyingSingle = email;
			try {
				const res = await fetch('/api/verify', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ emails: [email], checkExistence: existenceEnabled })
				});

				if (res.ok) {
					const data = await res.json();
					if (data.results?.[0]) {
						verificationResults = { ...verificationResults, [email]: data.results[0] };
					}
				}
			} catch {
			}
			verifyProgress = { done: verifyProgress.done + 1, total: emails.length };
		}

		verifyingSingle = '';
		verifying = false;
	}

	// Verifies all unverified emails in the current results with abort support.
	async function handleVerifyAll() {
		if (displaySuggestions.length === 0) return;
		const controller = new AbortController();
		verifyAbort = controller;
		verifying = true;

		const emails = displaySuggestions
			.filter((r) => !verificationResults[r.email])
			.map((r) => r.email);

		verifyProgress = { done: 0, total: emails.length };

		for (const email of emails) {
			if (controller.signal.aborted) break;
			verifyingSingle = email;
			try {
				const res = await fetch('/api/verify', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ emails: [email], checkExistence: existenceEnabled }),
					signal: controller.signal
				});

				if (res.ok) {
					const data = await res.json();
					if (data.results?.[0]) {
						verificationResults = { ...verificationResults, [email]: data.results[0] };
					}
				}
			} catch {
				if (controller.signal.aborted) break;
			}
			verifyProgress = { done: verifyProgress.done + 1, total: emails.length };
			if (!controller.signal.aborted) {
				await new Promise((r) => setTimeout(r, 500));
			}
		}

		verifyingSingle = '';
		verifying = false;
		verifyAbort = null;
	}

	// Aborts an in-progress bulk verification operation.
	function cancelVerify() {
		verifyAbort?.abort();
		verifyAbort = null;
		verifyingSingle = '';
		verifying = false;
	}

	// Verifies a single email address through the verification API.
	async function handleVerifySingle(email: string) {
		verifyingSingle = email;
		try {
			const res = await fetch('/api/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ emails: [email], checkExistence: existenceEnabled })
			});

			if (res.ok) {
				const data = await res.json();
				if (data.results?.[0]) {
					verificationResults = { ...verificationResults, [email]: data.results[0] };
				}
			}
		} catch {
		}
		verifyingSingle = '';
	}

	let copied = $state(false);

	// Copies all displayed email addresses to the clipboard.
	function copyAllEmails() {
		const text = displaySuggestions.map((r) => r.email).join('\n');
		navigator.clipboard.writeText(text).then(() => {
			copied = true;
			setTimeout(() => (copied = false), 2000);
		});
	}

	// Downloads all displayed results as a CSV file.
	function downloadCSV() {
		const header = 'email,provider,pattern,category,prior,commonality,identifiability,confidence,breaches';
		const rows = displaySuggestions.map((r) => {
			const v = verificationResults[r.email];
			const confidence = v ? confidenceOf(r.email) : 'unverified';
			const breaches = v ? v.breachCount : '';
			return `${r.email},${r.provider},"${r.pattern}",${r.category},${r.score},${r.commonality},${r.identifiability},${confidence},${breaches}`;
		});
		const csv = [header, ...rows].join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `emails-${firstName.trim() || 'export'}-${lastName.trim() || ''}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') showAlgorithm = false; }} />

<div class="relative min-h-screen overflow-x-hidden bg-[var(--bg)] text-[var(--text)]" data-theme={theme}>
	<div class="ambient" aria-hidden="true"></div>
	<div class="relative z-10 mx-auto max-w-[1200px] px-6 py-10">

		<div class="mb-6 animate-fade-up">
			<div class="flex items-start justify-between gap-4">
				<div>
					<h1 class="display text-2xl font-bold tracking-tight text-[var(--text)]">mailcraft</h1>
				</div>
				<div class="flex shrink-0 items-center gap-2">
					<button
						type="button"
						onclick={toggleTheme}
						aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
						class="surface-tx flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
					>
						{#if theme === 'dark'}
							<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></svg>
						{:else}
							<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
						{/if}
					</button>
					<button
						type="button"
						onclick={() => (showAlgorithm = true)}
						class="surface-tx shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)]"
					>
						how it works
					</button>
				</div>
			</div>
			<p class="mt-2 text-xs text-[var(--text-muted)]">Generate possible emails from common patterns and perform basic checks.</p>
			{#if firstName.trim() && lastName.trim()}
				<div class="mt-3 flex gap-2">
					<button
						onclick={copyShareLink}
						class="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]"
					>
						{shareLink || 'Share Link'}
					</button>
				</div>
			{/if}
		</div>

		<div class="surface-tx animate-fade-up mb-6 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 transition-all focus-within:border-[var(--brand)]" style="animation-delay:60ms">
			<svg class="h-4 w-4 shrink-0 text-[var(--text-faint)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
			<input
				type="text"
				bind:value={query}
				placeholder={firstName.trim() && lastName.trim() ? `${firstName.trim().charAt(0).toLowerCase()}*@gmail.com` : 'Search emails...'}
				class="flex-1 bg-transparent text-sm text-[var(--text)] placeholder-[var(--text-faint)] outline-none"
			/>
			{#if queryIsComplete}
				{@const v = verificationResults[query.trim().toLowerCase()]}
				{#if v}
					{@const qCm = confidenceMeta(confidenceOf(query.trim().toLowerCase()))}
					<div class="flex shrink-0 items-center gap-1">
						<span class="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide {qCm.chip}">{qCm.label}</span>
						{#if v.breachCount > 0}
							<span class="rounded-full border border-[var(--warn-border)] bg-[var(--warn-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--warn)]">{v.breachCount} {v.breachCount === 1 ? 'BREACH' : 'BREACHES'}</span>
						{/if}
						{#if v.layers.existence?.some((e: ExistenceResult) => e.rateLimited)}
							<span class="rounded-full border border-[var(--caution-border)] bg-[var(--caution-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--caution)]">LIMITED</span>
						{:else if v.layers.existence?.some((e: ExistenceResult) => e.exists === true)}
							<span class="rounded-full border border-[var(--info-border)] bg-[var(--info-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--info)]">{v.layers.existence.filter((e: ExistenceResult) => e.exists === true).length} {v.layers.existence.filter((e: ExistenceResult) => e.exists === true).length === 1 ? 'ACCOUNT' : 'ACCOUNTS'}</span>
						{/if}
					</div>
				{:else if verifyingSingle === query.trim().toLowerCase()}
					<span class="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--text-faint)] border-t-transparent"></span>
				{:else}
					<button onclick={handleVerifyQuery} class="shrink-0 rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]">test</button>
				{/if}
			{/if}
			{#if query}
				<button onclick={() => (query = '')} class="text-xs text-[var(--text-faint)] transition-colors hover:text-[var(--text)]">clear</button>
			{/if}
		</div>

		<div class="mb-2 flex items-center justify-between">
			{#if allGenerated.length > 0}
				<span class="text-xs text-[var(--text-faint)]">{suggestions.length} results</span>
			{:else}
				<span class="text-xs text-[var(--text-faint)]">Fill in person details to generate emails</span>
			{/if}
			<div class="flex items-center gap-x-3 text-[10px] text-[var(--text-faint)]">
				<span>Press <kbd class="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-0.5 text-[var(--text)]">/</kbd> to search, <kbd class="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-0.5 text-[var(--text)]">esc</kbd> to clear</span>
			</div>
		</div>

		<div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--text-faint)]">
			<span><code class="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-0.5 text-[var(--text)]">*</code> any chars</span>
			<span><code class="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-0.5 text-[var(--text)]">_</code> single char</span>
			<span class="text-[var(--border)]">|</span>
			<button onclick={() => (showDomains = !showDomains)} class="text-[var(--brand)] transition-colors hover:underline">{showDomains ? '- hide' : '+'} domains</button>
		</div>

		{#if query.includes('@')}
			<div class="mt-2.5 flex flex-wrap items-center gap-px">
				{#each patternSegments as seg}
					<span
						class="inline-flex h-7 min-w-[1ch] items-center justify-center px-0.5 text-base
							{seg.type === 'literal' ? (hasWildcards ? 'rounded bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--text-muted)]') : ''}
							{seg.type === 'wildcard' ? 'text-[var(--text)]' : ''}
							{seg.type === 'at' ? 'mx-0.5 text-[var(--text-faint)]' : ''}
							{seg.type === 'domain' ? 'text-[var(--brand)]' : ''}"
					>
						{seg.char}
					</span>
				{/each}
			</div>
		{/if}

		{#if showDomains}
			<div class="mt-3 flex flex-wrap items-center gap-1.5">
				{#each QUICK_DOMAINS as domain}
					<button onclick={() => appendDomain(domain)} class="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--brand)] transition-all hover:bg-[var(--brand-soft)]">{domain}</button>
				{/each}
			</div>
			<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
				<span class="text-[9px] font-medium uppercase tracking-wider text-[var(--text-faint)]">au</span>
				{#each AU_DOMAINS as domain}
					<button onclick={() => appendDomain(domain)} class="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--text-muted)] transition-all hover:bg-[var(--surface-2)]">{domain}</button>
				{/each}
				<span class="text-[var(--border)]">|</span>
				<button onclick={() => (showGlobalDomains = !showGlobalDomains)} class="text-[10px] text-[var(--brand)] hover:underline">{showGlobalDomains ? '- global' : '+ global'}</button>
				{#if showGlobalDomains}
					{#each GLOBAL_DOMAINS as domain}
						<button onclick={() => appendDomain(domain)} class="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--text-muted)] transition-all hover:bg-[var(--surface-2)]">{domain}</button>
					{/each}
				{/if}
			</div>
			<div class="mt-2 flex flex-wrap items-center gap-1.5">
				<input
					type="text"
					bind:value={customDomainInput}
					placeholder="custom domain"
					onkeydown={(e) => { if (e.key === 'Enter') addCustomDomain(); }}
					class="w-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[10px] text-[var(--text)] placeholder-[var(--text-faint)] outline-none transition-all focus:border-[var(--brand)]"
				/>
				<button onclick={addCustomDomain} class="rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-muted)] transition-all hover:bg-[var(--surface-2)] hover:text-[var(--text)]">+ add</button>
				{#each customDomains as domain}
					<span class="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[10px] text-[var(--text)]">
						{domain}
						<button onclick={() => removeCustomDomain(domain)} class="text-[var(--text-faint)] transition-colors hover:text-[var(--text)]">&times;</button>
					</span>
				{/each}
			</div>
		{/if}

		<div class="animate-fade-up mt-6 mb-4" style="animation-delay:120ms">
			<h2 class="display text-sm font-semibold text-[var(--text)]">Person Details</h2>
			<div class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-2.5">
				<div class="col-span-1 sm:col-span-2">
					<label for="firstName" class="mb-1 block text-[10px] font-medium text-[var(--text-muted)]">first *</label>
					<input id="firstName" type="text" bind:value={firstName} placeholder="john" class="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] placeholder-[var(--text-dim)] outline-none transition-all focus:border-[var(--brand)]" />
				</div>
				<div class="col-span-1 sm:col-span-2">
					<label for="lastName" class="mb-1 block text-[10px] font-medium text-[var(--text-muted)]">last *</label>
					<input id="lastName" type="text" bind:value={lastName} placeholder="doe" class="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] placeholder-[var(--text-dim)] outline-none transition-all focus:border-[var(--brand)]" />
				</div>
				<div>
					<label for="birthYear" class="mb-1 block text-[10px] font-medium text-[var(--text-muted)]">year</label>
					<input id="birthYear" type="text" bind:value={birthYear} placeholder="2003" maxlength="4" class="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] placeholder-[var(--text-dim)] outline-none transition-all focus:border-[var(--brand)]" />
				</div>
				<div>
					<span class="mb-1 block text-[9px] text-transparent select-none" aria-hidden="true">&nbsp;</span>
					<button onclick={() => (showMore = !showMore)} class="w-full rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[10px] text-[var(--text-muted)] transition-all hover:bg-[var(--surface-2)] hover:text-[var(--text)]">{showMore ? '- less' : '+ more'}</button>
				</div>
			</div>

			{#if showMore}
				<div class="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-2.5">
					<div class="col-span-1 sm:col-span-2">
						<label for="middleName" class="mb-1 block text-[10px] font-medium text-[var(--text-muted)]">middle</label>
						<input id="middleName" type="text" bind:value={middleName} placeholder="andrew" class="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] placeholder-[var(--text-dim)] outline-none transition-all focus:border-[var(--brand)]" />
					</div>
					<div class="col-span-1 sm:col-span-2">
						<label for="nickname" class="mb-1 block text-[10px] font-medium {nicknameInvalid ? 'text-[var(--bad)]' : 'text-[var(--text-muted)]'}">nickname / handle{nicknameInvalid ? ' (invalid)' : ''}</label>
						<input id="nickname" type="text" bind:value={nickname} placeholder="gamer123" class="w-full rounded-lg border bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] placeholder-[var(--text-dim)] outline-none transition-all {nicknameInvalid ? 'border-[var(--bad-border)] focus:border-[var(--bad-border)]' : 'border-[var(--border)] focus:border-[var(--brand)]'}" />
					</div>
					<div>
						<label for="postcode" class="mb-1 block text-[10px] font-medium text-[var(--text-muted)]">postcode</label>
						<input id="postcode" type="text" bind:value={postcode} placeholder="10001" maxlength="10" class="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] placeholder-[var(--text-dim)] outline-none transition-all focus:border-[var(--brand)]" />
					</div>
					<div>
						<label for="birthMonth" class="mb-1 block text-[10px] font-medium text-[var(--text-muted)]">month</label>
						<input id="birthMonth" type="text" bind:value={birthMonth} placeholder="03" maxlength="2" class="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] placeholder-[var(--text-dim)] outline-none transition-all focus:border-[var(--brand)]" />
					</div>
					<div>
						<label for="birthDay" class="mb-1 block text-[10px] font-medium text-[var(--text-muted)]">day</label>
						<input id="birthDay" type="text" bind:value={birthDay} placeholder="15" maxlength="2" class="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] placeholder-[var(--text-dim)] outline-none transition-all focus:border-[var(--brand)]" />
					</div>
				</div>
			{/if}
		</div>

		{#if firstName.trim() && lastName.trim()}
			<div class="mb-6">
				<div class="mb-2.5 flex items-center gap-2">
					<span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Patterns</span>
					{#if disabledCategories.size > 0}
						<span class="text-[10px] text-[var(--text-faint)]">{disabledCategories.size} off</span>
						<button onclick={() => (disabledCategories = new Set())} class="text-[10px] text-[var(--brand)] hover:underline">reset</button>
					{/if}
				</div>
				<div class="flex flex-wrap gap-1.5">
					{#each CATEGORIES as cat}
						{@const off = disabledCategories.has(cat.name)}
						{@const needsData = cat.requires === 'middleName' ? !middleName.trim()
							: cat.requires === 'birthYear' ? !birthYear.trim()
							: cat.requires === 'birthMonth' ? !birthMonth.trim()
							: cat.requires === 'postcode' ? !postcode.trim()
							: cat.requires === 'nickname' ? !nickname.trim()
							: cat.requires === 'multiWord' ? !lastName.trim().includes(' ')
							: false}
						<button
							onclick={() => toggleCategory(cat.name)}
							class="group/cat flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition-all
								{off
								? 'border-[var(--border)] bg-[var(--surface)] opacity-40 hover:opacity-60'
								: needsData
								? 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)]'
								: 'border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--border)]'}"
						>
							<code class="font-mono {off ? 'text-[var(--text-dim)] line-through' : needsData ? 'text-[var(--text-dim)]' : 'text-[var(--text)]'}">{cat.example}</code>
							<span class="{off ? 'text-[var(--text-dim)] line-through' : needsData ? 'text-[var(--text-dim)]' : 'text-[var(--text-muted)]'}">{cat.name}</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}

		{#if allGenerated.length > 0 || manualEmail}

		{#if providers.length > 1}
			<div class="mb-4 flex flex-wrap gap-1.5">
				<button
					onclick={() => (providerFilter = 'all')}
					class="rounded-full border px-3 py-1 text-xs font-medium transition-all
						{providerFilter === 'all'
						? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]'
						: 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'}"
				>
					All
				</button>
				{#each providers as provider}
					<button
						onclick={() => (providerFilter = provider)}
						class="rounded-full border px-3 py-1 text-xs font-medium transition-all
							{providerFilter === provider
							? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]'
							: 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'}"
					>
						{provider}
					</button>
				{/each}
			</div>
		{/if}

		<div class="mb-3 flex flex-wrap items-center gap-2">
			{#if displaySuggestions.length > 0}
				{#if verifying}
					<div class="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-[10px] font-medium text-[var(--text)]">
						<span class="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-[var(--text-muted)] border-t-transparent"></span>
						<span>{verifyProgress.done}/{verifyProgress.total}</span>
						<button onclick={cancelVerify} class="ml-1 text-[var(--text-faint)] hover:text-[var(--text)]">stop</button>
					</div>
				{:else}
					<button onclick={handleVerifyTop} class="rounded-full border border-[var(--border)] px-3 py-1 text-[10px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]">test top 10</button>
					<button onclick={handleVerifyAll} class="rounded-full border border-[var(--border)] px-3 py-1 text-[10px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]">test all</button>
					<button
						onclick={() => existenceEnabled = !existenceEnabled}
						class="rounded-full border px-3 py-1 text-[10px] font-medium transition-all {existenceEnabled ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'border-[var(--border)] text-[var(--text-faint)] hover:bg-[var(--surface-2)]'}"
					>
						accounts {existenceEnabled ? 'on' : 'off'}
					</button>
				{/if}
				<button onclick={copyAllEmails} class="rounded-full border border-[var(--border)] px-3 py-1 text-[10px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]">{copied ? 'copied!' : 'copy all'}</button>
				<button onclick={downloadCSV} class="rounded-full border border-[var(--border)] px-3 py-1 text-[10px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]">csv</button>
			{/if}
		</div>

		<div class="animate-fade-up flex flex-col lg:flex-row" style="animation-delay:180ms">
			<div class="min-w-0 flex-1 {selectedEmail ? 'lg:border-r lg:border-[var(--border)]' : ''}">
				{#if displaySuggestions.length === 0}
					<div class="py-8 text-center">
						<p class="text-xs text-[var(--text-faint)]">no matches</p>
					</div>
				{:else}
					<div class="max-h-[560px] overflow-y-auto">
						<div class="grid grid-cols-1 gap-1.5 p-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
						{#each displaySuggestions as result, i}
							{@const v = verificationResults[result.email]}
							{@const atIdx = result.email.indexOf('@')}
							{@const conf = confidenceOf(result.email)}
							{@const cm = confidenceMeta(conf)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								onclick={() => selectEmail(result.email)}
								onkeydown={(e) => { if (e.key === 'Enter') selectEmail(result.email); }}
								style="animation-delay:{Math.min(i, 24) * 20}ms"
								class="group animate-fade-up surface-tx flex cursor-pointer items-center gap-2.5 rounded-lg border border-l-2 px-3 py-2.5 transition-all hover:-translate-y-px
									{selectedEmail === result.email ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-hover)]'}
									{v ? cm.border : 'border-l-transparent'}
									{conf === 'confirmed' ? 'glow-ok' : ''}
									{conf === 'invalid' ? 'opacity-55' : ''}"
								role="option"
								tabindex="0"
								aria-selected={selectedEmail === result.email}
							>

							<div class="min-w-0 flex-1">
								<div class="truncate font-mono text-[13px] font-medium text-[var(--text)]">{result.email.substring(0, atIdx)}</div>
								<div class="text-[11px] text-[var(--text-faint)]">{result.email.substring(atIdx + 1)}</div>
							</div>

							<div class="flex shrink-0 flex-col items-end gap-1">
								<div class="flex items-center gap-1">
									{#if v}
										<span class="rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wide {cm.chip}">{cm.label}</span>
										{#if v.breachCount > 0}
											<span class="rounded-full border border-[var(--warn-border)] bg-[var(--warn-bg)] px-1.5 py-px text-[8px] font-bold text-[var(--warn)]">{v.breachCount} {v.breachCount === 1 ? 'BREACH' : 'BREACHES'}</span>
										{/if}
										{#if v.layers.existence?.some((e: ExistenceResult) => e.rateLimited)}
											<span class="rounded-full border border-[var(--caution-border)] bg-[var(--caution-bg)] px-1.5 py-px text-[8px] font-bold text-[var(--caution)]">LIMITED</span>
										{:else if v.layers.existence?.some((e: ExistenceResult) => e.exists === true)}
											<span class="rounded-full border border-[var(--info-border)] bg-[var(--info-bg)] px-1.5 py-px text-[8px] font-bold text-[var(--info)]">{v.layers.existence.filter((e: ExistenceResult) => e.exists === true).length} {v.layers.existence.filter((e: ExistenceResult) => e.exists === true).length === 1 ? 'ACCT' : 'ACCTS'}</span>
										{/if}
									{:else if verifyingSingle === result.email}
										<span class="inline-block h-3 w-3 animate-spin rounded-full border border-[var(--text-faint)] border-t-transparent"></span>
									{:else}
										{@const tier = priorTier(result.score)}
										<span class="text-[9px] font-medium {tier.cls}">{tier.label}</span>
										<button
											type="button"
											onclick={(e) => { e.stopPropagation(); handleVerifySingle(result.email); }}
											class="rounded-md bg-[var(--surface)] px-1.5 py-0.5 text-[9px] text-[var(--text-muted)] opacity-0 transition-all group-hover:opacity-100 hover:text-[var(--text)]"
										>
											test
										</button>
									{/if}
								</div>
								{#if result.score > 0}
									<span class="font-mono text-[10px] text-[var(--text-dim)]" title="structural prior, not a probability">prior {(result.score * 100).toFixed(0)}</span>
								{/if}
							</div>
							</div>
						{/each}
						</div>
					</div>
				{/if}
			</div>

			{#if selectedEmail && selectedResult}
				{@const sv = selectedVerification}
				{@const sTier = priorTier(selectedResult.score)}
				<div class="w-full border-t border-[var(--border)] lg:w-80 lg:border-t-0 xl:w-96">
					<div class="p-4">
						<div class="mb-4">
						<code class="break-all text-sm font-bold text-[var(--text)]">{selectedEmail.split('@')[0]}<span class="text-[var(--text-faint)]">@</span><span class="text-[var(--brand)]">{selectedEmail.split('@')[1]}</span></code>
							<div class="mt-1 flex items-center gap-2 text-[10px]">
								<span class="rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 text-[var(--text-muted)]">{selectedResult.pattern}</span>
								<span class="rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 text-[var(--text-muted)]">{selectedResult.category}</span>
							</div>
						</div>

						{#if sv}
							{@const sConf = confidenceOf(selectedEmail)}
							{@const sCm = confidenceMeta(sConf)}
							<div class="mb-4 rounded-xl border p-3 {sCm.chip}">
								<div class="flex items-center gap-2">
									<span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full {sCm.dot} {sConf === 'confirmed' ? 'dot-pulse' : ''}"></span>
									<span class="text-sm font-bold uppercase tracking-wide">{sCm.label}</span>
									{#if sv.breachCount > 0}
										<span class="ml-auto rounded-full border border-[var(--warn-border)] bg-[var(--warn-bg)] px-2.5 py-1 text-xs font-bold text-[var(--warn)]">{sv.breachCount} {sv.breachCount === 1 ? 'BREACH' : 'BREACHES'}</span>
									{/if}
								</div>
								<p class="mt-1.5 text-[11px] font-medium leading-snug opacity-90">
									{#if sConf === 'confirmed'}Found in a breach corpus. A real person used this address to sign up somewhere.
									{:else if sConf === 'likely'}A linked account was found, so this inbox very likely exists.
									{:else if sConf === 'plausible'}Valid syntax and a live mail server, but no usage evidence was found.
									{:else}Failed a check, so it won't receive mail. Treat as a dead end.{/if}
								</p>
							</div>

							<div class="mb-4 space-y-1">
								<h3 class="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">checks</h3>
								<div class="flex items-center gap-2.5 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs">
									<span class="inline-block h-2 w-2 shrink-0 rounded-full {sv.layers.syntax.valid ? 'bg-[var(--ok-solid)]' : 'bg-[var(--text-faint)]'}"></span>
									<span class="text-[var(--text)]">Syntax</span>
									<span class="ml-auto text-[11px] font-medium {sv.layers.syntax.valid ? 'text-[var(--text)]' : 'text-[var(--text-faint)]'}">{sv.layers.syntax.valid ? 'valid' : sv.layers.syntax.error || 'invalid'}</span>
								</div>
								<div class="flex items-center gap-2.5 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs">
									<span class="inline-block h-2 w-2 shrink-0 rounded-full {sv.layers.mx.valid ? 'bg-[var(--ok-solid)]' : 'bg-[var(--text-faint)]'}"></span>
									<span class="text-[var(--text)]">MX Record</span>
									<span class="ml-auto text-[11px] font-medium {sv.layers.mx.valid ? 'text-[var(--text)]' : 'text-[var(--text-faint)]'}">{sv.layers.mx.valid ? 'found' : 'missing'}</span>
								</div>
								<div class="flex items-center gap-2.5 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs">
									<span class="inline-block h-2 w-2 shrink-0 rounded-full {sv.layers.disposable.isDisposable ? 'bg-[var(--text-faint)]' : 'bg-[var(--ok-solid)]'}"></span>
									<span class="text-[var(--text)]">Disposable</span>
									<span class="ml-auto text-[11px] font-medium text-[var(--text-faint)]">{sv.layers.disposable.isDisposable ? 'yes' : 'no'}</span>
								</div>
								<div class="flex items-center gap-2.5 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs">
									<span class="inline-block h-2 w-2 shrink-0 rounded-full {sv.layers.breaches.xposedOrNot.found || sv.layers.breaches.leakCheck.found || sv.layers.breaches.hibp.found ? 'bg-[var(--warn-solid)]' : 'bg-[var(--text-faint)]'}"></span>
									<span class="text-[var(--text)]">Breaches</span>
									<span class="ml-auto text-[11px] font-medium {sv.breachCount > 0 ? 'text-[var(--warn)]' : 'text-[var(--text-faint)]'}">{sv.breachCount > 0 ? sv.breachCount + ' distinct' : 'none'}</span>
								</div>
								{#if sv.layers.existence && sv.layers.existence.length > 0}
									{@const existsCount = sv.layers.existence.filter((e: ExistenceResult) => e.exists === true).length}
									{@const isRateLimited = sv.layers.existence.some((e: ExistenceResult) => e.rateLimited)}
									<div class="flex items-center gap-2.5 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs">
										<span class="inline-block h-2 w-2 shrink-0 rounded-full {isRateLimited ? 'bg-[var(--caution-solid)]' : existsCount > 0 ? 'bg-[var(--info-solid)]' : 'bg-[var(--text-faint)]'}"></span>
										<span class="text-[var(--text)]">Accounts</span>
										<span class="ml-auto text-[11px] font-medium {isRateLimited ? 'text-[var(--caution)]' : existsCount > 0 ? 'text-[var(--info)]' : 'text-[var(--text-faint)]'}">{isRateLimited ? 'rate limited' : existsCount > 0 ? existsCount + ' found' : 'none'}</span>
									</div>
								{/if}
							</div>

							{#if sv.layers.breaches.xposedOrNot.found || sv.layers.breaches.leakCheck.found || sv.layers.breaches.hibp.found}
								<div class="rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)] p-3">
									<h3 class="mb-2 text-xs font-bold text-[var(--warn)]">Data Exposure</h3>
									{#if sv.layers.breaches.hibp.found}
										<div class="mb-2">
											<div class="flex items-center gap-1.5">
												<span class="inline-block h-2 w-2 rounded-full bg-[var(--warn-solid)]"></span>
												<span class="text-xs font-bold text-[var(--text)]">HIBP</span>
											</div>
											{#if sv.layers.breaches.hibp.breaches?.length}
												<div class="mt-1.5 flex flex-wrap gap-1 pl-3.5">
													{#each sv.layers.breaches.hibp.breaches.slice(0, 8) as breach}
														<span class="rounded-md bg-[var(--warn-chip)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--warn)]">{breach}</span>
													{/each}
													{#if sv.layers.breaches.hibp.breaches.length > 8}
														<span class="rounded-md bg-[var(--warn-chip)] px-1.5 py-0.5 text-[10px] text-[var(--warn)]">+{sv.layers.breaches.hibp.breaches.length - 8} more</span>
													{/if}
												</div>
											{/if}
										</div>
									{/if}
									{#if sv.layers.breaches.xposedOrNot.found}
										<div class="mb-2">
											<div class="flex items-center gap-1.5">
												<span class="inline-block h-2 w-2 rounded-full bg-[var(--warn-solid)]"></span>
												<span class="text-xs font-bold text-[var(--text)]">Breach Detected</span>
											</div>
											{#if sv.layers.breaches.xposedOrNot.breaches?.length}
												<div class="mt-1.5 flex flex-wrap gap-1 pl-3.5">
													{#each sv.layers.breaches.xposedOrNot.breaches.slice(0, 8) as breach}
														<span class="rounded-md bg-[var(--warn-chip)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--warn)]">{breach}</span>
													{/each}
													{#if sv.layers.breaches.xposedOrNot.breaches.length > 8}
														<span class="rounded-md bg-[var(--warn-chip)] px-1.5 py-0.5 text-[10px] text-[var(--warn)]">+{sv.layers.breaches.xposedOrNot.breaches.length - 8} more</span>
													{/if}
												</div>
											{/if}
										</div>
									{/if}
									{#if sv.layers.breaches.leakCheck.found}
										<div>
											<div class="flex items-center gap-1.5">
												<span class="inline-block h-2 w-2 rounded-full bg-[var(--warn-solid)]"></span>
												<span class="text-xs font-bold text-[var(--text)]">Leak Detected</span>
											</div>
											{#if sv.layers.breaches.leakCheck.sources?.length}
												<div class="mt-1.5 flex flex-wrap gap-1 pl-3.5">
													{#each sv.layers.breaches.leakCheck.sources as source}
														<span class="rounded-md bg-[var(--warn-chip)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--warn)]">{source}</span>
													{/each}
												</div>
											{/if}
										</div>
									{/if}
								</div>
							{/if}

							{#if sv.layers.existence?.some((e: ExistenceResult) => e.rateLimited)}
								<div class="mt-2 rounded-xl border border-[var(--caution-border)] bg-[var(--caution-bg)] p-3">
									<div class="flex items-center gap-1.5">
										<span class="inline-block h-2 w-2 rounded-full bg-[var(--caution-solid)]"></span>
										<span class="text-xs font-bold text-[var(--caution)]">Account checks rate limited</span>
									</div>
									<p class="mt-1 pl-3.5 text-[10px] text-[var(--caution)]">Too many requests. Try again in a few minutes.</p>
								</div>
							{:else if sv.layers.existence?.some((e: ExistenceResult) => e.exists === true)}
								<div class="mt-2 rounded-xl border border-[var(--info-border)] bg-[var(--info-bg)] p-3">
									<h3 class="mb-2 text-xs font-bold text-[var(--info)]">Account Existence</h3>
									{#each sv.layers.existence.filter((e: ExistenceResult) => e.exists === true) as entry}
										<div class="mb-2 last:mb-0">
											<div class="flex items-center gap-1.5">
												<span class="inline-block h-2 w-2 rounded-full bg-[var(--info-solid)]"></span>
												<span class="text-xs font-bold capitalize text-[var(--text)]">{entry.provider}</span>
											</div>
											{#if entry.details && Object.keys(entry.details).length > 0}
												<div class="mt-1.5 flex flex-wrap gap-1 pl-3.5">
													{#each Object.entries(entry.details) as [key, val]}
														<span class="rounded-md bg-[var(--info-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--info)]">{key}: {typeof val === 'boolean' ? (val ? 'yes' : 'no') : typeof val === 'object' ? JSON.stringify(val) : val}</span>
													{/each}
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{/if}

						{:else if verifyingSingle === selectedEmail}
							<div class="space-y-3">
								<div class="mb-3 flex items-center gap-2">
									<span class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--text-faint)] border-t-transparent"></span>
									<span class="text-xs text-[var(--text)]">Running checks...</span>
								</div>
								<div class="space-y-2">
									{#each ['Syntax validation', 'MX record lookup', 'Disposable check', 'Breach databases', 'Account existence'] as step, i}
										<div class="flex items-center gap-2 text-[11px]">
											<span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--text-faint)]" style="animation-delay: {i * 150}ms"></span>
											<span class="text-[var(--text-muted)]">{step}</span>
										</div>
									{/each}
								</div>
							</div>
						{:else}
							<button
								onclick={() => handleVerifySingle(selectedEmail ?? '')}
								class="w-full rounded-xl border border-[var(--border)] px-3 py-2.5 text-xs font-medium text-[var(--text)] transition-all hover:bg-[var(--surface-2)]"
							>
								test this email
							</button>
						{/if}

						<div class="mt-4 border-t border-[var(--border)] pt-4">
							<h3 class="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">pattern prior</h3>
							<p class="mb-3 text-[10px] leading-snug text-[var(--text-faint)]">How typical this format is: a structural guess, not a probability. Real confidence comes from the checks above.</p>
							<div class="space-y-2">
								<div class="flex items-center justify-between text-[11px]">
									<span class="text-[var(--text-muted)]">Commonality</span>
									<div class="flex items-center gap-2">
										<div class="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--border)]">
											<div class="h-full rounded-full bg-[var(--brand)] transition-all" style="width: {selectedResult.commonality * 100}%"></div>
										</div>
										<span class="w-7 text-right font-medium text-[var(--text)]">{(selectedResult.commonality * 100).toFixed(0)}</span>
									</div>
								</div>
								<div class="flex items-center justify-between text-[11px]">
									<span class="text-[var(--text-muted)]">Identifiability</span>
									<div class="flex items-center gap-2">
										<div class="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--border)]">
											<div class="h-full rounded-full bg-[var(--brand)] transition-all" style="width: {selectedResult.identifiability * 100}%"></div>
										</div>
										<span class="w-7 text-right font-medium text-[var(--text)]">{(selectedResult.identifiability * 100).toFixed(0)}</span>
									</div>
								</div>
								<div class="mt-1 flex items-center justify-between border-t border-[var(--border)] pt-2 text-[11px]">
									<span class="text-[var(--text-muted)]">Prior</span>
									<span class="flex items-baseline gap-1.5">
										<span class="text-[10px] font-medium {sTier.cls}">{sTier.label}</span>
										<span class="font-mono text-base font-bold text-[var(--text)]">{(selectedResult.score * 100).toFixed(0)}</span>
									</span>
								</div>
							</div>
						</div>

						<button
							onclick={() => { query = selectedEmail ?? ''; }}
							class="mt-4 w-full rounded-xl border border-[var(--border)] px-3 py-2 text-[11px] text-[var(--text-muted)] transition-all hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
						>
							use in query
						</button>
					</div>
				</div>
			{/if}
		</div>

		{/if}

		<div class="mt-6 mb-5 overflow-hidden rounded-xl border border-[var(--border)]">
			<button
				onclick={() => (showReference = !showReference)}
				class="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-[var(--surface-2)]"
			>
				<span class="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Provider Reference</span>
				<span class="rounded-md bg-[var(--surface-2)] px-2 py-0.5 text-[10px] text-[var(--text-faint)]">{showReference ? '-' : '+'}</span>
			</button>

			{#if showReference}
				<div class="border-t border-[var(--border)] px-5 pb-4 pt-3">
					<div class="overflow-x-auto">
						<table class="w-full text-[11px]">
							<thead>
								<tr class="border-b border-[var(--border)]">
									<th class="py-2 pr-3 text-left text-[10px] font-bold text-[var(--text-muted)]">provider</th>
									<th class="px-3 py-2 text-left text-[10px] font-bold text-[var(--text-muted)]">domains</th>
									<th class="px-3 py-2 text-left text-[10px] font-bold text-[var(--text-muted)]">rules</th>
								</tr>
							</thead>
							<tbody>
								{#each PROVIDER_REFERENCE as p}
									<tr class="border-b border-[var(--surface-2)] transition-colors hover:bg-[var(--surface-2)]">
										<td class="py-2 pr-3 font-medium text-[var(--text)]">{p.name}</td>
										<td class="px-3 py-2 font-mono text-[10px] text-[var(--brand)]">{p.domains.join(', ')}</td>
										<td class="px-3 py-2 text-[var(--text-muted)]">{p.rules}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}
		</div>

		<footer class="mt-10 border-t border-[var(--border)] pt-5 text-center text-[11px] text-[var(--text-faint)]">
			<a href="https://github.com/NotAlex-Tooling/" class="text-[var(--brand)] transition-colors hover:underline">Tooling by NotAlex</a>
			<span class="px-1.5 text-[var(--border)]">·</span>
			<a href="https://github.com/NotAlex-Tooling/mailcraft" class="text-[var(--brand)] transition-colors hover:underline">source code</a>
		</footer>

	</div>

	{#if showAlgorithm}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="animate-fade-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--backdrop)] p-4 backdrop-blur-md sm:p-8"
			onclick={() => (showAlgorithm = false)}
		>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="animate-scale-in surface-tx my-auto w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
				role="dialog"
				aria-modal="true"
				aria-label="Algorithm breakdown"
				onclick={(e) => e.stopPropagation()}
			>
				<div class="sticky top-0 z-10 flex items-center justify-between gap-4 rounded-t-2xl border-b border-[var(--border)] bg-[var(--surface)] px-5 py-3.5">
					<div>
						<h2 class="display text-sm font-bold text-[var(--text)]">how mailcraft works</h2>
						<p class="text-[11px] text-[var(--text-faint)]">generation and ranking internals</p>
					</div>
					<button
						type="button"
						onclick={() => (showAlgorithm = false)}
						aria-label="Close"
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
					>
						<svg class="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3l8 8M11 3l-8 8" stroke-linecap="round" /></svg>
					</button>
				</div>

				<div class="space-y-5 px-5 py-4 text-[12px] leading-relaxed text-[var(--text)]">
					{#if firstName.trim() && lastName.trim()}
						<div class="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
							Current input produces <span class="font-mono font-bold text-[var(--text)]">{allGenerated.length}</span> unique candidates across <span class="font-mono font-bold text-[var(--text)]">{PROVIDERS.length}</span> provider domains, capped at <span class="font-mono">{ALGORITHM.maxResults}</span>.
						</div>
					{/if}

					<section>
						<div class="mb-1 flex items-baseline gap-2">
							<span class="font-mono text-[10px] text-[var(--text-dim)]">01</span>
							<h3 class="text-xs font-bold text-[var(--text)]">token derivation</h3>
						</div>
						<p class="text-[var(--text-soft)]">
							Name parts are folded to ASCII before use. The input is lowercased, NFKD-normalized, stripped of combining marks, then mapped for letters that do not decompose (<span class="rounded bg-[var(--surface-2)] px-1 font-mono text-[11px]">ß</span> to ss, <span class="rounded bg-[var(--surface-2)] px-1 font-mono text-[11px]">æ</span> to ae, <span class="rounded bg-[var(--surface-2)] px-1 font-mono text-[11px]">ø</span> to o, and similar). So <span class="font-mono text-[11px]">José Müller</span> becomes <span class="font-mono text-[11px]">josemuller</span>. Tokens extracted: first, last, first initial, last initial, middle and middle initial, every word of a multi-word surname plus its initials, and the nickname handle (which keeps digits and the <span class="font-mono text-[11px]">. _ -</span> characters).
						</p>
					</section>

					<section>
						<div class="mb-1 flex items-baseline gap-2">
							<span class="font-mono text-[10px] text-[var(--text-dim)]">02</span>
							<h3 class="text-xs font-bold text-[var(--text)]">combination engine</h3>
						</div>
						<p class="text-[var(--text-soft)]">
							Generation is a cross product, not a fixed pattern list. Each name form (an ordered list of segments such as <span class="font-mono text-[11px]">[first, last]</span> or <span class="font-mono text-[11px]">[f, m, last]</span>) is joined with every separator, then every suffix is appended, then the result is paired with every provider domain:
						</p>
						<p class="mt-2 rounded-lg bg-[var(--text)] px-3 py-2 font-mono text-[11px] text-[var(--surface-2)]">forms x separators x suffixes x providers</p>
						<ul class="mt-2 space-y-1 text-[11px] text-[var(--text-soft)]">
							<li><span class="font-bold text-[var(--text)]">separators:</span> empty, dot, underscore, hyphen.</li>
							<li><span class="font-bold text-[var(--text)]">suffixes:</span> none, two and four digit birth year, mmdd, ddmm, mmddyy, postcode, and a fixed set of common trailing numbers. Dotted forms also get a dot-separated suffix variant, for example <span class="font-mono">first.last.88</span>.</li>
						</ul>
					</section>

					<section>
						<div class="mb-1 flex items-baseline gap-2">
							<span class="font-mono text-[10px] text-[var(--text-dim)]">03</span>
							<h3 class="text-xs font-bold text-[var(--text)]">provider validation gate</h3>
						</div>
						<p class="text-[var(--text-soft)]">
							Before a candidate is kept, the local part is validated against the target provider's real rules: permitted characters, must-start-with-letter, and length. Length is measured on the canonical base, so Gmail counts the dot-stripped, tag-stripped form. Candidates that a provider would reject are discarded at generation time, so the verifier never has to reject something the generator produced.
						</p>
					</section>

					<section>
						<div class="mb-1 flex items-baseline gap-2">
							<span class="font-mono text-[10px] text-[var(--text-dim)]">04</span>
							<h3 class="text-xs font-bold text-[var(--text)]">scoring (the prior)</h3>
						</div>
						<p class="text-[var(--text-soft)]">
							Every candidate carries two structural axes, derived from its shape rather than hand-assigned per pattern. <span class="font-bold text-[var(--text)]">Commonality</span> is how typical the format is. <span class="font-bold text-[var(--text)]">Identifiability</span> is how uniquely it points to this specific person. They combine into a single prior:
						</p>
						<div class="mt-2 space-y-1.5 rounded-lg bg-[var(--surface-2)] px-3 py-2.5 font-mono text-[11px] text-[var(--text)]">
							<div>commonality = formCommon x sepFactor x suffixCommon, clamped 0 to 1</div>
							<div>identifiability = formIdent + suffixIdentBonus, clamped 0 to 1</div>
							<div class="border-t border-[var(--border)] pt-1.5">prior = commonality x {ALGORITHM.priorWeights.commonality} + identifiability x {ALGORITHM.priorWeights.identifiability} + providerWeight x {ALGORITHM.priorWeights.provider}</div>
						</div>
						<div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
							<span class="text-[var(--text-muted)]">separator factors:</span>
							{#each Object.entries(ALGORITHM.separatorFactors) as [sep, factor]}
								<span class="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px]">{sep === '' ? '(none)' : sep} = {factor}</span>
							{/each}
						</div>
						<p class="mt-2 text-[11px] text-[var(--text-soft)]">
							Arbitrary trailing numbers carry deliberately low commonality so they sink to the tail, and they only attach to forms whose commonality is at least <span class="font-mono">{ALGORITHM.numberSuffixMinCommon}</span>. Provider weight is a rough popularity prior, not an authoritative market share, and is the smallest term on purpose.
						</p>
					</section>

					<section>
						<div class="mb-1 flex items-baseline gap-2">
							<span class="font-mono text-[10px] text-[var(--text-dim)]">05</span>
							<h3 class="text-xs font-bold text-[var(--text)]">canonical dedup</h3>
						</div>
						<p class="text-[var(--text-soft)]">
							Results are keyed by the address that actually reaches an inbox. For Gmail the key strips dots and any <span class="font-mono text-[11px]">+tag</span>, so <span class="font-mono text-[11px]">john.doe</span> and <span class="font-mono text-[11px]">johndoe</span> collapse to one entry and the higher-prior representation is kept. Sibling domains stay separate because the domain is part of the key, so <span class="font-mono text-[11px]">@hotmail.com</span> and <span class="font-mono text-[11px]">@outlook.com</span> are never merged even though they share rules.
						</p>
					</section>

					<section>
						<div class="mb-1 flex items-baseline gap-2">
							<span class="font-mono text-[10px] text-[var(--text-dim)]">06</span>
							<h3 class="text-xs font-bold text-[var(--text)]">budget and caps</h3>
						</div>
						<p class="text-[var(--text-soft)]">
							Speculative number variants are capped at <span class="font-mono">{ALGORITHM.numberBudget}</span> so they cannot crowd out structural patterns. The full list is then capped at <span class="font-mono">{ALGORITHM.maxResults}</span>. Structural forms (names, initials, middle name, birthday, location, nickname) are assembled first and are never evicted by number noise.
						</p>
					</section>

					<section>
						<div class="mb-1 flex items-baseline gap-2">
							<span class="font-mono text-[10px] text-[var(--text-dim)]">07</span>
							<h3 class="text-xs font-bold text-[var(--text)]">ranking by evidence</h3>
						</div>
						<p class="text-[var(--text-soft)]">
							The prior only orders unverified guesses. Once an address is checked, it is assigned a confidence from the actual evidence, and the list re-sorts by that confidence first with the prior as the tiebreaker. Higher weight sorts higher:
						</p>
						<div class="mt-2 space-y-1.5">
							{#each CONFIDENCE_TIERS as tier}
								{@const meta = confidenceMeta(tier.key)}
								<div class="flex items-start gap-2.5 rounded-lg border border-[var(--border)] px-2.5 py-2">
									<span class="mt-0.5 inline-flex w-16 shrink-0 items-center gap-1.5">
										<span class="inline-block h-2 w-2 rounded-full {meta.dot}"></span>
										<span class="text-[10px] font-bold uppercase tracking-wide text-[var(--text)]">{meta.label}</span>
									</span>
									<span class="font-mono text-[10px] text-[var(--text-dim)]">{tier.weight}</span>
									<span class="flex-1 text-[11px] text-[var(--text-soft)]">{tier.blurb}</span>
								</div>
							{/each}
						</div>
						<p class="mt-2 text-[11px] text-[var(--text-soft)]">
							Unverified rows display a prior tier instead of a confidence: <span class="font-bold text-[var(--text)]">likely pattern</span> at <span class="font-mono">{PRIOR_TIER_THRESHOLDS.likely}</span> and above, <span class="font-bold text-[var(--text)]">possible</span> from <span class="font-mono">{PRIOR_TIER_THRESHOLDS.possible}</span> to <span class="font-mono">{PRIOR_TIER_THRESHOLDS.likely}</span>, and <span class="font-bold text-[var(--text)]">unlikely</span> below <span class="font-mono">{PRIOR_TIER_THRESHOLDS.possible}</span>.
						</p>
					</section>
				</div>
			</div>
		</div>
	{/if}
</div>
