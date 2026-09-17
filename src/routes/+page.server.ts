import type { PageServerLoad } from './$types';
import { loadCalendar } from '$lib/server/calendarSource';
import { semesterFrom } from '$lib/semester';

// The teaching days come off the same calendar PDF the academic calendar page
// reads, parsed at build time. Counting what's left of them is the browser's
// job, since only the browser knows what today is.
export const prerender = true;

export const load: PageServerLoad = async ({ fetch }) => ({
	semester: semesterFrom((await loadCalendar(fetch)).days)
});
