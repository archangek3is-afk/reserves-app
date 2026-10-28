// Main Controller — Réserves & Courses PWA
import { waitForAuth, syncStatus, getFoyerId } from './firebase.js';
import { loadGuideData } from './badges.js';
import { isFoyerConfigured, renderFoyerSetup } from './foyer.js';
import { renderAccueil, destroyAccueil } from './accueil.js';
import { renderCourses, destroyCourses } from './courses.js';
import { renderKit, destroyKit } from './kit.js';
import { renderGuide, destroyGuide } from './guide.js';
import { renderBudget, destroyBudget } from './budget.js';
import { renderReglages, applyTheme } from './reglages.js';

let currentScreen = 'accueil';

const TABS = ['accueil', 'courses', 'kit', 'guide', 'budget'];

// ---- Service Worker ----
function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('./sw.js').then((reg) => {
    // Check for updates periodically
    setInterval(() => reg.update(), 60 * 60 * 1000); // every hour

    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner();
          }
        });
      }
    });
  }).catch(err => console.error('SW registration failed:', err));

  // Listen for NEW_VERSION message from SW
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'NEW_VERSION') {
      showUpdateBanner();
    }
  });
}

function showUpdateBanner() {
  const banner = document.getElementById('update-banner');
  if (banner) banner.classList.add('update-banner--visible');
}

function applyUpdate() {
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
  }
  // Also tell any waiting worker
  navigator.serviceWorker.getRegistration().then(reg => {
    if (reg && reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  });
  // Reload after a moment
  setTimeout(() => location.reload(), 500);
}

// ---- Theme ----
function initTheme() {
  const saved = localStorage.getItem('theme') || 'auto';
  applyTheme(saved);
}

// ---- Sync Status ----
function initSyncPill() {
  const pill = document.getElementById('sync-pill');
  if (!pill) return;

  syncStatus.subscribe((state) => {
    pill.textContent = state.label;
    pill.className = 'sync-pill';
    if (state.status === 'offline') pill.classList.add('sync-pill--offline');
    else if (state.status === 'syncing') pill.classList.add('sync-pill--syncing');
  });
}

// ---- Navigation ----
function destroyCurrentScreen() {
  switch (currentScreen) {
    case 'accueil': destroyAccueil(); break;
    case 'courses': destroyCourses(); break;
    case 'kit': destroyKit(); break;
    case 'guide': destroyGuide(); break;
    case 'budget': destroyBudget(); break;
  }
}

export function navigateTo(screen) {
  destroyCurrentScreen();
  currentScreen = screen;

  const container = document.getElementById('screen-container');
  if (!container) return;

  // Update tab bar
  document.querySelectorAll('.tab-bar__item').forEach(tab => {
    tab.classList.toggle('tab-bar__item--active', tab.dataset.tab === screen);
  });

  // Hide settings header back if not in settings
  const settingsBackBtn = document.getElementById('btn-back-from-settings');
  const settingsIconBtn = document.getElementById('btn-settings');
  if (screen === 'reglages') {
    if (settingsBackBtn) settingsBackBtn.classList.remove('hidden');
    if (settingsIconBtn) settingsIconBtn.classList.add('hidden');
  } else {
    if (settingsBackBtn) settingsBackBtn.classList.add('hidden');
    if (settingsIconBtn) settingsIconBtn.classList.remove('hidden');
  }

  // Render screen
  switch (screen) {
    case 'accueil': renderAccueil(container); break;
    case 'courses': renderCourses(container); break;
    case 'kit': renderKit(container); break;
    case 'guide': renderGuide(container); break;
    case 'budget': renderBudget(container); break;
    case 'reglages': renderReglages(container); break;
    default: renderAccueil(container);
  }
}

export function showSettings() {
  navigateTo('reglages');
}

// ---- Init ----
async function init() {
  initTheme();
  initServiceWorker();

  // Show loading
  const container = document.getElementById('screen-container');
  if (container) container.innerHTML = '<div class="spinner"></div>';

  // Wait for auth
  await waitForAuth();

  // Load guide data for badge engine
  await loadGuideData();

  initSyncPill();

  // Check foyer
  if (!isFoyerConfigured()) {
    const foyerContainer = document.getElementById('foyer-container');
    if (foyerContainer) {
      foyerContainer.classList.remove('hidden');
      renderFoyerSetup(foyerContainer);
    }
    return;
  }

  // Load toxo status from foyer if available
  const fid = getFoyerId();
  if (fid) {
    try {
      const { getDoc, doc, db } = await import('./firebase.js');
      const snap = await getDoc(doc(db, 'foyers', fid));
      if (snap.exists()) {
        const data = snap.data();
        if (data.toxoStatus) localStorage.setItem('toxoStatus', data.toxoStatus);
        if (data.budgetMensuel) localStorage.setItem('budgetMensuel', data.budgetMensuel);
      }
    } catch (e) {
      console.error('Load foyer settings error:', e);
    }
  }

  // Bind tab clicks
  document.querySelectorAll('.tab-bar__item').forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const target = tab.dataset.tab;
      if (target) navigateTo(target);
    });
  });

  // Settings icon
  const settingsBtn = document.getElementById('btn-settings');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => showSettings());
  }

  // Back from settings
  const backBtn = document.getElementById('btn-back-from-settings');
  if (backBtn) {
    backBtn.addEventListener('click', () => navigateTo('accueil'));
  }

  // Update banner
  const updateBtn = document.getElementById('btn-update');
  if (updateBtn) {
    updateBtn.addEventListener('click', applyUpdate);
  }

  // Navigate to default screen
  navigateTo('accueil');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
