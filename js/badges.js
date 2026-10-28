// Badge Engine — Pregnancy food safety badge computation

let guideData = null;
let articleRules = [];

// Normalize text: lowercase, strip accents, trim
function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .trim();
}

// Simple depluralize (French)
function depluralize(word) {
  if (word.endsWith('aux')) return word.slice(0, -3) + 'al';
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

// Load guide data
export async function loadGuideData() {
  if (guideData) return guideData;
  try {
    const resp = await fetch('./data/guide.json');
    guideData = await resp.json();
    articleRules = guideData.filter(e => e.type === 'article');
  } catch (e) {
    console.error('Failed to load guide.json:', e);
    guideData = [];
    articleRules = [];
  }
  return guideData;
}

// Get toxo status from settings
function getToxoStatus() {
  return localStorage.getItem('toxoStatus') || 'non-immunisee';
}

// Qualifier escalation detection
function hasEscalatingQualifier(normalizedText) {
  const escalators = ['fume', 'cru', 'crue', 'tartare', 'saignant', 'saignante', 'bleu', 'bleue'];
  return escalators.some(q => normalizedText.includes(q));
}

// Qualificatifs "forts" : peuvent baisser un 'surveiller' → 'ok' (cuisson/stérilisation)
function hasStrongDeescalatingQualifier(normalizedText) {
  const strong = ['cuit', 'cuite', 'cuits', 'cuites', 'en conserve', 'conserve'];
  return strong.some(q => normalizedText.includes(q));
}

// Qualificatifs "faibles" : permettent de chercher une règle OK plus spécifique,
// mais ne baissent PAS automatiquement un surveiller → ok
function hasDeescalatingQualifier(normalizedText) {
  const weak = ['pasteurise', 'pasteurisee'];
  return hasStrongDeescalatingQualifier(normalizedText) ||
         weak.some(q => normalizedText.includes(q));
}

/**
 * Compute badge level for a given article name.
 * @param {string} articleName - The name of the food item
 * @param {string|null} badgeForce - Forced badge override (eviter, surveiller, ok, null)
 * @returns {string|null} - 'eviter', 'surveiller', 'ok', or null
 */
export function computeBadge(articleName, badgeForce = null) {
  // badgeForce always wins
  if (badgeForce) return badgeForce;
  if (!articleName || !articleRules.length) return null;

  const normalizedInput = normalize(articleName);
  // Also try depluralized words
  const words = normalizedInput.split(/\s+/);
  const depluralizedInput = words.map(depluralize).join(' ');

  let bestMatch = null;
  let bestMatchLength = 0;

  for (const rule of articleRules) {
    for (const keyword of rule.motsCles) {
      const normalizedKeyword = normalize(keyword);
      // Check if any keyword is found in the normalized input or depluralized input
      if (normalizedInput.includes(normalizedKeyword) || depluralizedInput.includes(normalizedKeyword)) {
        // Pick the longest (most specific) match
        if (normalizedKeyword.length > bestMatchLength) {
          bestMatch = rule;
          bestMatchLength = normalizedKeyword.length;
        }
      }
    }
  }

  if (!bestMatch) return null;

  // Exclusion: if the input contains an excluded keyword, skip this rule
  if (bestMatch.motsClesExclus && bestMatch.motsClesExclus.some(k => normalizedInput.includes(normalize(k)))) {
    return null;
  }

  let niveau = bestMatch.niveau;

  // Handle toxoDependent rules
  if (bestMatch.toxoDependent) {
    const toxo = getToxoStatus();
    if (toxo === 'immunisee') return null;
    return 'surveiller';
  }

  // Qualifier escalation: "fume", "cru", "tartare", "saignant" → escalate to eviter
  if (hasEscalatingQualifier(normalizedInput) && niveau !== 'eviter') {
    niveau = 'eviter';
  }

  // Qualifier de-escalation: "cuit", "en conserve", "pasteurisé" → can lower
  if (hasDeescalatingQualifier(normalizedInput)) {
    // Check if there's a more specific OK rule matching the full text
    // For "sardines en conserve", the specific rule is OK
    // If the best match is already ok, keep it
    // If the best match is surveiller and text says "cuit"/"conserve", check for ok rule
    if (niveau === 'eviter' || niveau === 'surveiller') {
      // Look for a matching OK rule specifically
      for (const rule of articleRules) {
        if (rule.niveau !== 'ok') continue;
        for (const keyword of rule.motsCles) {
          const nk = normalize(keyword);
          if (normalizedInput.includes(nk) && nk.length > bestMatchLength * 0.5) {
            // Found a more relevant OK match
            return 'ok';
          }
        }
      }
      // Seulement les qualificatifs forts (cuit, en conserve) baissent surveiller → ok
      // "pasteurisé" seul ne suffit pas (ex: camembert pasteurisé reste ⚠️)
      // Exception : si le mot-clé matché encode déjà le qualificatif (ex: "crevettes cuites"),
      // le niveau est intentionnel — ne pas le baisser.
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

/**
 * Return HTML badge markup for a given level.
 */
export function getBadgeHtml(niveau) {
  if (!niveau) return '';
  const map = {
    eviter: '<span class="badge badge--eviter" aria-label="À éviter">⛔ Éviter</span>',
    surveiller: '<span class="badge badge--surveiller" aria-label="À surveiller">⚠️ Surveiller</span>',
    ok: '<span class="badge badge--ok" aria-label="OK en grossesse">✅ OK</span>'
  };
  return map[niveau] || '';
}

/**
 * Get full rule info for an article name (for detail display).
 */
export function getRuleInfo(articleName) {
  if (!articleName || !articleRules.length) return null;
  const normalizedInput = normalize(articleName);
  const words = normalizedInput.split(/\s+/);
  const depluralizedInput = words.map(depluralize).join(' ');

  let bestMatch = null;
  let bestMatchLength = 0;

  for (const rule of articleRules) {
    for (const keyword of rule.motsCles) {
      const normalizedKeyword = normalize(keyword);
      if (normalizedInput.includes(normalizedKeyword) || depluralizedInput.includes(normalizedKeyword)) {
        if (normalizedKeyword.length > bestMatchLength) {
          bestMatch = rule;
          bestMatchLength = normalizedKeyword.length;
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Run built-in tests to validate badge engine.
 */
export function runTests() {
  const tests = [
    { input: 'camembert au lait cru', expected: 'eviter', toxo: 'non-immunisee' },
    { input: 'camembert pasteurisé', expected: 'surveiller', toxo: 'non-immunisee' },
    { input: 'saumon fumé', expected: 'eviter', toxo: 'non-immunisee' },
    { input: 'saumon', expected: 'surveiller', toxo: 'non-immunisee' },
    { input: 'sardines en conserve', expected: 'ok', toxo: 'non-immunisee' },
    { input: 'steak haché', expected: 'surveiller', toxo: 'non-immunisee' },
    { input: 'jambon cru', expected: 'eviter', toxo: 'non-immunisee' },
    { input: 'jambon blanc', expected: 'ok', toxo: 'non-immunisee' },
    { input: 'tomates', expected: 'surveiller', toxo: 'non-immunisee' },
    { input: 'tomates', expected: null, toxo: 'immunisee' },
    { input: 'piles AA', expected: null, toxo: 'non-immunisee' }
  ];

  const results = [];
  for (const t of tests) {
    localStorage.setItem('toxoStatus', t.toxo);
    const result = computeBadge(t.input);
    const pass = result === t.expected;
    results.push({
      input: t.input,
      toxo: t.toxo,
      expected: t.expected,
      got: result,
      pass
    });
    if (!pass) {
      console.warn(`FAIL: "${t.input}" (toxo=${t.toxo}) → expected ${t.expected}, got ${result}`);
    }
  }

  // Restore default
  localStorage.setItem('toxoStatus', 'non-immunisee');

  const passed = results.filter(r => r.pass).length;
  console.log(`Badge tests: ${passed}/${results.length} passed`);
  return results;
}
