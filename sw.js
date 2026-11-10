/* Service worker de Rendiconto: guarda la app y sus librerías para que funcione sin conexión.
   Solo se registra cuando la app se sirve por https (o localhost); en file:// no se usa. Los datos del usuario no pasan por aquí.

   El nombre de la caché lo reescribe publicar/preparar.py en cada publicación con la fecha y un hash del contenido
   ('rendiconto-AAAAMMDD-xxxxxxxx'). Así, cuando cambia aunque sea un byte del código, el nombre cambia, el iPhone
   instala un service worker nuevo y deja de servir para siempre la versión vieja de su caché. */
'use strict';
const CACHE = 'rendiconto-20261110-9a1ee7e0'; // preparar.py lo reescribe con 'rendiconto-<fecha>-<hash del contenido>' al publicar
const APP = [
  './', 'index.html', 'manifest.webmanifest', 'sw.js',
  'iconos/icono.svg', 'iconos/icono-180.png', 'iconos/icono-192.png', 'iconos/icono-512.png',
  'lib/app.js', 'lib/motor.js', 'lib/faltan.js', 'lib/meses.js', 'lib/excel.js', 'lib/registro.js',
  'lib/jszip.min.js', 'lib/pdf.min.js', 'lib/pdf.worker.min.js', 'lib/pdf-lib.min.js',
];
// el OCR (lib/ocr-*.js, unos 7 MB) no se guarda al instalar: se guarda la primera vez que se usa (ver «fetch»)

// Red primero para el código: así el móvil siempre coge la última versión si hay conexión y no se queda con una vieja.
// Caché primero solo para lo pesado que no cambia (OCR, pdf.js, pdf-lib, JSZip, iconos).
const CODIGO = /(^|\/)(index\.html|sw\.js|manifest\.webmanifest|lib\/(app|motor|faltan|meses|excel|registro)\.js)$/;

self.addEventListener('install', function (e) {
  // guarda la app, pero NO toma el control solo: espera a que el usuario pulse «Actualizar» (o a que no queden pestañas)
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(APP); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
    .then(function () { return self.clients.claim(); }));
});
// la página pide activar la versión nueva cuando el usuario pulsa «Actualizar» en la franja de aviso
self.addEventListener('message', function (e) { if (e.data && e.data.tipo === 'actualizar') self.skipWaiting(); });

function esCodigo(url) {
  return url.pathname === '/' || url.pathname.endsWith('/') || CODIGO.test(url.pathname);
}
self.addEventListener('fetch', function (e) {
  const r = e.request;
  if (r.method !== 'GET') return;
  const url = new URL(r.url);
  if (url.origin !== self.location.origin) return;
  if (r.mode === 'navigate' || esCodigo(url)) {
    // red primero, con la caché como respaldo cuando no hay conexión
    e.respondWith(fetch(r).then(function (resp) {
      if (resp && resp.ok) { const copia = resp.clone(); caches.open(CACHE).then(function (c) { c.put(r, copia); }); }
      return resp;
    }).catch(function () {
      return caches.match(r, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('index.html'); });
    }));
    return;
  }
  // caché primero para lo pesado que no cambia; si no está, la red, y se guarda para la próxima vez (también el OCR)
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(function (hit) {
    return hit || fetch(r).then(function (resp) {
      if (resp && resp.ok) { const copia = resp.clone(); caches.open(CACHE).then(function (c) { c.put(r, copia); }); }
      return resp;
    });
  }));
});
