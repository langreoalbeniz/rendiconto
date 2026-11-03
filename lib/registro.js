/* Registro de tickets en este navegador (IndexedDB): bandeja de pendientes, tickets enviados y el archivo original de cada uno.
   Un registro por archivo, con clave nombre|tamaño|lastModified; el archivo (foto, PDF, XML…) va tal cual, como Blob, en «archivos».
   Si el navegador no deja usar IndexedDB, se guarda en memoria (dura mientras la página esté abierta) y Registro.disponible() devuelve false. */
(function (root) {
  'use strict';
  const NOMBRE = 'rendiconto', VERSION = 2;
  let db = null, memoria = null, abriendo = null;

  function abre() {
    if (db || memoria) return Promise.resolve();
    if (abriendo) return abriendo;
    abriendo = new Promise(function (ok) {
      try {
        const r = indexedDB.open(NOMBRE, VERSION);
        r.onupgradeneeded = function () {
          const d = r.result;
          if (!d.objectStoreNames.contains('fotos')) d.createObjectStore('fotos', { keyPath: 'clave' });
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
          if (!d.objectStoreNames.contains('archivos')) d.createObjectStore('archivos', { keyPath: 'clave' });
        };
        r.onsuccess = function () { db = r.result; ok(); };
        r.onerror = r.onblocked = function () { console.warn('IndexedDB no disponible', r.error); memoria = { fotos: new Map(), meta: new Map(), archivos: new Map() }; ok(); };
      } catch (e) { console.warn('IndexedDB no disponible', e); memoria = { fotos: new Map(), meta: new Map(), archivos: new Map() }; ok(); }
    });
    return abriendo;
  }
  function copia(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  // fn(almacen IndexedDB) devuelve una petición; en memoria, fnMem(Map) devuelve el resultado
  function op(almacen, modo, fn, fnMem) {
    return abre().then(function () {
      if (memoria) return copia(fnMem(memoria[almacen]));
      return new Promise(function (ok, ko) {
        const tx = db.transaction(almacen, modo); let res;
        const r = fn(tx.objectStore(almacen));
        r.onsuccess = function () { res = r.result; };
        tx.oncomplete = function () { ok(res); };
        tx.onerror = tx.onabort = function () { ko(tx.error); };
      });
    });
  }

  const api = {
    disponible: function () { return abre().then(function () { return !memoria; }); },
    get: function (clave) { return op('fotos', 'readonly', function (s) { return s.get(clave); }, function (m) { return m.get(clave); }); },
    put: function (rec) { return op('fotos', 'readwrite', function (s) { return s.put(rec); }, function (m) { m.set(rec.clave, copia(rec)); }); },
    todos: function () { return op('fotos', 'readonly', function (s) { return s.getAll(); }, function (m) { return Array.from(m.values()); }); },
    meta: function (k) { return op('meta', 'readonly', function (s) { return s.get(k); }, function (m) { return m.get(k); }).then(function (r) { return r ? r.v : null; }); },
    ponMeta: function (k, v) { return op('meta', 'readwrite', function (s) { return s.put({ k: k, v: v }); }, function (m) { m.set(k, { k: k, v: copia(v) }); }); },
    borraMeta: function (k) { return op('meta', 'readwrite', function (s) { return s.delete(k); }, function (m) { m.delete(k); }); },
    // archivo original de un ticket (Blob tal cual, sin recomprimir). Si no cabe, la promesa falla con QuotaExceededError.
    ponArchivo: function (clave, blob, nombre) {
      const x = { clave: clave, blob: blob, nombre: nombre, tipo: blob.type || '', tamano: blob.size, guardado: Date.now() };
      return abre().then(function () { if (memoria) { memoria.archivos.set(clave, x); return; } return op('archivos', 'readwrite', function (s) { return s.put(x); }); });
    },
    archivo: function (clave) { return abre().then(function () { return memoria ? memoria.archivos.get(clave) : op('archivos', 'readonly', function (s) { return s.get(clave); }); }); },
    borraArchivo: function (clave) { return op('archivos', 'readwrite', function (s) { return s.delete(clave); }, function (m) { m.delete(clave); }); },
    // clave, nombre y tamaño de cada archivo guardado (sin leer su contenido)
    archivos: function () {
      return abre().then(function () {
        if (memoria) return Array.from(memoria.archivos.values()).map(function (x) { return { clave: x.clave, nombre: x.nombre, tamano: x.tamano }; });
        return new Promise(function (ok, ko) {
          const out = [], tx = db.transaction('archivos', 'readonly'), r = tx.objectStore('archivos').openCursor();
          r.onsuccess = function () { const c = r.result; if (c) { out.push({ clave: c.value.clave, nombre: c.value.nombre, tamano: c.value.tamano }); c.continue(); } };
          tx.oncomplete = function () { ok(out); }; tx.onerror = tx.onabort = function () { ko(tx.error); };
        });
      });
    },
  };
  root.Registro = api;
})(this);
