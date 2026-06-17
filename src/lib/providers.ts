// Single source of truth for email provider rules; drives generation, validation, server-side syntax checks, and the UI reference table.

export interface Provider {
	domain: string;
	name: string;
	aliases: string[];
	family: string;
	weight: number;
	allowsDot: boolean;
	allowsUnderscore: boolean;
	allowsHyphen: boolean;
	allowsPlus: boolean;
	mustStartWithLetter: boolean;
	dotIsDistinct: boolean;
	plusIsAlias: boolean;
	minLength: number;
	maxLength: number;
}

type Rules = Pick<
	Provider,
	| 'allowsDot' | 'allowsUnderscore' | 'allowsHyphen' | 'allowsPlus'
	| 'mustStartWithLetter' | 'dotIsDistinct' | 'plusIsAlias' | 'minLength' | 'maxLength'
>;

const RULES: Record<string, Rules & { family: string; summary: string }> = {
	gmail: {
		family: 'Gmail', summary: '6–30 chars (dots ignored), letters/numbers/dots only, + aliases',
		allowsDot: true, allowsUnderscore: false, allowsHyphen: false, allowsPlus: true,
		mustStartWithLetter: false, dotIsDistinct: false, plusIsAlias: true, minLength: 6, maxLength: 30
	},
	outlook: {
		family: 'Outlook', summary: '1–64 chars, must start with a letter, dots/underscores/hyphens, + aliases',
		allowsDot: true, allowsUnderscore: true, allowsHyphen: true, allowsPlus: true,
		mustStartWithLetter: true, dotIsDistinct: true, plusIsAlias: true, minLength: 1, maxLength: 64
	},
	yahoo: {
		family: 'Yahoo', summary: '4–32 chars, must start with a letter, dots/underscores',
		allowsDot: true, allowsUnderscore: true, allowsHyphen: false, allowsPlus: false,
		mustStartWithLetter: true, dotIsDistinct: true, plusIsAlias: false, minLength: 4, maxLength: 32
	},
	icloud: {
		family: 'iCloud', summary: '3–20 chars, must start with a letter, dots/underscores, + aliases',
		allowsDot: true, allowsUnderscore: true, allowsHyphen: true, allowsPlus: true,
		mustStartWithLetter: true, dotIsDistinct: true, plusIsAlias: true, minLength: 3, maxLength: 20
	},
	proton: {
		family: 'Proton', summary: '1–40 chars, dots/underscores/hyphens, + aliases',
		allowsDot: true, allowsUnderscore: true, allowsHyphen: true, allowsPlus: true,
		mustStartWithLetter: false, dotIsDistinct: true, plusIsAlias: true, minLength: 1, maxLength: 40
	},
	aol: {
		family: 'AOL', summary: '3–32 chars, must start with a letter, dots/underscores',
		allowsDot: true, allowsUnderscore: true, allowsHyphen: false, allowsPlus: false,
		mustStartWithLetter: true, dotIsDistinct: true, plusIsAlias: false, minLength: 3, maxLength: 32
	},
	standard: {
		family: 'Standard', summary: 'Standard rules (RFC 5321), dots/underscores/hyphens',
		allowsDot: true, allowsUnderscore: true, allowsHyphen: true, allowsPlus: true,
		mustStartWithLetter: false, dotIsDistinct: true, plusIsAlias: false, minLength: 1, maxLength: 64
	},
	qq: {
		family: 'Standard', summary: '3–18 chars, dots/underscores',
		allowsDot: true, allowsUnderscore: true, allowsHyphen: false, allowsPlus: false,
		mustStartWithLetter: false, dotIsDistinct: true, plusIsAlias: false, minLength: 3, maxLength: 18
	},
	yandex: {
		family: 'Standard', summary: '1–30 chars, dots/hyphens',
		allowsDot: true, allowsUnderscore: false, allowsHyphen: true, allowsPlus: true,
		mustStartWithLetter: false, dotIsDistinct: true, plusIsAlias: true, minLength: 1, maxLength: 30
	}
};

// Builds a Provider from a shared rule preset so sibling domains keep identical rules.
function make(domain: string, name: string, preset: keyof typeof RULES, weight: number, aliases: string[] = []): Provider {
	const r = RULES[preset];
	return {
		domain, name, aliases, family: r.family, weight,
		allowsDot: r.allowsDot, allowsUnderscore: r.allowsUnderscore, allowsHyphen: r.allowsHyphen,
		allowsPlus: r.allowsPlus, mustStartWithLetter: r.mustStartWithLetter,
		dotIsDistinct: r.dotIsDistinct, plusIsAlias: r.plusIsAlias,
		minLength: r.minLength, maxLength: r.maxLength
	};
}

