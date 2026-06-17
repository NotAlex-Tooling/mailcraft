// Generates and scores candidate email addresses from personal information by combining name forms, separators, suffixes, and providers, deduplicated by canonical inbox.
import { PROVIDERS, isValidForProvider, canonicalizeEmail, type Provider } from './providers';

export interface UserInput {
	firstName: string;
	lastName: string;
	middleName?: string;
	nickname?: string;
	birthYear?: number;
	birthMonth?: number;
	birthDay?: number;
	postcode?: string;
	customDomains?: string[];
	disabledCategories?: string[];
}

export interface CategoryInfo {
	name: string;
	example: string;
	requires?: string;
}

export const CATEGORIES: CategoryInfo[] = [
	{ name: 'Name Combinations', example: 'first.last' },
	{ name: 'Initials', example: 'flast' },
	{ name: 'Middle Name', example: 'first.m.last', requires: 'middleName' },
	{ name: 'With Year', example: 'first.last03', requires: 'birthYear' },
	{ name: 'With Birthday', example: 'first0315', requires: 'birthMonth' },
	{ name: 'Location', example: 'first10001', requires: 'postcode' },
	{ name: 'Nickname/Handle', example: 'handle', requires: 'nickname' },
	{ name: 'Separators', example: 'first_last' },
	{ name: 'Simple', example: 'first' },
	{ name: 'Multi-word', example: 'first.de.last', requires: 'multiWord' },
	{ name: 'Numbers', example: 'first.last1' }
];

export interface GeneratedEmail {
	email: string;
	provider: string;
	pattern: string;
	category: string;
	score: number;
	commonality: number;
	identifiability: number;
}

const MAX_RESULTS = 2500;
const NUMBER_BUDGET = 280;
const NUMBER_SUFFIX_MIN_COMMON = 0.45;
const PRIOR_WEIGHTS = { commonality: 0.42, identifiability: 0.48, provider: 0.1 } as const;

// Folds accents and diacritics to ASCII so international names transliterate (José -> jose, Müller -> muller).
function fold(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/ß/g, 'ss')
		.replace(/æ/g, 'ae')
		.replace(/œ/g, 'oe')
		.replace(/ø/g, 'o')
		.replace(/đ/g, 'd')
		.replace(/ł/g, 'l')
		.replace(/þ/g, 'th');
}

// Folds a string and strips everything except lowercase letters.
function clean(s: string): string {
	return fold(s).replace(/[^a-z]/g, '');
}

// Folds a string and keeps only characters valid in a username (letters, digits, dot, underscore, hyphen).
function cleanUsername(s: string): string {
	return fold(s).replace(/[^a-z0-9._-]/g, '');
}

const SEP_FACTOR: Record<string, number> = { '': 1.0, '.': 0.97, '_': 0.5, '-': 0.38 };
const SEPARATORS = ['', '.', '_', '-'];

export const ALGORITHM = {
	maxResults: MAX_RESULTS,
	numberBudget: NUMBER_BUDGET,
	numberSuffixMinCommon: NUMBER_SUFFIX_MIN_COMMON,
	priorWeights: PRIOR_WEIGHTS,
	separatorFactors: SEP_FACTOR
} as const;

interface NameForm {
	segs: string[];
	labels: string[];
	common: number;
	ident: number;
	category: string;
	multiSegment: boolean;
}

interface Suffix {
	value: string;
	label: string;
	common: number;
	identBonus: number;
	category: string | null;
	isNumber: boolean;
}

