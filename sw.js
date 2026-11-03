/* Service worker de Rendiconto: guarda la app y sus librerías para que funcione sin conexión.
   Solo se registra cuando la app se sirve por https (o localhost); en file:// no se usa. Los datos del usuario no pasan por aquí. */
'use strict';
const CACHE = 'rendiconto-v4';
const APP = [
  './', 'index.html', 'manifest.webmanifest', 'sw.js',
  'iconos/icono.svg', 'iconos/icono-180.png', 'iconos/icono-192.png', 'iconos/icono-512.png',
  'lib/app.js', 'lib/motor.js', 'lib/excel.js', 'lib/registro.js', 'lib/jszip.min.js', 'lib/pdf.min.js', 'lib/pdf.worker.min.js', 'lib/pdf-lib.min.js',
];
// el OCR (lib/ocr-*.js, unos 7 MB) no se guarda al instalar: se guarda la primera vez que se usa (ver «fetch»)

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(APP); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
    .then(function () { return self.clients.claim(); }));
});
// primero la caché; si no está, la red, y se guarda para la próxima vez (también el OCR)
self.addEventListener('fetch', function (e) {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(function (hit) {
    return hit || fetch(r).then(function (resp) {
      if (resp && resp.ok) { const copia = resp.clone(); caches.open(CACHE).then(function (c) { c.put(r, copia); }); }
      return resp;
    });
  }));
});
