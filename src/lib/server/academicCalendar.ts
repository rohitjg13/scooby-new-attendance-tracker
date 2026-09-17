// Parses the university's academic calendar PDF (one page, six month columns,
// each a "Date | event" pair with the weekday names down the left edge).
// Nothing about this file is hard-coded to Monsoon 2026: the month headers,
// the column positions and the row bands all come out of the PDF, so dropping
// a newer calendar into src/lib/data is the whole update.

export interface TextItem {
	str: string;
	x: number;
	y: number;
}

export type Category = 'exam' | 'break' | 'deadline' | 'holiday' | 'event';

/** A filled cell background. The calendar colour-codes its rows and prints the
 *  legend for those colours at the bottom of the page, so the colours are the
 *  PDF's own answer to "what kind of day is this". */
export interface Fill {
	color: string;
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}

export interface CalendarDay {
	/** ISO date, e.g. "2026-08-15" */
	date: string;
	/** weekday as printed in the PDF's leftmost column */
	weekday: string;
	text: string;
	category: Category;
	/** the legend entry this day's colour maps to, e.g. "Restricted Holidays";
	 *  empty when the PDF left the cell uncoloured. */
	label: string;
}

export interface AcademicCalendar {
	title: string;
	notes: string[];
	days: CalendarDay[];
	/** the colour key printed at the foot of the PDF */
	legend: { label: string; category: Category }[];
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_HEADER = /^([A-Z][a-z]{2})[a-z]*[-\s](\d{2}|\d{4})$/;

// Used on the legend label when a day is colour-coded, and on the day's own
// text when it is not.
function categorise(text: string): Category {
	if (/exam/i.test(text)) return 'exam';
	if (/no class|buffer|break|surge|vacation/i.test(text)) return 'break';
	if (/holiday/i.test(text)) return 'holiday';
	if (
		/last date|last day|last teaching|registration|submission|declaration|clearance|begins|finishes|start of|drop|add /i.test(
			text
		)
	)
		return 'deadline';
	return 'event';
}

// Entries and notes the printed PDF gets wrong or that say nothing useful,
// dropped as if the cell were blank. Comment a line out (or delete it) once a
// newer calendar prints it correctly — this is the only place anything about a
// specific calendar is hard-coded.
const OMIT: RegExp[] = [
	/last date to drop full semester UG courses/i,
	// Says a date will be announced later, which is not a date.
	/self-course registration dates will be announced/i
];

const area = (f: Fill) => (f.x1 - f.x0) * (f.y1 - f.y0);

/** Smallest filled cell containing a point — the one actually painted there. */
function fillAt(fills: Fill[], x: number, y: number): Fill | undefined {
	return fills
		.filter((f) => x >= f.x0 - 0.5 && x <= f.x1 + 0.5 && y >= f.y0 - 0.5 && y <= f.y1 + 0.5)
		.sort((a, b) => area(a) - area(b))[0];
}

export function parseAcademicCalendar(items: TextItem[], fills: Fill[] = []): AcademicCalendar {
	const text = items.filter((i) => i.str.trim()).map((i) => ({ ...i, str: i.str.trim() }));

	// --- month columns, from the header row -------------------------------
	const headers = text
		.map((i) => ({ i, m: MONTH_HEADER.exec(i.str) }))
		.filter((h) => h.m && MONTHS.includes(h.m[1]))
		.map(({ i, m }) => ({
			x: i.x,
			y: i.y,
			month: MONTHS.indexOf(m![1]),
			year: m![2].length === 2 ? 2000 + Number(m![2]) : Number(m![2])
		}))
		.sort((a, b) => a.x - b.x);
	if (!headers.length) throw new Error('no month headers (e.g. "Aug-26") found in the PDF');

	const dateHeaders = text.filter((i) => /^date$/i.test(i.str) && Math.abs(i.y - headers[0].y) < 6);
	const columns = headers.map((h) => {
		// the "Date" label immediately left of the month name
		const own = dateHeaders.filter((d) => d.x < h.x).sort((a, b) => b.x - a.x)[0];
		return { ...h, dateX: own ? own.x : h.x };
	});

	// --- row band, from the weekday column --------------------------------
	const dayCol = text.filter((i) => WEEKDAYS.includes(i.str) && i.x < columns[0].dateX - 5);
	if (!dayCol.length) throw new Error('no weekday column found in the PDF');
	const rows = dayCol.map((i) => ({ y: i.y, weekday: i.str })).sort((a, b) => b.y - a.y);
	const top = rows[0].y + 4;
	// the last row's date can sit a line below its weekday label (a tall merged
	// cell pushes it down), so the band reaches one row height past it — which
	// still stops short of the teaching-day totals underneath the grid.
	const gaps = rows.slice(1).map((r, i) => rows[i].y - r.y).sort((a, b) => a - b);
	const rowHeight = gaps[Math.floor(gaps.length / 2)] || 12;
	const bottom = rows[rows.length - 1].y - rowHeight;

	// --- colour legend, printed under the grid ----------------------------
	// swatch on the left, its label immediately to the right of it.
	const legend = new Map<string, string>();
	for (const f of fills) {
		if (f.y1 >= bottom || area(f) > 1000 || /^#(f{6}|0{6})$/i.test(f.color)) continue;
		// legend rows are tighter than the swatches are tall, so pick the label
		// closest to the swatch's centre line, not merely one overlapping it
		const mid = (f.y0 + f.y1) / 2;
		const label = text
			.filter((t) => t.x >= f.x1 - 1 && Math.abs(t.y - mid) < 8)
			.sort((a, b) => Math.abs(a.y - mid) - Math.abs(b.y - mid) || a.x - b.x)[0];
		if (label) legend.set(f.color, label.str);
	}

	// --- dates and event text per column ----------------------------------
	const days: CalendarDay[] = [];
	for (const [c, col] of columns.entries()) {
		const left = col.dateX - 15;
		const right = c + 1 < columns.length ? columns[c + 1].dateX - 15 : Infinity;
		const inColumn = text.filter((i) => i.y <= top && i.y >= bottom && i.x >= left && i.x < right);

		const dates = inColumn
			.filter(
				(i) => /^\d{1,2}$/.test(i.str) && Number(i.str) >= 1 && Number(i.str) <= 31 && Math.abs(i.x - col.dateX) <= 25
			)
			.map((i) => ({ day: Number(i.str), y: i.y, lines: [] as TextItem[] }));
		const events = inColumn.filter((i) => !dates.some((d) => d.y === i.y && Number(i.str) === d.day));

		for (const e of events) {
			// nearest date row; a wrapped line sits just below its date, so ties
			// go to the row above.
			let best = dates[0];
			for (const d of dates) {
				const gap = Math.abs(d.y - e.y);
				const bestGap = Math.abs(best.y - e.y);
				if (gap < bestGap || (gap === bestGap && d.y > best.y)) best = d;
			}
			if (best && Math.abs(best.y - e.y) <= 30) best.lines.push(e);
		}

		for (const d of dates) {
			const stamp = new Date(Date.UTC(col.year, col.month, d.day));
			// the printed weekday for this row is the label on the nearest row line
			const row = rows.reduce((a, b) => (Math.abs(b.y - d.y) < Math.abs(a.y - d.y) ? b : a));
			d.lines.sort((a, b) => b.y - a.y || a.x - b.x);
			const printed = d.lines
				.map((l) => l.str)
				.join(' ')
				.replace(/\s+/g, ' ')
				.trim();
			const body = OMIT.some((re) => re.test(printed)) ? '' : printed;
			// the cell's own colour is the calendar's answer; its text is the
			// fallback for the rows left uncoloured.
			const head = d.lines[0] ?? { x: col.dateX, y: d.y };
			const swatch = body ? fillAt(fills, head.x, head.y)?.color : undefined;
			const label = swatch ? legend.get(swatch) : undefined;
			days.push({
				date: stamp.toISOString().slice(0, 10),
				weekday: row.weekday,
				text: body,
				label: label ?? '',
				category: categorise(label ?? body)
			});
		}
	}
	days.sort((a, b) => a.date.localeCompare(b.date));

	const title = text.filter((i) => i.y > top).sort((a, b) => b.y - a.y)[0]?.str ?? 'Academic Calendar';
	const notes = text
		.filter((i) => i.y < bottom && /^note[:\s]/i.test(i.str))
		.map((i) => i.str)
		.filter((n) => !OMIT.some((re) => re.test(n)));

	const key = [...legend.values()].map((label) => ({ label, category: categorise(label) }));

	return { title, notes, days, legend: key };
}

/** Pull positioned text and cell fills out of a PDF. pdfjs is imported lazily
 *  so it only loads on the server, where this runs. */
export async function extractPdf(data: Uint8Array): Promise<{ items: TextItem[]; fills: Fill[] }> {
	const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
	const doc = await getDocument({ data, useSystemFonts: false }).promise;
	const items: TextItem[] = [];
	const fills: Fill[] = [];
	for (let p = 1; p <= doc.numPages; p++) {
		// ponytail: the calendar is one page; later pages get pushed out of the
		// row band rather than parsed. Widen this if a two-page calendar shows up.
		const drop = (p - 1) * 10_000;
		const page = await doc.getPage(p);
		for (const item of (await page.getTextContent()).items) {
			if (!('str' in item)) continue;
			items.push({ str: item.str, x: item.transform[4], y: item.transform[5] - drop });
		}

		// paths are emitted in device space, so replay the transform stack to get
		// each filled rectangle back into the same coordinates as the text
		const ops = await page.getOperatorList();
		let m = [1, 0, 0, 1, 0, 0];
		const stack: number[][] = [];
		let color = '#000000';
		for (let i = 0; i < ops.fnArray.length; i++) {
			const args = ops.argsArray[i] as any;
			switch (ops.fnArray[i]) {
				case OPS.save:
					stack.push(m);
					break;
				case OPS.restore:
					m = stack.pop() ?? m;
					break;
				case OPS.transform: {
					const [a, b, c, d, e, f] = args as number[];
					m = [
						m[0] * a + m[2] * b,
						m[1] * a + m[3] * b,
						m[0] * c + m[2] * d,
						m[1] * c + m[3] * d,
						m[0] * e + m[2] * f + m[4],
						m[1] * e + m[3] * f + m[5]
					];
					break;
				}
				case OPS.setFillRGBColor:
					color = String(args[0]).toLowerCase();
					break;
				case OPS.constructPath: {
					const box = args[2] as ArrayLike<number> | undefined;
					if (!box || box.length < 4) break;
					const pt = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
					const [ax, ay] = pt(box[0], box[1]);
					const [bx, by] = pt(box[2], box[3]);
					fills.push({
						color,
						x0: Math.min(ax, bx),
						x1: Math.max(ax, bx),
						y0: Math.min(ay, by) - drop,
						y1: Math.max(ay, by) - drop
					});
					break;
				}
			}
		}
	}
	return { items, fills };
}
