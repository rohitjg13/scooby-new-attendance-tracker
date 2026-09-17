# Attendance Tracker

Paste your SNU course-wise attendance report and get every course's percentage,
with the attendance waiver applied and classes left counted off the academic
calendar. Everything stays in your browser.

## Running it

```sh
npm install
npm run dev
```

`npm run build` / `npm run preview` for production. Deploys via `adapter-auto`.

## Academic calendar

Teaching days come from the calendar PDF in `src/lib/data/`, parsed at build
time (the page is prerendered). For a new semester, drop the new PDF in — the
newest filename wins. The one hard-coded thing is the `OMIT` list at the top of
`src/lib/server/academicCalendar.ts`, for entries the PDF itself gets wrong.

## Checks

Plain `assert` self-checks, no framework:

```sh
npm run check                              # svelte-check
node scripts/attendance.check.ts
node scripts/attendanceReport.check.ts
node scripts/semester.check.ts
node scripts/academicCalendar.check.ts     # prints every calendar entry
```
