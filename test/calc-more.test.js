// Weitere Tests der Rechenlogik: Rand- und Sonderfälle (erfundene Daten)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evalExpr, fmt, fmt0, fmtCur, fmtRange, fmtDay, round2, addDays, daysBetween, tripDates, currencies, rateOf, toCHF, fromCHF,
  itemCalc, tripSummary, placeFor, dayCurrency, stayFor, dueList, byMethod, methodUsage, shares, settlement, minimizeTransfers,
  todoList, tripCsv, paymentsCsv, mergeItems, cashWallet, cashPlan,
} from '../public/js/calc.js';

const S = { rates: { THB: { rate: 0.025 }, EUR: { rate: 0.95 } }, methods: [{ id: 'kk', name: 'Karte' }, { id: 'bar', name: 'Bar' }], categories: [{ id: 'essen', name: 'Essen' }] };
const it = (o) => ({ date: '2030-01-02', title: 'X', catId: 'essen', plan: { amount: 0, currency: 'CHF' }, payWhere: 'vorgaengig', payments: [], todos: [], files: [], ...o });

test('Zahlen und Ausdrücke: Grenzfälle', () => {
  assert.equal(evalExpr("1'500 + 2*(3+4)"), 1514);
  assert.equal(evalExpr('12,50'), 12.5);
  assert.equal(evalExpr('=-5+-2'), -7);
  assert.equal(evalExpr(''), 0);
  assert.ok(Number.isNaN(evalExpr('3+')));
  assert.ok(Number.isNaN(evalExpr('(1+2')));
  assert.ok(Number.isNaN(evalExpr('1/0')));
  assert.ok(Number.isNaN(evalExpr('abc')));
  assert.equal(fmt(-0.001), '0.00');
  assert.equal(fmt0(undefined), '0');
  assert.equal(fmtCur(15300, 'THB'), "15'300 THB");
  assert.equal(fmtCur(12.5), '12.50');
  assert.equal(round2(-0.001), 0);
});

test('Datum: Zeitspannen, Wochentag, Reisetage', () => {
  assert.equal(fmtRange('2030-02-06', '2030-02-27'), '06.–27.02.2030');
  assert.equal(fmtRange('2030-01-28', '2030-02-05'), '28.01.–05.02.2030');
  assert.equal(fmtRange('2029-12-28', '2030-01-05'), '28.12.2029–05.01.2030');
  assert.equal(fmtRange('2030-01-01', ''), '01.01.2030');
  assert.equal(fmtDay('2030-01-01'), 'Di 01.01.');
  assert.equal(addDays('2030-02-28', 1), '2030-03-01');
  assert.equal(daysBetween('2030-03-30', '2030-04-02'), 3); // über Sommerzeit-Wechsel
  assert.deepEqual(tripDates({ start: '2030-01-03', end: '2030-01-01' }), []);
  assert.equal(tripDates({ start: '2030-01-01', end: '2030-01-03' }).length, 3);
});

test('Währungen: CHF ist 1, unbekannte Währung NaN, Umrechnung hin und zurück', () => {
  assert.deepEqual(currencies(S), ['CHF', 'EUR', 'THB']);
  assert.deepEqual(currencies(null), ['CHF']);
  assert.equal(rateOf(S, 'CHF'), 1);
  assert.ok(Number.isNaN(rateOf(S, 'XYZ')));
  assert.equal(toCHF(S, 1000, 'THB'), 25);
  assert.equal(fromCHF(S, 25, 'THB'), 1000);
});

