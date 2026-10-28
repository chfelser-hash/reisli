// Liest eine Ferien-Excel (Format Ferien2027.xlsm) und schreibt eine Reisli-Reise als JSON.
// Die Datei kann danach in der App unter «Mehr → Sicherung → Einspielen» hochgeladen werden.
// Einfacher ist meist der direkte Weg in der App: «Mehr → Excel importieren».
//
//   npm run import-excel -- "C:\Pfad\zu\Ferien2027.xlsm"
import fs from 'node:fs';
import path from 'node:path';
import { importTripFromExcel, applySettingsPatch } from '../server/excel-import.js';
import { migrate, newId } from '../server/store.js';
import { tripSummary, fmt } from '../public/js/calc.js';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Aufruf: npm run import-excel -- "Pfad\\zur\\Reise.xlsm"');
  process.exit(1);
}

const data = migrate({});
const { trip, settingsPatch, report } = importTripFromExcel(file, { fileName: path.basename(file), settings: data.settings, newId });
applySettingsPatch(data.settings, settingsPatch);
const s = tripSummary(data.settings, trip, '0000-01-01');

console.log(`\nReise «${trip.name}»  ${trip.start} – ${trip.end}`);
console.log(`  ${report.items} Posten, davon ${report.stays} Unterkünfte, ${report.payments} Zahlungen`);
console.log(`  Prognose total : CHF ${fmt(s.forecast)}   (Excel: CHF ${fmt(report.excelTotal)})`);
console.log(`  Bezahlt        : CHF ${fmt(s.paid)}   (Excel «bereits bezahlt»: CHF ${fmt(report.excelPaid)} – zählt dort auch Reserviertes mit Bezahlmethode)`);
console.log(`  Pro Person     : CHF ${fmt(s.perPerson)}`);
if (Math.abs(s.forecast - report.excelTotal) > 1) console.log('  ⚠ Prognose weicht vom Excel-Total ab – bitte prüfen.');
for (const w of report.warnings) console.log('  ⚠ ' + w);

const out = `reisli-import-${trip.name.replace(/\W+/g, '_')}.json`;
fs.writeFileSync(out, JSON.stringify({ app: 'reisli', kind: 'trip', exportedAt: new Date().toISOString(), trip, settingsPatch }, null, 1));
console.log(`\n→ ${out} geschrieben. Enthält persönliche Daten: nach dem Einspielen löschen.\n`);
