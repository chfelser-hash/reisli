// Tests der Rechenlogik – ausschliesslich mit erfundenen Beispieldaten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cashWallet, isCashMethod, evalExpr, itemCalc, tripSummary, allowanceMap, dueList, cashPlan, byMethod, shares, settlement,
  minimizeTransfers, copyTrip, tripDates, nights, placeFor, tripCsv, addDays, todoList,
} from '../public/js/calc.js';

const settings = {
  methods: [{ id: 'kk', name: 'Kreditkarte' }, { id: 'post', name: 'Postkonto' }],
  categories: [{ id: 'essen', name: 'Essen' }, { id: 'unterkunft', name: 'Unterkunft' }, { id: 'flug', name: 'Flug' }],
  rates: { THB: { rate: 0.025 }, EUR: { rate: 0.95 } },
};
let seq = 0;
const nid = () => 'id' + ++seq;
const item = (o) => ({ id: nid(), date: '2027-02-06', title: 'X', catId: 'sonstiges', plan: { amount: 0, currency: 'CHF' }, payments: [], todos: [], files: [], ...o });

test('evalExpr rechnet einfache Ausdrücke', () => {
  assert.equal(evalExpr('1500+120'), 1620);
  assert.equal(evalExpr("1'200,50"), 1200.5);
  assert.equal(evalExpr('2*(3+4)'), 14);
  assert.ok(Number.isNaN(evalExpr('2+')));
});

test('itemCalc: Status aus Plan und Zahlungen abgeleitet', () => {
  const offen = itemCalc(settings, item({ plan: { amount: 1000, currency: 'THB' }, payWhere: 'vorort' }));
  assert.equal(offen.status, 'offen');
  assert.equal(offen.label, 'offen – vor Ort');
  assert.equal(offen.totalCHF, 25);

  const res = itemCalc(settings, item({ plan: { amount: 1000, currency: 'THB' }, reserved: true }));
  assert.equal(res.label, 'reserviert – Zahlung vorgängig');

  // Anzahlung in CHF auf einen THB-Betrag, Rest wird zum aktuellen Kurs gerechnet
  const an = itemCalc(settings, item({ plan: { amount: 10000, currency: 'THB' }, payWhere: 'vorort', payments: [{ amount: 100, currency: 'CHF', chf: 100 }] }));
  assert.equal(an.status, 'angezahlt');
  assert.equal(an.label, 'angezahlt – Rest vor Ort');
  assert.equal(an.open, 6000);
  assert.equal(an.totalCHF, 250);

  // Bezahlt zu einem anderen Kurs als heute: Ist-Wert zählt, nichts mehr offen
  const bez = itemCalc(settings, item({ plan: { amount: 4000, currency: 'THB' }, payments: [{ amount: 4000, currency: 'THB', chf: 108.4 }] }));
  assert.equal(bez.status, 'bezahlt');
  assert.equal(bez.open, 0);
  assert.equal(bez.totalCHF, 108.4);

  assert.equal(itemCalc(settings, item({})).status, 'info');
  // «erledigt» schliesst einen Posten trotz Differenz ab
  assert.equal(itemCalc(settings, item({ plan: { amount: 100, currency: 'CHF' }, payments: [{ amount: 95, currency: 'CHF' }], done: true })).open, 0);
});

test('Unterkunft verteilt Kosten auf Nächte, Platzhalter-Pauschale wird ersetzt', () => {
  const trip = {
    start: '2027-02-06', end: '2027-02-09', travelers: 2, days: {},
    allowances: [{ id: 'u', label: 'Unterkunft', catId: 'unterkunft', amount: 100, currency: 'CHF', mode: 'platzhalter', per: 'nacht' }],
    items: [item({ date: '2027-02-06', endDate: '2027-02-08', catId: 'unterkunft', plan: { amount: 8000, currency: 'THB' } })],
  };
  assert.equal(nights(trip.items[0]), 2);
  const s = tripSummary(settings, trip, '2026-01-01');
  // 2 Nächte à 100 CHF (Hotel) + 1 Nacht Platzhalter 100 CHF; letzter Tag ist keine Nacht
  assert.equal(s.total, 200);
  assert.equal(s.allowance, 100);
  assert.equal(s.forecast, 300);
  assert.equal(s.byDay.get('2027-02-07').total, 100);
});

