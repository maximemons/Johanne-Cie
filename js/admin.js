import { db, auth, authReady } from "./config.js";
import {
  ADMIN_EMAIL, EMAIL_LINK_KEY, ALLERGENES, BEST_ID, DRAFT_ID, isDraft, AUTRE_ID, AUTRE_LABEL, MOIS, ORDER_STATUTS,
  esc, formatPrice, formatDateFR, todayISO, tomorrowISO, catName, isCategoryActive,
  groupByCategory, normalizeStatut, hasSeason, seasonLabel, isInSeason, formatPrixPour,
  normalizeOrderStatut, isOrderOpen, normalizeShopSettings, cleanTag, tagKey, productTags, allTags,
  productParfums, cleanParfumName, parfumKey, articleLabel, formatDisplayPrice, PARFUM_MAX_LENGTH
} from "./catalog.js";
import {
  currentCost, sortHistory, upsertEntry, removeEntry, marginOf, lastChange, pctChange,
  formatPct, formatNum, formatDateShort, globalIndexSeries, lineChartSVG,
  suggestSellingPrice, targetPrice, markupPct, pricingRuleLabel, normalizePricing, DEFAULT_PRICING
} from "./costs.js";
import { normalizeLoyalty, DEFAULT_LOYALTY } from "./loyalty.js";
import { createOrderWatcher, showAlert, mountNotifOptIn, notifPermission, orderNumber } from "./web-notify.js";
import {
  collection, onSnapshot, addDoc, updateDoc, setDoc, deleteDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const $ = (id) => document.getElementById(id);
const state = {
  user: null,
  categories: [],
  products: [],
  couts: {},          // prix de revient privés : { [idPâtisserie]: { historique: [...] } }
  costProduct: null,  // pâtisserie dont le détail est ouvert
  orders: [],
  tab: "commandes",
  orderView: "commande",
  orderFilter: "ACTIVES",
  prodCat: "ALL",
  prodSearch: "",
  pricing: { ...DEFAULT_PRICING },            // réglages du prix suggéré (parametres/prix, privé)
  loyalty: normalizeLoyalty(DEFAULT_LOYALTY), // programme de fidélité (parametres/fidelite, public)
  loyaltyDraft: null,                         // paliers en cours d'édition
  shop: normalizeShopSettings(null),          // réglages de la boutique (parametres/boutique, public)
  dirty: { pricing: false, loyalty: false, shop: false },  // un formulaire en cours d'édition n'est pas écrasé par le temps réel
  priceEdit: null                             // ajustement de prix en cours : { id, total, motif, annulerRemise }
};
let unsubscribers = [];

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("translate-y-20", "opacity-0");
  clearTimeout(window.__t);
  window.__t = setTimeout(() => t.classList.add("translate-y-20", "opacity-0"), 2600);
}

const isAdmin = (u) => Boolean(u) && u.email === ADMIN_EMAIL && u.emailVerified;
const run = async (fn, okMsg, errMsg) => {
  try { await fn(); if (okMsg) toast(okMsg); }
  catch (err) { console.error(err); toast(errMsg || "Une erreur est survenue"); }
};

// ---------------- Auth ----------------
$("admin-login-google").addEventListener("click", async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch { toast("Connexion Google impossible"); }
});
$("signout-btn").addEventListener("click", () => signOut(auth));

// Connexion par lien e-mail (sans mot de passe) : le lien prouve la propriété de l'adresse
$("admin-email-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("admin-email").value.trim();
  try {
    await sendSignInLinkToEmail(auth, email, { url: new URL("admin.html", window.location.href).href, handleCodeInApp: true });
    localStorage.setItem(EMAIL_LINK_KEY, email);
    $("admin-info").textContent = `Lien envoyé à ${email}. Ouvrez-le depuis votre messagerie.`;
    $("admin-info").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    toast("Envoi du lien impossible");
  }
});

let linkPending = isSignInWithEmailLink(auth, window.location.href);

async function completeEmailLinkSignIn() {
  if (!linkPending) return;
  try {
    let email = localStorage.getItem(EMAIL_LINK_KEY);
    if (!email) email = window.prompt("Pour confirmer votre connexion, saisissez votre adresse e-mail :");
    if (!email) throw new Error("email manquant");
    await signInWithEmailLink(auth, email.trim(), window.location.href);
    localStorage.removeItem(EMAIL_LINK_KEY);
  } catch (err) {
    console.error(err);
    toast("Lien invalide ou expiré");
  } finally {
    linkPending = false;
    window.history.replaceState(null, "", "admin.html");
    applyUser(auth.currentUser);
  }
}

// Session conservée en cache : restaurée automatiquement au chargement
onAuthStateChanged(auth, (user) => {
  if (!linkPending) applyUser(user);
});
authReady.then(completeEmailLinkSignIn);

function applyUser(user) {
  state.user = user;
  const ok = isAdmin(user);
  $("admin-locked").classList.toggle("hidden", ok);
  $("admin-dashboard").classList.toggle("hidden", !ok);
  $("signout-btn").classList.toggle("hidden", !user);
  $("admin-user-badge").textContent = user?.email || "";
  $("admin-user-badge").classList.toggle("hidden", !user);

  if (!user) {
    $("admin-lock-msg").textContent = "Connectez-vous avec Google ou par lien e-mail avec l'adresse de l'administrateur.";
  } else if (!ok) {
    $("admin-lock-msg").innerHTML = `Compte connecté : <strong>${esc(user.email)}</strong>.<br>L'accès est réservé à l'administrateur.`;
  }

  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  if (ok) startListeners();
}

function startListeners() {
  const handle = (key, after) => (snap) => {
    state[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    after();
  };
  unsubscribers.push(
    onSnapshot(collection(db, "categories"), handle("categories", () => { renderCategories(); renderProductForm(); renderProducts(); renderCosts(); })),
    onSnapshot(collection(db, "patisseries"), handle("products", () => { renderCategories(); renderProducts(); renderCosts(); renderFormTags(); })),
    onSnapshot(
      collection(db, "couts"),
      (snap) => {
        state.couts = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
        $("costs-error").classList.add("hidden");
        renderCosts();
        renderProducts();
      },
      (err) => { console.error(err); $("costs-error").classList.remove("hidden"); }
    ),
    onSnapshot(
      collection(db, "commandes"),
      (snap) => {
        state.orders = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.toMillis?.() ?? Date.now()) - (a.createdAt?.toMillis?.() ?? Date.now()));
        renderOrders();
        if (!snap.metadata.hasPendingWrites) alertAdmin(watchAdminOrders(state.orders));
      },
      (err) => {
        console.error(err);
        $("orders-list").innerHTML = `<p class="text-xs text-red-700">Lecture des commandes refusée. Vérifiez que les règles Firestore (firestore.rules) sont déployées.</p>`;
      }
    ),
    onSnapshot(doc(db, "parametres", "prix"), (snap) => {
      state.pricing = normalizePricing(snap.data());
      renderSettings();
    }, (err) => console.warn("Paramètres de prix :", err)),
    onSnapshot(doc(db, "parametres", "fidelite"), (snap) => {
      state.loyalty = normalizeLoyalty(snap.exists() ? snap.data() : DEFAULT_LOYALTY);
      renderSettings();
    }, (err) => console.warn("Paramètres de fidélité :", err)),
    onSnapshot(doc(db, "parametres", "boutique"), (snap) => {
      state.shop = normalizeShopSettings(snap.data());
      renderSettings();
    }, (err) => console.warn("Paramètres de la boutique :", err))
  );
}

// ---------------- Alertes navigateur (nouvelle commande, annulation par un client) ----------------
const watchAdminOrders = createOrderWatcher("johanne_alertes_admin");
const ADMIN_URL = "admin.html#commandes";

function alertAdmin(changes) {
  const events = changes.filter(({ order, before, now }) =>
    (before === undefined && now === "En attente") ||
    (now === "Annulée" && order.annuleePar === "client"));
  if (events.length > 3) {
    const nouvelles = events.filter((e) => e.now === "En attente").length;
    const annulees = events.length - nouvelles;
    const parts = [nouvelles && `${nouvelles} nouvelle${nouvelles > 1 ? "s" : ""} commande${nouvelles > 1 ? "s" : ""}`, annulees && `${annulees} annulation${annulees > 1 ? "s" : ""}`].filter(Boolean);
    showAlert("Johanne & Cie — commandes", { body: parts.join(" et "), url: ADMIN_URL, tag: "admin-resume" });
    return;
  }
  for (const { order, now } of events) {
    const annulee = now === "Annulée";
    const articles = (order.articles || []).map((a) => `${a.quantity} × ${articleLabel(a)}`).join(", ");
    showAlert(annulee ? `Commande annulée #${orderNumber(order)}` : `Nouvelle commande #${orderNumber(order)}`, {
      body: `${order.userEmail || "Client"} — ${formatPrice(order.total || 0)}${articles ? `\n${articles}` : ""}`,
      url: ADMIN_URL,
      tag: `admin-${order.id}-${now}`
    });
  }
}

mountNotifOptIn($("notif-admin"), {
  texte: "Recevez une alerte à chaque nouvelle commande et à chaque annulation par un client, tant qu'un onglet de l'administration est ouvert (même réduit). Un clic sur l'alerte ouvre les commandes.",
  onTest: () => showAlert("Alerte de test", { body: "Les alertes de commande fonctionnent sur cet appareil.", url: ADMIN_URL, tag: "admin-test" })
});
mountNotifOptIn($("notif-admin-banner"), { texte: "Être alerté à chaque nouvelle commande ou annulation ?" });
if (notifPermission() !== "default") $("notif-admin-banner")?.classList.add("hidden");

// ---------------- Onglets ----------------
const TABS = ["commandes", "patisseries", "categories", "couts", "parametres"];
function showTab(tab) {
  state.tab = tab;
  TABS.forEach((t) => $(`tab-${t}`).classList.toggle("hidden", t !== tab));
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
  history.replaceState(null, "", `#${tab}`);
}
document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
showTab(TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "commandes");
// Lien direct / retour navigateur : l'onglet suit le hash
window.addEventListener("hashchange", () => {
  const t = location.hash.slice(1);
  if (TABS.includes(t) && t !== state.tab) showTab(t);
});

// =============================================================
// COMMANDES
// =============================================================
const STATUT_STYLE = {
  "En attente": "bg-amber-50 text-amber-800 border-amber-200",
  "Acceptée": "bg-sky-50 text-sky-800 border-sky-200",
  "En préparation": "bg-violet-50 text-violet-800 border-violet-200",
  "Prête": "bg-emerald-50 text-emerald-800 border-emerald-200",
  "Retrait partiel": "bg-teal-50 text-teal-800 border-teal-200",
  "Retirée": "bg-stone-100 text-stone-600 border-stone-300",
  "Refusée": "bg-red-50 text-red-800 border-red-200",
  "Annulée": "bg-red-50 text-red-800 border-red-200"
};

// Étapes proposées selon le statut : [libellé du bouton, statut visé, style]
const NEXT_STEPS = {
  "En attente": [["Accepter", "Acceptée", "primary"], ["Refuser", "Refusée", "danger"]],
  "Acceptée": [["En préparation", "En préparation", "primary"], ["Refuser", "Refusée", "danger"]],
  "En préparation": [["Marquer prête", "Prête", "primary"]],
  "Prête": [["Marquer retirée", "Retirée", "primary"]],
  "Retrait partiel": [["Marquer retirée", "Retirée", "primary"]]
};
const STEP_CLS = {
  primary: "bg-[#2C2A29] text-[#FDFBF7] hover:bg-[#43403E]",
  danger: "border border-red-300 text-red-700 hover:bg-red-700 hover:text-white"
};
// Horodatage enregistré à chaque étape
const STEP_FIELD = { "Acceptée": "accepteeLe", "Refusée": "refuseeLe", "En préparation": "preparationLe", "Prête": "preteLe", "Retrait partiel": "retraitPartielLe", "Retirée": "retireeLe", "Annulée": "annuleeLe" };

