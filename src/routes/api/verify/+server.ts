// Email verification API: runs syntax, MX, disposable, breach, and account-existence checks for submitted addresses.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveMx } from 'dns/promises';
import { env } from '$env/dynamic/private';
import { validateEmailSyntax } from '$lib/providers';

const HIBP_API_KEY = env.HIBP_API_KEY;

interface ExistenceResult {
	exists: boolean | null;
	provider: string;
	details?: Record<string, unknown>;
	rateLimited?: boolean;
}

interface VerificationResult {
	email: string;
	layers: {
		syntax: { valid: boolean; error?: string };
		mx: { valid: boolean; records?: string[] };
		disposable: { isDisposable: boolean };
		breaches: {
			xposedOrNot: { found: boolean; breaches?: string[] };
			leakCheck: { found: boolean; sources?: string[] };
			hibp: { found: boolean; breaches?: string[]; enabled: boolean };
		};
		existence: ExistenceResult[];
	};
	verdict: 'invalid' | 'unknown';
	breachCount: number;
}

const existenceRateMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 10;

// Sliding-window rate limit for existence checks, keyed by client IP.
function isExistenceRateLimited(ip: string): boolean {
	const now = Date.now();
	const recent = (existenceRateMap.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW);
	existenceRateMap.set(ip, recent);
	if (recent.length >= RATE_LIMIT_MAX) return true;
	recent.push(now);
	return false;
}

setInterval(() => {
	const now = Date.now();
	for (const [ip, timestamps] of existenceRateMap) {
		const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);
		if (recent.length === 0) existenceRateMap.delete(ip);
		else existenceRateMap.set(ip, recent);
	}
}, 10 * 60 * 1000);

const mxCache = new Map<string, { valid: boolean; records?: string[] }>();

// Resolves and caches the MX records for an email's domain to confirm it can receive mail.
async function checkMX(email: string): Promise<{ valid: boolean; records?: string[] }> {
	const domain = email.split('@')[1];
	const cached = mxCache.get(domain);
	if (cached) return cached;
	let result: { valid: boolean; records?: string[] };
	try {
		const mx = await resolveMx(domain);
		result = mx.length === 0
			? { valid: false }
			: { valid: true, records: mx.sort((a, b) => a.priority - b.priority).map((r) => r.exchange) };
	} catch {
		result = { valid: false };
	}
	mxCache.set(domain, result);
	return result;
}

// Flags known disposable domains via mailchecker.
async function checkDisposable(email: string): Promise<{ isDisposable: boolean }> {
	try {
		const MailChecker = await import('mailchecker');
		const isValid = MailChecker.default?.isValid ?? MailChecker.isValid;
		return { isDisposable: !isValid(email) };
	} catch {
		return { isDisposable: false };
	}
}

// Queries XposedOrNot for known breaches containing this email.
async function checkXposedOrNot(email: string): Promise<{ found: boolean; breaches?: string[] }> {
	try {
		const res = await fetch(`https://api.xposedornot.com/v1/check-email/${encodeURIComponent(email)}`, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) return { found: false };
		const data = await res.json();
		const breaches: string[] =
			data.ExposedBreaches?.breaches_details?.map((b: { breach?: string }) => b.breach).filter(Boolean) ?? [];
		return { found: breaches.length > 0, breaches };
	} catch {
		return { found: false };
	}
}

// Queries the public LeakCheck endpoint for known leaks containing this email.
async function checkLeakCheck(email: string): Promise<{ found: boolean; sources?: string[] }> {
	try {
		const res = await fetch(`https://leakcheck.io/api/public?check=${encodeURIComponent(email)}`, {
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) return { found: false };
		const data = await res.json();
		if (data.success && data.found > 0) {
			return { found: true, sources: data.sources?.map((s: { name: string }) => s.name) ?? [] };
		}
		return { found: false };
	} catch {
		return { found: false };
	}
}

// Queries Have I Been Pwned when HIBP_API_KEY is set, no-opping cleanly when it is absent.
async function checkHIBP(email: string): Promise<{ found: boolean; breaches?: string[]; enabled: boolean }> {
	if (!HIBP_API_KEY) return { found: false, enabled: false };
	try {
		const res = await fetch(
			`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=true`,
			{ headers: { 'hibp-api-key': HIBP_API_KEY, 'user-agent': 'MailCraft' }, signal: AbortSignal.timeout(8000) }
		);
		if (res.status === 404) return { found: false, enabled: true };
		if (!res.ok) return { found: false, enabled: true };
		const data = await res.json();
		const breaches: string[] = Array.isArray(data)
			? data.map((b: { Name?: string }) => b.Name).filter((n): n is string => Boolean(n))
			: [];
		return { found: breaches.length > 0, breaches, enabled: true };
	} catch {
		return { found: false, enabled: true };
	}
}

// Fetches a URL with retries and exponential backoff on HTTP 429 responses.
async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 2): Promise<Response> {
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const res = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
		if (res.status !== 429 || attempt === maxRetries) return res;
		const retryAfter = res.headers.get('Retry-After');
		const delay = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000, 10000) : 1000 * 2 ** attempt;
		await new Promise((r) => setTimeout(r, delay));
	}
	throw new Error('Unreachable');
}

