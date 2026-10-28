// Foyer management: create, join, manage household
import {
  db, auth, getCurrentUser, waitForAuth,
  getFoyerId, setFoyerId,
  doc, getDoc, setDoc, updateDoc, getDocs,
  collection, arrayUnion, arrayRemove, serverTimestamp
} from './firebase.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(len = 6) {
  let code = '';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) {
    code += CODE_CHARS[arr[i] % CODE_CHARS.length];
  }
  return code;
}

// Check if foyer is configured
export function isFoyerConfigured() {
  return !!getFoyerId();
}

// Get foyer info from Firestore
export async function getFoyerInfo() {
  const fid = getFoyerId();
  if (!fid) return null;
  try {
    const snap = await getDoc(doc(db, 'foyers', fid));
    if (snap.exists()) return { id: fid, ...snap.data() };
    return null;
  } catch (e) {
    console.error('getFoyerInfo error:', e);
    return null;
  }
}

// Create foyer
export async function creerFoyer(prenom) {
  const user = getCurrentUser();
  if (!user) throw new Error('Non authentifié');

  const foyerId = crypto.randomUUID();
  const code = generateCode();

  // Create foyer document (codeActif = nom du champ vérifié par les règles Firestore)
  await setDoc(doc(db, 'foyers', foyerId), {
    membres: [user.uid],
    prenoms: { [user.uid]: prenom },
    codeActif: code,
    createdAt: serverTimestamp(),
    budgetMensuel: 400,
    terme: null,
    toxoStatus: 'non-immunisee',
    derniereVerifKit: null
  });

  // Create code lookup
  await setDoc(doc(db, 'codes', code), {
    foyerId: foyerId
  });

  // Import kit objectives into stock subcollection
  try {
    const resp = await fetch('./data/kit-objectif.json');
    const kitItems = await resp.json();
    for (const item of kitItems) {
      await setDoc(doc(db, 'foyers', foyerId, 'stock', item.id), {
        ...item,
        lots: [],
        checked: false // for sansPeremption items
      });
    }
  } catch (e) {
    console.error('Error importing kit:', e);
  }

  setFoyerId(foyerId);
  localStorage.setItem('prenom', prenom);
  localStorage.setItem('foyerCode', code);

  return { foyerId, code };
}

// Join foyer
export async function rejoindreFoyer(prenom, code) {
  const user = getCurrentUser();
  if (!user) throw new Error('Non authentifié');

  const codeUpper = code.toUpperCase().trim();
  const codeSnap = await getDoc(doc(db, 'codes', codeUpper));
  if (!codeSnap.exists()) {
    throw new Error('Code invalide');
  }

  const foyerId = codeSnap.data().foyerId;

  // Add self to foyer membres.
  // codeJonction est inclus pour que les règles Firestore puissent vérifier
  // que le code saisi correspond à codeActif du foyer.
  const foyerRef = doc(db, 'foyers', foyerId);
  await updateDoc(foyerRef, {
    membres: arrayUnion(user.uid),
    [`prenoms.${user.uid}`]: prenom,
    codeJonction: codeUpper   // validé par la règle Firestore (branche join)
  });

  setFoyerId(foyerId);
  localStorage.setItem('prenom', prenom);
  localStorage.setItem('foyerCode', codeUpper);

  return { foyerId, code: codeUpper };
}

// Regenerate foyer code
export async function regenererCode() {
  const fid = getFoyerId();
  if (!fid) throw new Error('Aucun foyer');

  const oldCode = localStorage.getItem('foyerCode');
  const newCode = generateCode();

  // Update foyer
  await updateDoc(doc(db, 'foyers', fid), { codeActif: newCode });

  // Create new code lookup
  await setDoc(doc(db, 'codes', newCode), { foyerId: fid });

  // TODO: delete old code doc (needs to be done carefully)

  localStorage.setItem('foyerCode', newCode);
  return newCode;
}

// Remove a member (or self — leave foyer)
export async function retirerMembre(uid) {
  const fid = getFoyerId();
  if (!fid) throw new Error('Aucun foyer');

  await updateDoc(doc(db, 'foyers', fid), {
    membres: arrayRemove(uid)
  });

  // If removing self, clear local
  const user = getCurrentUser();
  if (user && user.uid === uid) {
    localStorage.removeItem('foyerId');
    localStorage.removeItem('prenom');
    localStorage.removeItem('foyerCode');
  }
}

// Get current user's prenom
export function getPrenom() {
  return localStorage.getItem('prenom') || 'Moi';
}

