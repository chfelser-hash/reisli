// Ansicht «Offen»: Zahlungskalender (was ist wann fällig), Bargeld vor Ort, To-dos
import { h, toast } from '../ui.js';
import { trip, settings, saveItem, render, methodName, personName } from '../app.js';
import { dueList, cashPlan, todoList, fmt, fmt0, fmtCur, fmtDate, fmtDay, todayStr, toCHF, MONTHS, paymentCHF, daysBetween } from '../calc.js';
import { editItem, quickPay, catDot } from './item.js';
import { renderPlan } from './plan.js';

let tab = 'zahlungen';
let withAllowances = true;
let fromToday = true;

export function renderOffen() {
  const t = trip();
  if (!t) return renderPlan();
  const todos = todoList(t).filter((x) => !x.todo.done).length;
  const seg = (id, label) => h('button', { class: 'seg' + (tab === id ? ' on' : ''), onclick: () => { tab = id; render(); } }, label);
  const view = h('div', { class: 'view offen' },
    h('div', { class: 'toolbar' }, h('div', { class: 'segs' }, seg('zahlungen', 'Zahlungen'), seg('bargeld', 'Vor Ort / Bargeld'), seg('todos', todos ? `To-dos (${todos})` : 'To-dos')))
  );
  if (tab === 'zahlungen') view.append(...payments(t));
  else if (tab === 'bargeld') view.append(...cash(t));
  else view.append(todosView(t));
  return view;
}

// ---------- Zahlungskalender ----------
function payments(t) {
  const S = settings();
  const today = todayStr();
  const list = dueList(S, t);
  const groups = new Map();
  for (const x of list) {
    const d = x.it.dueDate;
    const key = !d ? 'none' : d < today ? 'over' : d.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  const label = (k) => (k === 'none' ? 'Ohne Fälligkeitsdatum' : k === 'over' ? 'Überfällig' : `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`);
  const order = [...groups.keys()].sort((a, b) => (a === 'over' ? -1 : b === 'over' ? 1 : a === 'none' ? 1 : b === 'none' ? -1 : a.localeCompare(b)));
  const totalCHF = list.reduce((a, x) => a + x.c.openCHF, 0);

  const due = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Zahlungskalender'), h('span', { class: 'muted' }, `vorgängig noch zu zahlen: CHF ${fmt0(totalCHF)}`)),
    list.length ? null : h('p', { class: 'empty' }, 'Keine offenen Vorauszahlungen. 🎉'),
    order.map((k) => h('div', { class: 'due-group' + (k === 'over' ? ' over' : '') },
      h('h3', null, label(k), h('span', { class: 'muted' }, ' · CHF ' + fmt0(groups.get(k).reduce((a, x) => a + x.c.openCHF, 0)))),
      h('ul', { class: 'due-list' }, groups.get(k).map(({ it, c }) => h('li', { class: 'due-row' },
        h('span', { class: 'due-date' }, it.dueDate ? fmtDate(it.dueDate) : '—', it.dueDate && it.dueDate >= today ? h('small', null, `in ${daysBetween(today, it.dueDate)} T.`) : null),
        h('button', { class: 'due-main link-like', onclick: () => editItem(it) },
          h('span', { class: 'it-title' }, catDot(it.catId), it.title),
          h('span', { class: 'it-meta' }, `${fmtDay(it.date)} · ${c.label}${it.dueMethodId ? ' · ' + methodName(it.dueMethodId) : ''}`)
        ),
        h('span', { class: 'it-amt' }, it.plan.currency === 'CHF' ? fmt(c.openCHF) : h('span', { class: 'two' }, h('span', null, fmtCur(c.open, it.plan.currency)), h('small', null, '≈ CHF ' + fmt(c.openCHF)))),
        h('button', { class: 'btn small', onclick: () => quickPay(it) }, '✓ bezahlt')
      )))
    ))
  );

  // Bisherige Zahlungen
  const paid = [];
  for (const it of t.items) for (const p of it.payments || []) paid.push({ it, p });
  paid.sort((a, b) => (b.p.date || '').localeCompare(a.p.date || ''));
  const history = h('section', { class: 'card' },
    h('details', null,
      h('summary', null, h('strong', null, `Bisherige Zahlungen (${paid.length})`), h('span', { class: 'muted' }, ' · CHF ' + fmt0(paid.reduce((a, x) => a + paymentCHF(S, x.p), 0)))),
      h('div', { class: 'table-scroll' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Datum'), h('th', null, 'Posten'), h('th', null, 'Methode'), t.split?.enabled ? h('th', null, 'Von') : null, h('th', { class: 'num' }, 'Betrag'), h('th', { class: 'num' }, 'CHF'))),
        h('tbody', null, paid.map(({ it, p }) => h('tr', { class: 'clickable', onclick: () => editItem(it) },
          h('td', null, p.date ? fmtDate(p.date) : h('span', { class: 'muted' }, 'unbekannt')),
          h('td', null, it.title),
          h('td', null, methodName(p.methodId)),
          t.split?.enabled ? h('td', null, personName(p.paidBy) || h('span', { class: 'warn' }, '?')) : null,
          h('td', { class: 'num' }, fmtCur(p.amount, p.currency)),
          h('td', { class: 'num' }, fmt(paymentCHF(S, p)))
        )))
      ))
    )
  );
  return [due, history];
}

