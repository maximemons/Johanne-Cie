// Utilitaires partagés boutique / admin
export const ADMIN_EMAIL = "pro.maxime.mons@gmail.com";
export const AUTRE_ID = "__autre__";
export const AUTRE_LABEL = "Autre";

export const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre"
];

export const STATUTS = ["Disponible", "Épuisé", "Hors-Saison"];
// Cycle d'une commande : En attente → Acceptée → En préparation → Prête → (Retrait partiel →) Retirée
// (ou Refusée par l'atelier / Annulée par le client tant qu'elle n'est pas « En préparation »)
// « Retrait partiel » : une partie seulement des articles a été remise ; la commande reste ouverte.
export const ORDER_STATUTS = ["En attente", "Acceptée", "En préparation", "Prête", "Retrait partiel", "Retirée", "Refusée", "Annulée"];
const CLOSED_STATUTS = ["Retirée", "Refusée", "Annulée"];

/** Compatibilité : les anciennes commandes « Confirmée » sont des commandes acceptées. */
export function normalizeOrderStatut(s) {
  if (!s) return "En attente";
  if (s === "Confirmée") return "Acceptée";
  return ORDER_STATUTS.includes(s) ? s : "En attente";
}
export const isOrderOpen = (o) => !CLOSED_STATUTS.includes(normalizeOrderStatut(o.statut));
/** Le client peut annuler tant que l'atelier n'a pas lancé la préparation ni remis un article. */
export const canClientCancel = (o) =>
  ["En attente", "Acceptée"].includes(normalizeOrderStatut(o.statut)) && !(o.articles || []).some((a) => a.remis);
/** Une partie seulement des articles a été remise au client (ex. précommande à venir). */
export const isPartiallyDelivered = (o) => {
  const n = (o.articles || []).filter((a) => a.remis).length;
  return n > 0 && n < (o.articles || []).length;
};
/** Commande qui compte (points de fidélité, chiffre) : ni refusée ni annulée. */
export const isOrderVoid = (o) => ["Refusée", "Annulée"].includes(normalizeOrderStatut(o.statut));

const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c]);

export function formatPrice(value) {
  const num = Number(value) || 0;
  return num.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

// ---------- Dates (toujours en heure locale, format AAAA-MM-JJ) ----------
export function toISODate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseISODate(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function todayISO() {
  return toISODate(new Date());
}

export function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toISODate(d);
}

export function formatDateFR(iso, withYear = true) {
  if (!iso) return "Date non précisée";
  return parseISODate(iso).toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {})
  });
}

// ---------- Catégories ----------
export const catName = (c) => (c && (c.nom || c.name)) || "";
export const isCategoryActive = (c) => Boolean(c) && c.actif !== false;

function sortCategories(categories) {
  return [...categories].sort(
    (a, b) => (Number(a.ordre) || 0) - (Number(b.ordre) || 0) || catName(a).localeCompare(catName(b), "fr")
  );
}

/**
 * Regroupe les pâtisseries par catégorie.
 * Une pâtisserie dont la catégorie n'existe plus, est masquée, ou n'a jamais été définie
 * est rangée dans "Autre", toujours placée en dernier.
 */
export function groupByCategory(categories, products, { includeEmpty = false } = {}) {
  const sorted = sortCategories(categories);
  const known = new Map(sorted.filter(isCategoryActive).map((c) => [c.id, { id: c.id, nom: catName(c), products: [] }]));
  const autre = { id: AUTRE_ID, nom: AUTRE_LABEL, products: [] };

  for (const p of products) {
    (known.get(p.categorieId) || autre).products.push(p);
  }

  const groups = [...known.values()];
  if (includeEmpty) return [...groups, autre];
  return [...groups.filter((g) => g.products.length), ...(autre.products.length ? [autre] : [])];
}

// ---------- Brouillons ----------
// `brouillon: true` sur une pâtisserie = visible en admin seulement, jamais en boutique.
// Champ absent ou false = publiée (les pâtisseries existantes restent donc visibles).
export const isDraft = (p) => p?.brouillon === true;

// ---------- Saisonnalité & disponibilité ----------
export function normalizeStatut(statut) {
  const s = String(statut || "").trim().toLowerCase();
  if (s === "épuisé" || s === "epuise" || s === "épuise") return "Épuisé";
  if (s === "hors-saison" || s === "hors saison") return "Hors-Saison";
  return "Disponible";
}

