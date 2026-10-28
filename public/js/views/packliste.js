// Packliste: Vorlagen (unter «Mehr», für alle Reisen) und die Liste pro Reise (unter «Offen»).
// Abhaken klappt auch offline und auf zwei Handys gleichzeitig (jeder Eintrag wird einzeln gespeichert).
import { h, toast, modal, confirmDialog, chips } from '../ui.js';
import { state, api, settings, render } from '../app.js';
import { card, saveSettings, uid } from './shared.js';

// Startvorlagen, solange noch keine eigenen gespeichert sind. «*» am Zeilenende = pro Person.
const DEFAULT_TEXT = {
  Standard: `# Dokumente & Geld
Pass / ID *
Kreditkarten *
Bargeld CHF
Führerschein *
Krankenkassen- und Versicherungskarte *
# Elektronik
Handy & Ladekabel *
Powerbank
Reiseadapter
Kopfhörer *
# Kleidung
T-Shirts *
Hosen / Shorts *
Unterwäsche *
Socken *
Pullover / Jacke *
Badekleider *
Schlafkleider *
# Hygiene & Gesundheit
Zahnbürste & Zahnpasta *
Duschmittel / Shampoo
Sonnencreme
Reiseapotheke
Persönliche Medikamente *
Brille / Kontaktlinsen *
# Unterwegs
Sonnenbrille *
Tagesrucksack
Wasserflasche *`,
  Tauchreise: `# Tauchen
Brevets & Logbuch *
Tauchcomputer *
Maske & Schnorchel *
Flossen *
Anzug *
Atemregler *
Jacket / Wing *
Tauchlampe *
Boje (SMB) *
DAN-Ausweis *
Tauchtauglichkeit (Medical) *
Ersatz-O-Ringe & Werkzeug
Silikonfett
Antibeschlag
Ladegeräte Computer / Lampe`,
  'CCR (JJ)': `# CCR
Atemkalk
O2-Zellen (Ersatz)
Batterien Controller / Handsets
Mundstück
Atemschläuche
Schutzkappen & Stopfen
O-Ringe & Fett
Werkzeug & Inbus
Bailout-Regler
Flaschenadapter INT/DIN
Checkliste & Wartungslog`,
};

/** Text ↔ Einträge: «# Gruppe» beginnt eine Gruppe, «*» am Ende = pro Person */
export function parseTemplate(text) {
  let group = '';
  const items = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) { group = line.replace(/^#+/, '').trim(); continue; }
    const perPerson = /\s*\*$/.test(line);
    const t = line.replace(/\s*\*$/, '').trim();
    if (t) items.push({ text: t, group, perPerson });
  }
  return items;
}
export function templateText(items) {
  let group = null;
  const out = [];
  for (const x of items) {
    if (x.group !== group) { group = x.group; if (group) out.push('# ' + group); }
    out.push(x.text + (x.perPerson ? ' *' : ''));
  }
  return out.join('\n');
}

export const templates = () => settings().packTemplates || Object.entries(DEFAULT_TEXT).map(([name, text]) => ({ id: 'tpl-' + name.toLowerCase().replace(/\W+/g, '-'), name, items: parseTemplate(text) }));
const persons = () => (state.data.users || []).map((u) => u.name);

// ---------- Vorlagen (Mehr) ----------
export function templatesCard() {
  const list = templates();
  return card('pack', 'Packlisten-Vorlagen',
    h('p', { class: 'muted small' }, 'Für alle Reisen. Pro Reise unter «Offen → Packliste» eine oder mehrere Vorlagen übernehmen.'),
    h('ul', { class: 'tpl-list' }, list.map((tpl) => h('li', null,
      h('button', { class: 'linklike', onclick: () => editTemplate(tpl) }, tpl.name),
      h('span', { class: 'muted small' }, `${tpl.items.length} Einträge`)
    ))),
    h('button', { class: 'btn dashed', onclick: () => editTemplate(null) }, '+ Vorlage')
  );
}

