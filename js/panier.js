import { db } from "./config.js";
import { $, showToast, saveCart, catalog, subscribeCatalog } from "./shop-common.js";
import { loadCart, getCartTotal, setItemDate, applyFirstDateToAll, removeItem } from "./cart.js";
import {
  ADMIN_EMAIL, esc, formatPrice, formatDateFR, tomorrowISO, parseISODate,
  getAvailability, seasonLabel, productUrl, isOrderable, isPreorder, seasonWindow
} from "./catalog.js";
import { mountAuthGate, watchUser, logout } from "./auth-ui.js";
import { subscribeMyOrders, subscribeLoyaltySettings, takeFlash } from "./client-orders.js";
import { loyaltyBalance, normalizeLoyalty, availableRewards, rewardAmount, pointsFor } from "./loyalty.js";
import { mountNotifOptIn, notifPermission } from "./web-notify.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const state = {
  cart: loadCart(),
  user: null,
  authReady: false,
  showDateErrors: false,
  orders: [],            // commandes du client (solde de fidélité)
  loyalty: null,         // réglages du programme (parametres/fidelite)
  loyaltyError: null,    // réglages ou commandes illisibles : le client en est informé
  settingsError: null,
  ordersError: null,
  rewardPoints: 0,       // palier choisi (en points), 0 = aucun
  flash: takeFlash()     // message venant d'une autre page (ex. « Recommander »)
};
let unsubOrders = null;

const authLoading = $("cart-auth-loading");
const authGate = $("cart-auth-gate");
const cartMain = $("cart-main");
const authBox = $("auth-box");
const cartEmptyState = $("cart-empty-state");
const cartContent = $("cart-content");
const cartItemsList = $("cart-items-list");
const cartDatesBlock = $("cart-dates-block");
const cartDatesList = $("cart-dates-list");
const sameDateBtn = $("same-date-btn");
const orderConfirmation = $("order-confirmation");
const loyaltyBox = $("loyalty-box");

const gate = mountAuthGate(authGate, { page: "panier.html", subtitle: "Connectez-vous pour accéder à votre panier." });
const syncCartStorage = () => saveCart(state.cart);
const liveOf = (item) => catalog.products.find((p) => p.id === item.id);

