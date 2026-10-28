// Courses (Shopping List) module
import {
  db, getFoyerId, foyerCollection, foyerDoc, getCurrentUser,
  onSnapshot, query, orderBy, doc, setDoc, updateDoc, deleteDoc, addDoc,
  getDoc, getDocs, serverTimestamp
} from './firebase.js';
import { computeBadge, getBadgeHtml } from './badges.js';
import { getPrenom } from './foyer.js';

let unsubCourses = null;
let articles = [];
let favoris = [];
let magasins = [];
let hideChecked = localStorage.getItem('hideChecked') === 'true';
let debounceTimers = {};

function formatPrice(n) {
  if (n == null || isNaN(n)) return '';
  return Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

async function loadMagasins() {
  try {
    const resp = await fetch('./data/magasins.json');
    magasins = await resp.json();
  } catch (e) {
    magasins = [];
  }
}

function loadFavoris() {
  try {
    favoris = JSON.parse(localStorage.getItem('favoris') || '[]');
  } catch { favoris = []; }
}

function saveFavoris() {
  localStorage.setItem('favoris', JSON.stringify(favoris));
}

function updateFavori(article) {
  const idx = favoris.findIndex(f => f.nom.toLowerCase() === article.nom.toLowerCase());
  if (idx >= 0) {
    favoris[idx].count = (favoris[idx].count || 0) + 1;
    favoris[idx] = { ...favoris[idx], ...article };
  } else {
    favoris.push({ ...article, count: 1 });
  }
  saveFavoris();
}

// Parse input: "3 pommes, lait, 6 œufs" → [{qty:3, nom:"pommes"}, {qty:1, nom:"lait"}, {qty:6, nom:"œufs"}]
function parseInput(text) {
  const items = text.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  return items.map(item => {
    const m = item.match(/^(\d+(?:[.,]\d+)?)\s+(.+)/);
    if (m) {
      return { quantite: parseFloat(m[1].replace(',', '.')), nom: m[2].trim() };
    }
    return { quantite: 1, nom: item };
  });
}

// Render
export function renderCourses(container) {
  loadFavoris();
  loadMagasins();

  container.innerHTML = `
    <div class="screen screen--active" id="screen-courses">
      <div class="screen-header">
        <div class="flex-between">
          <h1 class="screen-header__title">Courses</h1>
          <button class="btn btn--sm btn--secondary" id="btn-semaine-type">Semaine type</button>
        </div>
        <div class="screen-header__stats" id="courses-stats"></div>
      </div>

      <div class="autocomplete">
        <input type="text" class="input" id="courses-input" placeholder="Ajouter : lait, 6 œufs, pain..." autocomplete="off">
        <div class="autocomplete__list" id="courses-autocomplete"></div>
      </div>

      <div class="flex-between mt-12 mb-12">
        <label style="display:flex;align-items:center;gap:6px;font-size:0.82rem;cursor:pointer;">
          <input type="checkbox" id="chk-hide-checked" ${hideChecked ? 'checked' : ''} style="width:18px;height:18px;">
          Masquer les articles achetés
        </label>
        <button class="btn btn--sm btn--danger" id="btn-terminer" style="display:none;">Terminer les courses</button>
      </div>

      <div id="courses-list"></div>

      <dialog id="dialog-article-detail">
        <div class="dialog-title">Détails de l'article</div>
        <div id="detail-content"></div>
        <div class="dialog-actions">
          <button class="btn btn--ghost" id="detail-close">Fermer</button>
          <button class="btn btn--danger btn--sm" id="detail-delete">Supprimer</button>
          <button class="btn btn--primary btn--sm" id="detail-save">Enregistrer</button>
        </div>
      </dialog>

      <dialog id="dialog-expiry">
        <div class="dialog-title">Date de péremption</div>
        <p class="text-sm mb-12" id="expiry-article-name"></p>
        <input type="date" class="input" id="expiry-date-input">
        <div class="quick-dates">
          <button class="btn btn--sm btn--secondary quick-date" data-months="3">+3 mois</button>
          <button class="btn btn--sm btn--secondary quick-date" data-months="6">+6 mois</button>
          <button class="btn btn--sm btn--secondary quick-date" data-months="12">+1 an</button>
          <button class="btn btn--sm btn--secondary quick-date" data-months="24">+2 ans</button>
        </div>
        <div class="dialog-actions">
          <button class="btn btn--ghost" id="expiry-skip">Passer</button>
          <button class="btn btn--primary" id="expiry-save">Valider</button>
        </div>
      </dialog>
    </div>
  `;

  bindEvents();
  subscribeToCourses();
}

function bindEvents() {
  const input = document.getElementById('courses-input');
  const autocompleteEl = document.getElementById('courses-autocomplete');

  // Input: autocomplete + add on Enter
  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (val.length < 2) {
      autocompleteEl.classList.remove('autocomplete__list--visible');
      return;
    }
    const lower = val.toLowerCase();
    const matches = favoris
      .filter(f => f.nom.toLowerCase().includes(lower))
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, 5);

    if (matches.length > 0) {
      autocompleteEl.innerHTML = matches.map(f =>
        `<div class="autocomplete__item" data-fav="${encodeURIComponent(JSON.stringify(f))}">${f.nom}${f.magasin ? ' <span class="text-muted text-sm">(' + f.magasin + ')</span>' : ''}</div>`
      ).join('');
      autocompleteEl.classList.add('autocomplete__list--visible');
    } else {
      autocompleteEl.classList.remove('autocomplete__list--visible');
    }
  });

  autocompleteEl.addEventListener('click', (e) => {
    const item = e.target.closest('.autocomplete__item');
    if (!item) return;
    const fav = JSON.parse(decodeURIComponent(item.dataset.fav));
    addArticle(fav);
    input.value = '';
    autocompleteEl.classList.remove('autocomplete__list--visible');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;
      const parsed = parseInput(val);
      for (const p of parsed) {
        // Check if favori exists
        const fav = favoris.find(f => f.nom.toLowerCase() === p.nom.toLowerCase());
        if (fav) {
          addArticle({ ...fav, quantite: p.quantite });
        } else {
          addArticle({ nom: p.nom, quantite: p.quantite });
        }
      }
      input.value = '';
      autocompleteEl.classList.remove('autocomplete__list--visible');
    }
  });

  // Hide checked toggle
  document.getElementById('chk-hide-checked').addEventListener('change', (e) => {
    hideChecked = e.target.checked;
    localStorage.setItem('hideChecked', hideChecked);
    renderArticleList();
  });

  // Semaine type
  document.getElementById('btn-semaine-type').addEventListener('click', loadSemaineType);

  // Terminer les courses
  document.getElementById('btn-terminer').addEventListener('click', terminerCourses);

  // Detail dialog
  document.getElementById('detail-close').addEventListener('click', () => {
    document.getElementById('dialog-article-detail').close();
  });

  // Expiry quick dates
  document.querySelectorAll('.quick-date').forEach(btn => {
    btn.addEventListener('click', () => {
      const months = parseInt(btn.dataset.months);
      const d = new Date();
      d.setMonth(d.getMonth() + months);
      document.getElementById('expiry-date-input').value = d.toISOString().split('T')[0];
    });
  });
}