test('Posten: erledigt ohne Zahlung, fehlender Kurs, gleitender Rest bei CHF-Zahlung auf Fremdwährung', () => {
  assert.equal(itemCalc(S, it({ plan: { amount: 100, currency: 'CHF' }, done: true })).status, 'bezahlt');
  const miss = itemCalc(S, it({ plan: { amount: 100, currency: 'XYZ' } }));
  assert.equal(miss.rateMissing, true);
  const fl = itemCalc(S, it({ plan: { amount: 4000, currency: 'THB' }, payments: [{ amount: 50, currency: 'CHF' }] }));
  assert.equal(fl.status, 'angezahlt');
  assert.equal(fl.floating, true);
  assert.equal(fl.open, 2000);
  const info = itemCalc(S, it({}));
  assert.equal(info.status, 'info');
  assert.equal(itemCalc(S, it({ plan: { amount: 50, currency: 'CHF' }, payWhere: 'vorort' })).label, 'offen – vor Ort');
  assert.match(itemCalc(S, it({ plan: { amount: 50, currency: 'CHF' }, reserved: true })).label, /reserviert/);
});

test('Ort, Währung und Unterkunft eines Tages', () => {
  const trip = { currency: 'THB', days: { '2030-01-03': { place: 'Krabi', currency: 'CHF' } }, items: [it({ date: '2030-01-01', endDate: '2030-01-03', title: 'Hotel', place: 'Bangkok' })] };
  assert.equal(placeFor(trip, null, '2030-01-03'), 'Krabi');
  assert.equal(placeFor(trip, null, '2030-01-02'), 'Bangkok');
  assert.equal(placeFor(trip, null, '2030-01-03') && placeFor({ ...trip, days: {} }, null, '2030-01-03'), 'Bangkok'); // Abreisetag: Ort der letzten Nacht
  assert.equal(placeFor({ items: [] }, it({ place: 'Zürich' }), '2030-01-09'), 'Zürich');
  assert.equal(dayCurrency(trip, '2030-01-03'), 'CHF');
  assert.equal(dayCurrency(trip, '2030-01-02'), 'THB');
  assert.equal(dayCurrency({}, '2030-01-02'), 'CHF');
  assert.equal(stayFor(trip, '2030-01-02').title, 'Hotel');
  assert.equal(stayFor(trip, '2030-01-03'), undefined); // Check-out-Tag
});

test('Fälligkeiten, Bezahlmethoden, Nutzung einer Methode', () => {
  const trip = { items: [
    it({ title: 'A', plan: { amount: 100, currency: 'CHF' }, dueDate: '2030-01-10', dueMethodId: 'kk' }),
    it({ title: 'B', plan: { amount: 100, currency: 'CHF' } }),
    it({ title: 'C', plan: { amount: 100, currency: 'CHF' }, dueDate: '2029-12-01' }),
    it({ title: 'D', plan: { amount: 40, currency: 'CHF' }, payWhere: 'vorort' }),
    it({ title: 'E', plan: { amount: 30, currency: 'CHF' }, payments: [{ amount: 30, currency: 'CHF', methodId: 'bar' }] }),
  ] };
  assert.deepEqual(dueList(S, trip).map((x) => x.it.title), ['C', 'A', 'B']); // vor Ort und bezahlt nicht im Kalender
  const bm = Object.fromEntries(byMethod(S, trip).map((m) => [m.methodId, m]));
  assert.equal(bm.kk.planned, 100);
  assert.equal(bm.bar.paid, 30);
  assert.equal(bm.vorort.planned, 40);
  assert.equal(methodUsage([trip], 'kk'), 1);
  assert.equal(methodUsage([trip], 'bar'), 1);
});

test('Kostenaufteilung: Anteile nach Beträgen, nicht zugeordnete Zahlungen, Ausgleich', () => {
  const parts = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  assert.deepEqual(shares(it({ split: { mode: 'amounts', values: { a: 30, b: 10, c: 0 } } }), parts), { a: 0.75, b: 0.25, c: 0 });
  assert.deepEqual(shares(it({ split: { mode: 'shares', values: {} } }), parts), { a: 1 / 3, b: 1 / 3, c: 1 / 3 }); // ohne Werte gleichmässig
  assert.deepEqual(shares(it({ split: { mode: 'equal', members: ['zz'] } }), parts), { a: 1 / 3, b: 1 / 3, c: 1 / 3 });
  assert.deepEqual(shares(it({}), []), {});
  const trip = { split: { enabled: true, participants: parts }, items: [
    it({ plan: { amount: 90, currency: 'CHF' }, payments: [{ amount: 90, currency: 'CHF', paidBy: 'a' }] }),
    it({ plan: { amount: 30, currency: 'CHF' }, payments: [{ amount: 30, currency: 'CHF' }] }), // ohne «bezahlt von»
  ] };
  const s = settlement(S, trip, '2030-01-01');
  assert.equal(s.unassigned, 30);
  assert.equal(s.people.find((p) => p.id === 'a').balance, 50);
  assert.deepEqual(minimizeTransfers([{ id: 'x', balance: 0 }]), []);
});

