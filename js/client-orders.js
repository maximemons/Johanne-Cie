// Commandes du client connecté : historique, annulation, « Recommander » ; réglages de fidélité.
import { db } from "./config.js";
import { loadCart, addItem } from "./cart.js";
import { saveCart } from "./shop-common.js";
import { notifyAtelier } from "./notify.js";
import { canClientCancel, isOrderable, isPreorder, seasonWindow, formatDateFR, normalizeStatut } from "./catalog.js";
import {
  collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const millis = (o) => o.createdAt?.toMillis?.() ?? Date.now();

/** Commandes du client, de la plus récente à la plus ancienne (temps réel). */
export function subscribeMyOrders(uid, cb, onError) {
  const q = query(collection(db, "commandes"), where("userId", "==", uid));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => millis(b) - millis(a))),
    (err) => { console.error(err); onError?.(err); }
  );
}

/** Réglages publics du programme de fidélité (parametres/fidelite). */
export function subscribeLoyaltySettings(cb) {
  return onSnapshot(
    doc(db, "parametres", "fidelite"),
    (snap) => cb(snap.data() || null),
    (err) => { console.warn("Réglages fidélité indisponibles :", err); cb(null); }
  );
}

/** Annulation par le client : autorisée tant que la commande n'est pas « En préparation ». */
export async function cancelOrder(order) {
  if (!canClientCancel(order)) throw new Error("Cette commande ne peut plus être annulée.");
  await updateDoc(doc(db, "commandes", order.id), { statut: "Annulée", annuleeLe: serverTimestamp(), annuleePar: "client" });
  await notifyAtelier("annulee", order);
}

/**
 * Remet les articles d'une commande dans le panier, aux prix actuels.
 * Les créations épuisées, retirées ou supprimées sont écartées ; celles hors saison
 * sont ajoutées en précommande (date à choisir dans leur saison).
 */
export function reorderToCart(order, products) {
  const cart = loadCart();
  const added = [], skipped = [], preorders = [];
  for (const a of order.articles || []) {
    const live = products.find((p) => p.id === a.id);
    if (!live) { skipped.push({ nom: a.nom, raison: "n'est plus à la carte" }); continue; }
    if (!isOrderable(live)) {
      const s = normalizeStatut(live.statut);
      skipped.push({ nom: live.nom, raison: s === "Épuisé" ? "est épuisée" : "est retirée de la carte pour le moment" });
      continue;
    }
    addItem(cart, live, Number(a.quantity) || 1);
    added.push(live.nom);
    if (isPreorder(live)) {
      const w = seasonWindow(live.saison);
      preorders.push({ nom: live.nom, debut: w.start, fin: w.end });
    }
  }
  saveCart(cart);
  return { added, skipped, preorders };
}

/** Texte du message affiché sur le panier après « Recommander ». */
export function reorderMessage({ added, skipped, preorders }) {
  const lines = [];
  if (!added.length) lines.push("Aucune création de cette commande n'est disponible pour le moment.");
  else lines.push(`${added.length} création${added.length > 1 ? "s ajoutées" : " ajoutée"} à votre panier, aux prix actuels. Choisissez vos dates de retrait.`);
  for (const s of skipped) lines.push(`« ${s.nom} » ${s.raison} : elle n'a pas été ajoutée.`);
  for (const p of preorders) {
    lines.push(`« ${p.nom} » est hors saison : elle est ajoutée en précommande, pour une date entre le ${formatDateFR(p.debut, false)} et le ${p.fin ? formatDateFR(p.fin) : "…"}.`);
  }
  return { tone: skipped.length || !added.length ? "warn" : "info", lines };
}

// ---------- Message transmis d'une page à l'autre (ex. compte → panier) ----------
const FLASH_KEY = "johanne_flash";
export const setFlash = (msg) => sessionStorage.setItem(FLASH_KEY, JSON.stringify(msg));
export function takeFlash() {
  try {
    const v = JSON.parse(sessionStorage.getItem(FLASH_KEY) || "null");
    sessionStorage.removeItem(FLASH_KEY);
    return v;
  } catch { return null; }
}
