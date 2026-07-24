/**
 * One-off repair for the day-submission approval bug (fixed in approval.routes.ts):
 * approving a single day could incorrectly flip the whole week's Timesheet.status to
 * APPROVED even though other days in the week were never submitted/approved, locking
 * out entry on those days.
 *
 * This script finds Timesheets stuck in that bad state and recomputes their correct
 * status using the same rule the fixed endpoint now uses: a week is only APPROVED when
 * every date that has logged entries has an APPROVED DaySubmission.
 *
 * Usage (from backend/):
 *   npx ts-node --transpile-only prisma/fix-premature-week-approvals.ts            # dry run, reports only
 *   npx ts-node --transpile-only prisma/fix-premature-week-approvals.ts --apply    # applies the fix
 */
import prisma from '../src/utils/prisma';

async function main() {
  const apply = process.argv.includes('--apply');

  const candidates = await prisma.timesheet.findMany({
    where: { status: 'APPROVED' },
    include: { daySubmissions: true, entries: { select: { date: true } } },
  });

  let affected = 0;

  for (const t of candidates) {
    const entryDates = new Set(t.entries.map(e => e.date.toDateString()));
    if (entryDates.size === 0) continue;

    const approvedDates = new Set(
      t.daySubmissions.filter(s => s.status === 'APPROVED').map(s => s.date.toDateString())
    );
    const fullyApproved = [...entryDates].every(d => approvedDates.has(d));
    if (fullyApproved) continue; // this one is legitimately fully approved

    affected++;
    const anySubmitted = t.daySubmissions.some(s => s.status === 'SUBMITTED');
    const correctedStatus = anySubmitted ? 'SUBMITTED' : 'DRAFT';

    console.log(
      `Timesheet ${t.id} (user ${t.userId}, period ${t.periodStart.toDateString()}–${t.periodEnd.toDateString()}): ` +
      `APPROVED -> ${correctedStatus} ` +
      `(${approvedDates.size}/${entryDates.size} entry-dates actually approved)`
    );

    if (apply) {
      await prisma.timesheet.update({
        where: { id: t.id },
        data: { status: correctedStatus, approvedAt: null },
      });
    }
  }

  console.log(`\n${affected} affected timesheet(s) found out of ${candidates.length} APPROVED timesheet(s) checked.`);
  console.log(apply ? 'Changes applied.' : 'Dry run only — re-run with --apply to write these changes.');
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
