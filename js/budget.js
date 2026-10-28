// Budget Screen — monthly tracking
import {
  db, getFoyerId, foyerCollection, foyerDoc,
  onSnapshot, doc, getDoc
} from './firebase.js';

let unsubAchats = null;
let achats = [];
let currentMonth = null; // YYYY-MM

function formatPrice(n) {
  if (n == null || isNaN(n)) return '0,00 €';
  return Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('fr-FR');
}

function getMonthLabel(ym) {
  const [y, m] = ym.split('-');
  const months = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  return `${months[parseInt(m) - 1]} ${y}`;
}

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function renderBudget(container) {
  currentMonth = getCurrentMonthKey();

  container.innerHTML = `
    <div class="screen screen--active" id="screen-budget">
      <div class="screen-header">
        <h1 class="screen-header__title">Budget</h1>
      </div>

      <div class="month-selector">
        <button class="btn btn--icon btn--ghost" id="month-prev" aria-label="Mois précédent">◀</button>
        <span class="month-selector__label" id="month-label">${getMonthLabel(currentMonth)}</span>
        <button class="btn btn--icon btn--ghost" id="month-next" aria-label="Mois suivant">▶</button>
      </div>

      <div class="card" id="budget-summary">
        <div class="flex-between">
          <div>
            <div class="card__title">Dépensé</div>
            <div class="card__value" id="budget-spent">—</div>
          </div>
          <div style="text-align:right;">
            <div class="card__title">Budget</div>
            <div class="card__value" id="budget-total">—</div>
          </div>
        </div>
        <div class="gauge gauge-large mt-12">
          <div class="gauge__fill" id="budget-gauge" style="width:0%"></div>
        </div>
        <div class="card__sub flex-between" id="budget-remaining-row">
          <span id="budget-remaining-label"></span>
          <span id="budget-gap-label"></span>
        </div>
      </div>

      <h2 class="section-title">Par magasin</h2>
      <div class="card" id="budget-by-store"></div>

      <h2 class="section-title">Historique des achats</h2>
      <div id="budget-history"></div>
    </div>
  `;

  document.getElementById('month-prev').addEventListener('click', () => {
    currentMonth = shiftMonth(currentMonth, -1);
    document.getElementById('month-label').textContent = getMonthLabel(currentMonth);
    renderBudgetData();
  });

  document.getElementById('month-next').addEventListener('click', () => {
    currentMonth = shiftMonth(currentMonth, 1);
    document.getElementById('month-label').textContent = getMonthLabel(currentMonth);
    renderBudgetData();
  });

  subscribeToAchats();
}

function subscribeToAchats() {
  if (unsubAchats) unsubAchats();
  const fid = getFoyerId();
  if (!fid) return;

  unsubAchats = onSnapshot(foyerCollection('achats'), (snap) => {
    achats = [];
    snap.forEach(d => achats.push({ id: d.id, ...d.data() }));
    renderBudgetData();
  }, (err) => console.error('Budget achats error:', err));
}

async function renderBudgetData() {
  const budgetMensuel = parseFloat(localStorage.getItem('budgetMensuel')) || 400;
  const monthAchats = achats.filter(a => a.mois === currentMonth);

  // Total spent
  const spent = monthAchats.reduce((s, a) => s + (a.total || 0), 0);
  const pct = Math.min(Math.round((spent / budgetMensuel) * 100), 100);
  const remaining = budgetMensuel - spent;
  const gaugeColor = pct > 90 ? 'red' : pct > 70 ? 'orange' : 'green';

  const spentEl = document.getElementById('budget-spent');
  const totalEl = document.getElementById('budget-total');
  const gaugeEl = document.getElementById('budget-gauge');
  const remainLabel = document.getElementById('budget-remaining-label');
  const gapLabel = document.getElementById('budget-gap-label');

  if (spentEl) spentEl.textContent = formatPrice(spent);
  if (totalEl) totalEl.textContent = formatPrice(budgetMensuel);
  if (gaugeEl) {
    gaugeEl.style.width = pct + '%';
    gaugeEl.className = `gauge__fill gauge__fill--${gaugeColor}`;
  }
  if (remainLabel) remainLabel.textContent = remaining >= 0 ? `Reste ${formatPrice(remaining)}` : `Dépassement ${formatPrice(-remaining)}`;

  // Estimated vs real gap
  let estimatedTotal = 0;
  for (const a of monthAchats) {
    const arts = a.articles || [];
    for (const art of arts) {
      estimatedTotal += (art.prixEstime || 0) * (art.quantite || 1);
    }
  }
  const gap = spent - estimatedTotal;
  if (gapLabel) {
    if (Math.abs(gap) > 0.5) {
      gapLabel.textContent = gap > 0 ? `+${formatPrice(gap)} vs estimé` : `${formatPrice(gap)} vs estimé`;
      gapLabel.style.color = gap > 0 ? 'var(--alert)' : 'var(--validated)';
    } else {
      gapLabel.textContent = '';
    }
  }

  // By magasin
  const byStore = {};
  for (const a of monthAchats) {
    const store = a.magasin || 'Autre';
    byStore[store] = (byStore[store] || 0) + (a.total || 0);
  }

  const storeEl = document.getElementById('budget-by-store');
  if (storeEl) {
    if (Object.keys(byStore).length === 0) {
      storeEl.innerHTML = '<div class="text-muted text-sm" style="padding:8px;">Aucun achat ce mois</div>';
    } else {
      storeEl.innerHTML = Object.entries(byStore)
        .sort((a, b) => b[1] - a[1])
        .map(([store, amount]) => `
          <div class="budget-row">
            <span class="budget-row__name">${store}</span>
            <span class="budget-row__amount">${formatPrice(amount)}</span>
          </div>
        `).join('');
    }
  }

  // History
  const historyEl = document.getElementById('budget-history');
  if (historyEl) {
    const sorted = [...monthAchats].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (sorted.length === 0) {
      historyEl.innerHTML = '<div class="empty-state"><div class="empty-state__icon">📋</div><div class="empty-state__text">Aucun achat enregistré ce mois.</div></div>';
    } else {
      historyEl.innerHTML = sorted.map(a => `
        <div class="purchase-item card">
          <div class="purchase-item__header">
            <span class="purchase-item__store">${a.magasin || 'Autre'}</span>
            <span class="purchase-item__date">${formatDate(a.date)}</span>
          </div>
          <div class="purchase-item__total">${formatPrice(a.total)}</div>
          <div class="text-sm text-muted mt-12">${(a.articles || []).map(art => art.nom).join(', ')}</div>
        </div>
      `).join('');
    }
  }
}

export function destroyBudget() {
  if (unsubAchats) { unsubAchats(); unsubAchats = null; }
}
