// Dialog zum Erfassen und Bearbeiten eines Postens (inkl. Zahlungen, Aufteilung, To-dos, Belege)
import { h, modal, chips, toast, confirmDialog, closeDialogOf } from '../ui.js';
import { state, trip, settings, saveItem, deleteItem, api, render, tripCurrencies, cat, hasRate } from '../app.js';
import { evalExpr, itemCalc, fmt, fmtCur, fmtDay, toCHF, round2, todayStr, isDate, addDays, nights, daysBetween, mergeItems, STATUS } from '../calc.js';

const uid = () => Math.random().toString(36).slice(2, 10);

/** Leerer Posten für ein Datum */
export function blankItem(date, extra = {}) {
  const t = trip();
  return {
    date: date || t.start,
    endDate: '',
    time: '',
    title: '',
    detail: '',
    catId: 'aktivitaet',
    place: '',
    plan: { amount: 0, currency: t.currency || 'CHF' },
    reserved: false,
    payWhere: 'vorgaengig',
    dueDate: '',
    dueMethodId: '',
    payments: [],
    done: false,
    link: '',
    note: '',
    todos: [],
    files: [],
    split: null,
    ...extra,
  };
}

/** Öffnet den Editor. Liefert den gespeicherten Posten oder null. */
export async function editItem(original, opts = {}) {
  const t = trip();
  const S = settings();
  const it = structuredClone(original);
  it.payments ||= [];
  it.todos ||= [];
  it.files ||= [];
  const isNew = !original.id;
  let saved = null;
  state.busy = true;

  const statusEl = h('div', { class: 'status-line' });
  const updateStatus = () => {
    const c = itemCalc(S, it);
    statusEl.replaceChildren(...[
      h('span', { class: 'pill ' + STATUS[c.status].cls }, c.label),
      c.hasCost ? h('span', { class: 'muted' }, `Total CHF ${fmt(c.totalCHF)}`) : null,
      c.paidCHF ? h('span', { class: 'muted' }, `· bezahlt ${fmt(c.paidCHF)}`) : null,
      c.open ? h('span', { class: 'muted' }, `· offen ${fmtCur(c.open, it.plan.currency)}`) : null,
      c.rateMissing ? h('span', { class: 'warn' }, `Kein Kurs für ${it.plan.currency} – unter Mehr → Währungen erfassen`) : null,
    ].filter(Boolean));
  };

  // ----- Titel & Kategorie -----
  const title = h('input', { value: it.title, placeholder: 'z.B. Flug nach Bangkok', required: true, oninput: (e) => (it.title = e.target.value) });
  const catChips = chips(
    S.categories.map((c) => ({ value: c.id, label: c.name, color: c.color })),
    it.catId,
    (v) => {
      it.catId = v;
      stayBox.hidden = !(v === 'unterkunft' || it.endDate);
    },
    'small cats'
  );

  // ----- Datum / Zeit / Unterkunft -----
  const endInput = h('input', { type: 'date', value: it.endDate || '', min: it.date, onchange: (e) => { it.endDate = e.target.value; nightsEl.textContent = nightsText(); } });
  const nightsText = () => (it.endDate > it.date ? `${nights(it)} ${nights(it) === 1 ? 'Nacht' : 'Nächte'}` : '');
  const nightsEl = h('span', { class: 'muted small' }, nightsText());
  const stayBox = h('label', { hidden: !(it.catId === 'unterkunft' || it.endDate) }, h('span', null, 'Check-out ', nightsEl), endInput);
  const dateInput = h('input', { type: 'date', value: it.date, required: true, onchange: (e) => {
    const old = it.date;
    it.date = e.target.value;
    // Unterkunft mitverschieben
    if (it.endDate && isDate(old) && isDate(it.date)) {
      const k = nights({ ...it, date: old });
      it.endDate = addDays(it.date, Math.max(1, k));
      endInput.value = it.endDate;
    }
    endInput.min = it.date;
    nightsEl.textContent = nightsText();
  } });

  // ----- Betrag -----
  const curOptions = tripCurrencies();
  const amountPreview = h('span', { class: 'muted small' });
  const amount = h('input', {
    class: 'amount-sm', inputmode: 'decimal', value: it.plan.amount ? String(it.plan.amount) : '', placeholder: '0',
    oninput: (e) => {
      const v = evalExpr(e.target.value);
      e.target.classList.toggle('invalid', Number.isNaN(v));
      if (!Number.isNaN(v)) it.plan.amount = round2(v);
      preview();
    },
  });
  const curSel = h('select', { class: 'cur-select', onchange: (e) => { it.plan.currency = e.target.value; preview(); } }, curOptions.map((c) => h('option', { value: c, selected: c === it.plan.currency }, c)));
  const preview = () => {
    const cur = it.plan.currency;
    amountPreview.textContent = cur !== 'CHF' && it.plan.amount ? (hasRate(cur) ? `≈ CHF ${fmt(toCHF(S, it.plan.amount, cur))}` : `Kurs für ${cur} fehlt`) : '';
    updateStatus();
  };

  // ----- Bezahlung -----
  const dueDate = h('input', { type: 'date', value: it.dueDate || '', onchange: (e) => (it.dueDate = e.target.value) });
  const dueMethod = h('select', { onchange: (e) => (it.dueMethodId = e.target.value) }, h('option', { value: '' }, '— noch offen —'), S.methods.map((m) => h('option', { value: m.id, selected: m.id === it.dueMethodId }, m.name)));
  const dueBox = h('div', { class: 'form-grid', hidden: it.payWhere === 'vorort' },
    h('label', null, 'Fällig am', dueDate),
    h('label', null, 'Wird bezahlt mit', dueMethod)
  );
  const where = chips([{ value: 'vorgaengig', label: 'vorgängig' }, { value: 'vorort', label: 'vor Ort' }], it.payWhere || 'vorgaengig', (v) => {
    it.payWhere = v;
    dueBox.hidden = v === 'vorort';
    updateStatus();
  }, 'small');
  const reserved = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.reserved, onchange: (e) => { it.reserved = e.target.checked; updateStatus(); } }), 'reserviert / gebucht');
  const done = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.done, onchange: (e) => { it.done = e.target.checked; updateStatus(); } }), 'abgeschlossen (Restdifferenz ignorieren)');

  // ----- Zahlungen -----
  const parts = t.split?.enabled ? t.split.participants : [];
  const payList = h('div', { class: 'pay-list' });
  const renderPayments = () => {
    payList.replaceChildren(
      ...it.payments.map((p, i) => {
        const chf = h('input', { class: 'num', inputmode: 'decimal', value: p.chf ?? '', placeholder: 'CHF', title: 'Effektiv belasteter Betrag in CHF (z.B. laut Kreditkartenabrechnung)', oninput: (e) => { const v = evalExpr(e.target.value); p.chf = e.target.value.trim() === '' || Number.isNaN(v) ? null : round2(v); updateStatus(); } });
        const autoChf = () => {
          if (p.currency === 'CHF') p.chf = p.amount;
          else if (hasRate(p.currency)) p.chf = round2(toCHF(S, p.amount, p.currency));
          chf.value = p.chf ?? '';
          chf.disabled = p.currency === 'CHF';
          updateStatus();
        };
        chf.disabled = p.currency === 'CHF';
        return h('div', { class: 'pay-row' },
          h('input', { type: 'date', value: p.date || '', title: 'Zahlungsdatum', onchange: (e) => (p.date = e.target.value) }),
          h('div', { class: 'row gap' },
            h('input', { class: 'num', inputmode: 'decimal', value: p.amount || '', placeholder: 'Betrag', oninput: (e) => { const v = evalExpr(e.target.value); if (!Number.isNaN(v)) { p.amount = round2(v); autoChf(); } } }),
            h('select', { class: 'cur-select', onchange: (e) => { p.currency = e.target.value; autoChf(); } }, curOptions.map((c) => h('option', { value: c, selected: c === p.currency }, c)))
          ),
          h('label', { class: 'inline' }, 'CHF', chf),
          h('select', { onchange: (e) => (p.methodId = e.target.value), 'aria-label': 'Bezahlmethode' }, h('option', { value: '' }, '— Methode —'), S.methods.map((m) => h('option', { value: m.id, selected: m.id === p.methodId }, m.name))),
          parts.length ? h('select', { onchange: (e) => (p.paidBy = e.target.value), 'aria-label': 'Bezahlt von' }, h('option', { value: '' }, '— bezahlt von —'), parts.map((x) => h('option', { value: x.id, selected: x.id === p.paidBy }, x.name))) : null,
          h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Zahlung entfernen', onclick: () => { it.payments.splice(i, 1); renderPayments(); updateStatus(); } }, '✕')
        );
      })
    );
  };
  const lastMethod = () => {
    try { return localStorage.getItem('reisli.method') || ''; } catch { return ''; }
  };
  const addPayment = (rest) => {
    const c = itemCalc(S, it);
    const cur = it.plan.currency || 'CHF';
    const amt = rest ? c.open : 0;
    it.payments.push({ id: uid(), date: todayStr(), amount: amt, currency: cur, chf: amt ? round2(toCHF(S, amt, cur)) : null, methodId: it.dueMethodId || lastMethod(), paidBy: parts[0]?.id || '', note: '' });
    renderPayments();
    updateStatus();
  };
  renderPayments();

  // ----- Aufteilung -----
  let splitBox = null;
  if (parts.length) {
    it.split ||= { mode: 'equal', members: parts.map((p) => p.id), values: {} };
    it.split.members ||= parts.map((p) => p.id);
    it.split.values ||= {};
    const body = h('div');
    const renderSplit = () => {
      if (it.split.mode === 'equal') {
        body.replaceChildren(h('div', { class: 'chips' }, parts.map((p) =>
          h('label', { class: 'check chip-check' }, h('input', { type: 'checkbox', checked: it.split.members.includes(p.id), onchange: (e) => {
            it.split.members = e.target.checked ? [...new Set([...it.split.members, p.id])] : it.split.members.filter((x) => x !== p.id);
          } }), p.name)
        )));
      } else {
        body.replaceChildren(h('div', { class: 'form-grid' }, parts.map((p) =>
          h('label', null, p.name + (it.split.mode === 'amounts' ? ` (${it.plan.currency})` : ' (Anteile)'),
            h('input', { class: 'num', inputmode: 'decimal', value: it.split.values[p.id] ?? '', oninput: (e) => (it.split.values[p.id] = evalExpr(e.target.value) || 0) }))
        )));
      }
    };
    splitBox = h('section', { class: 'ed-sec' },
      h('h3', null, 'Aufteilung'),
      chips([{ value: 'equal', label: 'gleichmässig' }, { value: 'shares', label: 'nach Anteilen' }, { value: 'amounts', label: 'nach Beträgen' }], it.split.mode, (v) => { it.split.mode = v; renderSplit(); }, 'small'),
      body
    );
    renderSplit();
  }

  // ----- To-dos -----
  const todoList = h('div', { class: 'todo-edit' });
  const renderTodos = () => {
    todoList.replaceChildren(...it.todos.map((td, i) => h('div', { class: 'todo-row' },
      h('input', { type: 'checkbox', checked: td.done, onchange: (e) => (td.done = e.target.checked), 'aria-label': 'erledigt' }),
      h('input', { value: td.text, placeholder: 'z.B. Passdaten schicken', oninput: (e) => (td.text = e.target.value) }),
      h('input', { type: 'date', value: td.due || '', onchange: (e) => (td.due = e.target.value), 'aria-label': 'bis wann' }),
      h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'To-do entfernen', onclick: () => { it.todos.splice(i, 1); renderTodos(); } }, '✕')
    )));
  };
  renderTodos();

  // ----- Belege -----
  const filesEl = h('ul', { class: 'file-list' });
  const renderFiles = () => {
    filesEl.replaceChildren(...it.files.map((f) => h('li', null,
      h('a', { href: '/api/files/' + f.id, target: '_blank', rel: 'noopener' }, '📎 ' + f.name),
      h('span', { class: 'muted small' }, Math.max(1, Math.round(f.size / 1024)) + ' KB'),
      h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Beleg löschen', onclick: async () => {
        if (!(await confirmDialog('Beleg löschen', `«${f.name}» endgültig löschen?`, 'Löschen', true))) return;
        await api('DELETE', `/api/trips/${t.id}/items/${it.id}/files/${f.id}`);
        it.files = it.files.filter((x) => x.id !== f.id);
        const live = t.items.find((x) => x.id === it.id);
        if (live) live.files = it.files;
        renderFiles();
      } }, '✕')
    )));
  };
  const fileInput = h('input', { type: 'file', class: 'file-input', multiple: true, accept: 'image/*,application/pdf,.pdf,.txt,.eml,.msg,.doc,.docx', onchange: async (e) => {
    const list = [...e.target.files];
    e.target.value = '';
    if (!list.length) return;
    try {
      if (!it.id) {
        // Neuer Posten: zuerst speichern, damit der Beleg einen Platz hat
        if (!validate()) return;
        const s = await saveItem(it);
        Object.assign(it, { id: s.id });
        saved = s;
      }
      for (const f of list) {
        const r = await api('POST', `/api/trips/${t.id}/items/${it.id}/files`, f);
        it.files.push(r.file);
        const live = t.items.find((x) => x.id === it.id);
        if (live && live !== it) live.files = [...it.files];
      }
      renderFiles();
      toast(list.length === 1 ? 'Beleg gespeichert' : `${list.length} Belege gespeichert`);
    } catch (ex) {
      toast(ex.message, { error: true });
    }
  } });
  renderFiles();

  const err = h('p', { class: 'form-error', role: 'alert' });
  const validate = () => {
    err.textContent = '';
    if (!it.title.trim()) { err.textContent = 'Bitte einen Titel eingeben.'; title.focus(); return false; }
    if (!isDate(it.date)) { err.textContent = 'Datum fehlt.'; return false; }
    if (it.endDate && it.endDate <= it.date) it.endDate = '';
    return true;
  };

  const content = h('div', { class: 'item-editor' },
    statusEl,
    h('label', null, 'Titel', title),
    catChips,
    h('div', { class: 'form-grid three' },
      h('label', null, 'Datum', dateInput),
      h('label', null, 'Zeit', h('input', { type: 'time', value: it.time || '', onchange: (e) => (it.time = e.target.value) })),
      stayBox
    ),
    h('div', { class: 'form-grid' },
      h('label', null, 'Detail', h('input', { value: it.detail || '', placeholder: 'z.B. Ab 20:00, Hotelname, Tauchplatz', oninput: (e) => (it.detail = e.target.value) })),
      h('label', null, 'Ort', h('input', { value: it.place || '', placeholder: 'leer = Ort des Tages', oninput: (e) => (it.place = e.target.value) }))
    ),
    h('section', { class: 'ed-sec' },
      h('h3', null, 'Kosten'),
      h('div', { class: 'row gap wrap amount-line' }, amount, curSel, amountPreview),
      h('div', { class: 'row gap wrap' }, h('span', { class: 'muted small' }, 'Bezahlung'), where, reserved),
      dueBox
    ),
    h('section', { class: 'ed-sec' },
      h('div', { class: 'row gap wrap' }, h('h3', null, 'Zahlungen'), h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn small', onclick: () => addPayment(true) }, '✓ Rest bezahlt'),
        h('button', { type: 'button', class: 'btn small', onclick: () => addPayment(false) }, '+ Zahlung')),
      payList,
      it.payments.length || it.done ? done : h('p', { class: 'hint' }, 'Anzahlungen und Restzahlungen einzeln erfassen. Bei Fremdwährung den effektiv belasteten CHF-Betrag eintragen – der Kurs wird so eingefroren.'),
      it.payments.length || it.done ? null : done
    ),
    splitBox,
    h('section', { class: 'ed-sec' },
      h('div', { class: 'row gap' }, h('h3', null, 'To-dos'), h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn small', onclick: () => { it.todos.push({ id: uid(), text: '', due: '', done: false }); renderTodos(); todoList.querySelector('.todo-row:last-child input:not([type])')?.focus(); } }, '+ To-do')),
      todoList
    ),
    h('section', { class: 'ed-sec' },
      h('label', null, 'Link (Buchung, Bestätigung …)', h('input', { type: 'url', value: it.link || '', placeholder: 'https://', oninput: (e) => (it.link = e.target.value.trim()) })),
      h('label', null, 'Notiz', h('textarea', { rows: 3, oninput: (e) => (it.note = e.target.value) }, it.note || '')),
      h('div', { class: 'row gap wrap' }, h('h3', null, 'Belege'), h('span', { class: 'spacer' }), h('label', { class: 'btn small file-btn' }, '+ Datei', fileInput)),
      filesEl,
      it.files.length ? null : h('p', { class: 'hint' }, 'PDF, Fotos von Quittungen usw. Sie bleiben auf dem Server (NAS).')
    ),
    !isNew ? h('section', { class: 'ed-sec' },
      h('div', { class: 'row gap wrap' },
        h('span', { class: 'muted small grow' }, 'Doppelt erfasst oder Anzahlung und Rest als zwei Posten?'),
        h('button', { type: 'button', class: 'btn small', onclick: async (e) => {
          if (!validate()) return;
          const merged = await mergeDialog(it);
          if (!merged) return;
          saved = merged;
          closeDialogOf(e.target);
        } }, 'Mit anderem Posten zusammenführen …'))
    ) : null,
    err
  );
  preview();

  const buttons = [
    !isNew ? { label: 'Löschen', danger: true, onClick: async () => {
      if (!(await confirmDialog('Posten löschen', `«${original.title}» wirklich löschen? Belege werden ebenfalls gelöscht.`, 'Löschen', true))) return false;
      await deleteItem(original.id);
      toast('Gelöscht');
      return 'deleted';
    } } : null,
    !isNew ? { label: 'Duplizieren', onClick: async () => {
      if (!validate()) return false;
      const copy = { ...structuredClone(it), id: undefined, payments: [], files: [], done: false, todos: it.todos.map((x) => ({ ...x, id: uid(), done: false })) };
      await saveItem(it);
      saved = await saveItem(copy);
      toast('Kopie angelegt');
      return 'copied';
    } } : null,
    { label: 'Abbrechen', value: null },
    { label: 'Speichern', primary: true, onClick: async () => {
      if (!validate()) return false;
      try {
        it.todos = it.todos.filter((x) => x.text.trim());
        saved = await saveItem(it);
        for (const p of it.payments) if (p.methodId) try { localStorage.setItem('reisli.method', p.methodId); } catch { /* egal */ }
        toast(isNew ? 'Gespeichert' : 'Geändert');
        return 'saved';
      } catch (ex) {
        err.textContent = ex.message;
        return false;
      }
    } },
  ].filter(Boolean);

  const res = await modal(isNew ? opts.title || 'Neuer Posten' : 'Posten bearbeiten', content, buttons);
  state.busy = false;
  if (res || saved) render();
  return res === 'deleted' ? null : saved;
}

