// Ansicht «Mehr»: allgemeine Einstellungen – Bezahlmethoden, Kategorien, Währungen & Kurse, Benutzer, Sicherung.
// Alles, was nur eine Reise betrifft, liegt unter «Reise bearbeiten» (✎ im Plan).
import { h, toast, confirmDialog } from '../ui.js';
import { state, api, reload, render, settings, selectTrip, download, refreshRates, replaceMethodDialog } from '../app.js';
import { fmt0, fmtCur, fmtDate, methodUsage } from '../calc.js';
import { card, uid, saveSettings } from './shared.js';

export function renderMehr() {
  const view = h('div', { class: 'view mehr' },
    h('div', { class: 'settings-grid' }, methodsCard(), categoriesCard(), ratesCard(), usersCard(), backupCard()),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn ghost', onclick: async () => { await api('POST', '/api/logout'); location.reload(); } }, 'Abmelden'),
      h('span', { class: 'muted small' }, `Angemeldet als ${state.data.user.name}`)
    )
  );
  if (state.params?.section) setTimeout(() => document.getElementById('sec-' + state.params.section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  return view;
}

// ---------- Bezahlmethoden & Kategorien ----------
function listEditor(id, title, hint, items, fields, onSave, newItem) {
  const list = structuredClone(items);
  const body = h('div', { class: 'stack' });
  const draw = () => body.replaceChildren(...list.map((x, i) => h('div', { class: 'row gap' },
    fields.map((f) => f(x)),
    h('button', { class: 'icon-btn sm', 'aria-label': 'nach oben', disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); } }, '↑'),
    h('button', { class: 'icon-btn sm', 'aria-label': 'entfernen', onclick: () => { list.splice(i, 1); draw(); } }, '✕')
  )));
  draw();
  return card(id, title,
    hint ? h('p', { class: 'muted small' }, hint) : null,
    body,
    h('div', { class: 'row gap' },
      h('button', { class: 'btn dashed', onclick: () => { list.push(newItem()); draw(); body.lastChild?.querySelector('input')?.focus(); } }, '+ Hinzufügen'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: async () => {
        try {
          await onSave(list);
          render();
          toast('Gespeichert');
        } catch (ex) {
          toast(ex.message, { error: true });
        }
      } }, 'Speichern'))
  );
}

function methodsCard() {
  return listEditor('methods', 'Bezahlmethoden', 'Frei definierbar, z.B. Kreditkarten und Konten. Umbenennen ändert alle Einträge mit. Beim Löschen einer verwendeten Methode fragt Reisli, wodurch sie ersetzt werden soll.',
    settings().methods,
    [(m) => h('input', { value: m.name, 'aria-label': 'Name', oninput: (e) => (m.name = e.target.value) })],
    async (list) => {
      const keep = list.filter((m) => m.name.trim());
      // Gelöschte, aber noch verwendete Methoden zuerst umhängen
      for (const old of settings().methods.filter((m) => !keep.some((k) => k.id === m.id))) {
        const n = methodUsage(state.data.trips, old.id);
        if (!n) continue;
        const ok = await replaceMethodDialog(old.id, `«${old.name}» wird noch ${n}× verwendet (Zahlungen oder «Wird bezahlt mit»). Durch welche Methode soll sie ersetzt werden?`, keep);
        if (!ok) throw new Error('Nicht gespeichert – «' + old.name + '» wird noch verwendet');
      }
      await saveSettings({ methods: keep });
    },
    () => ({ id: uid(), name: '' }));
}

function categoriesCard() {
  return listEditor('categories', 'Kategorien', 'Für Auswertung und Farben. Gelöschte Kategorien erscheinen bei bestehenden Posten als «Sonstiges».',
    settings().categories,
    [
      (c) => h('input', { type: 'color', value: c.color, 'aria-label': 'Farbe', oninput: (e) => (c.color = e.target.value) }),
      (c) => h('input', { value: c.name, 'aria-label': 'Name', oninput: (e) => (c.name = e.target.value) }),
    ],
    (list) => saveSettings({ categories: list.filter((c) => c.name.trim()) }),
    () => ({ id: uid(), name: '', color: '#64748b' }));
}

