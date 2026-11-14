// Prix de revient : calculs purs + graphique SVG (sans dépendance). Usage admin uniquement.
import { parseISODate, todayISO, esc, formatDateFR } from "./catalog.js";

const DAY = 86400000;
const isEntry = (e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number.isFinite(Number(e.valeur)) && Number(e.valeur) >= 0;

// ---------- Historique : [{ date: "AAAA-MM-JJ", valeur, note? }], trié par date ----------
export function sortHistory(h) {
  return (Array.isArray(h) ? h : [])
    .filter(isEntry)
    .map((e) => ({ ...e, valeur: Number(e.valeur) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const currentCost = (h) => {
  const s = sortHistory(h);
  return s.length ? s[s.length - 1].valeur : null;
};

// Une seule valeur par jour : une nouvelle saisie le même jour remplace la précédente
export const upsertEntry = (h, entry) =>
  sortHistory([...sortHistory(h).filter((e) => e.date !== entry.date), entry]);

export const removeEntry = (h, date) => sortHistory(sortHistory(h).filter((e) => e.date !== date));

export const pctChange = (from, to) => (from > 0 ? ((to - from) / from) * 100 : null);

export function lastChange(h) {
  const s = sortHistory(h);
  if (s.length < 2) return null;
  const a = s[s.length - 2], b = s[s.length - 1];
  return { date: b.date, from: a.valeur, to: b.valeur, pct: pctChange(a.valeur, b.valeur) };
}

/** Marge sur le prix de vente : en €, en % du prix de vente, et coefficient multiplicateur. */
export function marginOf(prix, cout) {
  prix = Number(prix);
  if (!(prix > 0) || cout == null) return null;
  const eur = prix - cout;
  return { eur, pct: (eur / prix) * 100, coef: cout > 0 ? prix / cout : null };
}

export function formatPct(v, signed = false) {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${signed && v > 0 ? "+" : ""}${s} %`;
}

export const formatNum = (v, d = 1) =>
  v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

export const formatDateShort = (iso) => parseISODate(iso).toLocaleDateString("fr-FR");

/**
 * Indice global d'évolution des prix de revient (base 100 au premier relevé).
 * Indice chaîné : à chaque date, on applique la variation moyenne des produits déjà suivis,
 * pour qu'un nouveau produit ajouté plus tard ne fausse pas la courbe.
 */
export function globalIndexSeries(histories) {
  const series = histories.map(sortHistory).filter((s) => s.length && s[0].valeur > 0);
  if (!series.length) return [];
  const dates = [...new Set(series.flatMap((s) => s.map((e) => e.date)))].sort();
  const valueWhere = (s, pred) => {
    let v = null;
    for (const e of s) { if (pred(e)) v = e.valeur; else break; }
    return v;
  };
  const out = [{ date: dates[0], v: 100 }];
  let idx = 100;
  for (const d of dates.slice(1)) {
    const ratios = [];
    for (const s of series) {
      const before = valueWhere(s, (e) => e.date < d);
      if (before == null || before <= 0) continue;
      ratios.push(valueWhere(s, (e) => e.date <= d) / before);
    }
    if (!ratios.length) continue;
    idx *= ratios.reduce((a, b) => a + b, 0) / ratios.length;
    out.push({ date: d, v: idx });
  }
  return out;
}

// ---------- Graphique ----------
export function niceTicks(min, max, count = 4) {
  if (!(max > min)) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const r = raw / mag;
  const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
  let lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  if (min >= 0 && lo < 0) lo = 0;
  const ticks = [];
  for (let i = 0; lo + i * step <= hi + step / 2; i++) ticks.push(Number((lo + i * step).toFixed(10)));
  return { ticks, min: lo, max: hi };
}

/**
 * Courbe en escalier (un prix reste valable jusqu'à son prochain changement), prolongée jusqu'à aujourd'hui.
 * points : [{ date, v, note? }] — ref : { v, label } (ex. prix de vente, tracé en pointillés)
 */
export function lineChartSVG({ points, ref = null, fmt = String, today = todayISO(), label = "Évolution" }) {
  if (!points.length) return "";
  const W = 720, H = 300, m = { l: 74, r: 24, t: 24, b: 44 };
  const pts = points.map((p) => ({ ...p, t: parseISODate(p.date).getTime() }));
  const tMin = pts[0].t;
  const tMax = Math.max(pts[pts.length - 1].t, parseISODate(today).getTime(), tMin + 30 * DAY);

  const vals = pts.map((p) => p.v).concat(ref ? [ref.v] : []);
  const vMin = Math.min(...vals), vMax = Math.max(...vals);
  const pad = (vMax - vMin) * 0.15 || 0;
  const y = niceTicks(vMin - pad, vMax + pad);

  const X = (t) => m.l + ((t - tMin) / (tMax - tMin)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((v - y.min) / (y.max - y.min)) * (H - m.t - m.b);
  const f = (n) => n.toFixed(1);

  let d = `M${f(X(pts[0].t))} ${f(Y(pts[0].v))}`;
  for (let i = 1; i < pts.length; i++) d += ` H${f(X(pts[i].t))} V${f(Y(pts[i].v))}`;
  d += ` H${f(X(tMax))}`;

  const grid = y.ticks.map((v) => `
    <line x1="${m.l}" x2="${W - m.r}" y1="${f(Y(v))}" y2="${f(Y(v))}" stroke="#2C2A29" stroke-opacity="0.1" />
    <text x="${m.l - 10}" y="${f(Y(v) + 4)}" text-anchor="end">${esc(fmt(v))}</text>`).join("");

  const xl = [];
  for (let i = 0; i <= 4; i++) {
    const t = tMin + ((tMax - tMin) * i) / 4;
    const txt = new Date(t).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
    if (xl.at(-1)?.txt !== txt) xl.push({ t, txt });
  }
  const xTicks = xl.map(({ t, txt }, i) => `
    <text x="${f(X(t))}" y="${H - m.b + 22}" text-anchor="${i === 0 ? "start" : i === xl.length - 1 ? "end" : "middle"}">${txt}</text>`).join("");

  const refLine = ref ? `
    <line x1="${m.l}" x2="${W - m.r}" y1="${f(Y(ref.v))}" y2="${f(Y(ref.v))}" stroke="#7F7973" stroke-width="1.25" stroke-dasharray="6 4" />
    <text x="${W - m.r}" y="${f(Y(ref.v) - 6)}" text-anchor="end" fill="#2C2A29">${esc(ref.label)}</text>` : "";

  const dots = pts.map((p, i) => `
    <circle cx="${f(X(p.t))}" cy="${f(Y(p.v))}" r="${i === pts.length - 1 ? 5 : 4}" fill="${i === pts.length - 1 ? "#2C2A29" : "#FDFBF7"}" stroke="#2C2A29" stroke-width="1.5">
      <title>${esc(formatDateFR(p.date))} — ${esc(fmt(p.v))}${p.note ? ` — ${esc(p.note)}` : ""}</title>
    </circle>`).join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="${esc(label)}" font-family="Montserrat, sans-serif" font-size="11" fill="#7F7973">
    ${grid}
    <line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="#2C2A29" stroke-opacity="0.35" />
    ${xTicks}
    ${refLine}
    <path d="${d}" fill="none" stroke="#2C2A29" stroke-width="2" stroke-linejoin="round" />
    ${dots}
  </svg>`;
}

// ---------- Prix de vente suggéré à partir du prix de revient ----------
export const MAX_MARKUP_PCT = 40;

/**
 * Prix de vente maximal : revient + 40 %, arrondi au 0,50 € INFÉRIEUR (jamais au-dessus du plafond),
 * donc toujours en « ,00 » ou « ,50 ». Calcul en centimes entiers pour éviter les erreurs de virgule flottante.
 * Retourne null si aucun prix rond ne tient dans [revient ; revient + 40 %] (revient minuscule).
 */
export function suggestSellingPrice(cost, maxMarkupPct = MAX_MARKUP_PCT, stepCents = 50) {
  const cents = Math.round(Number(cost) * 100);
  if (!(cents > 0)) return null;
  const maxCents = Math.floor((cents * (100 + maxMarkupPct)) / 100);
  const priceCents = Math.floor(maxCents / stepCents) * stepCents;
  return priceCents >= cents ? priceCents / 100 : null;
}

/** Majoration d'un prix de vente par rapport au revient, en % (ex. 20 € pour 14,50 € → +37,9 %). */
export const markupPct = (price, cost) => (cost > 0 && price >= 0 ? (price / cost - 1) * 100 : null);