async function addArticle(data) {
  const fid = getFoyerId();
  if (!fid) return;

  const badge = computeBadge(data.nom, data.badgeForce || null);
  const id = crypto.randomUUID();

  const articleData = {
    nom: data.nom || '',
    quantite: data.quantite || 1,
    unite: data.unite || '',
    magasin: data.magasin || '',
    rayon: data.rayon || '',
    prixEstime: data.prixEstime || 0,
    prixReel: null,
    badge: badge,
    badgeForce: data.badgeForce || null,
    checked: false,
    checkedBy: null,
    checkedByPrenom: null,
    kitOriginId: data.kitOriginId || null,
    createdAt: serverTimestamp()
  };

  try {
    await setDoc(doc(db, 'foyers', fid, 'courses', id), articleData);
    // Auto-favori after 2+ additions
    updateFavori({
      nom: data.nom,
      magasin: data.magasin || '',
      rayon: data.rayon || '',
      unite: data.unite || '',
      prixEstime: data.prixEstime || 0
    });
  } catch (e) {
    console.error('addArticle error:', e);
  }
}

function subscribeToCourses() {
  if (unsubCourses) unsubCourses();
  const fid = getFoyerId();
  if (!fid) return;

  const coursesRef = foyerCollection('courses');
  unsubCourses = onSnapshot(coursesRef, (snap) => {
    articles = [];
    snap.forEach(d => articles.push({ id: d.id, ...d.data() }));
    renderArticleList();
  }, (err) => console.error('Courses snapshot error:', err));
}