// Chaque article porte sa propre date ; les anciennes commandes n'ont qu'une date globale
const orderArticles = (o) =>
  (o.articles || []).map((a) => ({ ...a, date: a.dateRetrait || o.dateRetrait || "" }));

const shortId = (o) => o.id.slice(0, 8).toUpperCase();
// Retrait partiel : chaque article peut être remis séparément (ex. précommande retirée plus tard)
const REMISE_STATUTS = ["Acceptée", "En préparation", "Prête", "Retrait partiel", "Retirée"];
const remisCount = (o) => (o.articles || []).filter((a) => a.remis).length;
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const fmtIso = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "");
const statutOf = (o) => normalizeOrderStatut(o.statut);
const isOpen = isOrderOpen;
const fmtTs = (ts) => (ts?.toDate ? ts.toDate().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "");

function initOrderControls() {
  $("order-filter").innerHTML =
    `<option value="ACTIVES">À traiter (en cours)</option><option value="TOUTES">Toutes</option>` +
    ORDER_STATUTS.map((s) => `<option value="${s}">${s}</option>`).join("");
  $("order-filter").value = state.orderFilter;
  document.querySelectorAll(".order-view-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.orderView === state.orderView));
}
initOrderControls();

$("order-filter").addEventListener("change", (e) => { state.orderFilter = e.target.value; renderOrders(); });
document.querySelectorAll(".order-view-btn").forEach((b) =>
  b.addEventListener("click", () => {
    state.orderView = b.dataset.orderView;
    initOrderControls();
    renderOrders();
  })
);

function renderOrders() {
  const pending = state.orders.filter((o) => statutOf(o) === "En attente").length;
  $("pending-badge").textContent = pending;
  $("pending-badge").classList.toggle("hidden", pending === 0);
  $("order-filter").classList.toggle("hidden", state.orderView === "jour");

  // Le temps réel peut redessiner pendant la saisie d'un ajustement de prix : on garde le curseur
  const active = document.activeElement?.closest?.("[data-action='price-field']");
  const field = active?.dataset.field, caret = active?.selectionStart;
  $("orders-list").innerHTML = state.orderView === "jour" ? renderByDay() : renderByOrder();
  if (field) {
    const el = $("orders-list").querySelector(`[data-action='price-field'][data-field='${field}']`);
    el?.focus();
    try { if (caret != null) el.setSelectionRange(caret, caret); } catch { /* champ numérique */ }
  }
}

function renderByOrder() {
  const list = state.orders.filter((o) => {
    if (state.orderFilter === "TOUTES") return true;
    if (state.orderFilter === "ACTIVES") return isOpen(o);
    return statutOf(o) === state.orderFilter;
  });
  if (!list.length) return `<p class="text-xs text-[#7F7973]">Aucune commande dans cette vue.</p>`;

  return list.map((o) => {
    const placed = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString("fr-FR") : "À l'instant";
    const statut = statutOf(o);
    const canRemit = REMISE_STATUTS.includes(statut) && (o.articles || []).length > 1;
    const nRemis = remisCount(o), nArt = (o.articles || []).length;
    const lines = orderArticles(o).map((a, i) => `
      <li class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 ${a.remis ? "opacity-60" : ""}">
        <span>${a.quantity} &times; ${a.remis ? `<s>${esc(articleLabel(a))}</s>` : esc(articleLabel(a))} <span class="text-[#7F7973]">(${formatPrice(a.prix * a.quantity)})</span>${a.precommande ? ` <span class="text-[10px] uppercase tracking-[0.12em] border border-[#2C2A29]/30 px-1.5 py-0.5 ml-1">Précommande</span>` : ""}${a.remis ? ` <span class="text-[10px] uppercase tracking-[0.12em] bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 ml-1">Remis${a.remisLe ? ` le ${esc(fmtIso(a.remisLe))}` : ""}</span>` : ""}</span>
        <span class="flex items-baseline gap-3">
          <span class="text-[#2C2A29] font-medium">${esc(formatDateFR(a.date))}</span>
          ${canRemit ? `<button type="button" data-action="article-remis" data-id="${esc(o.id)}" data-idx="${i}" class="text-[10px] uppercase tracking-[0.15em] underline ${a.remis ? "text-[#7F7973]" : "text-[#2C2A29]"}">${a.remis ? "Annuler la remise" : "Marquer remis"}</button>` : ""}
        </span>
      </li>`).join("");
    const steps = (NEXT_STEPS[statut] || []).map(([label, to, kind]) =>
      `<button type="button" data-action="order-set" data-id="${esc(o.id)}" data-statut="${esc(to)}" class="px-4 py-2 text-[11px] uppercase tracking-[0.15em] transition-colors ${STEP_CLS[kind]}">${label}</button>`).join("");
    const cancelledByClient = statut === "Annulée" && o.annuleePar === "client";

    return `
      <article class="border ${statut === "En attente" ? "border-[#2C2A29]" : "border-[#2C2A29]/15"} bg-white p-5 sm:p-6 space-y-4">
        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-[#2C2A29]/10 pb-3">
          <div>
            <span class="text-[10px] uppercase tracking-[0.2em] text-[#7F7973]">Commande #${esc(shortId(o))}</span>
            <p class="text-sm font-medium mt-0.5">${esc(o.userEmail || "Client")}</p>
            <p class="text-[10px] text-[#7F7973] mt-0.5">Passée le ${esc(placed)}</p>
          </div>
          <div class="text-right space-y-2">
            <span class="font-serif text-xl">${formatPrice(o.total)}</span>
            <div><span class="inline-block text-[11px] px-2 py-0.5 border ${STATUT_STYLE[statut] || ""}">${esc(statut)}${statut === "Retrait partiel" ? ` ${nRemis}/${nArt}` : ""}</span></div>
            ${statut !== "Retrait partiel" && nRemis && nRemis < nArt ? `<div><span class="inline-block text-[11px] px-2 py-0.5 border bg-emerald-50 text-emerald-800 border-emerald-200">Retrait partiel ${nRemis}/${nArt}</span></div>` : ""}
          </div>
        </div>
        <ul class="text-xs space-y-1.5">${lines}</ul>
        ${o.remise?.montant ? `<p class="text-xs text-[#7F7973]">Sous-total ${formatPrice(o.sousTotal ?? (o.total + o.remise.montant))} &bull; remise fidélité −${formatPrice(o.remise.montant)} (−${o.remise.pct} %, ${o.remise.points} pts)</p>` : ""}
        ${o.remiseAnnulee ? `<p class="text-xs text-[#7F7973]">Remise fidélité annulée (−${o.remiseAnnulee.pct} %, ${o.remiseAnnulee.points} pts rendus au client).</p>` : ""}
        ${o.prixAjuste ? `<p class="text-xs text-[#7F7973]">Prix ajusté${fmtTs(o.prixAjuste.le) ? ` le ${esc(fmtTs(o.prixAjuste.le))}` : ""} : ${formatPrice(o.prixAjuste.ancien)} → ${formatPrice(o.total)}${o.prixAjuste.motif ? ` &bull; ${esc(o.prixAjuste.motif)}` : ""}</p>` : ""}
        ${state.priceEdit?.id === o.id ? priceEditor(o) : ""}
        ${o.notes ? `<div class="bg-[#FDFBF7] p-3 border border-[#2C2A29]/10 text-xs text-[#7F7973]"><strong class="text-[#2C2A29]">Note atelier :</strong> ${esc(o.notes)}</div>` : ""}
        ${cancelledByClient ? `<p class="text-xs bg-red-50 border border-red-200 text-red-800 p-3">Annulée par le client${fmtTs(o.annuleeLe) ? ` le ${esc(fmtTs(o.annuleeLe))}` : ""}.</p>` : ""}
        ${statut === "Refusée" && o.motifRefus ? `<p class="text-xs text-[#7F7973]"><strong class="text-[#2C2A29]">Motif du refus :</strong> ${esc(o.motifRefus)}</p>` : ""}
        <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div class="flex flex-wrap gap-2">${steps}</div>
          <div class="flex items-center gap-4">
            <label class="text-[10px] uppercase tracking-[0.15em] text-[#7F7973] flex items-center gap-2">Statut
              <select data-action="order-status" data-id="${esc(o.id)}" class="px-2 py-1 text-xs border border-[#2C2A29]/30 bg-[#FDFBF7] normal-case tracking-normal focus:outline-none">
                ${ORDER_STATUTS.map((s) => `<option ${s === statut ? "selected" : ""}>${s}</option>`).join("")}
              </select>
            </label>
            ${state.priceEdit?.id === o.id ? "" : `<button type="button" data-action="price-edit" data-id="${esc(o.id)}" class="text-[10px] uppercase tracking-[0.15em] underline">Modifier le prix</button>`}
            <button type="button" data-action="order-delete" data-id="${esc(o.id)}" class="text-[10px] uppercase tracking-[0.15em] text-red-700 underline">Supprimer</button>
          </div>
        </div>
      </article>`;
  }).join("");
}

/** Change le statut d'une commande (avec motif facultatif en cas de refus). */
function setOrderStatus(id, statut) {
  const extra = {};
  if (statut === "Refusée") {
    const motif = window.prompt("Motif du refus (facultatif, affiché au client) :", "");
    if (motif === null) return; // abandon
    if (motif.trim()) extra.motifRefus = motif.trim();
  }
  if (statut === "Retirée" || statut === "Retrait partiel") {
    // Plusieurs articles encore à remettre : l'atelier choisit lesquels partent aujourd'hui
    const o = state.orders.find((x) => x.id === id);
    const restants = (o?.articles || []).filter((a) => !a.remis).length;
    if ((o?.articles || []).length > 1 && restants > 0) return openPickupModal(id, statut);
    if (statut === "Retrait partiel") return toast("Retrait partiel impossible : choisissez « Retirée »");
  }
  if (STEP_FIELD[statut]) extra[STEP_FIELD[statut]] = serverTimestamp();
  if (statut === "Retirée") {
    // Retrait global : les articles pas encore remis le sont maintenant
    const o = state.orders.find((x) => x.id === id);
    const now = new Date().toISOString();
    if (o?.articles?.some((a) => !a.remis)) {
      extra.articles = o.articles.map((a) => (a.remis ? a : { ...a, remis: true, remisLe: now }));
    }
    extra.retraitPartiel = false;
  }
  run(() => updateDoc(doc(db, "commandes", id), { statut, ...extra }), `Commande : ${statut.toLowerCase()}`);
}

// ---------- Retrait : choix des articles remis au client ----------
let pickup = null; // { id, statut visé, checked: Set des index cochés }
let focusBeforePickup = null;

/** Ouvre la popup de retrait ; les articles à retirer aujourd'hui sont cochés d'office. */
function openPickupModal(id, statutVise) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return;
  const today = todayISO();
  const checked = new Set();
  orderArticles(o).forEach((a, i) => { if (!a.remis && a.date === today) checked.add(i); });
  pickup = { id, statutVise, checked, nbArticles: o.articles.length };
  focusBeforePickup = document.activeElement;
  renderPickupModal();
  $("pickup-modal").classList.remove("hidden");
  $("pickup-modal-body").querySelector("input[type=checkbox]:not(:disabled)")?.focus();
}

function renderPickupModal() {
  const o = state.orders.find((x) => x.id === pickup?.id);
  if (!o) return closePickupModal();
  const today = todayISO();
  const arts = orderArticles(o);
  const dejaRemis = arts.filter((a) => a.remis).length;
  const total = dejaRemis + pickup.checked.size;
  const toutes = total === arts.length;
  const dateTag = (d) => !d ? "" : d === today ? "Aujourd'hui" : d < today ? "En retard" : "";

  const ligne = (a, i) => {
    const tag = dateTag(a.date);
    if (a.remis) {
      return `
        <li class="flex items-start gap-3 p-3 opacity-60">
          <input type="checkbox" checked disabled class="mt-0.5 accent-[#2C2A29]" aria-label="${esc(articleLabel(a))} : déjà retiré" />
          <span class="flex-1">${a.quantity} &times; ${esc(articleLabel(a))}<span class="block text-[11px] text-[#7F7973]">Déjà retiré${a.remisLe ? ` le ${esc(fmtIso(a.remisLe))}` : ""}</span></span>
        </li>`;
    }
    return `
      <li>
        <label class="flex items-start gap-3 p-3 cursor-pointer hover:bg-[#FDFBF7]">
          <input type="checkbox" data-action="pickup-check" data-idx="${i}" ${pickup.checked.has(i) ? "checked" : ""} class="mt-0.5 accent-[#2C2A29]" />
          <span class="flex-1">${a.quantity} &times; ${esc(articleLabel(a))}${a.precommande ? ` <span class="text-[10px] uppercase tracking-[0.12em] border border-[#2C2A29]/30 px-1.5 py-0.5 ml-1">Précommande</span>` : ""}
            <span class="block text-[11px] text-[#7F7973]">Retrait prévu ${esc(formatDateFR(a.date))}</span></span>
          ${tag ? `<span class="text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 border ${tag === "En retard" ? "bg-red-50 text-red-800 border-red-200" : "bg-[#2C2A29] text-[#FDFBF7] border-[#2C2A29]"}">${tag}</span>` : ""}
        </label>
      </li>`;
  };

  const issue = !pickup.checked.size
    ? "Cochez au moins un article."
    : toutes ? "Tous les articles seront retirés : la commande passera « Retirée »."
    : `${total} article${total > 1 ? "s" : ""} sur ${arts.length} retiré${total > 1 ? "s" : ""} : la commande passera « Retrait partiel ».`;

  $("pickup-modal-body").innerHTML = `
    <div class="space-y-1">
      <h3 id="pickup-modal-title" class="font-serif text-2xl">Qu'est-ce qui part aujourd'hui ?</h3>
      <p class="text-sm text-[#7F7973]">Commande #${esc(shortId(o))} &bull; ${esc(o.userEmail || "Client")}. Les articles prévus aujourd'hui sont cochés.</p>
    </div>
    <ul class="border border-[#2C2A29]/15 bg-white divide-y divide-[#2C2A29]/10 text-sm">${arts.map(ligne).join("")}</ul>
    <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
      <p class="${pickup.checked.size ? "text-[#2C2A29]" : "text-amber-800"}" aria-live="polite">${issue}</p>
      <button type="button" data-action="pickup-all" class="text-[10px] uppercase tracking-[0.15em] underline">${arts.some((a, i) => !a.remis && !pickup.checked.has(i)) ? "Tout cocher" : "Tout décocher"}</button>
    </div>
    <div class="flex flex-col-reverse sm:flex-row gap-3">
      <button type="button" data-action="pickup-cancel" class="flex-1 px-4 py-3 border border-[#2C2A29] text-xs uppercase tracking-[0.15em] hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors">Annuler</button>
      <button type="button" data-action="pickup-save" ${pickup.checked.size ? "" : "disabled"} class="flex-1 px-4 py-3 bg-[#2C2A29] text-[#FDFBF7] text-xs uppercase tracking-[0.15em] hover:bg-[#43403E] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">${toutes ? "Marquer retirée" : "Valider le retrait partiel"}</button>
    </div>`;
}

function closePickupModal() {
  pickup = null;
  $("pickup-modal").classList.add("hidden");
  $("pickup-modal-body").innerHTML = "";
  focusBeforePickup?.focus?.();
  focusBeforePickup = null;
}

function savePickup() {
  const o = state.orders.find((x) => x.id === pickup?.id);
  if (!o || !pickup.checked.size) return;
  if ((o.articles || []).length !== pickup.nbArticles) {
    toast("La commande a changé entre-temps : vérifiez la sélection");
    return renderPickupModal();
  }
  const now = new Date().toISOString();
  const articles = o.articles.map((a, i) => (pickup.checked.has(i) && !a.remis ? { ...a, remis: true, remisLe: now } : a));
  const n = articles.filter((a) => a.remis).length;
  const upd = { articles };
  let msg;
  if (n === articles.length) {
    Object.assign(upd, { statut: "Retirée", retireeLe: serverTimestamp(), retraitPartiel: false });
    msg = "Commande : retirée";
  } else {
    Object.assign(upd, { statut: "Retrait partiel", retraitPartielLe: serverTimestamp(), retraitPartiel: true });
    msg = `Retrait partiel ${n}/${articles.length}`;
  }
  const id = o.id;
  closePickupModal();
  run(() => updateDoc(doc(db, "commandes", id), upd), msg);
}

/** Remise (ou annulation de la remise) d'un seul article. Tout remis → « Retirée », une partie → « Retrait partiel ». */
function toggleArticleRemis(id, idx) {
  const o = state.orders.find((x) => x.id === id);
  if (!o?.articles?.[idx]) return;
  const articles = o.articles.map((a) => ({ ...a }));
  const a = articles[idx];
  if (a.remis) { delete a.remis; delete a.remisLe; }
  else { a.remis = true; a.remisLe = new Date().toISOString(); }
  const n = articles.filter((x) => x.remis).length;
  const upd = { articles, retraitPartiel: n > 0 && n < articles.length };
  let msg = a.remis ? `« ${articleLabel(a)} » remis` : `Remise de « ${articleLabel(a)} » annulée`;
  if (n === articles.length) {
    upd.statut = "Retirée";
    upd.retireeLe = serverTimestamp();
    msg = "Tout est remis : commande retirée";
  } else if (n > 0) {
    if (statutOf(o) !== "Retrait partiel") {
      upd.statut = "Retrait partiel";
      upd.retraitPartielLe = serverTimestamp();
    }
  } else if (["Retrait partiel", "Retirée"].includes(statutOf(o))) {
    upd.statut = "Prête"; // plus rien n'est parti
  }
  run(() => updateDoc(doc(db, "commandes", id), upd), msg);
}

/** Formulaire d'ajustement du prix d'une commande. */
function priceEditor(o) {
  const d = state.priceEdit;
  return `
    <div class="border border-[#2C2A29] bg-[#FDFBF7] p-4 space-y-3 text-xs">
      <p class="text-[11px] uppercase tracking-[0.15em]">Modifier le prix de la commande</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="space-y-1"><span class="block text-[10px] uppercase tracking-[0.15em] text-[#7F7973]">Nouveau total (€)</span>
          <input type="number" min="0" step="0.01" value="${esc(d.total)}" data-action="price-field" data-field="total" class="w-full px-3 py-2 text-sm border border-[#2C2A29]/30 bg-white focus:outline-none focus:border-[#2C2A29]" /></label>
        <label class="space-y-1"><span class="block text-[10px] uppercase tracking-[0.15em] text-[#7F7973]">Motif (affiché au client, facultatif)</span>
          <input type="text" maxlength="200" value="${esc(d.motif)}" data-action="price-field" data-field="motif" placeholder="Ex : remise non valable" class="w-full px-3 py-2 text-sm border border-[#2C2A29]/30 bg-white focus:outline-none focus:border-[#2C2A29]" /></label>
      </div>
      ${o.remise ? `<label class="flex items-center gap-2"><input type="checkbox" data-action="price-remise" ${d.annulerRemise ? "checked" : ""} class="accent-[#2C2A29]" /> Annuler la remise fidélité (−${formatPrice(o.remise.montant)}) et rendre les ${o.remise.points} pts au client</label>` : ""}
      <p class="text-[#7F7973]">Actuel : ${formatPrice(o.total)}${o.sousTotal != null ? ` (sous-total ${formatPrice(o.sousTotal)})` : ""}. Les points de fidélité gagnés suivent le nouveau total.</p>
      <div class="flex gap-3">
        <button type="button" data-action="price-save" data-id="${esc(o.id)}" class="px-4 py-2 bg-[#2C2A29] text-[#FDFBF7] text-[11px] uppercase tracking-[0.15em] hover:bg-[#43403E]">Enregistrer</button>
        <button type="button" data-action="price-cancel" class="px-4 py-2 border border-[#2C2A29]/40 text-[11px] uppercase tracking-[0.15em]">Annuler</button>
      </div>
    </div>`;
}

function savePriceEdit(id) {
  const o = state.orders.find((x) => x.id === id);
  const d = state.priceEdit;
  if (!o || d?.id !== id) return;
  const raw = String(d.total).replace(",", ".").trim();
  const total = round2(raw);
  if (raw === "" || !(total >= 0)) return toast("Total invalide");
  const upd = {};
  if (d.annulerRemise && o.remise) { upd.remise = null; upd.remiseAnnulee = o.remise; }
  if (total !== round2(o.total)) {
    upd.total = total;
    upd.prixAjuste = { ancien: o.prixAjuste?.ancien ?? o.total, motif: d.motif.trim(), le: serverTimestamp() };
  } else if (o.prixAjuste && d.motif.trim() !== (o.prixAjuste.motif || "")) {
    upd.prixAjuste = { ...o.prixAjuste, motif: d.motif.trim() };
  }
  if (!Object.keys(upd).length) { state.priceEdit = null; renderOrders(); return; }
  run(async () => {
    await updateDoc(doc(db, "commandes", id), upd);
    state.priceEdit = null;
    renderOrders();
  }, "Prix de la commande mis à jour", "Erreur lors de la mise à jour du prix");
}

// Planning de production : tout ce qu'il faut préparer, jour par jour
function renderByDay() {
  const days = new Map();
  for (const o of state.orders.filter(isOpen)) {
    for (const a of orderArticles(o)) {
      if (a.remis) continue; // déjà remis au client
      if (!days.has(a.date)) days.set(a.date, []);
      days.get(a.date).push({ ...a, order: o });
    }
  }
  if (!days.size) return `<p class="text-xs text-[#7F7973]">Rien à préparer pour le moment.</p>`;

  const today = todayISO(), tomorrow = tomorrowISO();
  const keys = [...days.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));

  return keys.map((date) => {
    const lines = days.get(date);
    const totals = new Map();
    // une ligne par recette ET par parfum (« Bûche roulée — Praliné »), triées pour que les parfums d'une recette se suivent
    lines.forEach((l) => totals.set(articleLabel(l), (totals.get(articleLabel(l)) || 0) + l.quantity));
    const sortedTotals = [...totals].sort((a, b) => a[0].localeCompare(b[0], "fr"));
    const tag = !date ? "" : date < today ? "En retard" : date === today ? "Aujourd'hui" : date === tomorrow ? "Demain" : "";
    const tagCls = date && date < today ? "bg-red-50 text-red-800 border-red-200" : "bg-[#2C2A29] text-[#FDFBF7] border-[#2C2A29]";

    return `
      <article class="border border-[#2C2A29]/15 bg-white p-5 sm:p-6 space-y-4">
        <div class="flex flex-wrap items-center gap-3 border-b border-[#2C2A29]/10 pb-3">
          <h3 class="font-serif text-xl capitalize">${esc(formatDateFR(date))}</h3>
          ${tag ? `<span class="text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 border ${tagCls}">${tag}</span>` : ""}
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-[0.18em] text-[#7F7973] mb-1">À préparer</p>
          <p class="text-sm">${sortedTotals.map(([n, q]) => `<strong>${q}&times;</strong> ${esc(n)}`).join(" &nbsp;&bull;&nbsp; ")}</p>
        </div>
        <ul class="text-xs space-y-1 text-[#7F7973]">
          ${lines.map((l) => `<li>${l.quantity} &times; ${esc(articleLabel(l))} &mdash; #${esc(shortId(l.order))} &middot; ${esc(l.order.userEmail || "Client")} &middot; <em>${esc(statutOf(l.order))}</em></li>`).join("")}
        </ul>
      </article>`;
  }).join("");
}

// =============================================================
// PÂTISSERIES
// =============================================================
const productForm = $("product-form");

function monthOptions(selected) {
  return MOIS.map((m, i) => `<option value="${i + 1}" ${i + 1 === selected ? "selected" : ""}>${m[0].toUpperCase() + m.slice(1)}</option>`).join("");
}
$("prod-allergenes").innerHTML = ALLERGENES
  .map((a) => `<label class="flex items-center gap-2"><input type="checkbox" value="${esc(a)}" class="prod-allergene accent-[#2C2A29]" /> ${esc(a)}</label>`)
  .join("");
const checkedAllergenes = () => [...document.querySelectorAll(".prod-allergene:checked")].map((c) => c.value);
// ---------- Tags du formulaire ----------
let formTags = [];

function addFormTags(raw) {
  const known = allTags(state.products);
  for (const part of String(raw).split(",")) {
    const t = cleanTag(part);
    if (!t || formTags.some((x) => tagKey(x) === tagKey(t))) continue;
    // reprend la graphie déjà utilisée dans le catalogue (« Chocolat » plutôt que « chocolat »)
    formTags.push(known.find((k) => tagKey(k) === tagKey(t)) || t);
  }
  renderFormTags();
}

function renderFormTags() {
  $("prod-tags").innerHTML = formTags.map((t, i) => `
    <span class="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 border border-[#2C2A29]/30 bg-white text-xs">
      ${esc(t)}
      <button type="button" data-remove-tag="${i}" aria-label="Retirer le tag ${esc(t)}" class="w-5 h-5 leading-none text-[#7F7973] hover:text-[#2C2A29]">&times;</button>
    </span>`).join("");
  const unused = allTags(state.products).filter((t) => !formTags.some((x) => tagKey(x) === tagKey(t)));
  $("prod-tag-suggestions").innerHTML = unused.map((t) => `<option value="${esc(t)}"></option>`).join("");
  const existing = $("prod-tag-existing");
  existing.classList.toggle("hidden", !unused.length);
  existing.innerHTML = unused.length
    ? `<span class="text-[#7F7973] mr-1">Déjà utilisés :</span>` + unused.map((t) =>
        `<button type="button" data-add-tag="${esc(t)}" class="px-2 py-0.5 border border-dashed border-[#2C2A29]/30 text-[#2C2A29] hover:border-[#2C2A29]">+ ${esc(t)}</button>`).join("")
    : "";
}

const tagInput = $("prod-tag-input");
tagInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault(); // Entrée n'envoie pas le formulaire
    addFormTags(tagInput.value);
    tagInput.value = "";
  } else if (e.key === "Backspace" && !tagInput.value && formTags.length) {
    formTags.pop();
    renderFormTags();
  }
});
// Choix dans la liste de suggestions, ou collage de « a, b, c »
tagInput.addEventListener("input", () => {
  const v = tagInput.value;
  if (v.includes(",") || allTags(state.products).some((t) => t === v)) {
    addFormTags(v);
    tagInput.value = "";
  }
});
tagInput.addEventListener("blur", () => { if (tagInput.value.trim()) { addFormTags(tagInput.value); tagInput.value = ""; } });
$("prod-tags").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-remove-tag]");
  if (!b) return;
  formTags.splice(Number(b.dataset.removeTag), 1);
  renderFormTags();
  tagInput.focus();
});
$("prod-tag-existing").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-add-tag]");
  if (b) addFormTags(b.dataset.addTag);
});

// ---------- Parfums du formulaire ----------
// Lignes éditées : { nom, prix, image, dispo, description, composition }
// (prix "" = prix de la pâtisserie ; description / composition vides = celles de la fiche générale)
let formParfums = [];

/** Relit les champs (la saisie n'est pas redessinée à chaque frappe). */
function readFormParfums() {
  document.querySelectorAll("#prod-parfums [data-parfum-row]").forEach((row) => {
    const i = Number(row.dataset.parfumRow);
    if (!formParfums[i]) return;
    formParfums[i] = {
      nom: row.querySelector("[data-pf='nom']").value,
      prix: row.querySelector("[data-pf='prix']").value.trim(),
      image: row.querySelector("[data-pf='image']").value.trim(),
      dispo: row.querySelector("[data-pf='dispo']").checked,
      description: row.querySelector("[data-pf='description']").value.trim(),
      composition: row.querySelector("[data-pf='composition']").value.trim()
    };
  });
}

/** Noms de parfums déjà utilisés sur d'autres pâtisseries (une graphie par parfum). */
function knownParfumNames() {
  const byKey = new Map();
  state.products.forEach((p) => productParfums(p).forEach((x) => { if (!byKey.has(parfumKey(x.nom))) byKey.set(parfumKey(x.nom), x.nom); }));
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
}

function renderFormParfums() {
  const box = $("prod-parfums");
  box.innerHTML = formParfums.length
    ? formParfums.map((x, i) => `
      <div data-parfum-row="${i}" class="border border-[#2C2A29]/15 bg-white p-3 flex gap-3">
        <div class="w-16 h-16 shrink-0 bg-[#F4F0E8] border border-[#2C2A29]/10 overflow-hidden">
          <img data-pf-preview src="${esc(/^https?:\/\//i.test(x.image) ? x.image : "assets/logo.svg")}" alt="" class="w-full h-full ${/^https?:\/\//i.test(x.image) ? "object-cover" : "object-contain p-1 opacity-60"}" />
        </div>
        <div class="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-6 gap-2">
          <div class="sm:col-span-3"><label class="lbl" for="pf-nom-${i}">Parfum</label><input id="pf-nom-${i}" data-pf="nom" type="text" maxlength="${PARFUM_MAX_LENGTH}" value="${esc(x.nom)}" placeholder="Ex : Praliné" class="inp" /></div>
          <div class="sm:col-span-2"><label class="lbl" for="pf-prix-${i}">Prix (&euro;)</label><input id="pf-prix-${i}" data-pf="prix" type="number" step="0.01" min="0" value="${esc(x.prix)}" placeholder="${esc($("prod-prix").value || "Prix de base")}" class="inp" /></div>
          <label class="sm:col-span-1 flex items-center gap-2 text-xs sm:pt-6"><input data-pf="dispo" type="checkbox" ${x.dispo ? "checked" : ""} class="accent-[#2C2A29]" /> Disponible</label>
          <div class="sm:col-span-6"><label class="lbl" for="pf-image-${i}">Image du parfum (URL, optionnel)</label><input id="pf-image-${i}" data-pf="image" type="url" value="${esc(x.image)}" placeholder="https://..." class="inp" /></div>
          <div class="sm:col-span-6"><label class="lbl" for="pf-desc-${i}">Description courte du parfum (optionnel)</label><textarea id="pf-desc-${i}" data-pf="description" rows="2" placeholder="Vide = description de la pâtisserie" class="inp">${esc(x.description)}</textarea></div>
          <div class="sm:col-span-6"><label class="lbl" for="pf-compo-${i}">Composition du parfum (optionnel)</label><textarea id="pf-compo-${i}" data-pf="composition" rows="2" placeholder="Vide = composition de la pâtisserie" class="inp">${esc(x.composition)}</textarea></div>
        </div>
        <div class="flex flex-col gap-1 shrink-0">
          <button type="button" data-pf-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="Monter ${esc(x.nom || "ce parfum")}" class="w-8 h-8 border border-[#2C2A29]/30 hover:border-[#2C2A29] disabled:opacity-30">&uarr;</button>
          <button type="button" data-pf-down="${i}" ${i === formParfums.length - 1 ? "disabled" : ""} aria-label="Descendre ${esc(x.nom || "ce parfum")}" class="w-8 h-8 border border-[#2C2A29]/30 hover:border-[#2C2A29] disabled:opacity-30">&darr;</button>
          <button type="button" data-pf-remove="${i}" aria-label="Retirer ${esc(x.nom || "ce parfum")}" class="w-8 h-8 border border-red-300 text-red-700 hover:bg-red-700 hover:text-white">&times;</button>
        </div>
      </div>`).join("")
    : `<p class="text-xs text-[#7F7973]">Aucun parfum : pas de choix proposé au client.</p>`;

  renderParfumSuggestions();
}

/** Boutons « Déjà utilisés » (mis à jour sans redessiner la saisie en cours). */
function renderParfumSuggestions() {
  readFormParfums();
  const used = new Set(formParfums.map((x) => parfumKey(x.nom)));
  const unused = knownParfumNames().filter((n) => !used.has(parfumKey(n)));
  $("prod-parfum-existing").innerHTML = unused.length
    ? `<span class="text-[#7F7973] mr-1">Déjà utilisés :</span>` + unused.map((n) =>
        `<button type="button" data-add-parfum="${esc(n)}" class="px-2 py-0.5 border border-dashed border-[#2C2A29]/30 hover:border-[#2C2A29]">+ ${esc(n)}</button>`).join("")
    : "";
}

function addFormParfum(nom = "") {
  readFormParfums();
  formParfums.push({ nom, prix: "", image: "", dispo: true, description: "", composition: "" });
  renderFormParfums();
  const inputs = document.querySelectorAll("#prod-parfums [data-pf='" + (nom ? "prix" : "nom") + "']");
  inputs[inputs.length - 1]?.focus();
}

renderFormParfums();
$("prod-parfum-add").addEventListener("click", () => addFormParfum());
$("prod-parfum-existing").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-add-parfum]");
  if (b) addFormParfum(b.dataset.addParfum);
});
$("prod-parfums").addEventListener("click", (e) => {
  const up = e.target.closest("button[data-pf-up]");
  const down = e.target.closest("button[data-pf-down]");
  const rm = e.target.closest("button[data-pf-remove]");
  if (!up && !down && !rm) return;
  readFormParfums();
  if (rm) formParfums.splice(Number(rm.dataset.pfRemove), 1);
  else {
    const i = Number((up || down).dataset[up ? "pfUp" : "pfDown"]);
    const j = up ? i - 1 : i + 1;
    if (j < 0 || j >= formParfums.length) return;
    [formParfums[i], formParfums[j]] = [formParfums[j], formParfums[i]];
  }
  renderFormParfums();
});
// Aperçu de l'image dès que l'URL est saisie
$("prod-parfums").addEventListener("input", (e) => {
  const inp = e.target.closest("[data-pf='image']");
  if (!inp) return;
  const img = inp.closest("[data-parfum-row]").querySelector("img[data-pf-preview]");
  const ok = /^https?:\/\//i.test(inp.value.trim());
  img.src = ok ? inp.value.trim() : "assets/logo.svg";
  img.className = `w-full h-full ${ok ? "object-cover" : "object-contain p-1 opacity-60"}`;
});
// Le prix de base sert d'indication dans les prix de parfum laissés vides
$("prod-prix").addEventListener("input", () => {
  document.querySelectorAll("#prod-parfums [data-pf='prix']").forEach((i) => { i.placeholder = $("prod-prix").value || "Prix de base"; });
});

/** Parfums à enregistrer, ou { error } si la saisie est incomplète. */
function collectFormParfums() {
  readFormParfums();
  const out = [], seen = new Set();
  for (const x of formParfums) {
    const nom = cleanParfumName(x.nom);
    if (!nom && !x.prix && !x.image && !x.description && !x.composition) continue; // ligne laissée vide
    if (!nom) return { error: "Chaque parfum doit avoir un nom" };
    if (seen.has(parfumKey(nom))) return { error: `Parfum en double : « ${nom} »` };
    seen.add(parfumKey(nom));
    const prix = x.prix === "" ? null : Number(x.prix);
    if (prix !== null && !(prix >= 0)) return { error: `Prix invalide pour « ${nom} »` };
    if (x.image && !/^https?:\/\//i.test(x.image)) return { error: `Image invalide pour « ${nom} » (URL https://…)` };
    out.push({ nom, prix, image: x.image || "", dispo: x.dispo !== false, description: x.description || "", composition: x.composition || "" });
  }
  return { parfums: out };
}

const parseUrlLines = (txt) => [...new Set(txt.split(/\s*\n\s*/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)))];

$("prod-saison-debut").innerHTML = monthOptions(1);
$("prod-saison-fin").innerHTML = monthOptions(12);
$("prod-saison-mode").addEventListener("change", (e) =>
  $("prod-saison-range").classList.toggle("hidden", e.target.value !== "periode")
);

function renderProductForm() {
  const sel = $("prod-categorie");
  const current = sel.value;
  sel.innerHTML =
    `<option value="">${AUTRE_LABEL} (sans catégorie)</option>` +
    state.categories
      .filter(isCategoryActive)
      .map((c) => `<option value="${esc(c.id)}">${esc(catName(c))}</option>`)
      .join("");
  sel.value = current;

  const f = $("prod-filter-cat");
  const fcur = state.prodCat;
  f.innerHTML =
    `<option value="ALL">Toutes les catégories</option><option value="${BEST_ID}">&#9733; Best-Sellers</option><option value="${DRAFT_ID}">&#9998; Brouillons</option>` +
    groupByCategory(state.categories, [], { includeEmpty: true })
      .map((g) => `<option value="${esc(g.id)}">${esc(g.nom)}</option>`).join("");
  f.value = fcur;
  renderFormTags();
  renderParfumSuggestions();
}

// Proposition de prix dès la saisie du prix de revient (création ou modification) :
// « Valider » remplit le champ Prix du formulaire, qu'il reste à enregistrer.
let formOfferedCost = null; // dernier revient pour lequel la popup a été proposée dans ce formulaire

$("prod-revient").addEventListener("change", () => {
  const raw = $("prod-revient").value.trim();
  const cout = Number(raw);
  if (raw === "" || !(cout > 0)) return;
  const id = $("prod-edit-id").value;
  if (id && cout === currentCost(state.couts[id]?.historique)) return; // inchangé
  formOfferedCost = cout;
  const prixRaw = $("prod-prix").value.trim();
  offerSellingPrice({
    id: id || null,
    nom: $("prod-nom").value.trim() || "Nouvelle pâtisserie",
    cout,
    prix: prixRaw === "" ? null : Number(prixRaw),
    target: "form"
  });
});

function resetProductForm() {
  formOfferedCost = null;
  productForm.reset();
  formTags = [];
  renderFormTags();
  formParfums = [];
  renderFormParfums();
  $("prod-edit-id").value = "";
  $("prod-brouillon").checked = false;
  $("prod-saison-range").classList.add("hidden");
  $("product-form-title").textContent = "Ajouter une pâtisserie";
  $("prod-submit-btn").textContent = "Enregistrer la pâtisserie";
  $("prod-cancel-edit").classList.add("hidden");
}
$("prod-cancel-edit").addEventListener("click", resetProductForm);

productForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!isAdmin(state.user)) return;
  // La proposition de prix (ouverte par la saisie du revient) doit être tranchée avant d'enregistrer
  if (!$("price-modal").classList.contains("hidden")) return;
  const id = $("prod-edit-id").value;
  const pf = collectFormParfums();
  if (pf.error) {
    $("prod-parfums").scrollIntoView({ behavior: "smooth", block: "center" });
    return toast(pf.error);
  }
  const periode = $("prod-saison-mode").value === "periode";
  const pourNombre = parseInt($("prod-pour-nombre").value, 10);
  const pourMax = parseInt($("prod-pour-max").value, 10);
  const data = {
    prixPour: pourNombre >= 1
      ? { nombre: pourNombre, nombreMax: pourMax > pourNombre ? pourMax : null, unite: $("prod-pour-unite").value }
      : null,
    unite: $("prod-pour-unite").value,
    nom: $("prod-nom").value.trim(),
    categorieId: $("prod-categorie").value,
    prix: Number($("prod-prix").value),
    statut: $("prod-statut").value,
    brouillon: $("prod-brouillon").checked,
    saison: periode ? { debut: Number($("prod-saison-debut").value), fin: Number($("prod-saison-fin").value) } : null,
    imageUrl: $("prod-image").value.trim(),
    images: parseUrlLines($("prod-images").value),
    description: $("prod-desc").value.trim(),
    conservation: $("prod-conservation").value.trim(),
    composition: $("prod-composition").value.trim(),
    parts: $("prod-parts").value.trim(),
    poids: $("prod-poids").value.trim(),
    allergenes: checkedAllergenes(),
    tags: (addFormTags(tagInput.value), tagInput.value = "", [...formTags]),
    parfums: pf.parfums
  };
  const revientRaw = $("prod-revient").value.trim();
  const revient = revientRaw === "" ? null : Number(revientRaw);
  if (revient !== null && !(revient >= 0)) return toast("Prix de revient invalide");
  run(async () => {
    let pid = id;
    let offer = null;
    if (id) await updateDoc(doc(db, "patisseries", id), data);
    else pid = (await addDoc(collection(db, "patisseries"), { ...data, createdAt: serverTimestamp() })).id;
    // Un prix de revient modifié s'ajoute à l'historique (daté d'aujourd'hui)
    if (revient !== null && revient !== currentCost(state.couts[pid]?.historique)) {
      const { isCurrent } = await saveCost(pid, revient, todayISO());
      // Popup après coup seulement si elle n'a pas déjà été proposée pendant la saisie
      if (isCurrent && revient > 0 && formOfferedCost !== revient) offer = { id: pid, nom: data.nom, cout: revient, prix: data.prix, target: "db" };
    }
    resetProductForm();
    if (offer) offerSellingPrice(offer); // popup : valider le prix de vente suggéré
  }, `${id ? "Pâtisserie mise à jour" : "Pâtisserie ajoutée"}${data.brouillon ? " (brouillon, invisible en boutique)" : ""}`, "Erreur lors de l'enregistrement");
});

$("prod-search").addEventListener("input", (e) => { state.prodSearch = e.target.value.trim().toLowerCase(); renderProducts(); });
$("prod-filter-cat").addEventListener("change", (e) => { state.prodCat = e.target.value; renderProducts(); });

function renderProducts() {
  const box = $("admin-products-list");
  if (!state.products.length) {
    box.innerHTML = `<p class="text-xs text-[#7F7973] md:col-span-2">Aucune pâtisserie enregistrée.</p>`;
    return;
  }
  const groups = groupByCategory(state.categories, state.products, { includeEmpty: true });
  const catOf = new Map();
  groups.forEach((g) => g.products.forEach((p) => catOf.set(p.id, g)));

  const bestCount = state.products.filter((p) => p.bestSeller === true).length;
  const draftCount = state.products.filter(isDraft).length;
  $("best-count").textContent = [
    bestCount && `\u2605 ${bestCount} best-seller${bestCount > 1 ? "s" : ""}`,
    draftCount && `\u270E ${draftCount} brouillon${draftCount > 1 ? "s" : ""}`
  ].filter(Boolean).join(" \u00B7 ");

  const items = (state.prodCat === BEST_ID
    ? groups.flatMap((g) => g.products).filter((p) => p.bestSeller === true)
    : state.prodCat === DRAFT_ID
    ? groups.flatMap((g) => g.products).filter(isDraft)
    : groups.filter((g) => state.prodCat === "ALL" || g.id === state.prodCat).flatMap((g) => g.products))
    .filter((p) => !state.prodSearch
      || String(p.nom || "").toLowerCase().includes(state.prodSearch)
      || productTags(p).some((t) => tagKey(t).includes(state.prodSearch)));

  if (!items.length) {
    box.innerHTML = `<p class="text-xs text-[#7F7973] md:col-span-2">Aucun résultat.</p>`;
    return;
  }

  box.innerHTML = items.map((p) => {
    const statut = normalizeStatut(p.statut);
    const g = catOf.get(p.id);
    const orphan = g.id === AUTRE_ID && p.categorieId;
    const autoOff = statut === "Disponible" && !isInSeason(p.saison);
    const chip =
      statut === "Disponible" ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : statut === "Épuisé" ? "bg-red-50 text-red-800 border-red-200"
      : "bg-stone-100 text-stone-700 border-stone-300";
    const season = seasonLabel(p.saison);
    const draft = isDraft(p);
    return `
      <article class="${draft ? "border border-dashed border-violet-300 bg-violet-50/40" : "border border-[#2C2A29]/15 bg-white"} p-4 flex gap-4">
        <div class="w-20 h-20 shrink-0 bg-[#F4F0E8] border border-[#2C2A29]/10 overflow-hidden">
          <img src="${esc(p.imageUrl || "assets/logo.svg")}" alt="" class="w-full h-full ${p.imageUrl ? "object-cover" : "object-contain p-1"}" loading="lazy" />
        </div>
        <div class="flex-1 min-w-0 flex flex-col justify-between gap-3">
          <div class="space-y-1">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <h4 class="font-serif text-xl leading-tight">${esc(p.nom)}</h4>
              <span class="flex items-center gap-2 shrink-0">
                <button type="button" data-action="prod-best" data-id="${esc(p.id)}" aria-pressed="${p.bestSeller === true}"
                  title="${p.bestSeller === true ? "Retirer des Best-Sellers" : "Ajouter aux Best-Sellers"}"
                  class="text-2xl leading-none transition-colors ${p.bestSeller === true ? "text-amber-600" : "text-[#2C2A29]/30 hover:text-amber-600"}">${p.bestSeller === true ? "&#9733;" : "&#9734;"}</button>
                ${draft ? `<span class="text-[11px] px-2 py-0.5 border bg-violet-100 text-violet-800 border-violet-300" title="Invisible en boutique">Brouillon</span>` : ""}
                <span class="text-[11px] px-2 py-0.5 border ${chip}">${statut}</span>
              </span>
            </div>
            <p class="text-[10px] uppercase tracking-[0.18em] text-[#7F7973]">${esc(g.nom)}${orphan ? " (catégorie retirée)" : ""} &bull; ${formatDisplayPrice(p)}${formatPrixPour(p.prixPour) ? ` &bull; pour ${esc(formatPrixPour(p.prixPour))}` : ""}</p>
            ${(() => {
              const c = currentCost(state.couts[p.id]?.historique);
              const m = marginOf(p.prix, c);
              return c == null ? "" : `<p class="text-[11px] text-[#7F7973]">Revient ${formatPrice(c)}${m ? ` &bull; marge ${formatPct(m.pct)}` : ""}</p>`;
            })()}
            ${season ? `<p class="text-[11px] text-[#7F7973]">Saison : ${esc(season.toLowerCase())}</p>` : ""}
            ${productTags(p).length ? `<p class="flex flex-wrap gap-1 pt-0.5">${productTags(p).map((t) => `<span class="px-1.5 py-px border border-[#2C2A29]/20 text-[10px] text-[#2C2A29]">${esc(t)}</span>`).join("")}</p>` : ""}
            ${productParfums(p).length ? `<div class="flex flex-wrap gap-1 pt-0.5" aria-label="Parfums (cliquer pour marquer épuisé / disponible)">${productParfums(p).map((x) => `
              <button type="button" data-action="parfum-toggle" data-id="${esc(p.id)}" data-parfum="${esc(x.nom)}"
                title="${x.dispo ? "Marquer ce parfum épuisé" : "Remettre ce parfum en stock"}"
                class="inline-flex items-center gap-1 pl-0.5 pr-1.5 py-0.5 border text-[10px] ${x.dispo ? "border-[#2C2A29]/30 text-[#2C2A29] hover:border-[#2C2A29]" : "border-red-200 bg-red-50 text-red-800 line-through"}">
                ${x.image ? `<img src="${esc(x.image)}" alt="" class="w-4 h-4 object-cover" loading="lazy" />` : `<span class="w-1"></span>`}${esc(x.nom)} &middot; ${formatPrice(x.prix)}
              </button>`).join("")}</div>` : ""}
            ${draft ? `<p class="text-[11px] text-violet-800">Brouillon : invisible des clients</p>` : ""}
            ${autoOff && !draft ? `<p class="text-[11px] text-amber-800">Actuellement hors-saison : non commandable</p>` : ""}
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" data-action="prod-stock" data-id="${esc(p.id)}" class="px-3 py-1.5 border border-[#2C2A29] text-[11px] uppercase tracking-[0.12em] hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors">${statut === "Disponible" ? "Marquer épuisé" : "Remettre en stock"}</button>
            <button type="button" data-action="prod-draft" data-id="${esc(p.id)}" class="px-3 py-1.5 border ${draft ? "border-violet-700 bg-violet-700 text-white hover:bg-violet-800" : "border-violet-300 text-violet-800 hover:border-violet-700"} text-[11px] uppercase tracking-[0.12em] transition-colors">${draft ? "Publier" : "Passer en brouillon"}</button>
            <button type="button" data-action="prod-cost" data-id="${esc(p.id)}" class="px-3 py-1.5 border border-[#2C2A29]/40 text-[11px] uppercase tracking-[0.12em] hover:border-[#2C2A29]">Revient</button>
            <button type="button" data-action="prod-edit" data-id="${esc(p.id)}" class="px-3 py-1.5 border border-[#2C2A29]/40 text-[11px] uppercase tracking-[0.12em] hover:border-[#2C2A29]">Modifier</button>
            <button type="button" data-action="prod-delete" data-id="${esc(p.id)}" class="px-3 py-1.5 border border-red-300 text-red-700 text-[11px] uppercase tracking-[0.12em] hover:bg-red-700 hover:text-white transition-colors">Supprimer</button>
          </div>
        </div>
      </article>`;
  }).join("");
}

function editProduct(p) {
  $("prod-edit-id").value = p.id;
  $("prod-nom").value = p.nom || "";
  $("prod-categorie").value = state.categories.some((c) => c.id === p.categorieId && isCategoryActive(c)) ? p.categorieId : "";
  $("prod-prix").value = p.prix ?? "";
  $("prod-statut").value = normalizeStatut(p.statut);
  $("prod-brouillon").checked = isDraft(p);
  $("prod-revient").value = currentCost(state.couts[p.id]?.historique) ?? "";
  $("prod-pour-nombre").value = p.prixPour?.nombre ?? "";
  $("prod-pour-max").value = p.prixPour?.nombreMax ?? "";
  $("prod-pour-unite").value = (p.prixPour?.unite || p.unite) === "pieces" ? "pieces" : "personnes";
  $("prod-image").value = p.imageUrl || "";
  $("prod-desc").value = p.description || "";
  $("prod-images").value = (p.images || []).join("\n");
  $("prod-conservation").value = p.conservation || "";
  $("prod-composition").value = p.composition || "";
  $("prod-parts").value = p.parts || "";
  $("prod-poids").value = p.poids || "";
  document.querySelectorAll(".prod-allergene").forEach((c) => { c.checked = (p.allergenes || []).includes(c.value); });
  formTags = productTags(p);
  tagInput.value = "";
  renderFormTags();
  formParfums = (Array.isArray(p.parfums) ? p.parfums : []).map((x) => ({
    nom: x?.nom || "", prix: x?.prix == null ? "" : String(x.prix), image: x?.image || "", dispo: x?.dispo !== false,
    description: x?.description || "", composition: x?.composition || ""
  }));
  renderFormParfums();
  const seasonal = hasSeason(p.saison);
  $("prod-saison-mode").value = seasonal ? "periode" : "toujours";
  $("prod-saison-range").classList.toggle("hidden", !seasonal);
  if (seasonal) {
    $("prod-saison-debut").value = p.saison.debut;
    $("prod-saison-fin").value = p.saison.fin;
  }
  $("product-form-title").textContent = "Modifier la pâtisserie";
  $("prod-submit-btn").textContent = "Mettre à jour";
  $("prod-cancel-edit").classList.remove("hidden");
  productForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

// =============================================================
// CATÉGORIES
// =============================================================
$("category-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!isAdmin(state.user)) return;
  const nom = $("cat-nom").value.trim();
  if (nom.toLowerCase() === AUTRE_LABEL.toLowerCase()) {
    return toast("« Autre » est une catégorie automatique");
  }
  if (state.categories.some((c) => catName(c).toLowerCase() === nom.toLowerCase())) {
    return toast("Cette catégorie existe déjà");
  }
  run(async () => {
    await addDoc(collection(db, "categories"), { nom, ordre: Number($("cat-ordre").value) || 1, actif: true });
    $("cat-nom").value = "";
  }, "Catégorie créée", "Erreur création catégorie");
});

function renderCategories() {
  const box = $("admin-categories-list");
  const sorted = groupByCategory(state.categories.map((c) => ({ ...c, actif: true })), [], { includeEmpty: true }).filter((g) => g.id !== AUTRE_ID);
  const countFor = (id) => state.products.filter((p) => p.categorieId === id).length;
  const ordered = sorted.map((g) => state.categories.find((c) => c.id === g.id));

  const maxOrdre = state.categories.reduce((m, c) => Math.max(m, Number(c.ordre) || 0), 0);
  if (document.activeElement !== $("cat-ordre")) $("cat-ordre").value = maxOrdre + 1;

  const orphans = groupByCategory(state.categories, state.products, { includeEmpty: true }).find((g) => g.id === AUTRE_ID).products.length;

  const cards = ordered.map((c) => {
    const n = countFor(c.id);
    const active = isCategoryActive(c);
    return `
      <div class="border border-[#2C2A29]/15 bg-white p-4 space-y-3 ${active ? "" : "opacity-70"}">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h4 class="font-serif text-lg">${esc(catName(c))}</h4>
            <p class="text-[10px] text-[#7F7973] uppercase tracking-[0.15em]">${n} pâtisserie${n > 1 ? "s" : ""}${active ? "" : " &bull; masquée (→ Autre)"}</p>
          </div>
          <label class="text-[10px] uppercase tracking-[0.15em] text-[#7F7973] flex items-center gap-2">Ordre
            <input type="number" value="${Number(c.ordre) || 0}" data-action="cat-order" data-id="${esc(c.id)}" class="w-16 px-2 py-1 text-xs border border-[#2C2A29]/30 bg-[#FDFBF7]" />
          </label>
        </div>
        <div class="flex gap-4 pt-2 border-t border-[#2C2A29]/10">
          <button type="button" data-action="cat-toggle" data-id="${esc(c.id)}" class="text-[10px] uppercase tracking-[0.15em] underline">${active ? "Rendre indisponible" : "Rendre disponible"}</button>
          <button type="button" data-action="cat-delete" data-id="${esc(c.id)}" class="text-[10px] uppercase tracking-[0.15em] text-red-700 underline">Supprimer</button>
        </div>
      </div>`;
  }).join("");

  const autre = `
    <div class="border border-dashed border-[#2C2A29]/30 bg-[#FDFBF7] p-4">
      <h4 class="font-serif text-lg">${AUTRE_LABEL}</h4>
      <p class="text-[10px] text-[#7F7973] uppercase tracking-[0.15em]">Automatique &bull; toujours en dernier &bull; ${orphans} pâtisserie${orphans > 1 ? "s" : ""}</p>
    </div>`;

  box.innerHTML = cards + autre;
}

// =============================================================
// Actions (délégation d'événements)
// =============================================================
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "SELECT" || el.tagName === "INPUT") return;
  if (!isAdmin(state.user)) return;
  const { action, id } = el.dataset;

  if (action === "prod-stock") {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    const next = normalizeStatut(p.statut) === "Disponible" ? "Épuisé" : "Disponible";
    run(() => updateDoc(doc(db, "patisseries", id), { statut: next }), next === "Épuisé" ? "Marquée épuisée" : "Remise en stock");
  } else if (action === "parfum-toggle") {
    const p = state.products.find((x) => x.id === id);
    if (!p || !Array.isArray(p.parfums)) return;
    const k = parfumKey(el.dataset.parfum);
    let nowDispo = true;
    const parfums = p.parfums.map((x) => {
      if (parfumKey(x?.nom) !== k) return x;
      nowDispo = x?.dispo === false;
      return { ...x, dispo: nowDispo };
    });
    run(() => updateDoc(doc(db, "patisseries", id), { parfums }),
      `« ${el.dataset.parfum} » ${nowDispo ? "remis en stock" : "marqué épuisé"}`);
  } else if (action === "prod-best") {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    const next = p.bestSeller !== true;
    run(() => updateDoc(doc(db, "patisseries", id), { bestSeller: next }),
      next ? "Ajoutée aux Best-Sellers" : "Retirée des Best-Sellers");
  } else if (action === "prod-draft") {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    const next = !isDraft(p);
    run(() => updateDoc(doc(db, "patisseries", id), { brouillon: next }),
      next ? "Passée en brouillon : invisible en boutique" : "Publiée : visible en boutique");
  } else if (action === "prod-edit") {
    const p = state.products.find((x) => x.id === id);
    if (p) editProduct(p);
  } else if (action === "prod-delete") {
    const p = state.products.find((x) => x.id === id);
    const hasCost = Boolean(state.couts[id]);
    if (confirm(`Supprimer « ${p?.nom || "cette pâtisserie"} » ?${hasCost ? "\n\nSon historique de prix de revient sera aussi supprimé." : ""}`)) {
      run(async () => {
        await deleteDoc(doc(db, "patisseries", id));
        if (hasCost) await deleteDoc(doc(db, "couts", id));
      }, "Pâtisserie supprimée", "Erreur lors de la suppression");
    }
  } else if (action === "price-apply") {
    applySellingPrice();
  } else if (action === "price-skip") {
    closePriceModal();
  } else if (action === "prod-cost" || action === "cost-open") {
    openCost(id);
  } else if (action === "cost-close") {
    state.costProduct = null;
    renderCosts();
  } else if (action === "cost-del") {
    if (confirm(`Supprimer le relevé du ${formatDateShort(el.dataset.date)} ?`)) {
      const next = removeEntry(state.couts[id]?.historique, el.dataset.date);
      run(() => (next.length ? writeCost(id, next) : deleteDoc(doc(db, "couts", id))), "Relevé supprimé", "Erreur lors de la suppression");
    }
  } else if (action === "cat-toggle") {
    const c = state.categories.find((x) => x.id === id);
    if (c) run(() => updateDoc(doc(db, "categories", id), { actif: !isCategoryActive(c) }), isCategoryActive(c) ? "Catégorie masquée" : "Catégorie réactivée");
  } else if (action === "cat-delete") {
    const c = state.categories.find((x) => x.id === id);
    const n = state.products.filter((p) => p.categorieId === id).length;
    const extra = n ? `\n\n${n} pâtisserie${n > 1 ? "s" : ""} rattachée${n > 1 ? "s" : ""} passeront dans « ${AUTRE_LABEL} ».` : "";
    if (confirm(`Supprimer la catégorie « ${catName(c)} » ?${extra}`)) {
      run(() => deleteDoc(doc(db, "categories", id)), "Catégorie supprimée", "Erreur suppression catégorie");
    }
  } else if (action === "order-set") {
    setOrderStatus(id, el.dataset.statut);
  } else if (action === "pickup-cancel") {
    closePickupModal();
  } else if (action === "pickup-save") {
    savePickup();
  } else if (action === "pickup-all" && pickup) {
    const o = state.orders.find((x) => x.id === pickup.id);
    const restants = (o?.articles || []).map((a, i) => (a.remis ? -1 : i)).filter((i) => i >= 0);
    const tout = restants.every((i) => pickup.checked.has(i));
    pickup.checked = new Set(tout ? [] : restants);
    renderPickupModal();
  } else if (action === "article-remis") {
    toggleArticleRemis(id, Number(el.dataset.idx));
  } else if (action === "price-edit") {
    const o = state.orders.find((x) => x.id === id);
    if (!o) return;
    state.priceEdit = { id, total: String(o.total ?? ""), motif: o.prixAjuste?.motif || "", annulerRemise: false };
    renderOrders();
  } else if (action === "price-cancel") {
    state.priceEdit = null;
    renderOrders();
  } else if (action === "price-save") {
    savePriceEdit(id);
  } else if (action === "loy-add") {
    loyaltyDraft().push({ points: "", remisePct: "" });
    state.dirty.loyalty = true;
    renderLoyaltyPaliers();
  } else if (action === "loy-del") {
    loyaltyDraft().splice(Number(el.dataset.idx), 1);
    state.dirty.loyalty = true;
    renderLoyaltyPaliers();
  } else if (action === "order-delete") {
    if (confirm("Supprimer définitivement cette commande ?")) {
      run(() => deleteDoc(doc(db, "commandes", id)), "Commande supprimée", "Erreur lors de la suppression");
    }
  }
});

document.addEventListener("change", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || !isAdmin(state.user)) return;
  const { action, id } = el.dataset;
  if (action === "order-status") {
    const o = state.orders.find((x) => x.id === id);
    if (o && el.value !== statutOf(o)) setOrderStatus(id, el.value);
    if (o) el.value = statutOf(o); // le temps réel affichera le nouveau statut
  } else if (action === "pickup-check" && pickup) {
    const i = Number(el.dataset.idx);
    if (el.checked) pickup.checked.add(i); else pickup.checked.delete(i);
    renderPickupModal();
    $("pickup-modal-body").querySelector(`[data-action='pickup-check'][data-idx='${i}']`)?.focus();
  } else if (action === "price-remise" && state.priceEdit) {
    const o = state.orders.find((x) => x.id === state.priceEdit.id);
    state.priceEdit.annulerRemise = el.checked;
    // Total proposé : sans la remise si on l'annule, sinon le total actuel
    if (o) state.priceEdit.total = String(el.checked ? round2(o.sousTotal ?? (o.total + (o.remise?.montant || 0))) : o.total);
    renderOrders();
  } else if (action === "loy-palier") {
    const d = loyaltyDraft()[Number(el.dataset.idx)];
    if (d) d[el.dataset.field] = el.value;
  } else if (action === "cat-order") {
    run(() => updateDoc(doc(db, "categories", id), { ordre: Number(el.value) || 0 }), "Ordre mis à jour");
  }
});