// ---------- Message en tête de page ----------
function renderFlash() {
  const box = $("cart-flash");
  const f = state.flash;
  if (!f?.lines?.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.className = `flash ${f.tone === "warn" ? "flash-warn" : "flash-info"} flex items-start justify-between gap-4`;
  box.innerHTML = `
    <div class="space-y-1">${f.lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>
    <button type="button" data-flash-close aria-label="Fermer le message" class="shrink-0 text-lg leading-none opacity-70 hover:opacity-100">&times;</button>`;
}
$("cart-flash").addEventListener("click", (e) => {
  if (e.target.closest("[data-flash-close]")) { state.flash = null; renderFlash(); }
});
function pushFlash(tone, lines) {
  const prev = state.flash?.lines || [];
  state.flash = { tone: tone === "warn" || state.flash?.tone === "warn" ? "warn" : "info", lines: [...prev, ...lines] };
  renderFlash();
}

// ---------- Dates : chaque création n'est ouverte à la commande que sur sa saison ----------
/** Fenêtre de dates possible pour un article : { min, max|null }. */
function itemWindow(item) {
  const live = liveOf(item);
  const w = seasonWindow(live?.saison);
  const tomorrow = tomorrowISO();
  return { min: w.start > tomorrow ? w.start : tomorrow, max: w.end };
}

function dateProblem(item) {
  if (!item.date) return null;
  if (item.date < tomorrowISO()) return "Date trop proche : à partir de demain.";
  const live = liveOf(item);
  if (catalog.products.length && !live) return "Cette création n'est plus proposée.";
  if (live && !isOrderable(live)) return "Cette création n'est plus disponible.";
  if (live && !getAvailability(live, parseISODate(item.date)).available) {
    const w = itemWindow(item);
    const s = seasonLabel(live.saison);
    return w.max
      ? `Hors saison à cette date. Choisissez une date entre le ${formatDateFR(w.min, false)} et le ${formatDateFR(w.max)}.`
      : `Hors-saison à cette date${s ? ` (${s.toLowerCase()})` : ""}. Choisissez une autre date.`;
  }
  return null;
}

// Une date reprise du premier article n'a pas de sens pour une création dont la saison ne la couvre pas
function dropInheritedDatesOutOfSeason() {
  state.cart.forEach((item, idx) => {
    if (idx === 0 || item.dateManual || !item.date) return;
    const live = liveOf(item);
    if (live && !getAvailability(live, parseISODate(item.date)).available) item.date = "";
  });
}

// ---------- Accès ----------
function renderCartAccess() {
  const logged = Boolean(state.user);
  authLoading.classList.toggle("hidden", state.authReady);
  authGate.classList.toggle("hidden", !state.authReady || logged);
  cartMain.classList.toggle("hidden", !state.authReady || !logged);
  if (state.authReady && logged) renderCart();
}

function renderCart() {
  // Retire les créations devenues impossibles à commander (épuisées, retirées, supprimées)
  if (catalog.ready) {
    const removed = [];
    state.cart = state.cart.filter((item) => {
      const live = liveOf(item);
      const ok = live && isOrderable(live);
      if (!ok) removed.push(live?.nom || item.nom);
      return ok;
    });
    if (removed.length) {
      pushFlash("warn", removed.map((n) => `« ${n} » n'est plus disponible : elle a été retirée de votre panier.`));
    }
  }
  if (state.cart.length) state.cart[0].dateManual = false;
  dropInheritedDatesOutOfSeason();
  syncCartStorage();

  const empty = state.cart.length === 0;
  cartEmptyState.classList.toggle("hidden", !empty);
  cartContent.classList.toggle("hidden", empty);
  if (empty) return;

  // Retour à l'affichage normal (après une commande validée)
  authBox.classList.remove("hidden");
  cartItemsList.classList.remove("hidden");
  cartDatesBlock.classList.remove("hidden");
  orderConfirmation.classList.add("hidden");

  cartItemsList.innerHTML = state.cart
    .map((item) => {
      const live = liveOf(item);
      const pre = live && isPreorder(live);
      return `
      <div class="flex items-center justify-between gap-4 p-4 border border-[#2C2A29]/15 bg-white">
        <div class="min-w-0 flex-1">
          <h3 class="font-serif text-xl text-[#2C2A29] truncate"><a href="${productUrl(item.id)}" class="hover:underline underline-offset-4">${esc(item.nom)}</a></h3>
          <p class="text-xs text-[#7F7973] mt-0.5">${formatPrice(item.prix)} / pièce${pre ? ` &bull; <span class="text-[#2C2A29]">précommande</span>` : ""}</p>
        </div>
        <div class="flex items-center border border-[#2C2A29]/25">
          <button type="button" data-qty-delta="-1" data-id="${esc(item.id)}" class="px-3 py-1 text-sm hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors" aria-label="Retirer un ${esc(item.nom)}">&minus;</button>
          <span class="px-3 py-1 text-xs font-medium">${item.quantity}</span>
          <button type="button" data-qty-delta="1" data-id="${esc(item.id)}" class="px-3 py-1 text-sm hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors" aria-label="Ajouter un ${esc(item.nom)}">+</button>
        </div>
        <div class="text-right shrink-0 w-24">
          <p class="font-serif text-lg text-[#2C2A29]">${formatPrice(item.prix * item.quantity)}</p>
          <button type="button" data-remove-id="${esc(item.id)}" class="text-[10px] uppercase tracking-[0.15em] text-[#7F7973] hover:text-[#2C2A29] underline">Retirer</button>
        </div>
      </div>`;
    })
    .join("");

  renderTotals();
  renderCartDates();
}

// ---------- Fidélité & totaux ----------
function loyaltyState() {
  if (state.loyaltyError) return null;
  const cfg = normalizeLoyalty(state.loyalty);
  if (!cfg.actif) return null;
  const bal = loyaltyBalance(state.orders, cfg);
  const rewards = availableRewards(bal.solde, cfg);
  if (!rewards.some((r) => r.points === state.rewardPoints)) state.rewardPoints = 0;
  const chosen = rewards.find((r) => r.points === state.rewardPoints) || null;
  return { cfg, bal, rewards, chosen };
}

function renderTotals() {
  const subtotal = getCartTotal(state.cart);
  const L = loyaltyState();
  const discount = L?.chosen ? rewardAmount(subtotal, L.chosen) : 0;
  const total = Math.max(0, subtotal - discount);

  $("cart-subtotal").textContent = formatPrice(subtotal);
  $("cart-discount-row").classList.toggle("hidden", !discount);
  $("cart-discount-label").textContent = L?.chosen ? `Remise fidélité (−${L.chosen.remisePct} %)` : "Remise fidélité";
  $("cart-discount").textContent = `−${formatPrice(discount)}`;
  $("cart-total").textContent = formatPrice(total);

  if (!L) {
    if (state.loyaltyError) {
      loyaltyBox.classList.remove("hidden");
      loyaltyBox.innerHTML = `<p class="text-xs text-[#7F7973]">Le programme de fidélité est momentanément indisponible : vos points ne sont pas perdus, mais aucune remise ne peut être appliquée à cette commande.</p>`;
    } else {
      loyaltyBox.classList.add("hidden");
      loyaltyBox.innerHTML = "";
    }
    return;
  }
  const { cfg, bal, rewards } = L;
  const next = cfg.paliers.find((p) => p.points > bal.solde);
  const expiry = bal.prochaineExpiration
    ? `<p class="text-[11px] text-[#7F7973]">${bal.prochaineExpiration.points} pt${bal.prochaineExpiration.points > 1 ? "s" : ""} expirent le ${esc(bal.prochaineExpiration.date.toLocaleDateString("fr-FR"))}.</p>`
    : "";
  const choices = rewards.length
    ? `<fieldset class="space-y-2 pt-1">
         <legend class="text-[11px] uppercase tracking-[0.15em] mb-1">Utiliser mes points</legend>
         <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="reward" value="0" ${state.rewardPoints === 0 ? "checked" : ""} class="accent-[#2C2A29]" /> Pas cette fois</label>
         ${rewards.map((r) => `<label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="reward" value="${r.points}" ${state.rewardPoints === r.points ? "checked" : ""} class="accent-[#2C2A29]" /> ${r.points} pts : −${r.remisePct} % <span class="text-[#7F7973]">(−${formatPrice(rewardAmount(subtotal, r))})</span></label>`).join("")}
       </fieldset>`
    : next ? `<p class="text-xs text-[#7F7973]">Encore ${next.points - bal.solde} pt${next.points - bal.solde > 1 ? "s" : ""} pour profiter de −${next.remisePct} % sur une commande.</p>` : "";

  loyaltyBox.classList.remove("hidden");
  loyaltyBox.innerHTML = `
    <div class="flex items-baseline justify-between gap-3">
      <span class="text-[11px] uppercase tracking-[0.15em]">Fidélité</span>
      <span><strong class="font-serif text-xl">${bal.solde}</strong> pt${bal.solde > 1 ? "s" : ""}</span>
    </div>
    ${bal.enAttente ? `<p class="text-[11px] text-[#7F7973]">+${bal.enAttente} pts en attente de validation de vos commandes.</p>` : ""}
    ${expiry}
    ${choices}
    <p class="text-xs">Cette commande vous rapportera <strong>${pointsFor(total)} pt${pointsFor(total) > 1 ? "s" : ""}</strong>.</p>
    <a href="compte.html#fidelite" class="inline-block text-[10px] uppercase tracking-[0.15em] underline text-[#7F7973] hover:text-[#2C2A29]">Le programme de fidélité</a>`;
}

loyaltyBox.addEventListener("change", (e) => {
  const r = e.target.closest("input[name='reward']");
  if (!r) return;
  state.rewardPoints = Number(r.value) || 0;
  renderTotals();
});

function renderCartDates() {
  sameDateBtn.classList.toggle("hidden", state.cart.length < 2);

  cartDatesList.innerHTML = state.cart
    .map((item, idx) => {
      const problem = dateProblem(item);
      const missing = state.showDateErrors && !item.date;
      const w = itemWindow(item);
      const live = liveOf(item);
      const seasonal = live && w.max;
      const hint =
        idx === 0 ? "Date de référence"
        : item.dateManual ? "Date personnalisée"
        : "Identique au premier article";
      const border = problem || missing ? "border-red-600" : "border-[#2C2A29]/30";
      return `
        <div class="space-y-1.5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="font-serif text-lg truncate">${esc(item.nom)} <span class="text-xs text-[#7F7973]">&times; ${item.quantity}</span></p>
              <p class="text-[10px] uppercase tracking-[0.18em] text-[#7F7973]">${hint}</p>
            </div>
            <input type="date" data-date-id="${esc(item.id)}" min="${w.min}" ${w.max ? `max="${w.max}"` : ""} value="${esc(item.date)}"
              aria-label="Date souhaitée pour ${esc(item.nom)}"
              class="px-3.5 py-2.5 text-sm border ${border} bg-[#FDFBF7] focus:outline-none focus:border-[#2C2A29]" />
          </div>
          ${seasonal ? `<p class="text-[11px] text-[#7F7973]">${isPreorder(live) ? "Précommande : r" : "R"}etrait possible du ${esc(formatDateFR(w.min, false))} au ${esc(formatDateFR(w.max))}.</p>` : ""}
          ${problem ? `<p class="text-xs text-red-700">${esc(problem)}</p>` : ""}
          ${missing ? `<p class="text-xs text-red-700">Choisissez une date.</p>` : ""}
        </div>`;
    })
    .join("");
}

cartItemsList.addEventListener("click", (e) => {
  const qty = e.target.closest("button[data-qty-delta]");
  const rm = e.target.closest("button[data-remove-id]");
  if (qty) {
    const item = state.cart.find((i) => i.id === qty.dataset.id);
    if (!item) return;
    item.quantity += Number(qty.dataset.qtyDelta);
    if (item.quantity <= 0) state.cart = removeItem(state.cart, item.id);
  } else if (rm) {
    state.cart = removeItem(state.cart, rm.dataset.removeId);
  } else return;
  syncCartStorage();
  renderCart();
});

cartDatesList.addEventListener("change", (e) => {
  const input = e.target.closest("input[data-date-id]");
  if (!input) return;
  setItemDate(state.cart, input.dataset.dateId, input.value);
  dropInheritedDatesOutOfSeason();
  syncCartStorage();
  renderCartDates();
});

sameDateBtn.addEventListener("click", () => {
  applyFirstDateToAll(state.cart);
  syncCartStorage();
  renderCartDates();
});

// ---------- Session ----------
function applyUser(user) {
  state.user = user;
  state.authReady = true;
  $("admin-shortcut-badge").classList.toggle("hidden", !(user && user.email === ADMIN_EMAIL));
  if (user) {
    $("user-display-email").textContent = user.email || user.displayName || "Client";
    gate.clear();
  }
  unsubOrders?.();
  unsubOrders = null;
  state.orders = [];
  state.ordersError = null;
  refreshLoyaltyError();
  if (user) {
    unsubOrders = subscribeMyOrders(user.uid, (orders) => {
      state.orders = orders;
      state.ordersError = null;
      refreshLoyaltyError();
      if (state.cart.length) renderTotals();
    }, (err) => {
      state.ordersError = err;
      refreshLoyaltyError();
      if (state.cart.length) renderTotals();
    });
  }
  renderCartAccess();
}

watchUser(applyUser, { page: "panier.html", onLinkError: gate.showError });
$("signout-btn").addEventListener("click", logout);
// Sans les réglages ou sans les commandes, le solde serait faux : pas de remise, mais un message.
function refreshLoyaltyError() {
  state.loyaltyError = state.settingsError || state.ordersError || null;
}
subscribeLoyaltySettings((cfg, err) => {
  state.loyalty = cfg;
  state.settingsError = err;
  refreshLoyaltyError();
  if (state.authReady && state.user && state.cart.length) renderTotals();
});

// ---------- Validation de commande ----------
$("submit-order-btn").addEventListener("click", async () => {
  if (!state.user || state.cart.length === 0) return;

  state.showDateErrors = true;
  renderCartDates();
  const invalid = state.cart.find((i) => !i.date || dateProblem(i));
  if (invalid) {
    showToast("Vérifiez les dates de retrait");
    cartDatesBlock.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const btn = $("submit-order-btn");
  btn.disabled = true;
  btn.textContent = "Enregistrement...";

  const articles = state.cart.map((i) => ({
    id: i.id, nom: i.nom, prix: i.prix, quantity: i.quantity, dateRetrait: i.date,
    ...(isPreorder(liveOf(i) || {}) ? { precommande: true } : {})
  }));
  const dates = [...new Set(articles.map((a) => a.dateRetrait))].sort();
  const subtotal = getCartTotal(state.cart);
  const L = loyaltyState();
  const montant = L?.chosen ? rewardAmount(subtotal, L.chosen) : 0;
  const order = {
    userId: state.user.uid,
    userEmail: state.user.email || "",
    articles,
    sousTotal: subtotal,
    remise: L?.chosen ? { points: L.chosen.points, pct: L.chosen.remisePct, montant } : null,
    total: Math.round((subtotal - montant) * 100) / 100,
    dateRetrait: dates[0],
    datesRetrait: dates,
    notes: $("order-notes").value.trim(),
    statut: "En attente",
    createdAt: serverTimestamp()
  };

  try {
    const ref = await addDoc(collection(db, "commandes"), order);

    state.cart = [];
    state.rewardPoints = 0;
    state.showDateErrors = false;
    syncCartStorage();
    $("order-notes").value = "";
    cartEmptyState.classList.add("hidden");
    cartContent.classList.remove("hidden");
    cartItemsList.classList.add("hidden");
    cartDatesBlock.classList.add("hidden");
    authBox.classList.add("hidden");
    loyaltyBox.classList.add("hidden");
    $("cart-discount-row").classList.add("hidden");
    $("order-id-display").textContent = ref.id.slice(0, 8).toUpperCase();
    orderConfirmation.classList.remove("hidden");
    // Proposer les alertes d'avancement (seulement si le client n'a encore rien choisi)
    if (notifPermission() === "default") {
      mountNotifOptIn($("notif-client-confirm"), { texte: "Être prévenu ici quand l'atelier accepte votre commande et quand elle passe aux fourneaux ?" });
    }
  } catch (err) {
    console.error(err);
    showToast("Erreur lors de la commande");
  } finally {
    btn.disabled = false;
    btn.textContent = "Valider la commande";
  }
});

// ---------- Firestore (temps réel) ----------
// Le catalogue sert à vérifier disponibilité et saisonnalité des articles du panier
subscribeCatalog(() => {
  if (state.authReady && state.user && state.cart.length) renderCart();
});

renderFlash();
renderCartAccess(); // « Chargement... » jusqu'à ce que la session soit connue