export function hasSeason(saison) {
  return Boolean(saison) && Number(saison.debut) >= 1 && Number(saison.fin) >= 1;
}

export function seasonLabel(saison) {
  if (!hasSeason(saison)) return "";
  return `De ${MOIS[saison.debut - 1]} à ${MOIS[saison.fin - 1]}`;
}

// Gère les saisons à cheval sur deux années (ex. novembre → février)
export function isInSeason(saison, date = new Date()) {
  if (!hasSeason(saison)) return true;
  const m = date.getMonth() + 1;
  const { debut, fin } = saison;
  return debut <= fin ? m >= debut && m <= fin : m >= debut || m <= fin;
}

/** { available, reason } pour une pâtisserie, à une date donnée (par défaut aujourd'hui). */
export function getAvailability(product, date = new Date()) {
  const statut = normalizeStatut(product.statut);
  if (statut === "Épuisé" || allParfumsOut(product)) return { available: false, reason: "Épuisé" };
  if (statut === "Hors-Saison") return { available: false, reason: "Hors-Saison" };
  if (!isInSeason(product.saison, date)) return { available: false, reason: "Hors-Saison" };
  return { available: true, reason: null };
}

/**
 * Peut-on commander cette création (pour une date à choisir) ?
 * Seuls « Épuisé » et « Hors-Saison » (retrait manuel) bloquent : une création saisonnière
 * hors de sa saison reste commandable en avance, pour une date située dans sa saison.
 */
export function isOrderable(product) {
  return normalizeStatut(product.statut) === "Disponible" && !allParfumsOut(product);
}

/** Recette à parfums dont aucun parfum n'est disponible : elle est épuisée. */
function allParfumsOut(product) {
  const list = Array.isArray(product?.parfums) ? product.parfums.filter((x) => String(x?.nom ?? "").trim()) : [];
  return list.length > 0 && list.every((x) => x?.dispo === false);
}

/** Précommande : commandable, mais pas en saison aujourd'hui. */
export function isPreorder(product, date = new Date()) {
  return isOrderable(product) && !isInSeason(product.saison, date);
}

const lastDayOfMonth = (y, m0) => new Date(y, m0 + 1, 0);

/**
 * Période de saison ouverte à la commande, à partir de `fromISO` (par défaut demain) :
 * { start, end } au format AAAA-MM-JJ (end = null si la création est disponible toute l'année).
 * C'est l'occurrence de la saison en cours si on y est, sinon la prochaine
 * (ex. le 10 mai pour une saison « août → août » : du 1er au 31 août).
 */
export function seasonWindow(saison, fromISO = tomorrowISO()) {
  if (!hasSeason(saison)) return { start: fromISO, end: null };
  const from = parseISODate(fromISO);
  let y = from.getFullYear(), m = from.getMonth();
  let guard = 0;
  while (!isInSeason(saison, new Date(y, m, 1)) && guard++ < 12) {
    m++; if (m > 11) { m = 0; y++; }
  }
  const startDate = guard === 0 ? from : new Date(y, m, 1);
  // Étend la fenêtre tant que les mois suivants sont en saison (12 mois max = toute l'année)
  let ey = y, em = m, months = 1;
  while (months < 12) {
    let ny = ey, nm = em + 1;
    if (nm > 11) { nm = 0; ny++; }
    if (!isInSeason(saison, new Date(ny, nm, 1))) break;
    ey = ny; em = nm; months++;
  }
  if (months >= 12) return { start: fromISO, end: null };
  return { start: toISODate(startDate), end: toISODate(lastDayOfMonth(ey, em)) };
}

/** « Précommande dès août » : libellé court pour une création hors de sa saison. */
export function preorderLabel(product) {
  const w = seasonWindow(product.saison);
  const d = parseISODate(w.start);
  return `Précommande dès ${MOIS[d.getMonth()]}`;
}

// ---------- Connexion par lien e-mail (sans mot de passe) ----------
export const EMAIL_LINK_KEY = "johanne_email_for_signin";

// ---------- Fiche produit ----------
// Les 14 allergènes à déclaration obligatoire (UE), plus « Alcool » (mention ajoutée par la Maison)
export const ALLERGENES = [
  "Gluten", "Crustacés", "Œufs", "Poissons", "Arachides", "Soja", "Lait",
  "Fruits à coque", "Céleri", "Moutarde", "Sésame", "Sulfites", "Lupin", "Mollusques",
  "Alcool"
];

