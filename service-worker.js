// 앱 파일을 폰에 저장해 두어 인터넷이 없어도 화면이 열리게 한다.
// 앱 파일을 크게 바꿨는데 폰에 반영이 안 되면 CACHE 이름의 숫자를 올린다.
const CACHE = 'weight-tracker-v1';

const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const CDN_FILES = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/hammerjs@2.0.8/hammer.min.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll([...APP_FILES, ...CDN_FILES]))
      .then(() => self.skipWaiting())
  );
});

// 이전 버전 캐시를 지운다.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 구글 시트(Apps Script) 요청은 항상 인터넷으로 보낸다. 캐시하면 옛날 기록이 보인다.
  if (url.hostname.endsWith('google.com') || url.hostname.endsWith('googleusercontent.com')) return;

  // CDN 라이브러리: 버전이 주소에 박혀 있어 바뀌지 않으므로 캐시 우선.
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // 앱 파일: 인터넷이 되면 최신 파일을 받고(캐시도 갱신), 안 되면 캐시에서 연다.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(cached => cached || caches.match('./index.html')))
    );
  }
});
