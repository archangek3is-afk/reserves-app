// Kit (Survival Kit Inventory) module
import {
  db, getFoyerId, foyerCollection,
  onSnapshot, doc, updateDoc, getDoc, setDoc,
  serverTimestamp
} from './firebase.js';
import { computeBadge, getBadgeHtml } from './badges.js';
import { addArticle } from './courses.js';

let unsubStock = null;
let stockItems = [];
let currentFilter = 'tout';

function formatPrice(n) {
  if (n == null || isNaN(n)) return '0,00 €';
  return Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR');
}

function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  return Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
}

function getStockQty(item) {
  if (item.sansPeremption) return item.checked ? item.objectif : 0;
  return (item.lots || []).reduce((s, l) => s + (l.quantite || 0), 0);
}

function getNextExpiry(item) {
  const lots = (item.lots || []).filter(l => l.datePeremption);
  if (lots.length === 0) return null;
  lots.sort((a, b) => new Date(a.datePeremption) - new Date(b.datePeremption));
  return lots[0].datePeremption;
}

export function renderKit(container) {
  container.innerHTML = `
    <div class="screen screen--active" id="screen-kit">
      <div class="screen-header">
        <h1 class="screen-header__title">Kit de survie</h1>
        <div class="screen-header__stats" id="kit-stats"></div>
      </div>

      <div class="filter-bar">
        <button class="filter-bar__btn filter-bar__btn--active" data-filter="tout">Tout</button>
        <button class="filter-bar__btn" data-filter="manquants">Manquants</button>
        <button class="filter-bar__btn" data-filter="peremption">Péremption proche</button>
      </div>

      <div class="flex-between mb-12">
        <button class="btn btn--sm btn--primary" id="btn-completer-kit">Compléter le kit</button>
        <button class="btn btn--sm btn--secondary" id="btn-rotation">Rotation</button>
      </div>

      <div id="kit-list"></div>

      <dialog id="dialog-add-lot">
        <div class="dialog-title">Ajouter un lot</div>
        <p class="text-sm mb-12" id="lot-product-name"></p>
        <div class="form-group">
          <label class="form-label">Quantité</label>
          <input type="number" class="input" id="lot-qty" value="1" min="1" step="1">
        </div>
        <div class="form-group">
          <label class="form-label">Date de péremption</label>
          <input type="date" class="input" id="lot-date">
          <div class="quick-dates">
            <button class="btn btn--sm btn--secondary lot-quick-date" data-months="3">+3 mois</button>
            <button class="btn btn--sm btn--secondary lot-quick-date" data-months="6">+6 mois</button>
            <button class="btn btn--sm btn--secondary lot-quick-date" data-months="12">+1 an</button>
            <button class="btn btn--sm btn--secondary lot-quick-date" data-months="24">+2 ans</button>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn btn--ghost" id="lot-cancel">Annuler</button>
          <button class="btn btn--primary" id="lot-save">Ajouter</button>
        </div>
      </dialog>
    </div>
  `;

  bindEvents();
  subscribeToStock();
}

function bindEvents() {
  // Filter buttons
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('filter-bar__btn--active'));
      btn.classList.add('filter-bar__btn--active');
      currentFilter = btn.dataset.filter;
      renderStockList();
    });
  });

  document.getElementById('btn-completer-kit').addEventListener('click', completerKit);
  document.getElementById('btn-rotation').addEventListener('click', rotation);

  // Lot dialog quick dates
  document.querySelectorAll('.lot-quick-date').forEach(btn => {
    btn.addEventListener('click', () => {
      const months = parseInt(btn.dataset.months);
      const d = new Date();
      d.setMonth(d.getMonth() + months);
      document.getElementById('lot-date').value = d.toISOString().split('T')[0];
    });
  });

  document.getElementById('lot-cancel').addEventListener('click', () => {
    document.getElementById('dialog-add-lot').close();
  });
}

function subscribeToStock() {
  if (unsubStock) unsubStock();
  const fid = getFoyerId();
  if (!fid) return;

  unsubStock = onSnapshot(foyerCollection('stock'), (snap) => {
    stockItems = [];
    snap.forEach(d => stockItems.push({ id: d.id, ...d.data() }));
    renderStockList();
  }, (err) => console.error('Kit stock error:', err));
}

