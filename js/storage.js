// Save/load via localStorage. Phase 1 wires only this stub; full named-layout
// persistence and UI surface arrive in Phase 2.

window.AntSim = window.AntSim || {};
(function (AntSim) {
  'use strict';

  const KEY = 'antcolony.layouts';

  function loadAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch (e) { return {}; }
  }

  function saveLayout(name, payload) {
    const all = loadAll();
    all[name] = payload;
    localStorage.setItem(KEY, JSON.stringify(all));
  }

  function loadLayout(name) {
    return loadAll()[name] || null;
  }

  function listLayouts() {
    return Object.keys(loadAll());
  }

  function deleteLayout(name) {
    const all = loadAll();
    delete all[name];
    localStorage.setItem(KEY, JSON.stringify(all));
  }

  AntSim.storage = { saveLayout, loadLayout, listLayouts, deleteLayout };
})(window.AntSim);
