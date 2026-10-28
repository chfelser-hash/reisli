// Allgemeine Reisedokumente: Pässe, Krankenkasse, Versicherungen, Tauchbrevets … – gelten für alle Reisen
// und lassen sich zusammen mit den Belegen einer Reise offline aufs Gerät laden.
import { h, toast, modal, confirmDialog } from '../ui.js';
import { state, trip, api, render } from '../app.js';
import { todayStr, addDays, fmtDate, isDate } from '../calc.js';
import { card } from './shared.js';

export const DOC_KINDS = [
  ['pass', 'Pass', '🛂'],
  ['id', 'Identitätskarte', '🪪'],
  ['krankenkasse', 'Krankenkasse', '🏥'],
  ['versicherung', 'Versicherung', '🛡️'],
  ['tauchen', 'Tauchen (Brevet, Logbuch, Tauchversicherung)', '🤿'],
  ['fuehrerschein', 'Führerschein', '🚗'],
  ['impfung', 'Impfausweis', '💉'],
  ['visum', 'Visum / Einreise', '📄'],
  ['notfall', 'Notfall (Nummern, Kontakte)', '🆘'],
  ['sonstiges', 'Sonstiges', '📁'],
];
const kindOf = (k) => DOC_KINDS.find((x) => x[0] === k) || DOC_KINDS[DOC_KINDS.length - 1];
const kindOrder = (k) => DOC_KINDS.findIndex((x) => x[0] === k);

export const documents = () => state.data.documents || [];

/** Alle Dateien der Dokumente – für «offline speichern» */
export const documentFiles = () => documents().flatMap((d) => d.files || []);

/**
 * Gültigkeit prüfen. Bezug ist die gewählte (noch nicht vorbei) Reise: Pässe sollten bei vielen Ländern noch
 * 6 Monate nach der Ausreise gültig sein.
 * Liefert {level: 'bad'|'warn'|'', text}
 */
export function validity(doc, t = trip()) {
  if (!isDate(doc.validUntil)) return { level: '', text: '' };
  const today = todayStr();
  if (doc.validUntil < today) return { level: 'bad', text: `abgelaufen seit ${fmtDate(doc.validUntil)}` };
  const ref = t && t.end >= today ? t : null;
  if (ref && doc.validUntil < ref.end) return { level: 'bad', text: `läuft vor Reiseende ab (${fmtDate(doc.validUntil)})` };
  if (ref && doc.kind === 'pass' && doc.validUntil < addDays(ref.end, 182)) return { level: 'warn', text: `weniger als 6 Monate nach Reiseende gültig (${fmtDate(doc.validUntil)}) – Einreisebestimmungen prüfen` };
  if (doc.validUntil < addDays(today, 90)) return { level: 'warn', text: `läuft bald ab (${fmtDate(doc.validUntil)})` };
  return { level: '', text: `gültig bis ${fmtDate(doc.validUntil)}` };
}

const sorted = () => [...documents()].sort((a, b) => (a.person || '').localeCompare(b.person || '') || kindOrder(a.kind) - kindOrder(b.kind) || a.title.localeCompare(b.title));

export const fileChips = (files) => (files?.length ? h('div', { class: 'file-chips' }, files.map((f) => h('a', { class: 'file-chip', href: '/api/files/' + f.id, target: '_blank', rel: 'noopener' }, '📎 ', f.name))) : null);

/** Kompakte Liste (für «Heute») */
export function docsCompact() {
  const list = sorted();
  if (!list.length) return h('p', { class: 'muted' }, 'Noch keine Dokumente. ', h('a', { href: '#dokumente' }, 'Pass, Krankenkasse, Brevets … erfassen'));
  return h('ul', { class: 'docs compact' }, list.map((d) => docRow(d, true)));
}

function docRow(d, compact = false) {
  const [, kindLabel, icon] = kindOf(d.kind);
  const v = validity(d);
  return h('li', { class: 'doc-row' },
    h('span', { class: 'doc-icon', 'aria-hidden': 'true' }, icon),
    h('div', { class: 'doc-body' },
      h('button', { class: 'linklike doc-title', onclick: () => (state.offline ? null : editDocument(d)) }, d.title, d.person ? h('span', { class: 'muted', style: { marginLeft: '.35rem' } }, '· ' + d.person) : null),
      h('div', { class: 'muted small' }, [compact ? '' : kindLabel.split(' (')[0], d.number ? 'Nr. ' + d.number : ''].filter(Boolean).join(' · ')),
      d.phone ? h('a', { class: 'contact', href: 'tel:' + d.phone.replace(/[^\d+]/g, '') }, '📞 ', d.phone) : null,
      v.text ? h('div', { class: 'small doc-valid ' + v.level }, (v.level ? '⚠ ' : '') + v.text) : null,
      !compact && d.note ? h('div', { class: 'small doc-note' }, d.note) : null,
      fileChips(d.files)
    )
  );
}

