// Guide Screen — Pregnancy food safety guide
import { loadGuideData, computeBadge, getBadgeHtml, getRuleInfo } from './badges.js';

let guideData = [];

export async function renderGuide(container) {
  guideData = await loadGuideData();

  const articles = guideData.filter(e => e.type === 'article');
  const fiches = guideData.filter(e => e.type === 'fiche');

  container.innerHTML = `
    <div class="screen screen--active" id="screen-guide">
      <div class="screen-header">
        <h1 class="screen-header__title">Guide grossesse</h1>
        <p class="text-sm text-muted">Recherche un aliment pour savoir s'il est autorisé.</p>
      </div>

      <div class="search-bar">
        <span class="search-bar__icon">🔍</span>
        <input type="text" class="input" id="guide-search" placeholder="Rechercher un aliment..." autocomplete="off" style="padding-left:40px;">
      </div>

      <div id="guide-results"></div>

      <div id="guide-fiches">
        <h2 class="section-title">Fiches pratiques</h2>
        ${fiches.map(f => renderFiche(f)).join('')}
      </div>
    </div>
  `;

  // Search handler
  const searchInput = document.getElementById('guide-search');
  searchInput.addEventListener('input', () => {
    const val = searchInput.value.trim();
    const resultsEl = document.getElementById('guide-results');
    const fichesEl = document.getElementById('guide-fiches');

    if (val.length < 2) {
      resultsEl.innerHTML = '';
      fichesEl.style.display = '';
      return;
    }

    fichesEl.style.display = 'none';
    const badge = computeBadge(val);
    const rule = getRuleInfo(val);

    let html = '';

    if (badge || rule) {
      html += `<div class="card animate-slide-up">`;
      html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">`;
      html += `<span style="font-size:1.1rem;font-weight:700;">${val}</span>`;
      html += getBadgeHtml(badge);
      html += `</div>`;

      if (rule) {
        if (rule.raison) html += `<p style="margin-bottom:6px;">${rule.raison}</p>`;
        if (rule.alternative) html += `<p style="margin-bottom:6px;"><strong>Alternative :</strong> ${rule.alternative}</p>`;
        if (rule.risque) html += `<p class="text-sm text-muted">Risque : ${rule.risque}</p>`;
        if (rule.source) html += `<p class="text-sm"><a href="${rule.source}" target="_blank" rel="noopener" style="color:var(--accent);">Source</a></p>`;
        if (rule.toxoDependent) {
          const toxo = localStorage.getItem('toxoStatus') || 'non-immunisee';
          if (toxo === 'immunisee') {
            html += `<div class="alert-banner alert-banner--info mt-12">Tu es immunisée contre la toxoplasmose : pas de restriction pour cet aliment.</div>`;
          } else {
            html += `<div class="alert-banner alert-banner--warning mt-12">Non immunisée toxo : bien laver et/ou éplucher avant de consommer.</div>`;
          }
        }
      }

      html += `<div class="fiche-card__warning mt-12">En cas de doute, demande à ta sage-femme.</div>`;
      html += `</div>`;
    } else {
      html += `<div class="card animate-slide-up">`;
      html += `<p><strong>${val}</strong></p>`;
      html += `<p class="text-muted">Aucune information spécifique trouvée pour cet aliment. Il est probablement sans risque particulier.</p>`;
      html += `<div class="fiche-card__warning mt-12">En cas de doute, demande à ta sage-femme.</div>`;
      html += `</div>`;
    }

    // Also show matching articles list
    const lower = val.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');
    const matches = articles.filter(a =>
      a.motsCles.some(k => k.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().includes(lower)) ||
      a.id.includes(lower)
    ).slice(0, 10);

    if (matches.length > 0) {
      html += `<h2 class="section-title mt-16">Résultats liés</h2>`;
      for (const m of matches) {
        html += `<div class="article-row" style="border:1px solid var(--border-light);border-radius:var(--radius-sm);margin-bottom:6px;">`;
        html += `<div class="article-row__content" style="padding:8px 12px;">`;
        html += `<div class="article-row__name">${m.motsCles[0]} ${getBadgeHtml(m.niveau)}</div>`;
        html += `<div class="article-row__details">${m.raison ? m.raison.substring(0, 80) + '...' : ''}</div>`;
        html += `</div></div>`;
      }
    }

    resultsEl.innerHTML = html;
  });
}

function renderFiche(fiche) {
  // Convert markdown-like bold to HTML
  const content = fiche.contenu
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<br>• $1');

  return `
    <div class="fiche-card">
      <div class="fiche-card__title">${fiche.titre}</div>
      <div class="fiche-card__content">${content}</div>
      ${fiche.source ? `<div class="fiche-card__source">Source : <a href="${fiche.source}" target="_blank" rel="noopener">${new URL(fiche.source).hostname}</a></div>` : ''}
      ${fiche.avertissement ? `<div class="fiche-card__warning">${fiche.avertissement}</div>` : ''}
    </div>
  `;
}

export function destroyGuide() {
  // No subscriptions to clean up
}
