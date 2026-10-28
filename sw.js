// Service Worker — Réserves & Courses
const CACHE_NAME = 'reserves-v4';

// NOTE POLICES : les URLs Google Fonts varient selon le navigateur (User-Agent).
// Pour garantir les polices hors ligne dès le premier lancement, deux options :
//   A) Auto-héberger les fichiers .woff2 dans fonts/ et les ajouter ici
//   B) Conserver l'import Google Fonts (cache dynamique au 1er lancement en ligne)
// Option B est active ici ; option A recommandée avant mise en production.
const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/firebase.js',
  './js/foyer.js',
  './js/courses.js',
  './js/kit.js',
  './js/guide.js',
  './js/budget.js',
  './js/accueil.js',
  './js/reglages.js',
  './js/badges.js',
  './data/guide.json',
  './data/kit-objectif.json',
  './data/modele-grossesse.json',
  './data/magasins.json',
  // Polices auto-hébergées — pré-cachées pour fonctionner hors ligne dès le 1er lancement
  './fonts/atkinson-400-latin.woff2',
  './fonts/atkinson-400-latin-ext.woff2',
  './fonts/atkinson-italic-400-latin.woff2',
  './fonts/atkinson-italic-400-latin-ext.woff2',
  './fonts/atkinson-700-latin.woff2',
  './fonts/atkinson-700-latin-ext.woff2',
  './fonts/barlow-600-latin.woff2',
  './fonts/barlow-600-latin-ext.woff2',
  './fonts/barlow-600-viet.woff2',
  './fonts/barlow-700-latin.woff2',
  './fonts/barlow-700-latin-ext.woff2',
  './fonts/barlow-700-viet.woff2',
  './fonts/barlow-800-latin.woff2',
  './fonts/barlow-800-latin-ext.woff2',
  './fonts/barlow-800-viet.woff2'
];

// Install: cache all app files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
});

// Activate: delete old caches and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => {
      self.clients.claim();
      // Broadcast new version to all clients
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'NEW_VERSION', cacheName: CACHE_NAME });
        });
      });
    })
  );
});

// Fetch: cache-first strategy for app files, network-first for Firebase/API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip Firebase, Google APIs, and other external API calls
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('firebaseinstallations.googleapis.com')
  ) {
    return;
  }

  // Cache-first for app files and fonts
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Return cache, but also update in background
        const fetchPromise = fetch(event.request).then((response) => {
          // Mettre à jour le cache pour les ressources locales (basic) ET les polices (cors)
          if (response && response.status === 200 &&
              (response.type === 'basic' ||
               url.hostname === 'fonts.gstatic.com' ||
               url.hostname === 'fonts.googleapis.com')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(() => {});
        return cached;
      }

      // Not in cache: fetch and cache
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200) {
          return response;
        }

        // Cache responses from same origin or Google Fonts
        if (
          url.origin === self.location.origin ||
          url.hostname === 'fonts.googleapis.com' ||
          url.hostname === 'fonts.gstatic.com'
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }

        return response;
      }).catch(() => {
        // Offline fallback for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('', { status: 408, statusText: 'Offline' });
      });
    })
  );
});

// Listen for SKIP_WAITING message
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