/** Kurzer Dialog «Zahlung erfassen» (z.B. aus dem Zahlungskalender) */
export async function quickPay(item) {
  const S = settings();
  const t = trip();
  const c = itemCalc(S, item);
  const cur = item.plan.currency || 'CHF';
  const p = { id: uid(), date: todayStr(), amount: c.open, currency: cur, chf: round2(toCHF(S, c.open, cur)), methodId: item.dueMethodId || '', paidBy: t.split?.participants?.[0]?.id || '', note: '' };
  const parts = t.split?.enabled ? t.split.participants : [];
  const chf = h('input', { class: 'num', inputmode: 'decimal', value: p.chf, disabled: cur === 'CHF', oninput: (e) => (p.chf = round2(evalExpr(e.target.value))) });
  const content = h('div', { class: 'form-grid' },
    h('p', { class: 'span2' }, h('strong', null, item.title), ' – offen ', fmtCur(c.open, cur)),
    h('label', null, 'Datum', h('input', { type: 'date', value: p.date, onchange: (e) => (p.date = e.target.value) })),
    h('label', null, `Betrag (${cur})`, h('input', { class: 'num', inputmode: 'decimal', value: p.amount, oninput: (e) => {
      const v = evalExpr(e.target.value);
      if (Number.isNaN(v)) return;
      p.amount = round2(v);
      if (cur === 'CHF') p.chf = p.amount;
      else if (hasRate(cur)) p.chf = round2(toCHF(S, p.amount, cur));
      chf.value = p.chf;
    } })),
    cur !== 'CHF' ? h('label', null, 'Effektiv belastet (CHF)', chf) : null,
    h('label', null, 'Bezahlt mit', h('select', { onchange: (e) => (p.methodId = e.target.value) }, h('option', { value: '' }, '— Methode —'), S.methods.map((m) => h('option', { value: m.id, selected: m.id === p.methodId }, m.name)))),
    parts.length ? h('label', null, 'Bezahlt von', h('select', { onchange: (e) => (p.paidBy = e.target.value) }, parts.map((x) => h('option', { value: x.id, selected: x.id === p.paidBy }, x.name)))) : null
  );
  const r = await modal('Zahlung erfassen', content, [
    { label: 'Abbrechen', value: null },
    { label: 'Als bezahlt speichern', primary: true, value: 'ok' },
  ]);
  if (r !== 'ok') return;
  await saveItem({ ...item, payments: [...(item.payments || []), p] });
  toast('Zahlung gespeichert');
  render();
}

