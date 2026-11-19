// Éléments communs aux pages boutique (index.html, produit.html, panier.html, compte.html)
import { db, auth } from "./config.js";
import { loadCart, persistCart, getCartCount } from "./cart.js";
import { normalizeShopSettings } from "./catalog.js";
import { createOrderWatcher, showAlert, orderNumber } from "./web-notify.js";
import { collection, doc, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

export const $ = (id) => document.getElementById(id);

// Mémoire "retour à la liste" : un lien marqué data-restore demande à l'accueil de retrouver sa position
export const LIST_STATE_KEY = "johanne_list_state";
export const RESTORE_FLAG = "johanne_restore_list";

export function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("translate-y-20", "opacity-0");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => toast.classList.add("translate-y-20", "opacity-0"), 2600);
}

export function syncCartBadge(cart = loadCart()) {
  const badge = $("cart-badge");
  if (!badge) return;
  const count = getCartCount(cart);
  badge.textContent = count;
  badge.classList.toggle("hidden", count === 0);
}

export function saveCart(cart) {
  persistCart(cart);
  syncCartBadge(cart);
}

// Catalogue partagé, mis à jour en temps réel. `ready` = catégories ET pâtisseries reçues.
export const catalog = { categories: [], products: [], ready: false };

export function subscribeCatalog(onChange) {
  let catsLoaded = false, prodsLoaded = false;
  const update = () => {
    catalog.ready = catsLoaded && prodsLoaded;
    onChange(catalog);
  };
  onSnapshot(collection(db, "categories"), (snap) => {
    catalog.categories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    catsLoaded = true;
    update();
  });
  onSnapshot(collection(db, "patisseries"), (snap) => {
    catalog.products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    prodsLoaded = true;
    update();
  });
}

/**
 * Réglages publics de la boutique (parametres/boutique), en temps réel : `cb(reglages)`.
 * Document absent ou illisible : réglages par défaut. L'écoute redémarre à chaque connexion /
 * déconnexion (une écoute refusée s'arrête définitivement).
 */
export function subscribeShopSettings(cb) {
  let unsub = null;
  onAuthStateChanged(auth, () => {
    unsub?.();
    unsub = onSnapshot(
      doc(db, "parametres", "boutique"),
      (snap) => cb(normalizeShopSettings(snap.data())),
      (err) => {
        console.error(
          "Réglages de la boutique illisibles (parametres/boutique). " +
          "Vérifiez que les règles sont déployées : firebase deploy --only firestore:rules", err);
        cb(normalizeShopSettings(null));
      }
    );
  });
}

// Liens "Retour aux pâtisseries" : l'accueil retrouvera la position où l'on était
document.addEventListener("click", (e) => {
  if (e.target.closest("a[data-restore]")) sessionStorage.setItem(RESTORE_FLAG, "1");
});

// Pastille du panier toujours à jour (retour arrière depuis le cache du navigateur, autre onglet)
syncCartBadge();
window.addEventListener("pageshow", () => syncCartBadge());
window.addEventListener("storage", () => syncCartBadge());

// ---------- Alertes navigateur côté client ----------
// Tant qu'une page de la boutique est ouverte (même en arrière-plan), le client connecté
// qui a autorisé les alertes est prévenu quand l'atelier fait avancer sa commande.
// Les changements survenus pendant son absence sont signalés à sa prochaine visite.
const CLIENT_ALERTS = {
  "Acceptée": (o) => [`Commande #${orderNumber(o)} acceptée`, "Bonne nouvelle : l'atelier a accepté votre commande."],
  "En préparation": (o) => [`Commande #${orderNumber(o)} aux fourneaux`, "Votre commande est en cours de préparation à l'atelier."]
  // Pour prévenir aussi d'autres étapes, ajouter ici "Prête", "Refusée"...
};

let stopClientAlerts = null;
onAuthStateChanged(auth, (user) => {
  stopClientAlerts?.();
  stopClientAlerts = null;
  if (!user) return;
  const watch = createOrderWatcher(`johanne_alertes_client_${user.uid}`);
  stopClientAlerts = onSnapshot(
    query(collection(db, "commandes"), where("userId", "==", user.uid)),
    (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      const changes = watch(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      for (const { order, now } of changes) {
        const make = CLIENT_ALERTS[now];
        if (!make) continue;
        const [title, body] = make(order);
        showAlert(title, { body, url: "compte.html", tag: `client-${order.id}-${now}` });
      }
    },
    (err) => console.warn("Suivi des commandes indisponible :", err)
  );
});