test('Tagesbudget: max(Pauschale, Ist), vergangene Tage nur Ist', () => {
  const trip = {
    start: '2027-02-06', end: '2027-02-08', travelers: 2, days: { '2027-02-08': { skip: ['e'] } },
    allowances: [{ id: 'e', label: 'Essen', catId: 'essen', amount: 80, currency: 'CHF', mode: 'tag', per: 'tag' }],
    items: [
      item({ date: '2027-02-06', catId: 'essen', plan: { amount: 30, currency: 'CHF' }, payments: [{ amount: 30, currency: 'CHF' }] }),
      item({ date: '2027-02-07', catId: 'essen', plan: { amount: 100, currency: 'CHF' }, payments: [{ amount: 100, currency: 'CHF' }] }),
    ],
  };
  // Vor der Reise: Tag 1 → 80 (30 erfasst + 50 Rest), Tag 2 → 100 (über Pauschale), Tag 3 übersprungen
  let s = tripSummary(settings, trip, '2027-01-01');
  assert.equal(s.forecast, 180);
  // Nach Tag 1: dort zählt nur noch das Ist
  s = tripSummary(settings, trip, '2027-02-07');
  assert.equal(s.forecast, 130);
  const m = allowanceMap(settings, trip, '2027-02-07');
  assert.equal(m.get('2027-02-06')[0].actualCHF, 30);
  assert.equal(m.has('2027-02-08'), false);
});

test('Zahlungskalender und Bargeld-Planer', () => {
  const trip = {
    start: '2027-02-06', end: '2027-02-10', currency: 'THB', days: { '2027-02-08': { place: 'Krabi' } }, allowances: [],
    items: [
      item({ title: 'Hotel A', plan: { amount: 4000, currency: 'THB' }, reserved: true, payWhere: 'vorgaengig', dueDate: '2027-02-01', dueMethodId: 'kk' }),
      item({ title: 'Hotel B', plan: { amount: 100, currency: 'CHF' }, payWhere: 'vorgaengig', dueDate: '2026-12-19' }),
      item({ title: 'Transfer', date: '2027-02-08', plan: { amount: 2700, currency: 'THB' }, payWhere: 'vorort' }),
      item({ title: 'Tauchen', date: '2027-02-09', plan: { amount: 15300, currency: 'THB' }, payWhere: 'vorort', payments: [{ amount: 300, currency: 'THB', methodId: 'post' }] }),
    ],
  };
  assert.deepEqual(dueList(settings, trip).map((x) => x.it.title), ['Hotel B', 'Hotel A']);
  const cash = cashPlan(settings, trip);
  assert.equal(cash.length, 1);
  assert.equal(cash[0].currency, 'THB');
  assert.equal(cash[0].total, 17700);
  assert.equal(cash[0].places[0].place, 'Krabi');
  const bm = byMethod(settings, trip);
  assert.equal(bm.find((x) => x.methodId === 'kk').planned, 100);
  assert.equal(bm.find((x) => x.methodId === 'post').paid, 7.5);
});

test('Kostenaufteilung: Anteile und möglichst wenige Überweisungen', () => {
  const parts = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cla' }];
  assert.deepEqual(shares(item({}), parts), { a: 1 / 3, b: 1 / 3, c: 1 / 3 });
  assert.deepEqual(shares(item({ split: { mode: 'shares', values: { a: 2, b: 1, c: 1 } } }), parts), { a: 0.5, b: 0.25, c: 0.25 });
  assert.deepEqual(shares(item({ split: { mode: 'equal', members: ['a', 'b'] } }), parts), { a: 0.5, b: 0.5, c: 0 });

  const trip = {
    start: '2027-02-06', end: '2027-02-07', days: {}, allowances: [],
    split: { enabled: true, participants: parts },
    items: [
      item({ plan: { amount: 300, currency: 'CHF' }, payments: [{ amount: 300, currency: 'CHF', paidBy: 'a' }] }),
      item({ plan: { amount: 60, currency: 'CHF' }, payments: [{ amount: 60, currency: 'CHF', paidBy: 'b' }], split: { mode: 'equal', members: ['b', 'c'] } }),
    ],
  };
  const st = settlement(settings, trip);
  const by = Object.fromEntries(st.people.map((p) => [p.id, p]));
  assert.equal(by.a.balance, 200);
  assert.equal(by.b.balance, -70);
  assert.equal(by.c.balance, -130);
  assert.deepEqual(st.transfers.map((t) => [t.from, t.to, t.amount]), [['c', 'a', 130], ['b', 'a', 70]]);
  assert.equal(minimizeTransfers([{ id: 'x', balance: 0 }]).length, 0);
});