function renderArticleList() {
  const listEl = document.getElementById('courses-list');
  const statsEl = document.getElementById('courses-stats');
  const btnTerminer = document.getElementById('btn-terminer');
  if (!listEl) return;

  const displayed = hideChecked ? articles.filter(a => !a.checked) : articles;
  const totalCount = articles.length;
  const checkedCount = articles.filter(a => a.checked).length;
  const remainingEstimate = articles.filter(a => !a.checked).reduce((s, a) => s + (a.prixEstime || 0) * (a.quantite || 1), 0);
  const checkedEstimate = articles.filter(a => a.checked).reduce((s, a) => s + ((a.prixReel != null ? a.prixReel : a.prixEstime) || 0) * (a.quantite || 1), 0);

  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat"><span class="stat__value">${totalCount - checkedCount}/${totalCount}</span><span class="stat__label">articles restants</span></div>
      <div class="stat"><span class="stat__value">${formatPrice(remainingEstimate)}</span><span class="stat__label">estimé restant</span></div>
      <div class="stat"><span class="stat__value">${formatPrice(checkedEstimate)}</span><span class="stat__label">acheté</span></div>
    `;
  }

  // Show terminer button if any checked
  if (btnTerminer) {
    btnTerminer.style.display = checkedCount > 0 ? 'inline-flex' : 'none';
  }

  if (displayed.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-state__icon">🛒</div><div class="empty-state__text">${totalCount === 0 ? 'Aucun article. Ajoute tes courses ci-dessus !' : 'Tous les articles sont achetés !'}</div></div>`;
    return;
  }

  // Group by magasin then rayon
  const groups = {};
  for (const a of displayed) {
    const mag = a.magasin || 'Non classé';
    const ray = a.rayon || 'Autre';
    const key = `${mag}|||${ray}`;
    if (!groups[key]) groups[key] = { magasin: mag, rayon: ray, items: [] };
    groups[key].items.push(a);
  }

  // Sort groups by magasin order
  const sortedGroups = Object.values(groups).sort((a, b) => {
    const oa = magasins.findIndex(m => m.nom === a.magasin);
    const ob = magasins.findIndex(m => m.nom === b.magasin);
    return (oa === -1 ? 99 : oa) - (ob === -1 ? 99 : ob);
  });

  let html = '';
  let lastMagasin = '';
  for (const group of sortedGroups) {
    if (group.magasin !== lastMagasin) {
      html += `<div class="group-header" data-group="${group.magasin}">
        <span class="group-header__title">${group.magasin}</span>
        <span class="group-header__chevron">▼</span>
      </div>`;
      lastMagasin = group.magasin;
    }
    html += `<div class="group-body" data-group-body="${group.magasin}">`;
    if (group.rayon && group.rayon !== 'Autre') {
      html += `<div style="padding:4px 12px;font-size:0.75rem;color:var(--ink-light);font-weight:600;text-transform:uppercase;">${group.rayon}</div>`;
    }
    for (const a of group.items) {
      const badge = a.badgeForce ? getBadgeHtml(a.badgeForce) + '<span class="badge-force-indicator">✏️</span>' : getBadgeHtml(a.badge);
      const priceVal = a.prixReel != null ? a.prixReel : (a.prixEstime || 0);
      html += `
        <div class="article-row ${a.checked ? 'article-row--checked' : ''}" data-id="${a.id}">
          <div class="article-row__check">
            <input type="checkbox" ${a.checked ? 'checked' : ''} data-check="${a.id}" aria-label="Marquer ${a.nom} comme acheté">
          </div>
          <div class="article-row__content" data-longpress="${a.id}">
            <div class="article-row__name">${a.nom}</div>
            <div class="article-row__details">
              ${a.quantite > 1 ? `<span>${a.quantite} ${a.unite || ''}</span>` : ''}
              ${badge}
              ${a.checked && a.checkedByPrenom ? `<span class="article-row__who">${a.checkedByPrenom}</span>` : ''}
            </div>
          </div>
          <div class="article-row__price">
            <input type="number" value="${priceVal}" step="0.01" min="0" data-price="${a.id}" aria-label="Prix" style="width:60px;">
          </div>
        </div>
      `;
    }
    html += '</div>';
  }

  listEl.innerHTML = html;

  // Bind checkbox events
  listEl.querySelectorAll('[data-check]').forEach(cb => {
    cb.addEventListener('change', (e) => toggleChecked(e.target.dataset.check, e.target.checked));
  });

  // Bind price input events (debounced)
  listEl.querySelectorAll('[data-price]').forEach(input => {
    input.addEventListener('input', (e) => {
      const id = e.target.dataset.price;
      clearTimeout(debounceTimers[id]);
      debounceTimers[id] = setTimeout(() => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) updateArticlePrice(id, val);
      }, 300);
    });
  });

  // Bind long-press for detail
  listEl.querySelectorAll('[data-longpress]').forEach(el => {
    let timer = null;
    el.addEventListener('pointerdown', (e) => {
      timer = setTimeout(() => {
        showDetailDialog(el.dataset.longpress);
      }, 500);
    });
    el.addEventListener('pointerup', () => clearTimeout(timer));
    el.addEventListener('pointerleave', () => clearTimeout(timer));
  });

  // Bind group collapse
  listEl.querySelectorAll('.group-header').forEach(header => {
    header.addEventListener('click', () => {
      const group = header.dataset.group;
      const body = listEl.querySelector(`[data-group-body="${group}"]`);
      if (body) {
        body.classList.toggle('group-body--collapsed');
        header.classList.toggle('group-header--collapsed');
      }
    });
  });
}