export function renderDokumente() {
  const view = h('div', { class: 'view dokumente' });
  const list = sorted();
  const head = h('div', { class: 'card-head' },
    h('h2', null, 'Reisedokumente'),
    h('button', { class: 'btn primary small', onclick: () => editDocument(null) }, '+ Dokument')
  );
  const problems = list.filter((d) => validity(d).level);
  view.append(h('section', { class: 'card' },
    head,
    h('p', { class: 'muted small' }, 'Gelten für alle Reisen: Kopien von Pässen, Krankenkassen- und Versicherungskarten, Tauchbrevets, Notfallnummern … Mit Gültigkeit: Reisli warnt, wenn etwas vor oder kurz nach der gewählten Reise abläuft.'),
    problems.length ? h('p', { class: 'warn' }, `⚠ ${problems.length} Dokument${problems.length === 1 ? '' : 'e'} prüfen`) : null,
    list.length ? h('ul', { class: 'docs' }, list.map((d) => docRow(d))) : h('p', { class: 'muted' }, 'Noch keine Dokumente erfasst.')
  ));
  view.append(offlineCard());
  return view;
}

/** Karte «Offline auf diesem Gerät»: Dokumente + Belege der gewählten Reise laden */
export function offlineCard() {
  const t = trip();
  const files = [...documentFiles(), ...(t ? t.items.flatMap((it) => it.files || []) : [])];
  const status = h('p', { class: 'muted small' });
  const btn = h('button', { class: 'btn', onclick: () => cacheFiles(files, status, btn) }, 'Offline speichern');
  if (!('caches' in window)) {
    return card(null, 'Offline auf diesem Gerät', h('p', { class: 'muted small' }, 'Nicht möglich: Offline-Speicher gibt es nur, wenn Reisli über HTTPS geöffnet wird (z.B. über die Tailscale-Adresse).'));
  }
  countCached(files).then((k) => {
    status.textContent = files.length ? `${k} von ${files.length} Dateien auf diesem Gerät` : 'Keine Dateien vorhanden.';
    btn.disabled = !files.length;
  });
  return card(null, 'Offline auf diesem Gerät',
    h('p', { class: 'muted small' }, `Lädt alle Dokumente${t ? ` und die Belege der Reise «${t.name}»` : ''} aufs Gerät, damit sie unterwegs auch ohne Verbindung aufgehen. Die Reisedaten selbst sind automatisch offline verfügbar.`),
    status,
    btn
  );
}

// ---------- Offline-Speicher für Dateien ----------
const FILES_CACHE = 'reisli-files';

export async function countCached(files) {
  if (!('caches' in window)) return 0;
  try {
    const c = await caches.open(FILES_CACHE);
    const hits = await Promise.all(files.map((f) => c.match('/api/files/' + f.id)));
    return hits.filter(Boolean).length;
  } catch { return 0; }
}

/** Dateien in den Gerätespeicher laden, damit sie unterwegs ohne Verbindung aufgehen */
export async function cacheFiles(files, statusEl, btn) {
  if (!('caches' in window)) return toast('Dieser Browser kann keine Dateien offline speichern (HTTPS nötig).', { error: true });
  try { await navigator.storage?.persist?.(); } catch { /* egal */ }
  btn.disabled = true;
  const c = await caches.open(FILES_CACHE);
  let ok = 0, fail = 0;
  for (const f of files) {
    try {
      const res = await fetch('/api/files/' + f.id, { credentials: 'same-origin' });
      if (!res.ok) throw new Error();
      await c.put('/api/files/' + f.id, res);
      ok++;
    } catch { fail++; }
    statusEl.textContent = `${ok} von ${files.length} gespeichert${fail ? ` · ${fail} fehlgeschlagen` : ''} …`;
  }
  btn.disabled = false;
  statusEl.textContent = fail ? `${ok} von ${files.length} auf diesem Gerät · ${fail} nicht erreichbar` : `Alle ${ok} Dateien auf diesem Gerät`;
  toast(fail ? 'Nicht alle Dateien konnten geladen werden' : 'Offline gespeichert', fail ? { error: true } : {});
}