// ---------- Währungen & Kurse ----------
function ratesCard() {
  const S = settings();
  const rates = structuredClone(S.rates || {});
  const body = h('tbody');
  const draw = () => body.replaceChildren(...Object.keys(rates).sort().map((cur) => {
    const r = rates[cur];
    const inv = h('span', { class: 'muted small' }, r.rate ? `1 CHF = ${fmtCur(1 / r.rate)} ${cur}` : '');
    return h('tr', null,
      h('th', null, cur),
      h('td', null, h('input', { class: 'num rate', inputmode: 'decimal', value: r.rate, 'aria-label': `CHF pro ${cur}`, oninput: (e) => { r.rate = Number(e.target.value.replace(',', '.')) || 0; r.source = 'manuell'; inv.textContent = r.rate ? `1 CHF = ${fmtCur(1 / r.rate)} ${cur}` : ''; } }), inv),
      h('td', { class: 'muted small' }, r.source || '', r.updatedAt ? ' · ' + fmtDate(r.updatedAt.slice(0, 10)) : ''),
      h('td', null, h('label', { class: 'check small', title: 'Fixiert: wird nicht automatisch aktualisiert' }, h('input', { type: 'checkbox', checked: !!r.locked, onchange: (e) => (r.locked = e.target.checked) }), 'fix')),
      h('td', null, h('button', { class: 'icon-btn sm', 'aria-label': 'entfernen', onclick: () => { delete rates[cur]; draw(); } }, '✕'))
    );
  }));
  draw();
  const add = h('input', { list: 'known-cur', placeholder: 'z.B. JPY', maxlength: 3, class: 'short' });
  return card('rates', 'Währungen & Kurse',
    h('p', { class: 'muted small' }, 'Kurs = CHF pro Einheit. Die Planbeträge werden laufend zum aktuellen Kurs gerechnet; bereits bezahlte Beträge behalten ihren effektiven CHF-Wert. ',
      state.data.autoRates ? 'Kurse werden täglich automatisch geholt (EZB) – vom Server oder, falls der nicht ins Internet kommt (z.B. Firmennetz), über den Browser. Ausser «fix».' : 'Automatische Kurse sind ausgeschaltet.'),
    h('div', { class: 'table-scroll' }, h('table', { class: 'simple rates' }, h('thead', null, h('tr', null, h('th', null, 'Währung'), h('th', null, 'CHF pro Einheit'), h('th', null, 'Quelle'), h('th'), h('th'))), body)),
    h('div', { class: 'row gap wrap' },
      add, h('datalist', { id: 'known-cur' }, (state.data.knownCurrencies || []).map((c) => h('option', { value: c }))),
      h('button', { class: 'btn', onclick: () => {
        const c = add.value.trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(c) || c === 'CHF') return toast('Dreistelliger Währungscode, z.B. JPY', { error: true });
        rates[c] ||= { rate: 0, source: 'manuell' };
        add.value = '';
        draw();
      } }, '+ Währung'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: async (e) => {
        e.target.disabled = true;
        try {
          await saveSettings({ rates: Object.fromEntries(Object.entries(rates).filter(([, r]) => r.rate > 0)) });
          const r = await refreshRates();
          render();
          toast(`Kurse vom ${fmtDate(r.date)} geholt${r.via === 'browser' ? ' (über den Browser)' : ''}${r.missing?.length ? ` · nicht verfügbar: ${r.missing.join(', ')}` : ''}`, { duration: 5000 });
        } catch (ex) {
          toast(ex.message, { error: true, duration: 6000 });
          e.target.disabled = false;
        }
      } }, '↻ Kurse holen'),
      h('button', { class: 'btn primary', onclick: async () => {
        const missing = Object.entries(rates).filter(([, r]) => !(r.rate > 0)).map(([c]) => c);
        if (missing.length) return toast('Kurs fehlt für ' + missing.join(', '), { error: true });
        await saveSettings({ rates });
        render();
        toast('Kurse gespeichert');
      } }, 'Speichern')
    )
  );
}