// Render foyer setup overlay
export function renderFoyerSetup(container) {
  container.innerHTML = `
    <div class="foyer-overlay" id="foyer-overlay">
      <div class="foyer-overlay__title">Réserves & Courses</div>
      <div class="foyer-overlay__subtitle">Gérez vos courses et votre kit de survie en duo</div>

      <div id="foyer-step-choice" class="foyer-overlay__buttons">
        <button class="btn btn--primary" id="btn-creer">Créer un foyer</button>
        <button class="btn btn--secondary" id="btn-rejoindre">Rejoindre un foyer</button>
      </div>

      <div id="foyer-step-creer" class="hidden" style="width:100%;max-width:300px;">
        <div class="form-group">
          <label class="form-label" for="creer-prenom">Ton prénom</label>
          <input type="text" id="creer-prenom" class="input" placeholder="Prénom" maxlength="30" autocomplete="given-name">
        </div>
        <button class="btn btn--primary btn--full" id="btn-creer-go">Créer</button>
        <button class="btn btn--ghost btn--full mt-12" id="btn-creer-back">Retour</button>
        <div id="creer-result" class="hidden mt-16 text-center"></div>
      </div>

      <div id="foyer-step-rejoindre" class="hidden" style="width:100%;max-width:300px;">
        <div class="form-group">
          <label class="form-label" for="rejoindre-prenom">Ton prénom</label>
          <input type="text" id="rejoindre-prenom" class="input" placeholder="Prénom" maxlength="30" autocomplete="given-name">
        </div>
        <div class="form-group">
          <label class="form-label" for="rejoindre-code">Code du foyer</label>
          <input type="text" id="rejoindre-code" class="input" placeholder="ABC123" maxlength="6" autocomplete="off" style="text-transform:uppercase;letter-spacing:0.1em;font-family:var(--font-heading);font-size:1.2rem;text-align:center;">
        </div>
        <button class="btn btn--primary btn--full" id="btn-rejoindre-go">Rejoindre</button>
        <button class="btn btn--ghost btn--full mt-12" id="btn-rejoindre-back">Retour</button>
        <div id="rejoindre-error" class="hidden mt-12 text-center" style="color:var(--alert)"></div>
      </div>
    </div>
  `;

  // Bind events
  const show = (id) => {
    document.getElementById('foyer-step-choice').classList.add('hidden');
    document.getElementById('foyer-step-creer').classList.add('hidden');
    document.getElementById('foyer-step-rejoindre').classList.add('hidden');
    document.getElementById(id).classList.remove('hidden');
  };

  document.getElementById('btn-creer').addEventListener('click', () => show('foyer-step-creer'));
  document.getElementById('btn-rejoindre').addEventListener('click', () => show('foyer-step-rejoindre'));
  document.getElementById('btn-creer-back').addEventListener('click', () => show('foyer-step-choice'));
  document.getElementById('btn-rejoindre-back').addEventListener('click', () => show('foyer-step-choice'));

  document.getElementById('btn-creer-go').addEventListener('click', async () => {
    const prenom = document.getElementById('creer-prenom').value.trim();
    if (!prenom) return;
    const btn = document.getElementById('btn-creer-go');
    btn.disabled = true;
    btn.textContent = 'Création...';
    try {
      const { code } = await creerFoyer(prenom);
      const resultEl = document.getElementById('creer-result');
      resultEl.classList.remove('hidden');
      resultEl.innerHTML = `
        <p style="margin-bottom:8px;font-weight:600;">Foyer créé !</p>
        <div class="code-display">${code}</div>
        <p class="text-sm text-muted">Partage ce code pour inviter l'autre personne.</p>
        <button class="btn btn--primary btn--full mt-16" id="btn-foyer-done">C'est parti !</button>
      `;
      document.getElementById('btn-foyer-done').addEventListener('click', () => {
        location.reload();
      });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Créer';
      alert('Erreur: ' + e.message);
    }
  });

  document.getElementById('btn-rejoindre-go').addEventListener('click', async () => {
    const prenom = document.getElementById('rejoindre-prenom').value.trim();
    const code = document.getElementById('rejoindre-code').value.trim();
    if (!prenom || !code) return;
    const btn = document.getElementById('btn-rejoindre-go');
    const errEl = document.getElementById('rejoindre-error');
    btn.disabled = true;
    btn.textContent = 'Connexion...';
    errEl.classList.add('hidden');
    try {
      await rejoindreFoyer(prenom, code);
      location.reload();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Rejoindre';
      errEl.classList.remove('hidden');
      errEl.textContent = e.message === 'Code invalide' ? 'Code invalide. Vérifie et réessaie.' : 'Erreur: ' + e.message;
    }
  });
}
