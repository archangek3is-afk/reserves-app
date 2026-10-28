/**
 * Tests de sécurité des règles Firestore — @firebase/rules-unit-testing v6
 *
 * Prérequis : Java 11+ installé, puis lancer :
 *   node_modules/.bin/firebase emulators:start --only firestore &
 *   node tests/rules.test.mjs
 *
 * Ou en une commande :
 *   node_modules/.bin/firebase emulators:exec --only firestore "node tests/rules.test.mjs"
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  arrayUnion,
} from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(join(__dirname, '../firestore.rules'), 'utf-8');

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

let passed = 0;
let failed = 0;
const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    passed++;
  } catch (e) {
    results.push({ name, ok: false, error: e.message || String(e) });
    failed++;
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────
const testEnv = await initializeTestEnvironment({
  projectId: 'reserves-test',
  firestore: { host: '127.0.0.1', port: 8080, rules },
});

const FOYER_ID  = 'foyer_test_001';
const UID_A     = 'uid_alice';
const UID_B     = 'uid_bob';
const UID_X     = 'uid_stranger';
const CODE      = 'ABCD12';   // bon code
const BAD_CODE  = 'ZZZZZZ';  // mauvais code

// Seed : foyer avec Alice seule, code valide
async function seedFoyerAlice() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'foyers', FOYER_ID), {
      nom: 'Test',
      membres: [UID_A],
      prenoms: { [UID_A]: 'Alice' },
      codeActif: CODE,
      creeLe: new Date().toISOString(),
    });
    await setDoc(doc(db, 'codes', CODE), { foyerId: FOYER_ID });
  });
}

// Seed : foyer avec Alice + Bob
async function seedFoyerAliceBob() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'foyers', FOYER_ID), {
      nom: 'Test',
      membres: [UID_A, UID_B],
      prenoms: { [UID_A]: 'Alice', [UID_B]: 'Bob' },
      codeActif: CODE,
      creeLe: new Date().toISOString(),
    });
    await setDoc(doc(db, 'codes', CODE), { foyerId: FOYER_ID });
  });
}

// ─── Tests cahier des charges (4 requis) ─────────────────────────────────────

await seedFoyerAlice();

// 1. Un inconnu ne lit aucun foyer
await test('CDC 1 — Inconnu : lecture foyer refusée', async () => {
  const ctx = testEnv.authenticatedContext(UID_X);
  await assertFails(getDoc(doc(ctx.firestore(), 'foyers', FOYER_ID)));
});

// 2. Listage de la collection codes refusé
await test('CDC 2 — Listage collection codes refusé (authentifié)', async () => {
  const ctx = testEnv.authenticatedContext(UID_X);
  await assertFails(getDocs(collection(ctx.firestore(), 'codes')));
});

// 3. Listage codes refusé pour non-authentifié
await test('CDC 3 — Listage collection codes refusé (non-authentifié)', async () => {
  const ctx = testEnv.unauthenticatedContext();
  await assertFails(getDocs(collection(ctx.firestore(), 'codes')));
});

// ─── Tests supplémentaires sécurité ──────────────────────────────────────────

// 4. Non-authentifié : lecture foyer refusée
await test('Sec 1 — Non-authentifié : lecture foyer refusée', async () => {
  const ctx = testEnv.unauthenticatedContext();
  await assertFails(getDoc(doc(ctx.firestore(), 'foyers', FOYER_ID)));
});

// 5. Jonction avec bon code → acceptée
await test('Sec 2 — Jonction avec bon code : acceptée', async () => {
  const ctx = testEnv.authenticatedContext(UID_B);
  const db  = ctx.firestore();
  // Step 1 : lire le code (autorisé)
  const snap = await assertSucceeds(getDoc(doc(db, 'codes', CODE)));
  const foyerId = snap.data().foyerId;
  // Step 2 : mettre à jour le foyer en s'ajoutant soi-même avec codeJonction
  await assertSucceeds(
    updateDoc(doc(db, 'foyers', foyerId), {
      membres: arrayUnion(UID_B),
      [`prenoms.${UID_B}`]: 'Bob',
      codeJonction: CODE,
    })
  );
});

// 6. Jonction avec mauvais code → refusée
await seedFoyerAlice(); // remettre à l'état initial
await test('Sec 3 — Jonction avec mauvais code : refusée', async () => {
  const ctx = testEnv.authenticatedContext(UID_X);
  const db  = ctx.firestore();
  // Le code n'existe pas → get() retourne vide (pas d'erreur), mais
  // le client ne peut pas récupérer le foyerId → on vérifie aussi
  // qu'une tentative directe avec le mauvais code est refusée
  await assertFails(
    updateDoc(doc(db, 'foyers', FOYER_ID), {
      membres: arrayUnion(UID_X),
      [`prenoms.${UID_X}`]: 'Étranger',
      codeJonction: BAD_CODE,  // mauvais code
    })
  );
});

// 7. Membre qui retire l'autre → refusé
await seedFoyerAliceBob();
await test('CDC 4 — Membre A retire membre B : refusé', async () => {
  const ctx = testEnv.authenticatedContext(UID_A);
  const db  = ctx.firestore();
  // Alice essaie d'écrire membres = [UID_A] seulement
  await assertFails(
    setDoc(doc(db, 'foyers', FOYER_ID), {
      nom: 'Test',
      membres: [UID_A],
      prenoms: { [UID_A]: 'Alice' },
      codeActif: CODE,
      creeLe: new Date().toISOString(),
    })
  );
});

// 8. Membre qui ajoute un tiers sans code → refusé
await seedFoyerAlice();
await test('Sec 4 — Membre A ajoute UID_X sans code valide : refusé', async () => {
  const ctx = testEnv.authenticatedContext(UID_A);
  const db  = ctx.firestore();
  // Alice essaie d'ajouter un tiers (pas de codeJonction)
  await assertFails(
    updateDoc(doc(db, 'foyers', FOYER_ID), {
      membres: arrayUnion(UID_X),
      [`prenoms.${UID_X}`]: 'Tiers',
    })
  );
});

// 9. Membre qui se retire lui-même → accepté
await seedFoyerAliceBob();
await test('Sec 5 — Membre B se retire lui-même : accepté', async () => {
  const ctx = testEnv.authenticatedContext(UID_B);
  const db  = ctx.firestore();
  await assertSucceeds(
    setDoc(doc(db, 'foyers', FOYER_ID), {
      nom: 'Test',
      membres: [UID_A],              // UID_B retiré
      prenoms: { [UID_A]: 'Alice' },
      codeActif: CODE,
      creeLe: new Date().toISOString(),
    })
  );
});

// 10. Création d'un code déjà existant → refusée
await test('Sec 6 — Création code déjà existant : refusée', async () => {
  // Alice (membre) essaie de créer codes/CODE alors qu'il existe déjà
  const ctx = testEnv.authenticatedContext(UID_A);
  const db  = ctx.firestore();
  await assertFails(
    setDoc(doc(db, 'codes', CODE), { foyerId: FOYER_ID })
  );
});

// 11. Membre lit les sous-collections → autorisé
await seedFoyerAlice();
await test('Sec 7 — Membre lit sous-collection courses : autorisé', async () => {
  const ctx = testEnv.authenticatedContext(UID_A);
  await assertSucceeds(
    getDocs(collection(ctx.firestore(), 'foyers', FOYER_ID, 'courses'))
  );
});

// 12. Inconnu lit les sous-collections → refusé
await test('Sec 8 — Inconnu lit sous-collection courses : refusé', async () => {
  const ctx = testEnv.authenticatedContext(UID_X);
  await assertFails(
    getDocs(collection(ctx.firestore(), 'foyers', FOYER_ID, 'courses'))
  );
});

// ─── Tests sous-collections (écriture depuis courses.js) ─────────────────────

await seedFoyerAlice();

// 13. Membre crée un article courses avec exactement les champs de addArticle()
//     (prixReel:null, badge:null, badgeForce:null, kitOriginId:null…)
await test('Sub 1 — Membre crée un article courses (champs null) : accepté', async () => {
  const ctx = testEnv.authenticatedContext(UID_A);
  const db  = ctx.firestore();
  await assertSucceeds(
    setDoc(doc(db, 'foyers', FOYER_ID, 'courses', 'article_test_001'), {
      nom: 'Lait',
      quantite: 1,
      unite: '',
      magasin: '',
      rayon: '',
      prixEstime: 0,
      prixReel: null,
      badge: null,
      badgeForce: null,
      checked: false,
      checkedBy: null,
      checkedByPrenom: null,
      kitOriginId: null,
    })
  );
});

// 14. Membre coche un article (toggleChecked)
await test('Sub 2 — Membre coche un article (checked:true) : accepté', async () => {
  const ctx = testEnv.authenticatedContext(UID_A);
  const db  = ctx.firestore();
  await assertSucceeds(
    updateDoc(doc(db, 'foyers', FOYER_ID, 'courses', 'article_test_001'), {
      checked: true,
      checkedBy: UID_A,
      checkedByPrenom: 'Alice',
    })
  );
});

// 15. Membre ajoute un lot dans stock (datePeremption:null)
await test('Sub 3 — Membre ajoute un lot stock (datePeremption:null) : accepté', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'foyers', FOYER_ID, 'stock', 'prod_001'), {
      nom: 'Lait UHT', lots: [],
    });
  });
  const ctx = testEnv.authenticatedContext(UID_A);
  const db  = ctx.firestore();
  await assertSucceeds(
    updateDoc(doc(db, 'foyers', FOYER_ID, 'stock', 'prod_001'), {
      lots: [{ id: 'lot_001', quantite: 2, datePeremption: null, ajouteLe: new Date().toISOString() }],
    })
  );
});

// 16. Membre crée un achat avec prixReel:null dans les articles
await test('Sub 4 — Membre crée un achat (prixReel:null) : accepté', async () => {
  const ctx = testEnv.authenticatedContext(UID_A);
  const db  = ctx.firestore();
  await assertSucceeds(
    setDoc(doc(db, 'foyers', FOYER_ID, 'achats', 'achat_001'), {
      magasin: 'Carrefour',
      mois: '2026-10',
      date: new Date().toISOString(),
      total: 3.50,
      articles: [{ nom: 'Lait', quantite: 1, prixReel: null, prixEstime: 0 }],
    })
  );
});

// 17. Inconnu ne peut pas écrire dans courses
await test('Sub 5 — Inconnu crée un article courses : refusé', async () => {
  const ctx = testEnv.authenticatedContext(UID_X);
  const db  = ctx.firestore();
  await assertFails(
    setDoc(doc(db, 'foyers', FOYER_ID, 'courses', 'article_stranger'), {
      nom: 'Pain', quantite: 1,
    })
  );
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────
await testEnv.cleanup();

// ─── Rapport ─────────────────────────────────────────────────────────────────
console.log('\n' + BOLD + '═══ Tests règles Firestore ═══' + RESET + '\n');
for (const r of results) {
  const icon = r.ok ? GREEN + '✓' + RESET : RED + '✗' + RESET;
  console.log(`  ${icon} ${r.name}`);
  if (!r.ok) console.log(`    ${DIM}${r.error?.split('\n')[0]}${RESET}`);
}
console.log('');
const color = failed === 0 ? GREEN : RED;
console.log(
  '  ' + BOLD + color +
  `Résultat : ${passed}/${results.length} tests passés` +
  (failed > 0 ? ` — ${failed} ÉCHEC(S)` : '') +
  RESET + '\n'
);
process.exit(failed > 0 ? 1 : 0);