// Clamps a number to the 0–1 range.
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// Derives the ordered name forms (first.last, initials, middle name, multi-word variants) from the input.
function buildNameForms(input: UserInput): NameForm[] {
	const first = clean(input.firstName);
	const last = clean(input.lastName);
	if (!first || !last) return [];

	const fi = first[0];
	const li = last[0];
	const middle = input.middleName ? clean(input.middleName) : '';
	const mi = middle ? middle[0] : '';

	const lastWords = input.lastName.trim().toLowerCase().split(/\s+/).map(clean).filter((w) => w.length > 0);
	const isMultiWord = lastWords.length > 1;

	const forms: NameForm[] = [
		{ segs: [first, last], labels: ['first', 'last'], common: 1.0, ident: 0.92, category: 'Name Combinations', multiSegment: true },
		{ segs: [last, first], labels: ['last', 'first'], common: 0.5, ident: 0.88, category: 'Name Combinations', multiSegment: true },
		{ segs: [fi, last], labels: ['f', 'last'], common: 0.7, ident: 0.62, category: 'Initials', multiSegment: true },
		{ segs: [first, li], labels: ['first', 'l'], common: 0.55, ident: 0.6, category: 'Initials', multiSegment: true },
		{ segs: [fi, li], labels: ['f', 'l'], common: 0.28, ident: 0.25, category: 'Initials', multiSegment: true },
		{ segs: [first], labels: ['first'], common: 0.45, ident: 0.28, category: 'Simple', multiSegment: false },
		{ segs: [last], labels: ['last'], common: 0.3, ident: 0.3, category: 'Simple', multiSegment: false }
	];

	if (middle) {
		forms.push(
			{ segs: [first, mi, last], labels: ['first', 'm', 'last'], common: 0.62, ident: 0.95, category: 'Middle Name', multiSegment: true },
			{ segs: [first, middle, last], labels: ['first', 'middle', 'last'], common: 0.32, ident: 0.99, category: 'Middle Name', multiSegment: true },
			{ segs: [fi, mi, last], labels: ['f', 'm', 'last'], common: 0.4, ident: 0.8, category: 'Middle Name', multiSegment: true },
			{ segs: [first, mi], labels: ['first', 'm'], common: 0.2, ident: 0.7, category: 'Middle Name', multiSegment: true }
		);
	}

	if (isMultiWord) {
		const lastInitials = lastWords.map((w) => w[0]).join('');
		forms.push(
			{ segs: [first, lastInitials], labels: ['first', 'lastinitials'], common: 0.45, ident: 0.7, category: 'Multi-word', multiSegment: true },
			{ segs: [fi, lastInitials], labels: ['f', 'lastinitials'], common: 0.3, ident: 0.45, category: 'Multi-word', multiSegment: true },
			{ segs: [first, ...lastWords], labels: ['first', ...lastWords], common: 0.35, ident: 0.85, category: 'Multi-word', multiSegment: true }
		);
		for (const word of lastWords) {
			if (word.length > 2) {
				forms.push({ segs: [first, word], labels: ['first', word], common: 0.4, ident: 0.6, category: 'Multi-word', multiSegment: true });
			}
		}
	}

	return forms;
}

// Builds the suffix list (birth year, birthday, postcode, and common trailing numbers) appended to name forms.
function buildSuffixes(input: UserInput): Suffix[] {
	const suffixes: Suffix[] = [{ value: '', label: '', common: 1.0, identBonus: 0, category: null, isNumber: false }];

	const year4 = input.birthYear ? String(input.birthYear) : '';
	const year2 = year4 ? year4.slice(-2) : '';
	const mm = input.birthMonth ? String(input.birthMonth).padStart(2, '0') : '';
	const dd = input.birthDay ? String(input.birthDay).padStart(2, '0') : '';
	const postcode = input.postcode ? input.postcode.replace(/[^a-z0-9]/gi, '').toLowerCase() : '';

	if (year2) {
		suffixes.push({ value: year2, label: 'yy', common: 0.85, identBonus: 0.1, category: 'With Year', isNumber: false });
		suffixes.push({ value: year4, label: 'yyyy', common: 0.6, identBonus: 0.12, category: 'With Year', isNumber: false });
	}
	if (mm && dd) {
		suffixes.push({ value: mm + dd, label: 'mmdd', common: 0.5, identBonus: 0.15, category: 'With Birthday', isNumber: false });
		suffixes.push({ value: dd + mm, label: 'ddmm', common: 0.4, identBonus: 0.15, category: 'With Birthday', isNumber: false });
		if (year2) suffixes.push({ value: mm + dd + year2, label: 'mmddyy', common: 0.32, identBonus: 0.18, category: 'With Birthday', isNumber: false });
	}
	if (postcode) {
		suffixes.push({ value: postcode, label: 'postcode', common: 0.4, identBonus: 0.18, category: 'Location', isNumber: false });
	}

	const numbers = ['1', '2', '3', '7', '01', '11', '12', '22', '23', '69', '77', '88', '99', '123', '007', '1234'];
	for (const n of numbers) {
		const common = n.length <= 1 ? 0.38 : n.length <= 2 ? 0.18 : n.length <= 3 ? 0.1 : 0.07;
		suffixes.push({ value: n, label: n, common, identBonus: 0, category: 'Numbers', isNumber: true });
	}

	return suffixes;
}