const isUrl = (u) => /^https?:\/\//i.test(String(u || "").trim());

/** Image principale + images supplémentaires, sans doublon. */
export function productImages(p) {
  const all = [p.imageUrl, ...(Array.isArray(p.images) ? p.images : [])].map((u) => String(u || "").trim()).filter(isUrl);
  return [...new Set(all)];
}

export const productUrl = (id) => `produit.html?id=${encodeURIComponent(id)}`;

/** Le produit se compte-t-il en pièces (et non en parts / personnes) ? */
export const isPieces = (p) => (p?.prixPour?.unite || p?.unite) === "pieces";

/**
 * "4" -> "4 parts" ; "1" -> "1 part" ; un texte libre ("6 à 8 parts") est conservé tel quel.
 * Produit vendu à la pièce : "12" -> "12 pièces", et "part(s)" devient "pièce(s)" dans un texte libre.
 */
export function formatParts(v, pieces = false) {
  const t = String(v ?? "").trim();
  if (!t) return "";
  const [singulier, pluriel] = pieces ? ["pièce", "pièces"] : ["part", "parts"];
  if (/^\d+$/.test(t)) return `${t} ${Number(t) > 1 ? pluriel : singulier}`;
  return pieces ? t.replace(/\b(p)art(s?)\b/gi, (_, p, s) => `${p}ièce${s}`) : t;
}

// ---------- Ce que couvre le prix : "4 personnes", "6 à 8 personnes", "12 pièces", "1 pièce" ----------
const UNITES = { personnes: ["personne", "personnes"], pieces: ["pièce", "pièces"] };

export function formatPrixPour(pp) {
  const n = Number(pp?.nombre);
  if (!(n >= 1)) return "";
  const max = Number(pp.nombreMax);
  const hasRange = max > n;
  const [singulier, pluriel] = UNITES[pp.unite === "pieces" ? "pieces" : "personnes"];
  return `${hasRange ? `${n} à ${max}` : n} ${(hasRange ? max : n) > 1 ? pluriel : singulier}`;
}

// ---------- Best-Sellers : sélection manuelle (étoile en admin), sans lien avec les ventes ----------
export const BEST_ID = "__best__";
/** Filtre admin « Brouillons » (liste des pâtisseries). */
export const DRAFT_ID = "__brouillons__";
export const BEST_LABEL = "Best-Sellers";

export const FAV_ID = "__favoris__";
export const FAV_LABEL = "Favoris";

/**
 * Groupes affichés en boutique : fausse catégorie « Favoris » en première position (s'il y en a),
 * puis « Best-Sellers » (s'il y en a), puis les vraies catégories.
 * Un favori / best-seller reste aussi dans sa vraie catégorie. Ordre dans les fausses catégories : celui de la carte.
 */
export function shopGroups(categories, products, favoriteIds = []) {
  const groups = groupByCategory(categories, products);
  const all = groups.flatMap((g) => g.products);
  const favSet = new Set(favoriteIds);
  const favs = all.filter((p) => favSet.has(p.id));
  const best = all.filter((p) => p.bestSeller === true);
  return [
    ...(favs.length ? [{ id: FAV_ID, nom: FAV_LABEL, icon: "♥", virtual: true, products: favs }] : []),
    ...(best.length ? [{ id: BEST_ID, nom: BEST_LABEL, icon: "★", virtual: true, products: best }] : []),
    ...groups
  ];
}

// ---------- Tags (libres, saisis en admin) ----------
export const TAG_MAX_LENGTH = 30;

/** Nettoie un tag : espaces superflus retirés, longueur limitée. "" si vide. */
export function cleanTag(t) {
  return String(t ?? "").replace(/\s+/g, " ").trim().slice(0, TAG_MAX_LENGTH);
}

export const tagKey = (t) => cleanTag(t).toLocaleLowerCase("fr");