test('To-dos sortiert, CSV der Reise mit Sonderzeichen', () => {
  const trip = { items: [
    it({ title: 'Hotel; "Sol"', date: '2030-01-02', todos: [{ text: 'b', due: '2030-01-05', done: false }, { text: 'erledigt', done: true }] }),
    it({ title: 'Flug', date: '2030-01-01', todos: [{ text: 'a', due: '', done: false }] }),
  ] };
  assert.deepEqual(todoList(trip).map((x) => x.todo.text), ['b', 'a', 'erledigt']);
  const csv = tripCsv(S, trip);
  assert.ok(csv.startsWith('﻿'));
  assert.match(csv, /"Hotel; ""Sol"""/);
  assert.match(csv.split('\r\n')[1], /^2030-01-01;/); // nach Datum sortiert
});

test('Kässeli-CSV: Bargeldbezüge als eigene Zeile, nach Methode gefiltert', () => {
  const trip = { name: 'R', items: [it({ title: 'Essen', payments: [{ date: '2030-01-02', amount: 400, currency: 'THB', chf: 10, methodId: 'bar' }] })],
    cash: [{ kind: 'bezug', date: '2030-01-01', amount: 5000, currency: 'THB', chf: 131, methodId: 'kk' }, { kind: 'bezug', date: '', amount: 1, currency: 'THB', chf: 1 }, { kind: 'korrektur', amount: -5, currency: 'THB' }] };
  const all = paymentsCsv(S, [trip]);
  assert.equal(all.count, 2);
  assert.match(all.csv, /Bargeldbezug THB 5'000/);
  const kk = paymentsCsv(S, [trip], { methodId: 'kk' });
  assert.equal(kk.count, 1);
  assert.equal(kk.total, 131);
});

test('Zusammenführen: Notizen, To-dos und Belege beider Posten bleiben', () => {
  const a = it({ title: 'A', note: 'eins', plan: { amount: 100, currency: 'CHF' }, todos: [{ id: 't1', text: 'x' }], files: [{ id: 'f1' }] });
  const b = it({ title: 'B', note: 'zwei', plan: { amount: 50, currency: 'CHF' }, todos: [{ id: 't2', text: 'y' }], files: [{ id: 'f2' }] });
  const m = mergeItems(S, a, b);
  assert.equal(m.plan.amount, 150);
  assert.deepEqual(m.files.map((f) => f.id), ['f1', 'f2']);
  assert.equal(m.todos.length, 2);
  assert.match(m.note, /eins/);
  assert.match(m.note, /zwei/);
});

test('Prognose pro Person und Bargeldplan ab heute', () => {
  const trip = { start: '2030-01-01', end: '2030-01-03', currency: 'THB', travelers: 4, allowances: [], items: [
    it({ date: '2030-01-01', plan: { amount: 400, currency: 'CHF' } }),
    it({ date: '2030-01-03', plan: { amount: 2000, currency: 'THB' }, payWhere: 'vorort' }),
    it({ date: '2030-01-01', plan: { amount: 1000, currency: 'THB' }, payWhere: 'vorort' }),
  ] };
  const sum = tripSummary(S, trip, '2030-01-01');
  assert.equal(sum.forecast, 475);
  assert.equal(sum.perPerson, 118.75);
  const cp = cashPlan(S, trip, { from: '2030-01-02' });
  assert.equal(cp[0].total, 2000); // was vor dem Stichtag lag, fehlt
  assert.deepEqual(cashWallet(S, { items: [], cash: [] }), []);
});