// Resolves the display category for a candidate from its name form, separator, and suffix.
function resolveCategory(form: NameForm, sep: string, suffix: Suffix): string {
	if (form.category === 'Nickname/Handle') return 'Nickname/Handle';
	if (suffix.category) return suffix.category;
	if ((sep === '_' || sep === '-') && form.multiSegment) return 'Separators';
	return form.category;
}

// Builds the human-readable pattern label (e.g. first.last.88) for a candidate.
function describePattern(form: NameForm, sep: string, suffix: Suffix, dottedSuffix: boolean): string {
	const body = form.labels.length > 1 ? form.labels.join(sep || '') : form.labels[0];
	if (!suffix.value) return body;
	return body + (dottedSuffix ? '.' : '') + suffix.label;
}

interface Candidate {
	local: string;
	pattern: string;
	category: string;
	commonality: number;
	identifiability: number;
}

// Produces the full set of scored local-part candidates from name forms, separators, and suffixes.
function buildCandidates(input: UserInput): Candidate[] {
	const forms = buildNameForms(input);

	const nick = input.nickname ? cleanUsername(input.nickname) : '';
	if (nick) {
		forms.push({ segs: [nick], labels: ['handle'], common: 0.9, ident: 0.9, category: 'Nickname/Handle', multiSegment: false });
	}

	const suffixes = buildSuffixes(input);
	const out: Candidate[] = [];
	const seen = new Set<string>();

	for (const form of forms) {
		const seps = form.multiSegment ? SEPARATORS : [''];
		for (const sep of seps) {
			const base = form.segs.join(sep);
			if (!base) continue;
			const sepFactor = form.multiSegment ? SEP_FACTOR[sep] : 1.0;

			for (const suffix of suffixes) {
				if (suffix.isNumber && form.common < NUMBER_SUFFIX_MIN_COMMON) continue;

				const attachments: { local: string; dotted: boolean; common: number }[] = [
					{ local: base + suffix.value, dotted: false, common: 1.0 }
				];
				if (sep === '.' && suffix.value && (suffix.category === 'With Year' || suffix.category === 'Numbers')) {
					attachments.push({ local: base + '.' + suffix.value, dotted: true, common: 0.6 });
				}

				for (const att of attachments) {
					if (seen.has(att.local)) continue;
					seen.add(att.local);

					out.push({
						local: att.local,
						pattern: describePattern(form, sep, suffix, att.dotted),
						category: resolveCategory(form, sep, suffix),
						commonality: clamp01(form.common * sepFactor * suffix.common * att.common),
						identifiability: clamp01(form.ident + suffix.identBonus)
					});
				}
			}
		}
	}

	return out;
}

