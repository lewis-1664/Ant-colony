// Save/load via localStorage. Phase 1 wires only this stub; full named-layout
// persistence and UI surface arrive in Phase 2.

const KEY = 'antcolony.layouts';

export function saveLayout(name, payload) {
  const all = loadAll();
  all[name] = payload;
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function loadLayout(name) {
  return loadAll()[name] || null;
}

export function listLayouts() {
  return Object.keys(loadAll());
}

export function deleteLayout(name) {
  const all = loadAll();
  delete all[name];
  localStorage.setItem(KEY, JSON.stringify(all));
}

function loadAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
  catch { return {}; }
}