async function editTemplate(tpl) {
  const d = { name: tpl?.name || '', text: tpl ? templateText(tpl.items) : '# Gruppe\nGegenstand *\n' };
  const err = h('p', { class: 'form-error' });
  const content = h('div', { class: 'stack' },
    h('label', null, 'Name', h('input', { value: d.name, placeholder: 'z.B. Winter, Städtereise', oninput: (e) => (d.name = e.target.value) })),
    h('label', null, 'Einträge', h('textarea', { class: 'tpl-text', rows: 16, spellcheck: false, oninput: (e) => (d.text = e.target.value) }, d.text)),
    h('p', { class: 'hint' }, 'Eine Zeile pro Gegenstand. «# Kleidung» beginnt eine Gruppe. Ein «*» am Ende heisst «pro Person» (z.B. «Pass *» → je ein Pass für jede Person).'),
    err
  );
  const all = templates();
  const res = await modal(tpl ? 'Vorlage bearbeiten' : 'Neue Vorlage', content, [
    tpl ? { label: 'Löschen', danger: true, onClick: async () => (await confirmDialog('Vorlage löschen', `«${tpl.name}» löschen?`, 'Löschen', true)) ? 'delete' : false } : null,
    { label: 'Abbrechen', value: null },
    { label: 'Speichern', primary: true, onClick: () => (d.name.trim() ? 'save' : ((err.textContent = 'Bitte einen Namen eingeben'), false)) },
  ].filter(Boolean));
  if (!res) return;
  const next = res === 'delete'
    ? all.filter((x) => x.id !== tpl.id)
    : tpl
      ? all.map((x) => (x.id === tpl.id ? { ...x, name: d.name.trim(), items: parseTemplate(d.text) } : x))
      : [...all, { id: uid(), name: d.name.trim(), items: parseTemplate(d.text) }];
  try {
    await saveSettings({ packTemplates: next });
    toast(res === 'delete' ? 'Vorlage gelöscht' : 'Vorlage gespeichert');
  } catch (ex) { toast(ex.message, { error: true }); }
  render();
}

// ---------- Packliste einer Reise (Offen) ----------
let who = '*'; // Filter: '*' alle, '' gemeinsam, sonst Name
let hideDone = false;

export const packStats = (t) => {
  const list = t.packing || [];
  return { total: list.length, done: list.filter((x) => x.done).length, open: list.filter((x) => !x.done).length };
};

export function renderPacking(t) {
  t.packing ||= [];
  if (!t.packing.length) return [startCard(t)];
  const st = packStats(t);
  const people = [...new Set([...persons(), ...t.packing.map((x) => x.who).filter(Boolean)])];
  const visible = t.packing.filter((x) => (who === '*' || x.who === who) && !(hideDone && x.done));
  const groups = new Map();
  for (const x of visible) {
    const g = x.group || 'Weiteres';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(x);
  }
  const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
  const head = h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', null, 'Packliste'),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn small', onclick: () => addTemplateDialog(t) }, '+ Vorlage'),
        h('button', { class: 'btn small ghost', onclick: () => resetAll(t) }, 'Alle zurücksetzen'))
    ),
    h('div', { class: 'row gap' }, h('strong', null, `${st.done} von ${st.total} gepackt`), h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, `${pct}%`)),
    h('div', { class: 'meter' }, h('span', { style: { width: pct + '%' } })),
    h('div', { class: 'row gap wrap pack-filter' },
      chips([{ value: '*', label: 'Alle' }, ...people.map((p) => ({ value: p, label: p })), { value: '', label: 'Gemeinsam' }], who, (v) => { who = v; render(); }, 'small'),
      h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: hideDone, onchange: (e) => { hideDone = e.target.checked; render(); } }), 'Gepacktes ausblenden'))
  );
  const listCard = h('section', { class: 'card' },
    visible.length ? [...groups].map(([g, items]) => h('div', { class: 'pack-group' },
      h('h3', null, g, h('span', { class: 'muted' }, ` ${items.filter((x) => x.done).length}/${items.length}`)),
      h('ul', { class: 'pack-list' }, items.map((x) => packRow(t, x)))
    )) : h('p', { class: 'muted' }, hideDone ? 'Alles gepackt 🎉' : 'Keine Einträge für diese Auswahl.'),
    addRow(t, people)
  );
  return [head, listCard];
}

function packRow(t, x) {
  return h('li', { class: 'pack-row' + (x.done ? ' done' : '') },
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: x.done, onchange: (e) => update(t, x, { done: e.target.checked }) }),
      h('span', { class: 'pk-text' }, x.text)),
    x.who ? h('span', { class: 'pill' }, x.who) : null,
    h('button', { class: 'icon-btn sm', 'aria-label': 'Eintrag löschen', onclick: async () => {
      try {
        await api('DELETE', `/api/trips/${t.id}/packing/${x.id}`);
        t.packing = t.packing.filter((y) => y.id !== x.id);
        render();
      } catch (ex) { toast(ex.message, { error: true }); }
    } }, '✕')
  );
}

async function update(t, x, patch) {
  try {
    const r = await api('PUT', `/api/trips/${t.id}/packing/${x.id}`, { ...x, ...patch });
    Object.assign(x, r.item || patch);
  } catch (ex) { toast(ex.message, { error: true }); }
  render();
}

