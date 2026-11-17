// Programme de fidélité : 1 € dépensé = 1 point (arrondi à l'inférieur : 4,50 € → 4 pts).
// Calcul pur, à partir des commandes du client. Réglages : document Firestore parametres/fidelite.
import { normalizeOrderStatut, isOrderVoid } from "./catalog.js";

const DAY = 86400000;

export const DEFAULT_LOYALTY = {
  actif: false,
  description: "",
  paliers: [{ points: 100, remisePct: 10 }],
  validiteJours: 0 // 0 = les points n'expirent jamais ; sinon durée de vie de chaque point (jours glissants)
};

export function normalizeLoyalty(raw) {
  const paliers = (Array.isArray(raw?.paliers) ? raw.paliers : DEFAULT_LOYALTY.paliers)
    .map((p) => ({ points: Math.floor(Number(p.points)), remisePct: Number(p.remisePct) }))
    .filter((p) => p.points > 0 && p.remisePct > 0 && p.remisePct <= 100)
    .sort((a, b) => a.points - b.points);
  const v = Math.floor(Number(raw?.validiteJours));
  return {
    actif: raw?.actif === true,
    description: String(raw?.description || ""),
    paliers,
    validiteJours: v > 0 ? v : 0
  };
}

export const pointsFor = (amount) => Math.max(0, Math.floor(Number(amount) || 0));

const orderTime = (o) => o.createdAt?.toMillis?.() ?? (typeof o.createdAt === "number" ? o.createdAt : Date.now());

/**
 * Solde de points.
 * - Une commande gagne ses points une fois acceptée par l'atelier (« En attente » = points à venir).
 * - Une commande refusée ou annulée ne gagne rien, et les points qu'elle utilisait sont rendus.
 * - Les points utilisés le sont dès la commande passée (pour éviter de les dépenser deux fois).
 * - Avec une durée de validité, chaque point expire N jours après la commande qui l'a rapporté ;
 *   les points dépensés sont pris en priorité parmi les plus anciens.
 * Retourne { solde, enAttente, prochaineExpiration: { date, points } | null }.
 */
export function loyaltyBalance(orders, settings, now = Date.now()) {
  const cfg = normalizeLoyalty(settings);
  const ttl = cfg.validiteJours * DAY;
  const events = [];
  let enAttente = 0;

  for (const o of orders || []) {
    if (isOrderVoid(o)) continue;
    const t = orderTime(o);
    const spent = Math.floor(Number(o.remise?.points) || 0);
    if (spent > 0) events.push({ t, kind: 0, pts: spent });
    const earned = pointsFor(o.total);
    if (!earned) continue;
    if (normalizeOrderStatut(o.statut) === "En attente") enAttente += earned;
    else events.push({ t, kind: 1, pts: earned });
  }
  events.sort((a, b) => a.t - b.t || a.kind - b.kind); // à date égale : dépense avant gain

  let lots = []; // { t, pts } points encore valables, du plus ancien au plus récent
  const expire = (at) => { if (ttl) lots = lots.filter((l) => l.t + ttl > at); };

  for (const e of events) {
    expire(e.t);
    if (e.kind === 1) {
      lots.push({ t: e.t, pts: e.pts });
    } else {
      let rest = e.pts;
      for (const l of lots) {
        const used = Math.min(l.pts, rest);
        l.pts -= used;
        rest -= used;
        if (!rest) break;
      }
      lots = lots.filter((l) => l.pts > 0);
    }
  }
  expire(now);

  const solde = lots.reduce((s, l) => s + l.pts, 0);
  const next = ttl && lots.length ? { date: new Date(lots[0].t + ttl), points: lots[0].pts } : null;
  return { solde, enAttente, prochaineExpiration: next };
}

/** Paliers que le solde permet d'utiliser. */
export const availableRewards = (solde, settings) =>
  normalizeLoyalty(settings).paliers.filter((p) => p.points <= solde);

/** Remise d'un palier sur un sous-total, arrondie au centime. */
export const rewardAmount = (subtotal, palier) =>
  palier ? Math.round(Number(subtotal) * palier.remisePct) / 100 : 0;