// ---------- Bargeld / vor Ort ----------
function cash(t) {
  const S = settings();
  const today = todayStr();
  const from = fromToday && today > t.start ? today : '';
  const groups = cashPlan(S, t, { withAllowances, from, today });
  const opts = h('section', { class: 'card' },
    h('p', { class: 'muted' }, 'Was noch vor Ort bezahlt werden muss – so weisst du, wie viel Bargeld du abheben oder einplanen musst.'),
    h('div', { class: 'row gap wrap' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: withAllowances, onchange: (e) => { withAllowances = e.target.checked; render(); } }), `Pauschalen einrechnen (in ${t.currency})`),
      today > t.start && today <= t.end ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: fromToday, onchange: (e) => { fromToday = e.target.checked; render(); } }), 'nur ab heute') : null
    )
  );
  if (!groups.length) return [opts, h('section', { class: 'card' }, h('p', { class: 'empty' }, 'Nichts mehr vor Ort zu bezahlen.'))];
  return [opts, ...groups.map((g) => h('section', { class: 'card cash' },
    h('div', { class: 'cash-head' },
      h('span', { class: 'cash-cur' }, g.currency),
      h('span', { class: 'cash-total' }, fmtCur(g.total)),
      g.currency !== 'CHF' ? h('span', { class: 'muted' }, '≈ CHF ' + fmt0(toCHF(S, g.total, g.currency))) : null
    ),
    h('ul', { class: 'cash-places' }, g.places.map((p) => h('li', null,
      h('span', null, h('strong', null, p.place), h('span', { class: 'muted small' }, ` ${fmtDay(p.from)}${p.to !== p.from ? ' – ' + fmtDay(p.to) : ''}`)),
      h('span', { class: 'num strong' }, fmtCur(p.total, g.currency))
    ))),
    h('details', null,
      h('summary', null, 'Einzelposten'),
      h('ul', { class: 'cash-rows' }, g.rows.map((r) => h('li', { class: r.allowance ? 'allowance' : '' },
        h('span', { class: 'muted' }, fmtDay(r.date)),
        r.itemId ? h('button', { class: 'link-like', onclick: () => editItem(t.items.find((x) => x.id === r.itemId)) }, r.title) : h('span', null, r.title),
        h('span', { class: 'num' }, fmtCur(r.amount))
      )))
    )
  ))];
}

// ---------- To-dos ----------
function todosView(t) {
  const today = todayStr();
  const list = todoList(t);
  if (!list.length) return h('section', { class: 'card' }, h('p', { class: 'empty' }, 'Keine To-dos. Du kannst bei jedem Posten To-dos erfassen (z.B. «Passdaten schicken»).'));
  return h('section', { class: 'card' },
    h('ul', { class: 'todo-list' }, list.map(({ todo, item }) => h('li', { class: (todo.done ? 'done' : '') + (!todo.done && todo.due && todo.due < today ? ' over' : '') },
      h('input', { type: 'checkbox', checked: todo.done, 'aria-label': 'erledigt', onchange: async (e) => {
        try {
          await saveItem({ ...item, todos: item.todos.map((x) => (x.id === todo.id ? { ...x, done: e.target.checked } : x)) });
          render();
        } catch (ex) {
          toast(ex.message, { error: true });
        }
      } }),
      h('span', { class: 'todo-text' }, todo.text, h('button', { class: 'link-like small muted', onclick: () => editItem(item) }, ` ${item.title} · ${fmtDay(item.date)}`)),
      todo.due ? h('span', { class: 'todo-due' }, 'bis ' + fmtDate(todo.due)) : h('span')
    )))
  );
}