// Saisie de l'ajustement de prix : gardée en mémoire (le temps réel peut redessiner la commande)
document.addEventListener("input", (e) => {
  const el = e.target.closest("[data-action='price-field']");
  if (el && state.priceEdit) state.priceEdit[el.dataset.field] = el.value;
});

// =============================================================
// PRIX DE REVIENT (privé)
// =============================================================
const eur = formatPrice;
const costOf = (id) => currentCost(state.couts[id]?.historique);

const writeCost = (id, historique) => setDoc(doc(db, "couts", id), { historique, updatedAt: serverTimestamp() });

// Retourne { isCurrent } : le relevé est-il le plus récent ? (un relevé saisi avec une date passée ne change pas le revient actuel)
async function saveCost(id, valeur, date, note = "") {
  const entry = { date, valeur, ...(note ? { note } : {}) };
  const historique = upsertEntry(state.couts[id]?.historique, entry);
  await writeCost(id, historique);
  return { isCurrent: historique.at(-1).date === date };
}

function openCost(id) {
  state.costProduct = id;
  showTab("couts");
  renderCosts();
  $("costs-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

document.addEventListener("submit", (e) => {
  if (e.target.id !== "cost-form") return;
  e.preventDefault();
  if (!isAdmin(state.user) || !state.costProduct) return;
  const raw = $("cost-valeur").value.trim();
  const valeur = Number(raw);
  const date = $("cost-date").value;
  if (raw === "" || !(valeur >= 0)) return toast("Prix de revient invalide");
  if (!date || date > todayISO()) return toast("Date invalide");
  run(async () => {
    const id = state.costProduct;
    const { isCurrent } = await saveCost(id, valeur, date, $("cost-note").value.trim());
    $("cost-valeur").value = "";
    $("cost-note").value = "";
    const p = state.products.find((x) => x.id === id);
    if (isCurrent && p && valeur > 0) offerSellingPrice({ id, nom: p.nom, cout: valeur, prix: p.prix, target: "db" });
  }, "Prix de revient enregistré", "Erreur lors de l'enregistrement");
});

const tile = (label, value, sub = "") => `
  <div class="border border-[#2C2A29]/15 bg-white p-4">
    <p class="text-[10px] uppercase tracking-[0.18em] text-[#7F7973]">${label}</p>
    <p class="font-serif text-2xl mt-1">${value}</p>
    ${sub ? `<p class="text-[11px] text-[#7F7973] mt-0.5">${sub}</p>` : ""}
  </div>`;

const evolution = (chg) =>
  !chg || chg.pct == null ? `<span class="text-[#7F7973]">—</span>`
  : chg.pct === 0 ? `<span class="text-[#7F7973]">= stable</span>`
  : `<span class="${chg.pct > 0 ? "text-red-700" : "text-emerald-700"}">${chg.pct > 0 ? "▲" : "▼"} ${formatPct(chg.pct, true)}</span> <span class="text-[11px] text-[#7F7973]">le ${formatDateShort(chg.date)}</span>`;

function renderCosts() {
  const groups = groupByCategory(state.categories, state.products, { includeEmpty: true });
  const rows = groups.flatMap((g) => g.products.map((p) => {
    const hist = state.couts[p.id]?.historique;
    const cout = currentCost(hist);
    return { p, g, cout, m: marginOf(p.prix, cout), chg: lastChange(hist) };
  }));

  // Synthèse
  const known = rows.filter((r) => r.m);
  const avg = known.length ? known.reduce((s, r) => s + r.m.pct, 0) / known.length : null;
  const lowest = known.reduce((min, r) => (!min || r.m.pct < min.m.pct ? r : min), null);
  $("costs-summary").innerHTML =
    tile("Prix de revient renseignés", `${rows.filter((r) => r.cout != null).length} / ${rows.length}`) +
    tile("Marge moyenne", avg == null ? "—" : formatPct(avg)) +
    tile("Marge la plus faible", lowest ? formatPct(lowest.m.pct) : "—", lowest ? esc(lowest.p.nom) : "");

  // Évolution globale (indice chaîné, base 100 au premier relevé)
  const ids = new Set(state.products.map((p) => p.id));
  const index = globalIndexSeries(Object.entries(state.couts).filter(([id]) => ids.has(id)).map(([, c]) => c.historique));
  $("costs-global").innerHTML = index.length >= 2
    ? `${lineChartSVG({ points: index, fmt: (v) => formatNum(v, 1), label: "Indice global du prix de revient" })}
       <p class="text-xs text-[#7F7973] mt-3">Indice 100 = premier relevé (${formatDateShort(index[0].date)}). Il suit la variation moyenne des prix de revient de toute la carte : <strong class="text-[#2C2A29]">${formatNum(index.at(-1).v, 1)}</strong> aujourd'hui (${formatPct(index.at(-1).v - 100, true)}).</p>`
    : `<p class="text-xs text-[#7F7973]">Le graphique apparaîtra dès qu'au moins un prix de revient aura changé au fil du temps.</p>`;

  // Tableau
  $("costs-table").innerHTML = rows.length ? `
    <div class="overflow-x-auto border border-[#2C2A29]/15 bg-white">
      <table class="w-full text-sm">
        <thead class="text-[10px] uppercase tracking-[0.15em] text-[#7F7973] text-left border-b border-[#2C2A29]/15">
          <tr><th class="p-3 font-normal">Pâtisserie</th><th class="p-3 font-normal">Vente</th><th class="p-3 font-normal">Revient</th><th class="p-3 font-normal">Marge</th><th class="p-3 font-normal">Dernière évolution</th><th class="p-3"></th></tr>
        </thead>
        <tbody class="divide-y divide-[#2C2A29]/10">
          ${rows.map(({ p, g, cout, m, chg }) => `
            <tr class="${state.costProduct === p.id ? "bg-[#F4F0E8]" : ""}">
              <td class="p-3"><span class="font-serif text-base">${esc(p.nom)}</span><br><span class="text-[10px] uppercase tracking-[0.15em] text-[#7F7973]">${esc(g.nom)}</span></td>
              <td class="p-3 whitespace-nowrap">${eur(p.prix)}</td>
              <td class="p-3 whitespace-nowrap">${cout == null ? `<span class="text-[#7F7973]">—</span>` : eur(cout)}</td>
              <td class="p-3 whitespace-nowrap">${m ? `<span class="${m.eur < 0 ? "text-red-700" : ""}">${eur(m.eur)} <span class="text-[11px] text-[#7F7973]">(${formatPct(m.pct)})</span></span>` : `<span class="text-[#7F7973]">—</span>`}</td>
              <td class="p-3 whitespace-nowrap">${evolution(chg)}</td>
              <td class="p-3 text-right"><button type="button" data-action="cost-open" data-id="${esc(p.id)}" class="px-3 py-1.5 border border-[#2C2A29] text-[11px] uppercase tracking-[0.12em] hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors whitespace-nowrap">${cout == null ? "Saisir" : "Historique"}</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>` : `<p class="text-xs text-[#7F7973]">Aucune pâtisserie.</p>`;

  renderCostPanel();
}

function renderCostPanel() {
  const box = $("costs-panel");
  const p = state.products.find((x) => x.id === state.costProduct);
  if (!p) {
    state.costProduct = null;
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  // Conserve la saisie en cours si le panneau est redessiné (mise à jour temps réel)
  const keep = box.dataset.pid === p.id
    ? ["cost-valeur", "cost-date", "cost-note"].map((id) => $(id)?.value ?? "") : null;

  const hist = sortHistory(state.couts[p.id]?.historique);
  const cur = currentCost(hist);
  const m = marginOf(p.prix, cur);
  const vals = hist.map((e) => e.valeur);
  const sinceFirst = hist.length > 1 ? pctChange(hist[0].valeur, cur) : null;

  const chart = hist.length
    ? lineChartSVG({
        points: hist.map((e) => ({ date: e.date, v: e.valeur, note: e.note })),
        ref: Number(p.prix) > 0 ? { v: Number(p.prix), label: `Prix de vente ${eur(p.prix)}` } : null,
        fmt: eur,
        label: `Évolution du prix de revient — ${p.nom}`
      })
    : `<p class="text-xs text-[#7F7973]">Aucun relevé : saisissez un premier prix de revient ci-dessus.</p>`;

  const desc = [...hist].reverse();
  box.dataset.pid = p.id;
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="border border-[#2C2A29] bg-white p-5 sm:p-6 space-y-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-[10px] uppercase tracking-[0.2em] text-[#7F7973]">Historique du prix de revient</p>
          <h3 class="font-serif text-2xl">${esc(p.nom)}</h3>
        </div>
        <button type="button" data-action="cost-close" class="text-[11px] uppercase tracking-[0.15em] underline text-[#7F7973] hover:text-[#2C2A29]">Fermer</button>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
        ${tile("Actuel", cur == null ? "—" : eur(cur), `Vente ${eur(p.prix)}`)}
        ${tile("Marge", m ? eur(m.eur) : "—", m ? formatPct(m.pct) : "")}
        ${tile("Coefficient", m?.coef ? `× ${formatNum(m.coef, 2)}` : "—", "vente ÷ revient")}
        ${tile("Depuis le 1er relevé", sinceFirst == null ? "—" : `<span class="${sinceFirst > 0 ? "text-red-700" : sinceFirst < 0 ? "text-emerald-700" : ""}">${formatPct(sinceFirst, true)}</span>`, hist.length ? `depuis le ${formatDateShort(hist[0].date)}` : "")}
        ${tile("Min – Max", vals.length ? `${eur(Math.min(...vals))} – ${eur(Math.max(...vals))}` : "—")}
      </div>

      <form id="cost-form" class="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end border border-[#2C2A29]/15 bg-[#FDFBF7] p-4">
        <div class="sm:col-span-3"><label class="lbl" for="cost-valeur">Nouveau prix de revient (&euro;)</label><input type="number" step="0.01" min="0" id="cost-valeur" required placeholder="Ex : 14.50" class="inp" /></div>
        <div class="sm:col-span-3"><label class="lbl" for="cost-date">À la date du</label><input type="date" id="cost-date" required max="${todayISO()}" class="inp" /></div>
        <div class="sm:col-span-4"><label class="lbl" for="cost-note">Note (optionnel)</label><input type="text" id="cost-note" placeholder="Ex : hausse du beurre" class="inp" /></div>
        <div class="sm:col-span-2"><button type="submit" class="w-full px-4 py-2.5 bg-[#2C2A29] text-[#FDFBF7] text-xs uppercase tracking-[0.18em] hover:bg-[#43403E] transition-colors">Enregistrer</button></div>
      </form>

      <div>${chart}</div>

      ${hist.length ? `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-[10px] uppercase tracking-[0.15em] text-[#7F7973] text-left border-b border-[#2C2A29]/15"><tr><th class="py-2 font-normal">Date</th><th class="py-2 font-normal">Prix de revient</th><th class="py-2 font-normal">Variation</th><th class="py-2 font-normal">Note</th><th></th></tr></thead>
          <tbody class="divide-y divide-[#2C2A29]/10">
            ${desc.map((e, i) => {
              const prev = desc[i + 1];
              const pc = prev ? pctChange(prev.valeur, e.valeur) : null;
              return `<tr>
                <td class="py-2 pr-4 whitespace-nowrap">${formatDateShort(e.date)}</td>
                <td class="py-2 pr-4 whitespace-nowrap">${eur(e.valeur)}</td>
                <td class="py-2 pr-4 whitespace-nowrap">${pc == null ? `<span class="text-[#7F7973]">relevé initial</span>` : `<span class="${pc > 0 ? "text-red-700" : pc < 0 ? "text-emerald-700" : "text-[#7F7973]"}">${pc > 0 ? "▲" : pc < 0 ? "▼" : "="} ${formatPct(pc, true)}</span>`}</td>
                <td class="py-2 pr-4 text-[#7F7973]">${esc(e.note || "")}</td>
                <td class="py-2 text-right"><button type="button" data-action="cost-del" data-id="${esc(p.id)}" data-date="${esc(e.date)}" class="text-[10px] uppercase tracking-[0.15em] text-red-700 underline">Supprimer</button></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>` : ""}
    </div>`;

  $("cost-date").value = keep?.[1] || todayISO();
  if (keep) { $("cost-valeur").value = keep[0]; $("cost-note").value = keep[2]; }
}


// =============================================================
// POPUP : prix de vente suggéré (taux, mode et arrondi réglés dans « Paramètres »)
// target "form" : remplit le champ Prix du formulaire ; target "db" : met à jour la pâtisserie.
// =============================================================
let priceProposal = null;
let focusBeforeModal = null;

function offerSellingPrice({ id, nom, cout, prix, target = "db" }) {
  const pricing = state.pricing;
  const suggere = suggestSellingPrice(cout, pricing);
  if (suggere == null) return;
  const actuel = prix == null || prix === "" ? NaN : Number(prix);
  const hasActuel = Number.isFinite(actuel) && actuel > 0;
  if (hasActuel && Math.round(suggere * 100) === Math.round(actuel * 100)) return; // déjà au bon prix
  priceProposal = { id, suggere, target };

  const exact = targetPrice(cout, pricing);
  const detail = (v) => {
    const m = marginOf(v, cout), x = markupPct(v, cout);
    return m ? ` <span class="block text-[11px] text-[#7F7973]">marge ${formatPct(m.pct)} &bull; ${formatPct(x, true)} sur le revient</span>` : "";
  };

  $("price-modal-body").innerHTML = `
    <div class="space-y-1">
      <h3 id="price-modal-title" class="font-serif text-2xl">${hasActuel ? "Ajuster le prix de vente ?" : "Prix de vente proposé"}</h3>
      <p class="text-sm text-[#7F7973]">Prix de revient de <strong class="text-[#2C2A29]">« ${esc(nom)} »</strong> : ${formatPrice(cout)}.</p>
    </div>
    <div class="border border-[#2C2A29]/15 bg-white divide-y divide-[#2C2A29]/10 text-sm">
      <div class="flex items-start justify-between gap-3 p-3"><span class="text-[#7F7973]">Prix de vente actuel</span><span class="text-right">${hasActuel ? `${formatPrice(actuel)}${detail(actuel)}` : "—"}</span></div>
      <div class="flex items-start justify-between gap-3 p-3"><span class="font-medium">Prix proposé</span><span class="text-right"><span class="font-serif text-2xl">${formatPrice(suggere)}</span>${detail(suggere)}</span></div>
    </div>
    <p class="text-xs text-[#7F7973] leading-relaxed">Règle : ${esc(pricingRuleLabel(pricing))} (${formatPrice(exact)} avant arrondi). Modifiable dans l'onglet « Paramètres ».${target === "form" ? " Le prix sera placé dans le formulaire : pensez à l'enregistrer." : ""}</p>
    <div class="flex flex-col-reverse sm:flex-row gap-3">
      <button type="button" data-action="price-skip" class="flex-1 px-4 py-3 border border-[#2C2A29] text-xs uppercase tracking-[0.15em] hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors">${hasActuel ? `Garder ${formatPrice(actuel)}` : "Ignorer"}</button>
      <button type="button" id="price-apply-btn" data-action="price-apply" class="flex-1 px-4 py-3 bg-[#2C2A29] text-[#FDFBF7] text-xs uppercase tracking-[0.15em] hover:bg-[#43403E] transition-colors">Valider ${formatPrice(suggere)}</button>
    </div>`;

  focusBeforeModal = document.activeElement;
  $("price-modal").classList.remove("hidden");
  $("price-apply-btn").focus();
}

function closePriceModal() {
  priceProposal = null;
  $("price-modal").classList.add("hidden");
  $("price-modal-body").innerHTML = "";
  focusBeforeModal?.focus?.();
  focusBeforeModal = null;
}

function applySellingPrice() {
  if (!priceProposal) return;
  const { id, suggere, target } = priceProposal;
  closePriceModal();
  if (target === "form") {
    $("prod-prix").value = suggere.toFixed(2);
    toast(`Prix ${formatPrice(suggere)} placé dans le formulaire`);
    return;
  }
  run(() => updateDoc(doc(db, "patisseries", id), { prix: suggere }), `Prix de vente mis à jour : ${formatPrice(suggere)}`, "Erreur lors de la mise à jour du prix");
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("price-modal").classList.contains("hidden")) closePriceModal();
  if (e.key === "Escape" && pickup) closePickupModal();
});

// =============================================================
// PARAMÈTRES : prix suggéré, programme de fidélité, notifications
// =============================================================
const loyaltyDraft = () => (state.loyaltyDraft ??= state.loyalty.paliers.map((p) => ({ ...p })));

function renderPricingExample() {
  const p = normalizePricing({ tauxPct: $("set-taux").value, mode: $("set-mode").value, arrondi: $("set-arrondi").value });
  const ex = 14.5;
  const sug = suggestSellingPrice(ex, p);
  const m = marginOf(sug, ex);
  $("pricing-example").innerHTML = `Exemple : revient ${formatPrice(ex)} → ${formatPrice(targetPrice(ex, p))} → proposé <strong>${formatPrice(sug)}</strong>${m ? ` (marge ${formatPct(m.pct)}, ${formatPct(markupPct(sug, ex), true)} sur le revient)` : ""}.`;
}

function renderLoyaltyPaliers() {
  $("loy-paliers").innerHTML = loyaltyDraft().map((p, i) => `
    <div class="flex flex-wrap items-center gap-3 text-sm">
      <input type="number" min="1" step="1" value="${esc(p.points)}" data-action="loy-palier" data-field="points" data-idx="${i}" aria-label="Points nécessaires" class="inp !w-28" placeholder="100" />
      <span>points =</span>
      <input type="number" min="1" max="100" step="0.5" value="${esc(p.remisePct)}" data-action="loy-palier" data-field="remisePct" data-idx="${i}" aria-label="Remise en %" class="inp !w-24" placeholder="10" />
      <span>% de remise sur la commande</span>
      <button type="button" data-action="loy-del" data-idx="${i}" class="text-[10px] uppercase tracking-[0.15em] text-red-700 underline">Retirer</button>
    </div>`).join("") || `<p class="text-xs text-[#7F7973]">Aucune récompense : les clients cumulent des points sans pouvoir les utiliser.</p>`;
}

function renderSettings() {
  if (!state.dirty.pricing) {
    $("set-taux").value = state.pricing.tauxPct;
    $("set-mode").value = state.pricing.mode;
    $("set-arrondi").value = String(state.pricing.arrondi);
    renderPricingExample();
  }
  if (!state.dirty.loyalty) {
    $("loy-actif").checked = state.loyalty.actif;
    $("loy-description").value = state.loyalty.description;
    $("loy-validite").value = state.loyalty.validiteJours || "";
    state.loyaltyDraft = null;
    renderLoyaltyPaliers();
  }
  if (!state.dirty.shop) $("shop-filtre-tags").checked = state.shop.filtreTags;
}

$("pricing-form").addEventListener("input", () => { state.dirty.pricing = true; renderPricingExample(); });
$("pricing-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!isAdmin(state.user)) return;
  const tauxPct = Number($("set-taux").value);
  const mode = $("set-mode").value;
  if (!(tauxPct > 0) || (mode === "marge" && tauxPct >= 100)) return toast("Taux invalide (une marge doit rester sous 100 %)");
  const data = { tauxPct, mode, arrondi: Number($("set-arrondi").value) === 1 ? 1 : 0.5, updatedAt: serverTimestamp() };
  run(async () => {
    await setDoc(doc(db, "parametres", "prix"), data);
    state.dirty.pricing = false;
  }, "Réglages du prix enregistrés", "Erreur d'enregistrement (règles Firestore déployées ?)");
});

$("loyalty-form").addEventListener("input", () => { state.dirty.loyalty = true; });
$("loyalty-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!isAdmin(state.user)) return;
  // Lecture directe des champs (la valeur saisie compte même si le champ n'a pas encore perdu le focus)
  const rows = [...$("loy-paliers").querySelectorAll("div")].map((row) => ({
    points: Math.floor(Number(row.querySelector("[data-field='points']")?.value)),
    remisePct: Number(row.querySelector("[data-field='remisePct']")?.value)
  }));
  if (rows.some((r) => !(r.points > 0) || !(r.remisePct > 0 && r.remisePct <= 100))) {
    return toast("Récompense incomplète : points > 0 et remise entre 1 et 100 %");
  }
  if (new Set(rows.map((r) => r.points)).size !== rows.length) return toast("Deux récompenses ont le même nombre de points");
  const validite = Math.floor(Number($("loy-validite").value));
  const data = {
    actif: $("loy-actif").checked,
    description: $("loy-description").value.trim(),
    paliers: rows.sort((a, b) => a.points - b.points),
    validiteJours: validite > 0 ? validite : 0,
    updatedAt: serverTimestamp()
  };
  run(async () => {
    await setDoc(doc(db, "parametres", "fidelite"), data);
    state.dirty.loyalty = false;
    state.loyaltyDraft = null;
  }, "Programme de fidélité enregistré", "Erreur d'enregistrement (règles Firestore déployées ?)");
});

$("shop-form").addEventListener("input", () => { state.dirty.shop = true; });
$("shop-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!isAdmin(state.user)) return;
  const data = { filtreTags: $("shop-filtre-tags").checked, updatedAt: serverTimestamp() };
  run(async () => {
    await setDoc(doc(db, "parametres", "boutique"), data);
    state.dirty.shop = false;
  }, data.filtreTags ? "Filtre par tag affiché" : "Filtre par tag masqué", "Erreur d'enregistrement (règles Firestore déployées ?)");
});

renderSettings();
