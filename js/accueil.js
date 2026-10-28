// Accueil (Home) screen — summary cards
import {
  db, getFoyerId, foyerCollection,
  onSnapshot, query, orderBy, getDocs, doc, getDoc
} from './firebase.js';
import { getBadgeHtml } from './badges.js';

let unsubStock = null;
let unsubCourses = null;
let unsubAchats = null;

function formatPrice(n) {
  if (n == null || isNaN(n)) return '0,00 €';
  return Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function formatDate(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : d.toDate ? d.toDate() : new Date(d);
  return date.toLocaleDateString('fr-FR');
}

function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d - now) / (1000 * 60 * 60 * 24));
}

export function renderAccueil(container) {
  const fid = getFoyerId();
  container.innerHTML = `
    <div class="screen screen--active" id="screen-accueil">
      <div id="accueil-terme"></div>
      <div id="accueil-kit-banner"></div>
      <div class="card-grid" id="accueil-cards">
        <div class="card" id="card-kit">
          <div class="card__title">Kit de survie</div>
          <div class="card__value" id="kit-rate">—</div>
          <div class="gauge"><div class="gauge__fill" id="kit-gauge" style="width:0%"></div></div>
          <div class="card__sub" id="kit-missing"></div>
        </div>
        <div class="card" id="card-expiry">
          <div class="card__title">À consommer</div>
          <div id="expiry-list" class="card__sub">—</div>
        </div>
        <div class="card" id="card-courses">
          <div class="card__title">Courses</div>
          <div class="card__value" id="courses-count">—</div>
          <div class="card__sub" id="courses-estimate"></div>
        </div>
        <div class="card" id="card-budget">
          <div class="card__title">Budget</div>
          <div class="card__value" id="budget-spent">—</div>
          <div class="gauge"><div class="gauge__fill" id="budget-gauge" style="width:0%"></div></div>
          <div class="card__sub" id="budget-remaining"></div>
        </div>
      </div>
    </div>
  `;

  if (!fid) return;

  // Load foyer info for terme
  loadFoyerInfo(fid);

  // Subscribe to stock for kit summary
  subscribeStock(fid);
  // Subscribe to courses
  subscribeCourses(fid);
  // Subscribe to achats for budget
  subscribeAchats(fid);
}

async function loadFoyerInfo(fid) {
  try {
    const snap = await getDoc(doc(db, 'foyers', fid));
    if (!snap.exists()) return;
    const data = snap.data();

    // Terme
    const termeEl = document.getElementById('accueil-terme');
    if (data.terme) {
      const termeDate = new Date(data.terme);
      const days = daysUntil(data.terme);
      termeEl.innerHTML = `<div class="terme-display">Terme prévu : <strong>${formatDate(termeDate)}</strong> (${days > 0 ? 'dans ' + days + ' jours' : 'dépassé'})</div>`;
    } else {
      termeEl.innerHTML = '';
    }

    // Kit verification banner
    const bannerEl = document.getElementById('accueil-kit-banner');
    if (data.derniereVerifKit) {
      const lastCheck = data.derniereVerifKit.toDate ? data.derniereVerifKit.toDate() : new Date(data.derniereVerifKit);
      const monthsSince = (Date.now() - lastCheck.getTime()) / (1000 * 60 * 60 * 24 * 30);
      if (monthsSince > 6) {
        bannerEl.innerHTML = `<div class="alert-banner alert-banner--warning">Dernière vérification du kit il y a plus de 6 mois. Pensez à faire un tour !</div>`;
      } else {
        bannerEl.innerHTML = '';
      }
    } else {
      bannerEl.innerHTML = `<div class="alert-banner alert-banner--warning">Le kit n'a jamais été vérifié. Faites un premier inventaire !</div>`;
    }

    // Budget info
    const budgetMensuel = data.budgetMensuel || 400;
    localStorage.setItem('budgetMensuel', budgetMensuel);
  } catch (e) {
    console.error('loadFoyerInfo error:', e);
  }
}