function addRow(t, people) {
  const groupsList = [...new Set(t.packing.map((x) => x.group).filter(Boolean))];
  const d = { text: '', group: '', who: who !== '*' ? who : '' };
  const text = h('input', { placeholder: 'Gegenstand hinzufügen …', oninput: (e) => (d.text = e.target.value) });
  const listId = 'pack-groups';
  return h('form', { class: 'pack-add', onsubmit: async (e) => {
    e.preventDefault();
    if (!d.text.trim()) return;
    try {
      const r = await api('POST', `/api/trips/${t.id}/packing`, { text: d.text.trim(), group: d.group.trim(), who: d.who, done: false });
      t.packing.push(...r.created);
      render();
      setTimeout(() => document.querySelector('.pack-add input')?.focus(), 30);
    } catch (ex) { toast(ex.message, { error: true }); }
  } },
    text,
    h('input', { class: 'pk-group', list: listId, value: d.group, placeholder: 'Gruppe (optional)', 'aria-label': 'Gruppe', oninput: (e) => (d.group = e.target.value) }),
    h('datalist', { id: listId }, groupsList.map((g) => h('option', { value: g }))),
    h('select', { 'aria-label': 'Für wen', onchange: (e) => (d.who = e.target.value) },
      h('option', { value: '' }, 'Gemeinsam'), people.map((p) => h('option', { value: p, selected: p === d.who }, p))),
    h('button', { class: 'btn small primary', type: 'submit' }, '+')
  );
}

/** Einträge aus Vorlagen erzeugen («pro Person» → je ein Eintrag); bereits vorhandene überspringen */
function fromTemplates(t, tplIds) {
  const people = persons();
  const have = new Set((t.packing || []).map((x) => `${x.text}|${x.who}`.toLowerCase()));
  const out = [];
  for (const tpl of templates().filter((x) => tplIds.includes(x.id))) {
    for (const it of tpl.items) {
      for (const w of it.perPerson && people.length ? people : ['']) {
        const k = `${it.text}|${w}`.toLowerCase();
        if (have.has(k)) continue;
        have.add(k);
        out.push({ text: it.text, group: it.group, who: w, done: false });
      }
    }
  }
  return out;
}

async function applyTemplates(t, ids) {
  const list = fromTemplates(t, ids);
  if (!list.length) return toast('Nichts Neues – alles schon auf der Liste');
  try {
    const r = await api('POST', `/api/trips/${t.id}/packing`, list);
    t.packing.push(...r.created);
    toast(`${r.created.length} Einträge übernommen`);
  } catch (ex) { toast(ex.message, { error: true }); }
  render();
}

function templatePicker(selected) {
  return h('div', { class: 'stack' }, templates().map((tpl) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: selected.has(tpl.id), onchange: (e) => (e.target.checked ? selected.add(tpl.id) : selected.delete(tpl.id)) }),
    tpl.name, h('span', { class: 'muted small' }, ` · ${tpl.items.length} Einträge`))));
}

function startCard(t) {
  const selected = new Set(templates().slice(0, 1).map((x) => x.id));
  const people = persons();
  return h('section', { class: 'card' },
    h('h2', null, 'Packliste'),
    h('p', { class: 'muted small' }, `Vorlagen wählen – Einträge mit «pro Person» werden für ${people.length ? people.join(' und ') : 'jede Person'} einzeln angelegt. Danach lässt sich alles ergänzen, löschen und abhaken (auch offline).`),
    templatePicker(selected),
    h('div', { class: 'row gap wrap', style: { marginTop: '.8rem' } },
      h('button', { class: 'btn primary', onclick: () => (selected.size ? applyTemplates(t, [...selected]) : toast('Bitte mindestens eine Vorlage wählen')) }, 'Packliste anlegen'),
      h('a', { class: 'btn ghost', href: '#mehr' }, 'Vorlagen bearbeiten'))
  );
}

async function addTemplateDialog(t) {
  const selected = new Set();
  const res = await modal('Vorlage hinzufügen', h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Bereits vorhandene Einträge werden übersprungen.'), templatePicker(selected)),
    [{ label: 'Abbrechen', value: null }, { label: 'Übernehmen', primary: true, value: 'ok' }]);
  if (res === 'ok' && selected.size) await applyTemplates(t, [...selected]);
}

async function resetAll(t) {
  const done = t.packing.filter((x) => x.done);
  if (!done.length) return toast('Nichts abgehakt');
  if (!(await confirmDialog('Alle zurücksetzen', `${done.length} Häkchen entfernen? Praktisch fürs Packen der Rückreise.`, 'Zurücksetzen'))) return;
  try {
    for (const x of done) {
      await api('PUT', `/api/trips/${t.id}/packing/${x.id}`, { ...x, done: false });
      x.done = false;
    }
  } catch (ex) { toast(ex.message, { error: true }); }
  render();
}
