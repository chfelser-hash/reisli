// Kleine DOM-Helfer, Toasts und Dialoge (kein Framework nötig)

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [prop, val] of Object.entries(v)) {
          if (prop.startsWith('--')) el.style.setProperty(prop, val);
          else el.style[prop] = val;
        }
      }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const svgNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

let toastTimer;
export function toast(msg, opts = {}) {
  const root = document.getElementById('toast');
  root.replaceChildren(h('span', null, msg));
  if (opts.action) root.append(h('button', { class: 'link', onclick: () => { root.classList.remove('show'); opts.action.fn(); } }, opts.action.label));
  root.className = 'toast show' + (opts.error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => root.classList.remove('show'), opts.duration || (opts.action ? 6000 : 2500));
}

/** Modaler Dialog. content: Element; buttons: [{label, primary, danger, onClick -> false lässt offen}] */
export function modal(title, content, buttons = [{ label: 'Schliessen' }]) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'modal' });
    const close = (v) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    dlg.append(
      h('form', { method: 'dialog', onsubmit: (e) => e.preventDefault() },
        h('header', null, h('h2', null, title), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Schliessen', onclick: () => close(null) }, '✕')),
        h('div', { class: 'modal-body' }, content),
        h('footer', null,
          buttons.map((b) =>
            h('button', {
              type: b.primary ? 'submit' : 'button',
              class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''),
              onclick: async () => {
                // Nur ein onClick, das ausdrücklich false liefert, hält den Dialog offen
                if (!b.onClick) return close(b.value ?? b.label);
                const r = await b.onClick();
                if (r !== false) close(r === undefined ? b.value ?? b.label : r);
              },
            }, b.label)
          )
        )
      )
    );
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    document.body.append(dlg);
    dlg.showModal();
    const first = dlg.querySelector('input,select,textarea');
    if (first) setTimeout(() => first.focus(), 30);
  });
}

export async function confirmDialog(title, text, okLabel = 'OK', danger = false) {
  const r = await modal(title, h('p', null, text), [
    { label: 'Abbrechen', value: false },
    { label: okLabel, primary: true, danger, value: true },
  ]);
  return r === true;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** Segment-/Chip-Auswahl */
export function chips(options, value, onChange, cls = '') {
  const wrap = h('div', { class: 'chips ' + cls, role: 'radiogroup' });
  const render = (val) => {
    wrap.replaceChildren(
      ...options.map((o) =>
        h('button', {
          type: 'button',
          role: 'radio',
          'aria-checked': String(o.value === val),
          class: 'chip' + (o.value === val ? ' on' : ''),
          style: o.color ? { '--c': o.color } : null,
          onclick: () => {
            render(o.value);
            onChange(o.value);
          },
        }, o.label)
      )
    );
  };
  render(value);
  wrap.setValue = render;
  return wrap;
}