function subscribeStock(fid) {
  if (unsubStock) unsubStock();
  const stockRef = query(foyerCollection('stock'));
  unsubStock = onSnapshot(stockRef, (snap) => {
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));

    // Kit fill rate
    let totalRate = 0;
    let missing = 0;
    const expiringLots = [];

    for (const item of items) {
      const lots = item.lots || [];
      let stockQty = 0;
      if (item.sansPeremption) {
        stockQty = item.checked ? item.objectif : 0;
      } else {
        stockQty = lots.reduce((s, l) => s + (l.quantite || 0), 0);
      }
      const rate = Math.min(stockQty / (item.objectif || 1), 1);
      totalRate += rate;
      if (stockQty === 0) missing++;

      // Collect expiring lots
      for (const lot of lots) {
        if (lot.datePeremption) {
          expiringLots.push({
            nom: item.nom,
            date: lot.datePeremption,
            quantite: lot.quantite
          });
        }
      }
    }

    const fillRate = items.length > 0 ? Math.round((totalRate / items.length) * 100) : 0;
    const gaugeColor = fillRate < 50 ? 'red' : fillRate < 100 ? 'orange' : 'green';

    const kitRateEl = document.getElementById('kit-rate');
    const kitGaugeEl = document.getElementById('kit-gauge');
    const kitMissingEl = document.getElementById('kit-missing');
    if (kitRateEl) kitRateEl.textContent = fillRate + ' %';
    if (kitGaugeEl) {
      kitGaugeEl.style.width = fillRate + '%';
      kitGaugeEl.className = `gauge__fill gauge__fill--${gaugeColor}`;
    }
    if (kitMissingEl) kitMissingEl.textContent = missing > 0 ? `${missing} produit${missing > 1 ? 's' : ''} manquant${missing > 1 ? 's' : ''}` : 'Kit complet';

    // Expiring soon (< 60 days)
    const expiryEl = document.getElementById('expiry-list');
    if (expiryEl) {
      const sorted = expiringLots
        .filter(l => daysUntil(l.date) < 60)
        .sort((a, b) => daysUntil(a.date) - daysUntil(b.date))
        .slice(0, 3);

      if (sorted.length === 0) {
        expiryEl.innerHTML = '<span class="text-muted">Rien à signaler</span>';
      } else {
        expiryEl.innerHTML = sorted.map(l => {
          const days = daysUntil(l.date);
          const cls = days < 0 ? 'expiry-expired' : 'expiry-soon';
          const label = days < 0 ? 'Expiré' : `${days}j`;
          return `<div class="${cls}" style="margin:2px 0;">${l.nom} — <strong>${label}</strong></div>`;
        }).join('');
      }
    }
  }, (err) => console.error('Stock subscribe error:', err));
}

function subscribeCourses(fid) {
  if (unsubCourses) unsubCourses();
  const coursesRef = foyerCollection('courses');
  unsubCourses = onSnapshot(coursesRef, (snap) => {
    let total = 0;
    let checked = 0;
    let estimateRemaining = 0;

    snap.forEach(d => {
      total++;
      const data = d.data();
      if (data.checked) {
        checked++;
      } else {
        estimateRemaining += (data.prixEstime || 0) * (data.quantite || 1);
      }
    });

    const countEl = document.getElementById('courses-count');
    const estEl = document.getElementById('courses-estimate');
    if (countEl) countEl.textContent = `${total - checked} / ${total}`;
    if (estEl) estEl.textContent = `Reste ~${formatPrice(estimateRemaining)}`;
  }, (err) => console.error('Courses subscribe error:', err));
}

function subscribeAchats(fid) {
  if (unsubAchats) unsubAchats();
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const achatsRef = foyerCollection('achats');

  unsubAchats = onSnapshot(achatsRef, (snap) => {
    let spent = 0;
    snap.forEach(d => {
      const data = d.data();
      if (data.mois === monthKey) {
        spent += data.total || 0;
      }
    });

    const budget = parseFloat(localStorage.getItem('budgetMensuel')) || 400;
    const pct = Math.min(Math.round((spent / budget) * 100), 100);
    const remaining = budget - spent;
    const gaugeColor = pct > 90 ? 'red' : pct > 70 ? 'orange' : 'green';

    const spentEl = document.getElementById('budget-spent');
    const gaugeEl = document.getElementById('budget-gauge');
    const remainEl = document.getElementById('budget-remaining');
    if (spentEl) spentEl.textContent = formatPrice(spent);
    if (gaugeEl) {
      gaugeEl.style.width = pct + '%';
      gaugeEl.className = `gauge__fill gauge__fill--${gaugeColor}`;
    }
    if (remainEl) remainEl.textContent = `Reste ${formatPrice(Math.max(remaining, 0))}`;
  }, (err) => console.error('Achats subscribe error:', err));
}

export function destroyAccueil() {
  if (unsubStock) { unsubStock(); unsubStock = null; }
  if (unsubCourses) { unsubCourses(); unsubCourses = null; }
  if (unsubAchats) { unsubAchats(); unsubAchats = null; }
}
