// Utilitaires partagés boutique / admin
export const ADMIN_EMAIL = "pro.maxime.mons@gmail.com";
export const AUTRE_ID = "__autre__";
export const AUTRE_LABEL = "Autre";

export const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre"
];

export const STATUTS = ["Disponible", "Épuisé", "Hors-Saison"];
export const ORDER_STATUTS = ["En attente", "Confirmée", "Prête", "Retirée", "Annulée"];

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
  if (statut === "Épuisé") return { available: false, reason: "Épuisé" };
  if (statut === "Hors-Saison") return { available: false, reason: "Hors-Saison" };
  if (!isInSeason(product.saison, date)) return { available: false, reason: "Hors-Saison" };
  return { available: true, reason: null };
}

// ---------- Connexion par lien e-mail (sans mot de passe) ----------
export const EMAIL_LINK_KEY = "johanne_email_for_signin";

// ---------- Fiche produit ----------
// Les 14 allergènes à déclaration obligatoire (UE)
export const ALLERGENES = [
  "Gluten", "Crustacés", "Œufs", "Poissons", "Arachides", "Soja", "Lait",
  "Fruits à coque", "Céleri", "Moutarde", "Sésame", "Sulfites", "Lupin", "Mollusques"
];

const isUrl = (u) => /^https?:\/\//i.test(String(u || "").trim());

/** Image principale + images supplémentaires, sans doublon. */
export function productImages(p) {
  const all = [p.imageUrl, ...(Array.isArray(p.images) ? p.images : [])].map((u) => String(u || "").trim()).filter(isUrl);
  return [...new Set(all)];
}

export const productUrl = (id) => `/produit?id=${encodeURIComponent(id)}`;
