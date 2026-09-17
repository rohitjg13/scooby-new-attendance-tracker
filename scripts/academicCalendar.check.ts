// Runnable self-check for the academic calendar PDF parser. No framework.
//   node scripts/academicCalendar.check.ts
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { parseAcademicCalendar, extractPdf } from "../src/lib/server/academicCalendar.ts";

const DIR = "src/lib/data";
const pdf = readdirSync(DIR).find((f) => /calendar.*\.pdf$/i.test(f));
assert.ok(pdf, "no academic calendar PDF in src/lib/data");

const { items, fills } = await extractPdf(new Uint8Array(readFileSync(`${DIR}/${pdf}`)));
const cal = parseAcademicCalendar(items, fills);
console.log(`${pdf}: ${cal.title}`);
assert.ok(cal.legend.length, "no colour legend parsed");
console.log(cal.legend);

// Every printed weekday must match the weekday of the date it was parsed as —
// if the column/row geometry were misread, this is what breaks.
for (const d of cal.days) {
	const real = new Date(d.date + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
	assert.equal(real, d.weekday, `${d.date} parsed under ${d.weekday}, actually ${real}`);
}

// Dates run contiguously through each month, no gaps and no strays.
const dates = cal.days.map((d) => d.date);
assert.equal(new Set(dates).size, dates.length, "duplicate dates");
for (let i = 1; i < dates.length; i++) {
	const gap = (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86_400_000;
	assert.equal(gap, 1, `gap between ${dates[i - 1]} and ${dates[i]}`);
}

const withText = cal.days.filter((d) => d.text);
assert.ok(withText.length > 20, `only ${withText.length} days carry an entry`);
assert.ok(cal.days.some((d) => d.category === "exam"), "no exam days found");

console.log(`${cal.days.length} days, ${withText.length} with entries`);
for (const d of withText) console.log(` ${d.date} ${d.weekday.slice(0, 3)} [${d.category}] ${d.text}`);