/**
 * Auswahl eines zweiten Postens, der in «it» zusammengeführt wird. Ähnliche Titel und nahe Daten zuerst.
 * Speichert zuerst die aktuellen Änderungen an «it». Liefert den zusammengeführten Posten oder null.
 */
async function mergeDialog(it) {
  const t = trip();
  const S = settings();
  const words = new Set(it.title.toLowerCase().split(/[^a-zäöü0-9]+/).filter((w) => w.length > 3));
  const score = (x) => {
    const common = x.title.toLowerCase().split(/[^a-zäöü0-9]+/).filter((w) => words.has(w)).length;
    return common * 100 - Math.abs(daysBetween(it.date, x.date)) - (x.catId === it.catId ? 0 : 20);
  };
  const others = t.items.filter((x) => x.id !== it.id).sort((a, b) => score(b) - score(a));
  let pick = null;
  const preview = h('div', { class: 'merge-preview' });
  const showPreview = () => {
    if (!pick) return preview.replaceChildren(h('p', { class: 'hint' }, 'Posten wählen, der in diesen hier übernommen wird.'));
    const m = mergeItems(S, it, pick);
    const c = itemCalc(S, m);
    preview.replaceChildren(
      h('p', null, h('strong', null, it.title), ' übernimmt ', h('strong', null, pick.title), '. Danach:'),
      h('ul', { class: 'small' },
        h('li', null, `Planbetrag ${fmtCur(m.plan.amount, m.plan.currency)} (≈ CHF ${fmt(c.planCHF)})`),
        h('li', null, `${m.payments.length} Zahlung(en), ${c.label}`),
        m.files.length ? h('li', null, `${m.files.length} Beleg(e)`) : null,
        h('li', null, `«${pick.title}» wird entfernt`)
      )
    );
  };
  const list = h('ul', { class: 'merge-list' }, others.slice(0, 40).map((x) => {
    const c = itemCalc(S, x);
    const li = h('li', null, h('label', { class: 'check' },
      h('input', { type: 'radio', name: 'merge', onchange: () => { pick = x; showPreview(); } }),
      h('span', { class: 'grow' }, h('strong', null, x.title), h('span', { class: 'muted small' }, ` ${fmtDay(x.date)}`)),
      h('span', { class: 'small' }, c.hasCost ? `${fmtCur(x.plan.amount, x.plan.currency)} · ${c.label}` : 'ohne Betrag')
    ));
    return li;
  }));
  showPreview();
  const r = await modal('Posten zusammenführen', h('div', { class: 'stack' }, list, preview), [
    { label: 'Abbrechen', value: null },
    { label: 'Zusammenführen', primary: true, onClick: () => (pick ? 'ok' : false) },
  ]);
  if (r !== 'ok' || !pick) return null;
  try {
    const cur = await saveItem(it);
    const res = await api('POST', `/api/trips/${t.id}/items/${cur.id}/merge`, { otherId: pick.id });
    t.items = t.items.filter((x) => x.id !== pick.id).map((x) => (x.id === cur.id ? res.item : x));
    toast('Zusammengeführt');
    return res.item;
  } catch (ex) {
    toast(ex.message, { error: true });
    return null;
  }
}

export const catDot = (id) => h('span', { class: 'dot', style: { '--c': cat(id).color }, title: cat(id).name });
