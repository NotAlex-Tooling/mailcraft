// SvelteKit configuration using the Vercel deployment adapter
import adapter from '@sveltejs/adapter-vercel';

const config = {
	kit: {
		adapter: adapter()
	}
};

export default config;