function renderStockList() {
  const listEl = document.getElementById('kit-list');
  const statsEl = document.getElementById('kit-stats');
  if (!listEl) return;

  // Compute stats
  let totalRate = 0;
  let totalValue = 0;
  let expiringSoon = 0;
  let missing = 0;

  for (const item of stockItems) {
    const qty = getStockQty(item);
    const rate = Math.min(qty / (item.objectif || 1), 1);
    totalRate += rate;
    totalValue += qty * ((item.prixEstime || 0) / (item.objectif || 1));
    if (qty === 0) missing++;
    const nextExp = getNextExpiry(item);
    if (nextExp && daysUntil(nextExp) < 60) expiringSoon++;
  }

  const fillRate = stockItems.length > 0 ? Math.round((totalRate / stockItems.length) * 100) : 0;

  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat"><span class="stat__value">${fillRate}%</span><span class="stat__label">rempli</span></div>
      <div class="stat"><span class="stat__value">${formatPrice(totalValue)}</span><span class="stat__label">valeur stock</span></div>
      <div class="stat"><span class="stat__value">${expiringSoon}</span><span class="stat__label">péremption proche</span></div>
    `;
  }

  // Filter
  let filtered = [...stockItems];
  if (currentFilter === 'manquants') {
    filtered = filtered.filter(i => getStockQty(i) < i.objectif);
  } else if (currentFilter === 'peremption') {
    filtered = filtered.filter(i => {
      const exp = getNextExpiry(i);
      return exp && daysUntil(exp) < 60;
    });
  }

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-state__icon">📦</div><div class="empty-state__text">${currentFilter === 'tout' ? 'Aucun produit dans le kit' : 'Aucun produit dans ce filtre'}</div></div>`;
    return;
  }

  // Group by categorie
  const categories = {};
  for (const item of filtered) {
    const cat = item.categorie || 'Autre';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(item);
  }

  let html = '';
  for (const [cat, items] of Object.entries(categories)) {
    html += `<div class="group-header"><span class="group-header__title">${cat}</span><span class="group-header__chevron">▼</span></div>`;
    html += '<div class="group-body">';
    for (const item of items) {
      const qty = getStockQty(item);
      const rate = Math.min(qty / (item.objectif || 1), 1);
      const pct = Math.round(rate * 100);
      const gaugeColor = pct < 50 ? 'red' : pct < 100 ? 'orange' : 'green';
      const nextExp = getNextExpiry(item);
      const badge = computeBadge(item.nom);
      const badgeHtml = getBadgeHtml(badge);
      const expDays = nextExp ? daysUntil(nextExp) : null;

      if (item.sansPeremption) {
        html += `
          <div class="kit-row">
            <div class="kit-row__info">
              <div class="kit-row__name">${item.nom} ${badgeHtml}</div>
              <div class="kit-row__meta">Objectif : ${item.objectif} ${item.unite || ''}</div>
            </div>
            <div class="kit-checkbox">
              <input type="checkbox" ${item.checked ? 'checked' : ''} data-kit-check="${item.id}" aria-label="Possédé">
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="kit-row">
            <div class="kit-row__info">
              <div class="kit-row__name">${item.nom} ${badgeHtml}</div>
              <div class="kit-row__meta">${qty} / ${item.objectif} ${item.unite || ''}</div>
              ${nextExp ? `<div class="kit-row__expiry ${expDays < 0 ? 'expiry-expired' : expDays < 30 ? 'expiry-soon' : ''}">${expDays < 0 ? 'Expiré' : expDays + 'j'} — ${formatDate(nextExp)}</div>` : ''}
            </div>
            <div class="kit-row__gauge">
              <div class="gauge">
                <div class="gauge__fill gauge__fill--${gaugeColor}" style="width:${pct}%"></div>
              </div>
            </div>
            <div class="kit-row__actions">
              <button class="btn btn--round btn--secondary btn--sm" data-kit-add="${item.id}" aria-label="Ajouter">+</button>
              <button class="btn btn--round btn--ghost btn--sm" data-kit-remove="${item.id}" aria-label="Retirer" ${qty === 0 ? 'disabled' : ''}>−</button>
            </div>
          </div>
        `;
      }
    }
    html += '</div>';
  }

  listEl.innerHTML = html;

  // Bind events
  listEl.querySelectorAll('[data-kit-check]').forEach(cb => {
    cb.addEventListener('change', (e) => toggleKitCheck(e.target.dataset.kitCheck, e.target.checked));
  });

  listEl.querySelectorAll('[data-kit-add]').forEach(btn => {
    btn.addEventListener('click', () => showAddLotDialog(btn.dataset.kitAdd));
  });

  listEl.querySelectorAll('[data-kit-remove]').forEach(btn => {
    btn.addEventListener('click', () => removeOldestUnit(btn.dataset.kitRemove));
  });

  // Group collapse
  listEl.querySelectorAll('.group-header').forEach(header => {
    header.addEventListener('click', () => {
      const body = header.nextElementSibling;
      if (body) {
        body.classList.toggle('group-body--collapsed');
        header.classList.toggle('group-header--collapsed');
      }
    });
  });
}