// ---------- Editor ----------
async function editDocument(original) {
  const d = structuredClone(original || { title: '', kind: 'pass', person: state.data.user?.name || '', number: '', validUntil: '', phone: '', note: '', files: [] });
  const people = [...new Set([...(state.data.users || []).map((u) => u.name), ...documents().map((x) => x.person)].filter(Boolean))];
  const err = h('p', { class: 'form-error' });
  const filesEl = h('ul', { class: 'file-list' });
  const renderFiles = () => filesEl.replaceChildren(...(d.files || []).map((f) => h('li', null,
    h('a', { href: '/api/files/' + f.id, target: '_blank', rel: 'noopener' }, '📎 ' + f.name),
    h('span', { class: 'muted small' }, Math.max(1, Math.round(f.size / 1024)) + ' KB'),
    h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Datei löschen', onclick: async () => {
      if (!(await confirmDialog('Datei löschen', `«${f.name}» löschen?`, 'Löschen', true))) return;
      try {
        await api('DELETE', `/api/documents/${d.id}/files/${f.id}`);
        d.files = d.files.filter((x) => x.id !== f.id);
        syncLocal(d);
        renderFiles();
      } catch (ex) { toast(ex.message, { error: true }); }
    } }, '✕')
  )));
  renderFiles();
  const save = async () => {
    if (!d.title.trim()) { err.textContent = 'Bitte eine Bezeichnung eingeben'; return null; }
    const r = d.id ? await api('PUT', `/api/documents/${d.id}`, d) : await api('POST', '/api/documents', d);
    Object.assign(d, { id: r.document.id, createdAt: r.document.createdAt });
    syncLocal({ ...r.document, files: d.files });
    return r.document;
  };
  const fileInput = h('input', { type: 'file', class: 'file-input', multiple: true, accept: 'image/*,application/pdf,.pdf', onchange: async (e) => {
    const list = [...e.target.files];
    e.target.value = '';
    if (!list.length) return;
    try {
      if (!d.id && !(await save())) return;
      for (const f of list) {
        const r = await api('POST', `/api/documents/${d.id}/files`, f);
        d.files.push(r.file);
      }
      syncLocal(d);
      renderFiles();
      toast(list.length === 1 ? 'Datei gespeichert' : `${list.length} Dateien gespeichert`);
    } catch (ex) { toast(ex.message, { error: true }); }
  } });
  const content = h('div', { class: 'form-grid' },
    h('label', null, 'Art', h('select', { onchange: (e) => (d.kind = e.target.value) }, DOC_KINDS.map(([k, label, icon]) => h('option', { value: k, selected: k === d.kind }, `${icon} ${label}`)))),
    personField(d, people),
    h('label', { class: 'span2' }, 'Bezeichnung', h('input', { value: d.title, required: true, placeholder: 'z.B. Pass, PADI Advanced, DAN Europe', oninput: (e) => (d.title = e.target.value) })),
    h('label', null, 'Nummer', h('input', { value: d.number, autocomplete: 'off', placeholder: 'Pass-, Versicherten-, Brevetnummer', oninput: (e) => (d.number = e.target.value) })),
    h('label', null, 'Gültig bis', h('input', { type: 'date', value: d.validUntil, onchange: (e) => (d.validUntil = e.target.value) })),
    h('label', { class: 'span2' }, 'Telefon (z.B. Notfallnummer der Versicherung)', h('input', { type: 'tel', value: d.phone, placeholder: '+41 …', oninput: (e) => (d.phone = e.target.value) })),
    h('label', { class: 'span2' }, 'Notiz', h('textarea', { rows: 2, oninput: (e) => (d.note = e.target.value) }, d.note || '')),
    h('div', { class: 'span2 row gap wrap' }, h('h3', null, 'Dateien'), h('span', { class: 'spacer' }), h('label', { class: 'btn small file-btn' }, '+ Datei / Foto', fileInput)),
    h('div', { class: 'span2' }, filesEl, h('p', { class: 'hint' }, 'Scan oder Foto (Vorder- und Rückseite). Wird nur auf eurer NAS gespeichert.')),
    err
  );
  const res = await modal(original ? 'Dokument bearbeiten' : 'Neues Dokument', content, [
    original ? { label: 'Löschen', danger: true, onClick: async () => {
      if (!(await confirmDialog('Dokument löschen', `«${d.title}» mit allen Dateien löschen?`, 'Löschen', true))) return false;
      try {
        await api('DELETE', `/api/documents/${d.id}`);
        state.data.documents = documents().filter((x) => x.id !== d.id);
        return 'deleted';
      } catch (ex) { err.textContent = ex.message; return false; }
    } } : null,
    { label: d.id ? 'Schliessen' : 'Abbrechen', value: d.id ? 'ok' : null },
    { label: 'Speichern', primary: true, onClick: async () => {
      try { return (await save()) ? 'ok' : false; } catch (ex) { err.textContent = ex.message; return false; }
    } },
  ].filter(Boolean));
  render();
  return res;
}

/** Person: Auswahl aus allen Benutzern (und bisher verwendeten Namen), «für alle» oder frei eingeben (z.B. Kinder) */
function personField(d, people) {
  const OTHER = '\u0000andere';
  const input = h('input', { value: d.person, placeholder: 'Name', hidden: true, oninput: (e) => (d.person = e.target.value.trim()) });
  const sel = h('select', { onchange: (e) => {
    const v = e.target.value;
    input.hidden = v !== OTHER;
    if (v === OTHER) { d.person = ''; input.value = ''; input.focus(); } else d.person = v;
  } },
    people.map((p) => h('option', { value: p, selected: p === d.person }, p)),
    h('option', { value: '', selected: !d.person }, 'Für alle'),
    h('option', { value: OTHER }, 'Andere Person …')
  );
  return h('label', null, 'Person', sel, input);
}

function syncLocal(doc) {
  const list = documents();
  const i = list.findIndex((x) => x.id === doc.id);
  if (i >= 0) list[i] = { ...list[i], ...doc };
  else list.push(doc);
  state.data.documents = list;
}