// Probes whether a Spotify account exists for the email via the signup validation endpoint.
async function checkSpotify(email: string): Promise<ExistenceResult> {
	try {
		const res = await fetchWithRetry(
			`https://spclient.wg.spotify.com/signup/public/v1/account?validate=1&email=${encodeURIComponent(email)}`,
			{ headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
		);
		if (!res.ok) return { exists: null, provider: 'spotify' };
		const data = await res.json();
		return { exists: data.status === 20, provider: 'spotify' };
	} catch {
		return { exists: null, provider: 'spotify' };
	}
}

// Probes whether an Adobe account exists for the email via the signin API.
async function checkAdobe(email: string): Promise<ExistenceResult> {
	try {
		const res = await fetchWithRetry('https://auth.services.adobe.com/signin/v2/users/accounts', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-IMS-ClientId': 'adobedotcom2' },
			body: JSON.stringify({ email })
		});
		if (!res.ok) return { exists: false, provider: 'adobe' };
		const data = await res.json();
		if (!Array.isArray(data) || data.length === 0) return { exists: false, provider: 'adobe' };
		const account = data[0];
		const details: Record<string, unknown> = {};
		if (account.type) details.accountType = account.type;
		if (Array.isArray(account.authenticationMethods)) {
			details.authMethods = account.authenticationMethods
				.map((m: { type?: string; id?: string }) => m.type ?? m.id ?? 'unknown')
				.join(', ');
		}
		if (account.status?.code) details.statusCode = account.status.code;
		return { exists: true, provider: 'adobe', ...(Object.keys(details).length > 0 && { details }) };
	} catch {
		return { exists: null, provider: 'adobe' };
	}
}

// Runs all verification layers for a single email and assembles the result.
async function verifyEmail(email: string, checkExistence: boolean, clientIp: string): Promise<VerificationResult> {
	const normalized = email.trim().toLowerCase();
	const emptyBreaches = {
		xposedOrNot: { found: false },
		leakCheck: { found: false },
		hibp: { found: false, enabled: Boolean(HIBP_API_KEY) }
	};
	const emptyExistence: ExistenceResult[] = [];

	const syntax = validateEmailSyntax(normalized);
	if (!syntax.valid) {
		return { email: normalized, layers: { syntax, mx: { valid: false }, disposable: { isDisposable: false }, breaches: emptyBreaches, existence: emptyExistence }, verdict: 'invalid', breachCount: 0 };
	}

	const [mx, disposable] = await Promise.all([checkMX(normalized), checkDisposable(normalized)]);

	if (!mx.valid || disposable.isDisposable) {
		return { email: normalized, layers: { syntax, mx, disposable, breaches: emptyBreaches, existence: emptyExistence }, verdict: 'invalid', breachCount: 0 };
	}

	const rateLimited = checkExistence && isExistenceRateLimited(clientIp);
	const runExistence = checkExistence && !rateLimited;

	const [xon, lc, hibp, spotify, adobe] = await Promise.all([
		checkXposedOrNot(normalized),
		checkLeakCheck(normalized),
		checkHIBP(normalized),
		runExistence ? checkSpotify(normalized) : Promise.resolve(null),
		runExistence ? checkAdobe(normalized) : Promise.resolve(null)
	]);

	const names = new Set<string>();
	for (const b of xon.breaches ?? []) names.add(b.toLowerCase());
	for (const s of lc.sources ?? []) names.add(s.toLowerCase());
	for (const b of hibp.breaches ?? []) names.add(b.toLowerCase());
	const breachCount = names.size;

	let existence: ExistenceResult[];
	if (rateLimited) {
		existence = [
			{ exists: null, provider: 'spotify', rateLimited: true },
			{ exists: null, provider: 'adobe', rateLimited: true }
		];
	} else if (runExistence) {
		existence = [spotify!, adobe!];
	} else {
		existence = emptyExistence;
	}

	return { email: normalized, layers: { syntax, mx, disposable, breaches: { xposedOrNot: xon, leakCheck: lc, hibp }, existence }, verdict: 'unknown', breachCount };
}

// Verifies up to 10 emails per request, spaced to stay friendly to upstream APIs.
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const emails: string[] = body.emails;
	const checkExistence: boolean = body.checkExistence ?? false;

	if (!Array.isArray(emails) || emails.length === 0) {
		return json({ error: 'No emails provided' }, { status: 400 });
	}

	const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
	const toCheck = emails.slice(0, 10);
	const results: VerificationResult[] = [];

	for (let i = 0; i < toCheck.length; i++) {
		results.push(await verifyEmail(toCheck[i], checkExistence, clientIp));
		if (i < toCheck.length - 1) await new Promise((r) => setTimeout(r, 500));
	}

	return json({ results });
};
