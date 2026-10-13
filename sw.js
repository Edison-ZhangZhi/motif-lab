/* MotifLab Service Worker — v17 性能：预缓存静态资源 + 鼓采样，二次访问秒开 */
'use strict';
var CACHE = 'motiflab-v47';
var PRECACHE = [
  './',
  'index.html',
  'theory.js',
  'cells.js',
  'specs.js',
  'rules.js',
  'app.js',
  'style.css',
  'lib/Tone.js',
  'lib/soundfont-player.min.js',
  'drums/brush_snare.mp3',
  'drums/clap.mp3',
  'drums/clave.mp3',
  'drums/conga_h.mp3',
  'drums/conga_l.mp3',
  'drums/crash.mp3',
  'drums/hat_808.mp3',
  'drums/hat_closed.mp3',
  'drums/kick_808.mp3',
  'drums/kick_room.mp3',
  'drums/rim_click.mp3',
  'drums/shaker.mp3',
  'drums/shekere.mp3',
  'drums/snap.mp3',
  'drums/snare_room.mp3'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    /* v19：国内网络抖动时 addAll 任一失败则整个 SW 安装失败（等于没装）。
       改为逐个缓存、允许部分失败——装上一个不完整的缓存也比没有强 */
    caches.open(CACHE).then(function (c) {
      return Promise.all(PRECACHE.map(function (u) {
        return c.add(u).catch(function () { return null; });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.search.indexOf('bust=') >= 0) return; /* v23：版本探测请求穿透网络，不进缓存 */
  /* v23：页面导航与 sw.js 改网络优先——缓存优先会把旧版 index.html 一直端给用户（"这还是旧版"根源）。
     离线时回退缓存，保住离线可用。 */
  if (req.mode === 'navigate' || /\/sw\.js$/.test(url.pathname)) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var clone = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, clone); });
        }
        return res;
      }).catch(function () {
        return caches.match(req, { ignoreSearch: false }).then(function (hit) {
          return hit || Response.error();
        });
      })
    );
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: false }).then(function (hit) {
      if (hit) {
        // 后台刷新缓存（stale-while-revalidate 的轻量版）
        fetch(req).then(function (res) {
          if (res && res.ok) {
            caches.open(CACHE).then(function (c) { c.put(req, res.clone()); });
          }
        }).catch(function () {});
        return hit;
      }
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var clone = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, clone); });
        }
        return res;
      });
    })
  );
});