test('Vorlage: Reise kopieren verschiebt Daten und leert Zahlungen', () => {
  const trip = {
    id: 't', name: 'Testreise', start: '2027-02-06', end: '2027-02-08', currency: 'THB', travelers: 2,
    allowances: [{ id: 'e', label: 'Essen', catId: 'essen', amount: 80, currency: 'CHF', mode: 'tag', per: 'tag' }],
    days: { '2027-02-07': { place: 'Bangkok', skip: [] } },
    split: { enabled: false, participants: [] },
    items: [item({ date: '2027-02-07', endDate: '2027-02-08', plan: { amount: 10, currency: 'CHF' }, payments: [{ amount: 10 }], todos: [{ id: 't1', text: 'Pass', done: true }] })],
  };
  const c = copyTrip(trip, { name: 'Japan', start: '2027-10-01', newId: nid });
  assert.equal(c.start, '2027-10-01');
  assert.equal(c.end, '2027-10-03');
  assert.equal(c.items[0].date, '2027-10-02');
  assert.equal(c.items[0].endDate, '2027-10-03');
  assert.equal(c.items[0].payments.length, 0);
  assert.equal(c.items[0].todos[0].done, false);
  assert.equal(c.days['2027-10-02'].place, 'Bangkok');
  assert.equal(tripDates(c).length, 3);
  assert.equal(placeFor(c, null, '2027-10-02'), 'Bangkok');
});

test('CSV-Export und To-do-Liste', () => {
  const trip = { start: '2027-02-06', end: '2027-02-06', days: {}, allowances: [], items: [item({ title: 'Flug; Zürich', catId: 'flug', plan: { amount: 10, currency: 'CHF' }, todos: [{ id: 'x', text: 'Sitzplatz', due: '2027-01-01', done: false }] })] };
  const csv = tripCsv(settings, trip);
  assert.ok(csv.startsWith('﻿Datum;'));
  assert.ok(csv.includes('"Flug; Zürich";;Flug'));
  assert.equal(todoList(trip)[0].todo.text, 'Sitzplatz');
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
});

test('Zusammenführen: Anzahlung in CHF + Rest in THB', async () => {
  const { mergeItems, itemCalc, fmtRange } = await import('../public/js/calc.js');
  const an = item({ title: 'Anzahlung Tauchen', plan: { amount: 300, currency: 'CHF' }, payments: [{ amount: 300, currency: 'CHF', chf: 300 }], note: 'per FlyWire' });
  const rest = item({ title: 'Tauchen', plan: { amount: 15000, currency: 'THB' }, payWhere: 'vorort' });
  const m = mergeItems(settings, rest, an);
  assert.equal(m.plan.currency, 'THB');
  assert.equal(m.plan.amount, 27000);
  assert.equal(m.payments.length, 1);
  assert.equal(m.payments[0].currency, 'THB');
  assert.equal(m.payments[0].amount, 12000);
  assert.equal(m.payments[0].chf, 300);
  const c = itemCalc(settings, m);
  assert.equal(c.status, 'angezahlt');
  assert.equal(c.open, 15000);
  assert.equal(c.totalCHF, 675);
  assert.equal(m.note, 'per FlyWire');
  assert.equal(fmtRange('2027-02-06', '2027-02-27'), '06.–27.02.2027');
  assert.equal(fmtRange('2027-01-28', '2027-02-05'), '28.01.–05.02.2027');
  assert.equal(fmtRange('2026-12-28', '2027-01-05'), '28.12.2026–05.01.2027');
});

