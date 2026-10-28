// Réglages (Settings) screen
import {
  db, getFoyerId, getCurrentUser,
  doc, getDoc, updateDoc, getDocs, collection, serverTimestamp
} from './firebase.js';
import { getFoyerInfo, regenererCode, getPrenom } from './foyer.js';

let magasins = [];

async function loadMagasins() {
  try {
    const resp = await fetch('./data/magasins.json');
    magasins = await resp.json();
  } catch { magasins = []; }
}

function formatDate(d) {
  if (!d) return '—';
  const date = d.toDate ? d.toDate() : new Date(d);
  return date.toLocaleDateString('fr-FR');
}

export async function renderReglages(container) {
  await loadMagasins();
  const foyer = await getFoyerInfo();
  const user = getCurrentUser();
  const toxo = localStorage.getItem('toxoStatus') || 'non-immunisee';
  const theme = localStorage.getItem('theme') || 'auto';
  const budgetMensuel = foyer?.budgetMensuel || localStorage.getItem('budgetMensuel') || 400;

  container.innerHTML = `
    <div class="screen screen--active" id="screen-reglages">
      <div class="screen-header">
        <h1 class="screen-header__title">Réglages</h1>
      </div>

      <div class="card">
        <div class="card__title">Foyer</div>
        ${foyer ? `
          <div class="flex-between mb-12">
            <span>Membres</span>
            <span class="text-muted">${foyer.membres ? foyer.membres.length : 0} personne(s)</span>
          </div>
          ${foyer.prenoms ? Object.entries(foyer.prenoms).map(([uid, nom]) => `
            <div class="flex-between" style="padding:4px 0;">
              <span>${nom} ${uid === user?.uid ? '(moi)' : ''}</span>
              ${uid !== user?.uid ? `<button class="btn btn--sm btn--ghost btn--danger" data-remove-uid="${uid}">Retirer</button>` : ''}
            </div>
          `).join('') : ''}
          <div class="divider"></div>
          <div class="card__title">Code d'invitation</div>
          <div class="code-display" id="foyer-code">${foyer.code || '—'}</div>
          <div class="flex-between">
            <button class="btn btn--sm btn--secondary" id="btn-copy-code">Copier</button>
            <button class="btn btn--sm btn--ghost" id="btn-regen-code">Régénérer</button>
          </div>
        ` : '<p class="text-muted">Aucun foyer configuré</p>'}
      </div>

      <div class="card">
        <div class="card__title">Grossesse</div>
        <div class="form-group">
          <label class="form-label">Statut toxoplasmose</label>
          <select class="input" id="setting-toxo">
            <option value="non-immunisee" ${toxo === 'non-immunisee' ? 'selected' : ''}>Non immunisée</option>
            <option value="immunisee" ${toxo === 'immunisee' ? 'selected' : ''}>Immunisée</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Terme prévu</label>
          <input type="date" class="input" id="setting-terme" value="${foyer?.terme || ''}">
        </div>
      </div>

      <div class="card">
        <div class="card__title">Budget mensuel</div>
        <div class="form-group">
          <label class="form-label">Montant (€)</label>
          <input type="number" class="input" id="setting-budget" value="${budgetMensuel}" min="0" step="10">
        </div>
      </div>

      <div class="card">
        <div class="card__title">Magasins</div>
        <div id="magasins-list">
          ${magasins.map(m => `
            <div class="settings-item">
              <span class="settings-item__label">${m.nom}</span>
              <span class="settings-item__value">
                ${m.horaires ? `<span class="text-sm">${m.horaires}</span>` : ''}
                ${m.mapsUrl ? `<a href="${m.mapsUrl}" target="_blank" rel="noopener" class="btn btn--sm btn--ghost">📍</a>` : ''}
              </span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card__title">Apparence</div>
        <div class="form-group">
          <label class="form-label">Thème</label>
          <select class="input" id="setting-theme">
            <option value="auto" ${theme === 'auto' ? 'selected' : ''}>Automatique</option>
            <option value="light" ${theme === 'light' ? 'selected' : ''}>Clair</option>
            <option value="dark" ${theme === 'dark' ? 'selected' : ''}>Sombre</option>
          </select>
        </div>
      </div>

      <div class="card">
        <div class="card__title">Données</div>
        <button class="btn btn--sm btn--secondary btn--full" id="btn-export-csv">Exporter en CSV</button>
      </div>

      <div class="card">
        <div class="card__title">Application</div>
        <div class="flex-between">
          <span>Version</span>
          <span class="text-muted" id="app-version-display">—</span>
        </div>
        <button class="btn btn--sm btn--secondary btn--full mt-12" id="btn-check-update">Vérifier les mises à jour</button>
      </div>
    </div>
  `;

  bindSettingsEvents(foyer);
}

function bindSettingsEvents(foyer) {
  // Copy code
  const copyBtn = document.getElementById('btn-copy-code');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const code = document.getElementById('foyer-code')?.textContent;
      if (code && navigator.clipboard) {
        navigator.clipboard.writeText(code);
        copyBtn.textContent = 'Copié !';
        setTimeout(() => copyBtn.textContent = 'Copier', 2000);
      }
    });
  }

  // Regen code
  const regenBtn = document.getElementById('btn-regen-code');
  if (regenBtn) {
    regenBtn.addEventListener('click', async () => {
      if (!confirm('Régénérer le code ? L\'ancien ne fonctionnera plus.')) return;
      try {
        const newCode = await regenererCode();
        const codeEl = document.getElementById('foyer-code');
        if (codeEl) codeEl.textContent = newCode;
      } catch (e) {
        alert('Erreur: ' + e.message);
      }
    });
  }

  // Remove members
  document.querySelectorAll('[data-remove-uid]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Retirer ce membre du foyer ?')) return;
      try {
        await retirerMembre(btn.dataset.removeUid);
        location.reload();
      } catch (e) {
        alert('Erreur: ' + e.message);
      }
    });
  });

  // Toxo
  document.getElementById('setting-toxo').addEventListener('change', async (e) => {
    const val = e.target.value;
    localStorage.setItem('toxoStatus', val);
    const fid = getFoyerId();
    if (fid) {
      try {
        await updateDoc(doc(db, 'foyers', fid), { toxoStatus: val });
      } catch (err) { console.error(err); }
    }
  });

  // Terme
  document.getElementById('setting-terme').addEventListener('change', async (e) => {
    const val = e.target.value;
    const fid = getFoyerId();
    if (fid) {
      try {
        await updateDoc(doc(db, 'foyers', fid), { terme: val || null });
      } catch (err) { console.error(err); }
    }
  });

  // Budget
  document.getElementById('setting-budget').addEventListener('change', async (e) => {
    const val = parseFloat(e.target.value) || 400;
    localStorage.setItem('budgetMensuel', val);
    const fid = getFoyerId();
    if (fid) {
      try {
        await updateDoc(doc(db, 'foyers', fid), { budgetMensuel: val });
      } catch (err) { console.error(err); }
    }
  });

  // Theme
  document.getElementById('setting-theme').addEventListener('change', (e) => {
    const val = e.target.value;
    localStorage.setItem('theme', val);
    applyTheme(val);
  });

  // Export CSV
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);

  // Check update
  document.getElementById('btn-check-update').addEventListener('click', () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) {
          reg.update();
          alert('Vérification en cours...');
        } else {
          alert('Aucun Service Worker trouvé.');
        }
      });
    }
  });

  // Version display
  const versionMeta = document.querySelector('meta[name="app-version"]');
  const versionEl = document.getElementById('app-version-display');
  if (versionEl) {
    versionEl.textContent = versionMeta ? versionMeta.content : '1.0.0';
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else if (theme === 'light') {
    root.setAttribute('data-theme', 'light');
  } else {
    root.removeAttribute('data-theme');
  }
}

async function exportCSV() {
  const fid = getFoyerId();
  if (!fid) return;

  try {
    // Export achats
    const achatsSnap = await getDocs(collection(db, 'foyers', fid, 'achats'));
    let csv = 'Date,Magasin,Article,Quantité,Prix estimé,Prix réel,Total\n';

    achatsSnap.forEach(d => {
      const data = d.data();
      const articles = data.articles || [];
      for (const a of articles) {
        csv += `"${data.date || ''}","${data.magasin || ''}","${a.nom || ''}",${a.quantite || 1},${a.prixEstime || 0},${a.prixReel || ''},${data.total || 0}\n`;
      }
    });

    // Download
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reserves-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Export error:', e);
    alert('Erreur lors de l\'export.');
  }
}

// Export applyTheme for use in app.js
export { applyTheme };