// ---------- Benutzer ----------
function usersCard() {
  const nu = { name: '', password: '' };
  const pw = { oldPassword: '', newPassword: '' };
  return card('users', 'Benutzer',
    h('ul', { class: 'plain-list' }, state.data.users.map((u) => h('li', null, u.name,
      u.id === state.data.user.id ? h('span', { class: 'muted small' }, 'du') : h('button', { class: 'link', onclick: async () => {
        if (!(await confirmDialog('Benutzer löschen', `${u.name} löschen?`, 'Löschen', true))) return;
        await api('DELETE', '/api/users/' + u.id);
        await reload();
        render();
      } }, 'löschen')))),
    h('form', { class: 'form-grid', onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/users', nu);
        await reload();
        render();
        toast('Benutzer angelegt');
      } catch (ex) {
        toast(ex.message, { error: true });
      }
    } },
      h('label', null, 'Name', h('input', { required: true, autocomplete: 'off', oninput: (e) => (nu.name = e.target.value) })),
      h('label', null, 'Passwort', h('input', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password', oninput: (e) => (nu.password = e.target.value) })),
      h('div', { class: 'span2' }, h('button', { class: 'btn', type: 'submit' }, '+ Person hinzufügen'))
    ),
    h('details', null, h('summary', null, 'Eigenes Passwort ändern'),
      h('form', { class: 'form-grid', onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api('POST', '/api/password', pw);
          e.target.reset();
          toast('Passwort geändert');
        } catch (ex) {
          toast(ex.message, { error: true });
        }
      } },
        h('label', null, 'Aktuell', h('input', { type: 'password', required: true, autocomplete: 'current-password', oninput: (e) => (pw.oldPassword = e.target.value) })),
        h('label', null, 'Neu', h('input', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password', oninput: (e) => (pw.newPassword = e.target.value) })),
        h('div', { class: 'span2' }, h('button', { class: 'btn', type: 'submit' }, 'Ändern'))
      ))
  );
}

// ---------- Sicherung ----------
function backupCard() {
  const listEl = h('div', null, h('p', { class: 'muted small' }, 'Lädt …'));
  const loadList = async () => {
    try {
      const { backups } = await api('GET', '/api/backups');
      listEl.replaceChildren(backups.length ? h('ul', { class: 'backup-list' }, backups.slice(0, 20).map((b) => h('li', null,
        h('span', null, h('span', null, b.name.replace(/\.json$/, '')), h('span', { class: 'muted small' }, ` ${fmt0(b.size / 1024)} KB`)),
        h('span', { class: 'row-actions' },
          h('button', { class: 'link', onclick: () => download('/api/backups/' + encodeURIComponent(b.name)) }, 'laden'),
          h('button', { class: 'link', onclick: async () => {
            if (!(await confirmDialog('Wiederherstellen', `Alle Daten durch den Stand «${b.name}» ersetzen? Der aktuelle Stand wird vorher gesichert.`, 'Wiederherstellen', true))) return;
            await api('POST', `/api/backups/${encodeURIComponent(b.name)}/restore`);
            await reload();
            render();
            toast('Wiederhergestellt');
          } }, 'wiederherstellen'))
      ))) : h('p', { class: 'muted small' }, 'Noch keine Sicherungen.'));
    } catch (ex) {
      listEl.replaceChildren(h('p', { class: 'form-error' }, ex.message));
    }
  };
  loadList();
  const restore = h('input', { type: 'file', class: 'file-input', accept: '.json,application/json', onchange: async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let data;
    try {
      data = JSON.parse(await f.text());
    } catch {
      return toast('Keine gültige JSON-Datei', { error: true });
    }
    if (data.kind === 'trip') {
      if (!(await confirmDialog('Reise einspielen', `Die Reise «${data.trip?.name}» wird zusätzlich angelegt. Bestehende Reisen bleiben unverändert.`, 'Einspielen'))) return;
    } else if (!(await confirmDialog('Sicherung einspielen', `Alle Reisen und Einstellungen werden durch die Sicherung vom ${fmtDate((data.exportedAt || '').slice(0, 10))} ersetzt (${data.trips?.length ?? 0} Reisen). Der aktuelle Stand wird vorher auf dem Server gesichert.`, 'Ersetzen', true))) return;
    try {
      const r = await api('POST', '/api/restore', data);
      await reload();
      if (r.trip) selectTrip(r.trip.id);
      render();
      toast(r.mode === 'trip' ? 'Reise eingespielt' : `Sicherung eingespielt (${r.trips} Reisen${r.files ? `, ${r.files} Belege` : ''})`);
    } catch (ex) {
      toast(ex.message, { error: true });
    }
  } });
  return card('backup', 'Sicherung',
    h('p', { class: 'muted small' }, 'Der Server sichert automatisch einmal täglich (30 Tage). Zusätzlich kannst du jederzeit eine Datei herunterladen – z.B. vor der Abreise aufs Handy oder in die Cloud.'),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn primary', onclick: () => download('/api/backup') }, '⬇ Sicherung herunterladen'),
      h('button', { class: 'btn', onclick: () => download('/api/backup?files=1') }, '⬇ inkl. Belege'),
      h('label', { class: 'btn file-btn' }, '⬆ Einspielen …', restore)
    ),
    h('div', { class: 'row gap sep' }, h('h3', null, 'Sicherungen auf dem Server'), h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: async () => { await api('POST', '/api/backups'); loadList(); toast('Sicherung erstellt'); } }, 'Jetzt sichern')),
    listEl
  );
}