/** Tags d'une pâtisserie, nettoyés et sans doublon (insensible à la casse). */
export function productTags(p) {
  const seen = new Set();
  return (Array.isArray(p?.tags) ? p.tags : []).map(cleanTag).filter((t) => {
    const k = tagKey(t);
    if (!t || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const hasTag = (p, tag) => productTags(p).some((t) => tagKey(t) === tagKey(tag));

/** Tous les tags utilisés dans le catalogue, triés (une seule graphie par tag : la plus fréquente). */
export function allTags(products) {
  const byKey = new Map(); // clé -> { graphie -> nombre }
  for (const p of products) {
    for (const t of productTags(p)) {
      const k = tagKey(t);
      const spellings = byKey.get(k) || new Map();
      spellings.set(t, (spellings.get(t) || 0) + 1);
      byKey.set(k, spellings);
    }
  }
  return [...byKey.values()]
    .map((sp) => [...sp.entries()].sort((a, b) => b[1] - a[1])[0][0])
    .sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
}

// ---------- Réglages publics de la boutique (document Firestore parametres/boutique) ----------
export const DEFAULT_SHOP_SETTINGS = { filtreTags: true };
export function normalizeShopSettings(d) {
  return { filtreTags: d?.filtreTags !== false };
}

// ---------- Parfums (choix proposé sur certaines recettes, chacun avec son tarif) ----------
// Stockés sur la pâtisserie : parfums: [{ nom, prix, dispo, image }]. Liste vide ou absente = pas de choix.
// `prix` est le prix de la pâtisserie dans ce parfum (à défaut, le prix de la pâtisserie).
// `dispo: false` = parfum momentanément indisponible (affiché, mais non commandable).
// `image` (URL, facultative) remplace la photo principale quand ce parfum est choisi.
export const PARFUM_MAX_LENGTH = 40;
export const cleanParfumName = (t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, PARFUM_MAX_LENGTH);
export const parfumKey = (t) => cleanParfumName(t).toLocaleLowerCase("fr");

/** Parfums d'une pâtisserie, nettoyés et sans doublon (insensible à la casse). */
export function productParfums(p) {
  const seen = new Set();
  const base = Number(p?.prix) || 0;
  return (Array.isArray(p?.parfums) ? p.parfums : [])
    .map((x) => {
      const prix = Number(x?.prix);
      const image = String(x?.image || "").trim();
      return {
        nom: cleanParfumName(x?.nom),
        prix: x?.prix === "" || x?.prix == null || !(prix >= 0) ? base : prix,
        dispo: x?.dispo !== false,
        image: isUrl(image) ? image : ""
      };
    })
    .filter((x) => {
      const k = parfumKey(x.nom);
      if (!x.nom || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export const hasParfums = (p) => productParfums(p).length > 0;
export const availableParfums = (p) => productParfums(p).filter((x) => x.dispo);
/** Parfum présélectionné : le premier parfum disponible, dans l'ordre réglé en admin ("" s'il n'y en a aucun). */
export const defaultParfum = (p) => availableParfums(p)[0]?.nom || "";
/** Le parfum `nom` de la pâtisserie (ou null s'il n'existe plus). */
export const findParfum = (p, nom) => productParfums(p).find((x) => parfumKey(x.nom) === parfumKey(nom)) || null;

/** Prix affiché : prix du parfum choisi, ou plus petit prix des parfums (« dès »), ou prix de la pâtisserie. */
export function displayPrice(p, parfumNom = "") {
  const chosen = parfumNom ? findParfum(p, parfumNom) : null;
  if (chosen) return { prix: chosen.prix, from: false };
  const list = availableParfums(p).length ? availableParfums(p) : productParfums(p);
  if (!list.length) return { prix: Number(p?.prix) || 0, from: false };
  const prices = list.map((x) => x.prix);
  const min = Math.min(...prices);
  return { prix: min, from: prices.some((v) => v !== min) };
}
export function formatDisplayPrice(p, parfumNom = "") {
  const d = displayPrice(p, parfumNom);
  return `${d.from ? "Dès " : ""}${formatPrice(d.prix)}`;
}

/** Images à montrer pour un parfum choisi : la sienne d'abord, puis celles de la pâtisserie. */
export function imagesForParfum(p, parfumNom = "") {
  const own = parfumNom ? findParfum(p, parfumNom)?.image : "";
  const base = productImages(p);
  return own ? [own, ...base.filter((u) => u !== own)] : base;
}

/** Libellé d'un article de panier / commande : « Bûche roulée — Praliné ». */
export const articleLabel = (a) => `${a?.nom || ""}${a?.parfum ? ` — ${a.parfum}` : ""}`;