test('Bargeld: Posten in der Währung vor Ort des Tages, Original bleibt sichtbar', async () => {
  const { cashPlan } = await import('../public/js/calc.js');
  const trip = {
    start: '2027-02-10', end: '2027-02-11', currency: 'THB',
    days: { '2027-02-10': { place: 'Boot' }, '2027-02-11': { place: 'Zuhause', currency: 'CHF' } },
    allowances: [{ id: 'e', label: 'Essen', catId: 'essen', amount: 80, currency: 'CHF', mode: 'tag', per: 'tag' }],
    items: [
      item({ date: '2027-02-11', title: 'Transfer nach Hause', plan: { amount: 50, currency: 'CHF' }, payWhere: 'vorort' }),
      item({ date: '2027-02-10', title: 'Trinken an Board', plan: { amount: 16, currency: 'CHF' }, payWhere: 'vorort' }),
      item({ date: '2027-02-10', title: 'NP Gebühr', plan: { amount: 5000, currency: 'THB' }, payWhere: 'vorort' }),
    ],
  };
  const g = cashPlan(settings, trip, { withAllowances: true, today: '2027-01-01' });
  const by = Object.fromEntries(g.map((x) => [x.currency, x]));
  const drinks = by.THB.rows.find((r) => r.title === 'Trinken an Board');
  assert.equal(drinks.amount, 640);
  assert.equal(drinks.origAmount, 16);
  assert.equal(drinks.origCurrency, 'CHF');
  assert.equal(by.THB.fixed, 5640);
  assert.equal(by.THB.allowance, 3200);
  assert.equal(by.CHF.fixed, 50);
  assert.equal(by.CHF.allowance, 80);
  assert.equal(by.CHF.rows.find((r) => r.title === 'Transfer nach Hause').origCurrency, undefined);
});

test('Bargeld: Pauschalen in der Währung vor Ort des Tages', async () => {
  const { cashPlan, dayCurrency } = await import('../public/js/calc.js');
  const trip = {
    start: '2027-02-06', end: '2027-02-07', currency: 'THB',
    days: { '2027-02-06': { place: 'Zürich', currency: 'CHF' }, '2027-02-07': { place: 'Bangkok' } },
    allowances: [{ id: 'e', label: 'Essen', catId: 'essen', amount: 80, currency: 'CHF', mode: 'tag', per: 'tag' }],
    items: [],
  };
  assert.equal(dayCurrency(trip, '2027-02-06'), 'CHF');
  assert.equal(dayCurrency(trip, '2027-02-07'), 'THB');
  const g = cashPlan(settings, trip, { withAllowances: true, today: '2027-01-01' });
  const by = Object.fromEntries(g.map((x) => [x.currency, x]));
  assert.equal(by.CHF.allowance, 80);
  assert.equal(by.CHF.places[0].place, 'Zürich');
  assert.equal(by.THB.allowance, 3200);
});

test('Anzahlung: fester Betrag in Postenwährung, Kursänderung verschiebt den Rest nicht', () => {
  const it = item({ plan: { amount: 27300, currency: 'THB' }, payments: [{ amount: 12000, currency: 'THB', chf: 298.8 }] });
  const a = itemCalc(settings, it);
  const b = itemCalc({ ...settings, rates: { ...settings.rates, THB: { rate: 0.0245 } } }, it);
  assert.equal(a.open, 15300);
  assert.equal(b.open, 15300);
  assert.equal(a.paidCHF, 298.8);
  assert.equal(a.floating, false);
  // Alte Erfassung nur in CHF: Rest schwankt → wird markiert
  const old = item({ plan: { amount: 27300, currency: 'THB' }, payments: [{ amount: 298.8, currency: 'CHF', chf: 298.8 }] });
  assert.equal(itemCalc(settings, old).floating, true);
});

test('Offen: Aufschlüsselung vorgängig + vor Ort + Pauschalen, Methodennutzung', async () => {
  const { openBreakdown, methodUsage } = await import('../public/js/calc.js');
  const trip = {
    start: '2027-02-10', end: '2027-02-10', currency: 'THB', days: {},
    allowances: [{ id: 'e', label: 'Essen', catId: 'essen', amount: 80, currency: 'CHF', mode: 'tag', per: 'tag' }],
    items: [
      item({ plan: { amount: 4000, currency: 'THB' }, payWhere: 'vorgaengig', dueMethodId: 'alt' }),
      item({ plan: { amount: 2000, currency: 'THB' }, payWhere: 'vorort' }),
      item({ plan: { amount: 10, currency: 'CHF' }, payments: [{ amount: 10, currency: 'CHF', methodId: 'alt' }] }),
    ],
  };
  assert.deepEqual(openBreakdown(settings, trip, '2027-01-01'), { vorgaengig: 100, vorort: 50, allowance: 80, total: 230 });
  assert.equal(methodUsage([trip], 'alt'), 2);
});