export const PROVIDERS: Provider[] = [
	make('gmail.com', 'Gmail', 'gmail', 0.5, ['googlemail.com']),
	make('outlook.com', 'Outlook', 'outlook', 0.13),
	make('hotmail.com', 'Hotmail', 'outlook', 0.07),
	make('live.com', 'Live', 'outlook', 0.03),
	make('yahoo.com', 'Yahoo', 'yahoo', 0.06),
	make('ymail.com', 'Ymail', 'yahoo', 0.015, ['rocketmail.com']),
	make('icloud.com', 'iCloud', 'icloud', 0.04),
	make('me.com', 'me.com', 'icloud', 0.01),
	make('aol.com', 'AOL', 'aol', 0.02),
	make('protonmail.com', 'ProtonMail', 'proton', 0.02, ['protonmail.ch']),
	make('proton.me', 'Proton', 'proton', 0.015, ['pm.me']),
	make('zoho.com', 'Zoho', 'standard', 0.015, ['zohomail.com']),
	make('mail.com', 'Mail.com', 'standard', 0.01),
	make('gmx.com', 'GMX', 'standard', 0.01, ['gmx.net']),
	make('bigpond.com', 'Bigpond', 'standard', 0.02, ['bigpond.net.au']),
	make('optusnet.com.au', 'Optusnet', 'standard', 0.015),
	make('tpg.com.au', 'TPG', 'standard', 0.008),
	make('iinet.net.au', 'iiNet', 'standard', 0.008),
	make('qq.com', 'QQ', 'qq', 0.02),
	make('163.com', '163', 'standard', 0.02, ['126.com']),
	make('mail.ru', 'Mail.ru', 'standard', 0.02, ['bk.ru', 'inbox.ru']),
	make('yandex.ru', 'Yandex', 'yandex', 0.015, ['yandex.com']),
	make('yahoo.co.jp', 'Yahoo JP', 'yahoo', 0.01)
];

const DOMAIN_INDEX = new Map<string, Provider>();
for (const p of PROVIDERS) {
	DOMAIN_INDEX.set(p.domain, p);
	for (const a of p.aliases) DOMAIN_INDEX.set(a, p);
}

// Returns the provider owning a domain (primary or alias), or undefined when unknown.
function getProvider(domain: string): Provider | undefined {
	return DOMAIN_INDEX.get(domain.trim().toLowerCase());
}

// Reduces a local part to the form that actually reaches an inbox under a provider's rules.
function canonicalLocal(local: string, provider: Provider): string {
	let l = local;
	if (provider.plusIsAlias) l = l.split('+')[0];
	if (!provider.dotIsDistinct) l = l.replace(/\./g, '');
	return l;
}

// Produces a canonical key for an email so addresses reaching the same inbox collapse during dedup.
export function canonicalizeEmail(email: string): string {
	const e = email.trim().toLowerCase();
	const at = e.indexOf('@');
	if (at === -1) return e;
	const local = e.slice(0, at);
	const domain = e.slice(at + 1);
	const provider = getProvider(domain);
	if (!provider) return e;
	return `${canonicalLocal(local, provider)}@${provider.domain}`;
}

// Validates a generated local part against a provider's character and length rules.
export function isValidForProvider(username: string, provider: Provider): boolean {
	if (username.startsWith('.') || username.endsWith('.') || username.includes('..')) return false;
	if (!provider.allowsUnderscore && username.includes('_')) return false;
	if (!provider.allowsHyphen && username.includes('-')) return false;
	if (!provider.allowsDot && username.includes('.')) return false;
	if (provider.mustStartWithLetter && !/^[a-z]/.test(username)) return false;

	let charset = 'a-z0-9';
	if (provider.allowsDot) charset += '.';
	if (provider.allowsUnderscore) charset += '_';
	if (provider.allowsHyphen) charset += '\\-';
	if (provider.allowsPlus) charset += '+';
	if (!new RegExp(`^[${charset}]+$`).test(username)) return false;

	const len = canonicalLocal(username, provider).length;
	if (len < provider.minLength || len > provider.maxLength) return false;

	return true;
}

// Validates the syntax of an arbitrary fully-qualified email using the shared provider rules.
export function validateEmailSyntax(email: string): { valid: boolean; error?: string } {
	const e = email.trim().toLowerCase();
	if (e.length > 254) return { valid: false, error: 'Too long' };

	const parts = e.split('@');
	if (parts.length !== 2) return { valid: false, error: 'Invalid format' };

	const [local, domain] = parts;
	if (local.length < 1 || local.length > 64) return { valid: false, error: 'Local part length' };
	if (/\.\./.test(local)) return { valid: false, error: 'Consecutive dots' };
	if (/^\.|\.$/.test(local)) return { valid: false, error: 'Leading/trailing dot' };
	if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return { valid: false, error: 'Invalid characters' };
	if (!/\./.test(domain) || /^[.-]|[.-]$/.test(domain)) return { valid: false, error: 'Invalid domain' };

	const provider = getProvider(domain);
	if (provider && !isValidForProvider(local, provider)) {
		return { valid: false, error: `${provider.name}: fails provider rules` };
	}

	return { valid: true };
}

export interface ProviderReference {
	name: string;
	domains: string[];
	rules: string;
}

// Builds the UI provider reference table, grouped by rule family from the same config.
export const PROVIDER_REFERENCE: ProviderReference[] = (() => {
	const seen = new Set<string>();
	const out: ProviderReference[] = [];
	for (const key of ['gmail', 'outlook', 'yahoo', 'icloud', 'proton', 'standard'] as const) {
		const fam = RULES[key].family;
		if (seen.has(fam)) continue;
		seen.add(fam);
		const domains = PROVIDERS.filter((p) => p.family === fam).flatMap((p) => [p.domain, ...p.aliases]);
		out.push({ name: fam, domains: [...new Set(domains)], rules: RULES[key].summary });
	}
	return out;
})();
