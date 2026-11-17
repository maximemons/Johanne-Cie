// Favoris : gardés dans le navigateur, et synchronisés avec le compte du client une fois connecté
// (document Firestore clients/{uid}, champ favoris), pour les retrouver sur tous ses appareils.
import { db, auth } from "./config.js";
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const KEY = "johanne_favoris";
const listeners = new Set();
let ids = readLocal();
let uid = null;
let unsubRemote = null;

function readLocal() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

function setIds(next, { remote = true } = {}) {
  ids = [...new Set(next)];
  localStorage.setItem(KEY, JSON.stringify(ids));
  listeners.forEach((cb) => cb(getFavorites()));
  if (remote && uid) {
    setDoc(doc(db, "clients", uid), { favoris: ids, updatedAt: serverTimestamp() }, { merge: true })
      .catch((err) => console.warn("Favoris non synchronisés :", err));
  }
}

export const getFavorites = () => [...ids];
export const isFavorite = (id) => ids.includes(id);
export function onFavoritesChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Ajoute ou retire un favori ; retourne true s'il est désormais en favori. */
export function toggleFavorite(id) {
  const on = !ids.includes(id);
  setIds(on ? [...ids, id] : ids.filter((x) => x !== id));
  return on;
}

/** Bouton cœur (HTML), à placer hors d'un lien. Cliquable via l'attribut data-fav-id. */
export function heartButton(id, nom, extraClass = "") {
  const on = isFavorite(id);
  return `<button type="button" data-fav-id="${String(id).replace(/"/g, "&quot;")}" aria-pressed="${on}"
      aria-label="${on ? "Retirer des favoris" : "Ajouter aux favoris"} : ${String(nom || "").replace(/"/g, "&quot;")}"
      class="fav-btn ${on ? "is-on" : ""} ${extraClass}">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.6-9.2C1 8.2 2.9 4.5 6.6 4.5c2.2 0 3.6 1.2 4.4 2.5.8-1.3 2.2-2.5 4.4-2.5 3.7 0 5.6 3.7 4.2 6.8-2.1 4.6-9.6 9.2-9.6 9.2Z"/></svg>
    </button>`;
}

// Connexion : on fusionne les favoris du navigateur avec ceux du compte, puis on suit le compte
onAuthStateChanged(auth, async (user) => {
  unsubRemote?.();
  unsubRemote = null;
  const wasLogged = Boolean(uid);
  uid = user?.uid || null;
  if (!user) {
    if (wasLogged) setIds([], { remote: false }); // déconnexion : on ne laisse pas les favoris sur un appareil partagé
    return;
  }
  try {
    const ref = doc(db, "clients", user.uid);
    const snap = await getDoc(ref);
    const remoteIds = Array.isArray(snap.data()?.favoris) ? snap.data().favoris : [];
    const merged = [...new Set([...remoteIds, ...ids])];
    setIds(merged, { remote: merged.length !== remoteIds.length });
    unsubRemote = onSnapshot(ref, (s) => {
      const r = Array.isArray(s.data()?.favoris) ? s.data().favoris : [];
      if (r.join("|") !== ids.join("|")) setIds(r, { remote: false });
    });
  } catch (err) {
    console.warn("Favoris du compte indisponibles :", err);
  }
});

// Autre onglet
window.addEventListener("storage", (e) => {
  if (e.key === KEY) setIds(readLocal(), { remote: false });
});