// Converts a wildcard query (* and _) into an anchored regular expression source string.
function wildcardToRegex(pattern: string): string {
	let regex = '^';
	for (const char of pattern) {
		if (char === '*') regex += '.*';
		else if (char === '_') regex += '.';
		else regex += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
	regex += '$';
	return regex;
}

// Tests whether an email matches a wildcard query against its local part and optional domain.
export function matchesQuery(email: string, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;

	const emailLower = email.toLowerCase();
	const at = emailLower.indexOf('@');
	if (at === -1) return false;

	const emailLocal = emailLower.substring(0, at);
	const emailDomain = emailLower.substring(at + 1);

	const queryAt = q.indexOf('@');
	if (queryAt === -1) {
		try {
			return new RegExp(wildcardToRegex(q)).test(emailLocal);
		} catch {
			return emailLocal.includes(q);
		}
	}

	const localPattern = q.substring(0, queryAt);
	const domainPattern = q.substring(queryAt + 1);

	let localOk = true;
	if (localPattern) {
		try {
			localOk = new RegExp(wildcardToRegex(localPattern)).test(emailLocal);
		} catch {
			localOk = emailLocal.includes(localPattern);
		}
	}

	let domainOk = true;
	if (domainPattern && domainPattern !== '*') {
		try {
			domainOk = new RegExp(wildcardToRegex(domainPattern)).test(emailDomain);
		} catch {
			domainOk = emailDomain === domainPattern;
		}
	}

	return localOk && domainOk;
}

// Combines candidates with providers, validates and scores each, dedups by canonical inbox, and returns the ranked list.
export function generateEmails(input: UserInput): GeneratedEmail[] {
	if (!input.firstName.trim() || !input.lastName.trim()) return [];

	const allCandidates = buildCandidates(input);
	const disabled = new Set(input.disabledCategories ?? []);
	const candidates = disabled.size > 0 ? allCandidates.filter((c) => !disabled.has(c.category)) : allCandidates;

	const providers: Provider[] = [...PROVIDERS];
	if (input.customDomains) {
		for (const domain of input.customDomains) {
			const d = domain.trim().toLowerCase();
			if (d && d.includes('.') && !providers.some((p) => p.domain === d)) {
				providers.push({
					domain: d, name: d, aliases: [], family: 'Custom', weight: 0.05,
					allowsDot: true, allowsUnderscore: true, allowsHyphen: true, allowsPlus: true,
					mustStartWithLetter: false, dotIsDistinct: true, plusIsAlias: false,
					minLength: 1, maxLength: 64
				});
			}
		}
	}

	const byCanonical = new Map<string, GeneratedEmail>();

	for (const provider of providers) {
		for (const cand of candidates) {
			if (!isValidForProvider(cand.local, provider)) continue;

			const email = `${cand.local}@${provider.domain}`;
			const key = canonicalizeEmail(email);

			const score = clamp01(
				cand.commonality * PRIOR_WEIGHTS.commonality +
					cand.identifiability * PRIOR_WEIGHTS.identifiability +
					provider.weight * PRIOR_WEIGHTS.provider
			);

			const existing = byCanonical.get(key);
			if (existing && existing.score >= score) continue;

			byCanonical.set(key, {
				email,
				provider: provider.name,
				pattern: cand.pattern,
				category: cand.category,
				score: Math.round(score * 100) / 100,
				commonality: Math.round(cand.commonality * 100) / 100,
				identifiability: Math.round(cand.identifiability * 100) / 100
			});
		}
	}

	const all = [...byCanonical.values()];
	const byScore = (a: GeneratedEmail, b: GeneratedEmail) => b.score - a.score;
	const structural = all.filter((c) => c.category !== 'Numbers').sort(byScore);
	const numbers = all.filter((c) => c.category === 'Numbers').sort(byScore).slice(0, NUMBER_BUDGET);
	const results = [...structural, ...numbers].sort(byScore);
	return results.length > MAX_RESULTS ? results.slice(0, MAX_RESULTS) : results;
}
