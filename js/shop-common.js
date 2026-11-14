// Éléments communs aux pages boutique (index.html, produit.html, panier.html)
import { db } from "./firebase-config.js";
import { loadCart, persistCart, getCartCount } from "./cart.js";
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

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

// Liens "Retour aux pâtisseries" : l'accueil retrouvera la position où l'on était
document.addEventListener("click", (e) => {
  if (e.target.closest("a[data-restore]")) sessionStorage.setItem(RESTORE_FLAG, "1");
});

// Pastille du panier toujours à jour (retour arrière depuis le cache du navigateur, autre onglet)
syncCartBadge();
window.addEventListener("pageshow", () => syncCartBadge());
window.addEventListener("storage", () => syncCartBadge());
