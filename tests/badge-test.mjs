/**
 * Test runner pour le moteur de badges (Node.js, pas de navigateur).
 * Simule localStorage et fetch pour faire tourner badges.js hors navigateur.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const guideJson = JSON.parse(
  readFileSync(join(__dirname, '../data/guide.json'), 'utf-8')
);

// --- Simulations navigateur ---
const _localStorage = {};
global.localStorage = {
  getItem: (k) => _localStorage[k] ?? null,
  setItem: (k, v) => { _localStorage[k] = v; },
  removeItem: (k) => { delete _localStorage[k]; }
};

// --- Copie inline de la logique badges.js (sans import/fetch) ---

function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .trim();
}

function depluralize(word) {
  if (word.endsWith('aux')) return word.slice(0, -3) + 'al';
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const articleRules = guideJson.filter(e => e.type === 'article');

function getToxoStatus() {
  return localStorage.getItem('toxoStatus') || 'non-immunisee';
}

function hasEscalatingQualifier(t) {
  return ['fume', 'cru', 'crue', 'tartare', 'saignant', 'saignante', 'bleu', 'bleue']
    .some(q => t.includes(q));
}

function hasStrongDeescalatingQualifier(t) {
  return ['cuit', 'cuite', 'cuits', 'cuites', 'en conserve', 'conserve']
    .some(q => t.includes(q));
}
function hasDeescalatingQualifier(t) {
  return hasStrongDeescalatingQualifier(t) ||
    ['pasteurise', 'pasteurisee'].some(q => t.includes(q));
}

function computeBadge(articleName, badgeForce = null) {
  if (badgeForce) return badgeForce;
  if (!articleName || !articleRules.length) return null;

  const normalizedInput = normalize(articleName);
  const words = normalizedInput.split(/\s+/);
  const depluralizedInput = words.map(depluralize).join(' ');

  let bestMatch = null;
  let bestMatchLength = 0;

  for (const rule of articleRules) {
    for (const keyword of rule.motsCles) {
      const normalizedKeyword = normalize(keyword);
      if (
        normalizedInput.includes(normalizedKeyword) ||
        depluralizedInput.includes(normalizedKeyword)
      ) {
        if (normalizedKeyword.length > bestMatchLength) {
          bestMatch = rule;
          bestMatchLength = normalizedKeyword.length;
        }
      }
    }
  }

  if (!bestMatch) return null;

  // Exclusion : si l'entrée contient un mot-clé exclu, ignorer la règle
  if (bestMatch.motsClesExclus && bestMatch.motsClesExclus.some(k => normalizedInput.includes(normalize(k)))) {
    return null;
  }

  // Règles toxo-dépendantes
  if (bestMatch.toxoDependent) {
    const toxo = getToxoStatus();
    if (toxo === 'immunisee') return null;
    return 'surveiller';
  }

  let niveau = bestMatch.niveau;

  // Escalade : "fumé", "cru", "tartare", "saignant" → eviter
  if (hasEscalatingQualifier(normalizedInput) && niveau !== 'eviter') {
    niveau = 'eviter';
  }

  // Désescalade : "cuit", "en conserve", "pasteurisé" → peut baisser
  if (hasDeescalatingQualifier(normalizedInput)) {
    if (niveau === 'eviter' || niveau === 'surveiller') {
      // Cherche une règle OK plus spécifique
      for (const rule of articleRules) {
        if (rule.niveau !== 'ok') continue;
        for (const keyword of rule.motsCles) {
          const nk = normalize(keyword);
          if (normalizedInput.includes(nk) && nk.length > bestMatchLength * 0.5) {
            return 'ok';
          }
        }
      }
      // Seulement les qualificatifs forts baissent surveiller → ok
      // Exception : si le mot-clé matché encode déjà le qualificatif, le niveau est intentionnel
      const matchedKeywordHasQualifier = bestMatch.motsCles.some(
        k => hasStrongDeescalatingQualifier(normalize(k))
      );
      if (niveau === 'surveiller' && hasStrongDeescalatingQualifier(normalizedInput) && !matchedKeywordHasQualifier) {
        niveau = 'ok';
      }
    }
  }

  return niveau;
}

// --- Cas de test du cahier des charges (+ cas 11 bonus) ---
const TESTS = [
  // ── Cas cahier des charges (11) ──────────────────────────────────────────
  { input: 'camembert au lait cru',   expected: 'eviter',     toxo: 'non-immunisee' },
  { input: 'camembert pasteurisé',    expected: 'surveiller', toxo: 'non-immunisee' },
  { input: 'saumon fumé',             expected: 'eviter',     toxo: 'non-immunisee' },
  { input: 'saumon',                  expected: 'surveiller', toxo: 'non-immunisee' },
  { input: 'sardines en conserve',    expected: 'ok',         toxo: 'non-immunisee' },
  { input: 'steak haché',             expected: 'surveiller', toxo: 'non-immunisee' },
  { input: 'jambon cru',              expected: 'eviter',     toxo: 'non-immunisee' },
  { input: 'jambon blanc',            expected: 'ok',         toxo: 'non-immunisee' },
  { input: 'tomates',                 expected: 'surveiller', toxo: 'non-immunisee' },
  { input: 'tomates',                 expected: null,         toxo: 'immunisee'     },
  { input: 'piles AA',                expected: null,         toxo: 'non-immunisee' },
  // ── Nouveaux cas (décisions du 28/10/2026) ──────────────────────────────
  { input: 'espadon',                 expected: 'eviter',     toxo: 'non-immunisee' },
  { input: 'thon en boîte',           expected: 'surveiller', toxo: 'non-immunisee' },
  { input: 'comté',                   expected: 'ok',         toxo: 'non-immunisee' },
  { input: 'Red Bull',                expected: 'eviter',     toxo: 'non-immunisee' },
  { input: 'tofu',                    expected: 'surveiller', toxo: 'non-immunisee' },
  { input: 'sauce soja',              expected: null,         toxo: 'non-immunisee' },
  // ── Nouveaux cas (décisions du 28/10/2026 v2) ───────────────────────────
  { input: 'fromage râpé',            expected: 'eviter',     toxo: 'non-immunisee' },
  { input: 'foie gras',               expected: 'eviter',     toxo: 'non-immunisee' },
  { input: 'saucisson',               expected: 'eviter',     toxo: 'non-immunisee' },
  { input: 'crevettes cuites',        expected: 'surveiller', toxo: 'non-immunisee' },
];

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';

let passed = 0;
let failed = 0;

console.log('\n' + BOLD + '═══ Tests moteur de badges (badges.js) ═══' + RESET + '\n');
console.log(
  DIM + '  #  Article                    toxo              attendu      résultat     statut' + RESET
);
console.log(DIM + '  ' + '─'.repeat(78) + RESET);

for (let i = 0; i < TESTS.length; i++) {
  const t = TESTS[i];
  localStorage.setItem('toxoStatus', t.toxo);
  const result = computeBadge(t.input);
  const ok = result === t.expected;
  ok ? passed++ : failed++;

  const num    = String(i + 1).padStart(2);
  const article = t.input.padEnd(28);
  const toxo    = t.toxo.padEnd(17);
  const exp     = String(t.expected).padEnd(12);
  const got     = String(result).padEnd(12);
  const status  = ok ? GREEN + '✓ PASS' + RESET : RED + '✗ FAIL' + RESET;

  console.log(`  ${num}  ${article} ${toxo} ${exp} ${got} ${status}`);

  if (!ok) {
    // Show which rule matched
    const ni = normalize(t.input);
    const matched = articleRules.filter(r =>
      r.motsCles.some(k => ni.includes(normalize(k)))
    ).map(r => `${r.id}(${r.niveau})`);
    console.log(
      RED + `      → règles correspondantes : ` +
      (matched.length ? matched.join(', ') : '(aucune)') + RESET
    );
  }
}

localStorage.setItem('toxoStatus', 'non-immunisee');

console.log('\n' + DIM + '  ' + '─'.repeat(78) + RESET);
const color = failed === 0 ? GREEN : RED;
console.log(
  '\n  ' + BOLD + color +
  `Résultat : ${passed}/${TESTS.length} tests passés` +
  (failed > 0 ? ` — ${failed} ÉCHEC(S)` : '') +
  RESET + '\n'
);

if (failed > 0) process.exit(1);