async function toggleKitCheck(id, checked) {
  const fid = getFoyerId();
  if (!fid) return;
  try {
    await updateDoc(doc(db, 'foyers', fid, 'stock', id), { checked });
  } catch (e) {
    console.error('toggleKitCheck error:', e);
  }
}

function showAddLotDialog(productId) {
  const item = stockItems.find(i => i.id === productId);
  if (!item) return;

  const dialog = document.getElementById('dialog-add-lot');
  document.getElementById('lot-product-name').textContent = item.nom;
  document.getElementById('lot-qty').value = 1;
  document.getElementById('lot-date').value = '';

  const saveBtn = document.getElementById('lot-save');
  const newSave = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSave, saveBtn);

  newSave.addEventListener('click', async () => {
    const qty = parseInt(document.getElementById('lot-qty').value) || 1;
    const dateVal = document.getElementById('lot-date').value || null;
    const fid = getFoyerId();
    try {
      const ref = doc(db, 'foyers', fid, 'stock', productId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const data = snap.data();
      const lots = data.lots || [];
      lots.push({
        id: crypto.randomUUID(),
        quantite: qty,
        datePeremption: dateVal,
        ajouteLe: new Date().toISOString()
      });
      await updateDoc(ref, { lots });
      dialog.close();
    } catch (e) {
      console.error('addLot error:', e);
    }
  });

  dialog.showModal();
}

async function removeOldestUnit(productId) {
  const fid = getFoyerId();
  if (!fid) return;
  const item = stockItems.find(i => i.id === productId);
  if (!item || !item.lots || item.lots.length === 0) return;

  // Sort by expiry (oldest first), then by added date
  const lots = [...item.lots].sort((a, b) => {
    if (a.datePeremption && b.datePeremption) return new Date(a.datePeremption) - new Date(b.datePeremption);
    if (a.datePeremption) return -1;
    if (b.datePeremption) return 1;
    return new Date(a.ajouteLe || 0) - new Date(b.ajouteLe || 0);
  });

  // Remove one unit from oldest lot
  if (lots[0].quantite > 1) {
    lots[0].quantite -= 1;
  } else {
    lots.splice(0, 1);
  }

  try {
    await updateDoc(doc(db, 'foyers', fid, 'stock', productId), { lots });
  } catch (e) {
    console.error('removeOldestUnit error:', e);
  }
}

async function completerKit() {
  const missing = stockItems.filter(i => {
    const qty = getStockQty(i);
    return qty < i.objectif;
  });

  if (missing.length === 0) {
    alert('Le kit est complet !');
    return;
  }

  if (!confirm(`Ajouter ${missing.length} produit(s) manquant(s) à la liste de courses ?`)) return;

  for (const item of missing) {
    const qty = getStockQty(item);
    const needed = item.objectif - qty;
    await addArticle({
      nom: item.nom,
      quantite: needed,
      unite: item.unite,
      magasin: item.magasinConseille || '',
      prixEstime: item.prixEstime ? (item.prixEstime / item.objectif) * needed : 0,
      kitOriginId: item.id
    });
  }
  alert(`${missing.length} article(s) ajouté(s) aux courses.`);
}

async function rotation() {
  const expiringSoon = stockItems.filter(i => {
    const exp = getNextExpiry(i);
    return exp && daysUntil(exp) < 60;
  });

  if (expiringSoon.length === 0) {
    alert('Aucun produit à rotation proche.');
    return;
  }

  const names = expiringSoon.map(i => `- ${i.nom} (${formatDate(getNextExpiry(i))})`).join('\n');
  const action = confirm(`Produits à consommer bientôt :\n\n${names}\n\nVoulez-vous les ajouter à la liste de courses pour rachat ?`);

  if (action) {
    for (const item of expiringSoon) {
      await addArticle({
        nom: item.nom,
        quantite: 1,
        unite: item.unite,
        magasin: item.magasinConseille || '',
        prixEstime: item.prixEstime ? item.prixEstime / item.objectif : 0,
        kitOriginId: item.id
      });
    }
    alert(`${expiringSoon.length} article(s) ajouté(s) aux courses pour remplacement.`);
  }
}

export function destroyKit() {
  if (unsubStock) { unsubStock(); unsubStock = null; }
}