test('Kostenaufteilung: Rückzahlungen verändern Saldo und Ausgleich', () => {
  const parts = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Ben' }];
  const trip = {
    start: '2027-02-06', end: '2027-02-06', days: {}, allowances: [],
    split: { enabled: true, participants: parts },
    items: [item({ plan: { amount: 200, currency: 'CHF' }, payments: [{ amount: 200, currency: 'CHF', paidBy: 'a' }] })],
    repayments: [{ id: 'r1', date: '2027-03-01', from: 'b', to: 'a', amount: 60 }],
  };
  const st = settlement(settings, trip);
  const by = Object.fromEntries(st.people.map((p) => [p.id, p]));
  assert.equal(by.b.repaid, 60);
  assert.equal(by.a.repaid, -60);
  assert.equal(by.a.balance, 40);
  assert.equal(by.b.balance, -40);
  assert.deepEqual(st.transfers.map((t) => [t.from, t.to, t.amount]), [['b', 'a', 40]]);
  trip.repayments.push({ id: 'r2', date: '2027-03-02', from: 'b', to: 'a', amount: 40 });
  assert.equal(settlement(settings, trip).transfers.length, 0);
});

test('CSV für Kässeli: Datum, Buchungstext, Betrag; ohne Datum separat', async () => {
  const { paymentsCsv } = await import('../public/js/calc.js');
  const t = { name: 'Thailand', items: [
    item({ title: 'Flug; BKK', catId: 'flug', payments: [{ date: '2026-10-01', amount: 2146.8, currency: 'CHF', chf: 2146.8, methodId: 'kk' }] }),
    item({ title: 'Hotel', payments: [{ date: '2026-11-02', amount: 4000, currency: 'THB', chf: 98.5, methodId: 'post' }, { date: '', amount: 10, currency: 'CHF', chf: 10, methodId: 'kk' }] }),
  ] };
  const all = paymentsCsv(settings, [t]);
  const lines = all.csv.replace('﻿', '').split('\r\n');
  assert.equal(lines[0], 'Datum;Buchungstext;Betrag CHF;Bezahlmethode;Reise;Posten;Kategorie;Originalbetrag;Währung;Notiz');
  assert.equal(lines[1], '01.10.2026;"Thailand: Flug; BKK";2146.80;Kreditkarte;Thailand;"Flug; BKK";Flug;;;');
  assert.equal(lines[2], '02.11.2026;Thailand: Hotel;98.50;Postkonto;Thailand;Hotel;;4000.00;THB;');
  assert.equal(all.count, 2);
  assert.equal(all.undated.length, 1);
  assert.equal(paymentsCsv(settings, [t], { methodId: 'kk' }).count, 1);
});

test('Bargeld-Kasse: Bezüge minus bar bezahlte Ausgaben, effektiver Kurs, Korrektur', () => {
  const settings = { methods: [{ id: 'bar', name: 'Bar' }, { id: 'kk', name: 'Kreditkarte' }], rates: { THB: { rate: 0.025 } } };
  const trip = {
    currency: 'THB',
    cash: [
      { id: 'a', kind: 'bezug', date: '2027-02-01', amount: 10000, currency: 'THB', chf: 262 },
      { id: 'b', kind: 'korrektur', date: '2027-02-03', amount: -200, currency: 'THB' },
    ],
    items: [
      { title: 'Essen', plan: { amount: 800, currency: 'THB' }, payments: [{ amount: 800, currency: 'THB', methodId: 'bar', date: '2027-02-01' }] },
      { title: 'Hotel', plan: { amount: 5000, currency: 'THB' }, payments: [{ amount: 5000, currency: 'THB', methodId: 'kk', date: '2027-02-01' }] },
      { title: 'Taxi CHF', plan: { amount: 50, currency: 'CHF' }, payments: [{ amount: 50, currency: 'CHF', methodId: 'bar' }] },
    ],
  };
  const w = cashWallet(settings, trip);
  assert.equal(w.length, 1); // CHF hat keinen Kassen-Eintrag → kein Portemonnaie
  assert.equal(w[0].balance, 10000 - 800 - 200);
  assert.ok(Math.abs(w[0].rate - 0.0262) < 1e-9);
  assert.ok(isCashMethod({ name: 'Bargeld' }) && !isCashMethod({ name: 'Bargeld', cash: false }) && isCashMethod({ name: 'Portemonnaie', cash: true }));
});

test('Version: package.json und oberster CHANGELOG-Eintrag stimmen überein', async () => {
  const fs = await import('node:fs');
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const log = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const top = log.match(/^##\s+(\S+)\s+[–-]\s+(\d{4}-\d{2}-\d{2})/m);
  assert.ok(top, 'CHANGELOG.md braucht einen Eintrag «## Version – Datum»');
  assert.equal(top[1], pkg.version, 'Neue Version: package.json und CHANGELOG.md gemeinsam anpassen');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});
