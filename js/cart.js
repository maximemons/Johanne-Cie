import { findParfum, parfumKey } from "./catalog.js";

const STORAGE_KEY = "johanne_cart";

/**
 * Clé d'une ligne du panier : la pâtisserie, et son parfum s'il y en a un.
 * Une même bûche en « Chocolat » et en « Praliné » fait donc deux lignes.
 */
export const lineKey = (id, parfum = "") => (parfum ? `${id}::${parfumKey(parfum)}` : String(id));

export function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return raw.map((i) => ({
      ...i,
      parfum: i.parfum || "",
      key: i.key || lineKey(i.id, i.parfum),   // paniers enregistrés avant les parfums
      date: i.date || "",
      dateManual: Boolean(i.dateManual)
    }));
  } catch {
    return [];
  }
}

export function persistCart(cart) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
}

export function getCartCount(cart) {
  return cart.reduce((sum, item) => sum + item.quantity, 0);
}

export function getCartTotal(cart) {
  return cart.reduce((sum, item) => sum + item.prix * item.quantity, 0);
}

/**
 * Ajoute une pâtisserie (dans le parfum choisi, le cas échéant) au panier.
 * Le prix est celui du parfum. Un nouvel article reprend la date du premier article du panier.
 */
export function addItem(cart, product, qty = 1, parfumNom = "") {
  const parfum = parfumNom ? findParfum(product, parfumNom) : null;
  const key = lineKey(product.id, parfum?.nom);
  const existing = cart.find((i) => i.key === key);
  if (existing) {
    existing.quantity += qty;
    return;
  }
  cart.push({
    key,
    id: product.id,
    nom: product.nom,
    parfum: parfum?.nom || "",
    prix: parfum ? parfum.prix : Number(product.prix) || 0,
    imageUrl: parfum?.image || product.imageUrl || "",
    quantity: qty,
    date: cart.length ? cart[0].date : "",
    dateManual: false
  });
}

/**
 * Change la date d'un article (désigné par sa clé de ligne).
 * - Premier article : la date est relayée à tous les articles dont la date n'a pas été modifiée à la main.
 * - Autre article : sa date devient "personnalisée" et n'est plus écrasée.
 */
export function setItemDate(cart, key, date) {
  const idx = cart.findIndex((i) => i.key === key);
  if (idx < 0) return;
  cart[idx].date = date;
  if (idx === 0) {
    cart.forEach((item, i) => {
      if (i > 0 && !item.dateManual) item.date = date;
    });
  } else {
    cart[idx].dateManual = true;
  }
}

// Remet tous les articles sur la date du premier
export function applyFirstDateToAll(cart) {
  if (!cart.length) return;
  cart.forEach((item) => {
    item.date = cart[0].date;
    item.dateManual = false;
  });
}

export function removeItem(cart, key) {
  const next = cart.filter((i) => i.key !== key);
  if (next.length) next[0].dateManual = false; // le nouveau premier devient la référence
  return next;
}