async function toggleChecked(id, checked) {
  const fid = getFoyerId();
  if (!fid) return;
  const user = getCurrentUser();
  try {
    await updateDoc(doc(db, 'foyers', fid, 'courses', id), {
      checked,
      checkedBy: checked ? (user ? user.uid : null) : null,
      checkedByPrenom: checked ? getPrenom() : null
    });
  } catch (e) {
    console.error('toggleChecked error:', e);
  }
}

async function updateArticlePrice(id, price) {
  const fid = getFoyerId();
  if (!fid) return;
  try {
    await updateDoc(doc(db, 'foyers', fid, 'courses', id), { prixReel: price });
  } catch (e) {
    console.error('updateArticlePrice error:', e);
  }
}

function showDetailDialog(id) {
  const article = articles.find(a => a.id === id);
  if (!article) return;
  const dialog = document.getElementById('dialog-article-detail');
  const content = document.getElementById('detail-content');

  content.innerHTML = `
    <div class="form-group">
      <label class="form-label">Article</label>
      <input type="text" class="input" id="detail-nom" value="${article.nom}" maxlength="120">
    </div>
    <div class="form-group">
      <label class="form-label">Quantité</label>
      <div style="display:flex;gap:8px;">
        <input type="number" class="input" id="detail-qty" value="${article.quantite || 1}" min="0" step="0.5" style="flex:1;">
        <input type="text" class="input" id="detail-unite" value="${article.unite || ''}" placeholder="unité" style="flex:1;" maxlength="20">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Magasin</label>
      <select class="input" id="detail-magasin">
        <option value="">—</option>
        ${magasins.map(m => `<option value="${m.nom}" ${article.magasin === m.nom ? 'selected' : ''}>${m.nom}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Rayon</label>
      <input type="text" class="input" id="detail-rayon" value="${article.rayon || ''}" placeholder="Rayon" maxlength="60">
    </div>
    <div class="form-group">
      <label class="form-label">Prix estimé (€)</label>
      <input type="number" class="input" id="detail-prix" value="${article.prixEstime || ''}" step="0.01" min="0">
    </div>
    <div class="form-group">
      <label class="form-label">Badge forcé</label>
      <select class="input" id="detail-badge-force">
        <option value="">Auto (par défaut)</option>
        <option value="eviter" ${article.badgeForce === 'eviter' ? 'selected' : ''}>⛔ Éviter</option>
        <option value="surveiller" ${article.badgeForce === 'surveiller' ? 'selected' : ''}>⚠️ Surveiller</option>
        <option value="ok" ${article.badgeForce === 'ok' ? 'selected' : ''}>✅ OK</option>
      </select>
    </div>
  `;

  // Save handler
  const saveBtn = document.getElementById('detail-save');
  const deleteBtn = document.getElementById('detail-delete');
  const newSave = saveBtn.cloneNode(true);
  const newDelete = deleteBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSave, saveBtn);
  deleteBtn.parentNode.replaceChild(newDelete, deleteBtn);

  newSave.addEventListener('click', async () => {
    const fid = getFoyerId();
    const badgeForce = document.getElementById('detail-badge-force').value || null;
    const nom = document.getElementById('detail-nom').value.trim();
    const badge = computeBadge(nom, badgeForce);
    try {
      await updateDoc(doc(db, 'foyers', fid, 'courses', id), {
        nom,
        quantite: parseFloat(document.getElementById('detail-qty').value) || 1,
        unite: document.getElementById('detail-unite').value.trim(),
        magasin: document.getElementById('detail-magasin').value,
        rayon: document.getElementById('detail-rayon').value.trim(),
        prixEstime: parseFloat(document.getElementById('detail-prix').value) || 0,
        badgeForce,
        badge
      });
      dialog.close();
    } catch (e) {
      console.error('Save detail error:', e);
    }
  });

  newDelete.addEventListener('click', async () => {
    if (!confirm('Supprimer cet article ?')) return;
    try {
      await deleteDoc(doc(db, 'foyers', getFoyerId(), 'courses', id));
      dialog.close();
    } catch (e) {
      console.error('Delete error:', e);
    }
  });

  dialog.showModal();
}

async function loadSemaineType() {
  try {
    const resp = await fetch('./data/modele-grossesse.json');
    const modele = await resp.json();

    // Check existing articles
    const existingNames = new Set(articles.map(a => a.nom.toLowerCase()));
    const toAdd = modele.filter(m => !existingNames.has(m.nom.toLowerCase()));

    if (toAdd.length === 0) {
      alert('Tous les articles de la semaine type sont déjà dans la liste !');
      return;
    }

    if (!confirm(`Ajouter ${toAdd.length} article(s) de la semaine type ?`)) return;

    for (const item of toAdd) {
      await addArticle({
        nom: item.nom,
        quantite: 1,
        unite: item.unite,
        magasin: item.magasin,
        rayon: item.rayon,
        prixEstime: item.prixEstime
      });
    }
  } catch (e) {
    console.error('loadSemaineType error:', e);
    alert('Erreur de chargement du modèle.');
  }
}

async function terminerCourses() {
  const checked = articles.filter(a => a.checked);
  if (checked.length === 0) return;
  if (!confirm(`Terminer les courses ? (${checked.length} article(s) acheté(s))`)) return;

  const fid = getFoyerId();
  const now = new Date();
  const mois = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Group by magasin
  const byMagasin = {};
  for (const a of checked) {
    const mag = a.magasin || 'Autre';
    if (!byMagasin[mag]) byMagasin[mag] = [];
    byMagasin[mag].push(a);
  }

  // Create achat documents
  for (const [mag, items] of Object.entries(byMagasin)) {
    const total = items.reduce((s, a) => s + ((a.prixReel != null ? a.prixReel : a.prixEstime) || 0) * (a.quantite || 1), 0);
    const achatId = crypto.randomUUID();
    await setDoc(doc(db, 'foyers', fid, 'achats', achatId), {
      magasin: mag,
      mois,
      date: now.toISOString(),
      total,
      articles: items.map(a => ({
        nom: a.nom,
        quantite: a.quantite,
        prixReel: a.prixReel,
        prixEstime: a.prixEstime
      })),
      createdAt: serverTimestamp()
    });
  }

  // Kit-origin items: prompt for expiry
  const kitItems = checked.filter(a => a.kitOriginId);
  for (const item of kitItems) {
    await promptExpiryAndAddToStock(item);
  }

  // Remove checked items from courses
  for (const a of checked) {
    await deleteDoc(doc(db, 'foyers', fid, 'courses', a.id));
  }
}

function promptExpiryAndAddToStock(article) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('dialog-expiry');
    const nameEl = document.getElementById('expiry-article-name');
    const dateInput = document.getElementById('expiry-date-input');
    const saveBtn = document.getElementById('expiry-save');
    const skipBtn = document.getElementById('expiry-skip');

    nameEl.textContent = article.nom;
    dateInput.value = '';

    const cleanup = () => {
      dialog.close();
      newSave.removeEventListener('click', onSave);
      newSkip.removeEventListener('click', onSkip);
    };

    const newSave = saveBtn.cloneNode(true);
    const newSkip = skipBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSave, saveBtn);
    skipBtn.parentNode.replaceChild(newSkip, skipBtn);

    const onSave = async () => {
      const dateVal = dateInput.value;
      await addLotToStock(article.kitOriginId, article.quantite || 1, dateVal || null);
      cleanup();
      resolve();
    };

    const onSkip = async () => {
      await addLotToStock(article.kitOriginId, article.quantite || 1, null);
      cleanup();
      resolve();
    };

    newSave.addEventListener('click', onSave);
    newSkip.addEventListener('click', onSkip);
    dialog.showModal();
  });
}

async function addLotToStock(productId, quantite, datePeremption) {
  const fid = getFoyerId();
  if (!fid || !productId) return;
  try {
    const stockRef = doc(db, 'foyers', fid, 'stock', productId);
    const snap = await getDoc(stockRef);
    if (!snap.exists()) return;
    const data = snap.data();
    const lots = data.lots || [];
    lots.push({
      id: crypto.randomUUID(),
      quantite: quantite,
      datePeremption: datePeremption,
      ajouteLe: new Date().toISOString()
    });
    await updateDoc(stockRef, { lots });
  } catch (e) {
    console.error('addLotToStock error:', e);
  }
}

export function destroyCourses() {
  if (unsubCourses) { unsubCourses(); unsubCourses = null; }
}

// Re-export for other modules
export { addArticle };
