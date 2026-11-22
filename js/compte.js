// Mon compte : programme de fidélité et historique des commandes (recommander, annuler).
import { $, showToast, catalog, subscribeCatalog } from "./shop-common.js";
import { mountNotifOptIn } from "./web-notify.js";
import {
  esc, formatPrice, formatDateFR, normalizeOrderStatut, canClientCancel, productUrl, isPartiallyDelivered, articleLabel
} from "./catalog.js";
import { mountAuthGate, watchUser, logout } from "./auth-ui.js";
import {
  subscribeMyOrders, subscribeLoyaltySettings, cancelOrder, reorderToCart, reorderMessage, setFlash
} from "./client-orders.js";
import { loyaltyBalance, normalizeLoyalty, pointsFor } from "./loyalty.js";

const state = { user: null, orders: null, loyalty: null, loyaltyError: null, busy: new Set() };
let unsubOrders = null;

const gate = mountAuthGate($("account-gate"), { page: "compte.html", subtitle: "Connectez-vous pour retrouver vos commandes et vos points." });

// Libellés pour le client (l'atelier voit les statuts bruts)
const CLIENT_STATUT = {
  "En attente": { label: "En attente de confirmation", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  "Acceptée": { label: "Acceptée", cls: "bg-sky-50 text-sky-800 border-sky-200" },
  "En préparation": { label: "En préparation", cls: "bg-violet-50 text-violet-800 border-violet-200" },
  "Prête": { label: "Prête à retirer", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  "Retrait partiel": { label: "Retirée en partie", cls: "bg-teal-50 text-teal-800 border-teal-200" },
  "Retirée": { label: "Retirée", cls: "bg-stone-100 text-stone-600 border-stone-300" },
  "Refusée": { label: "Refusée par l'atelier", cls: "bg-red-50 text-red-800 border-red-200" },
  "Annulée": { label: "Annulée", cls: "bg-stone-100 text-stone-600 border-stone-300" }
};

function render() {
  const logged = Boolean(state.user);
  $("account-loading").classList.toggle("hidden", state.user !== undefined);
  $("account-gate").classList.toggle("hidden", state.user === undefined || logged);
  $("account-main").classList.toggle("hidden", !logged);
  if (!logged) return;
  $("account-email").textContent = state.user.email || state.user.displayName || "Client";
  renderLoyalty();
  renderOrders();
}

// ---------- Fidélité ----------
function renderLoyalty() {
  const box = $("fidelite");
  if (state.loyaltyError) {
    box.classList.remove("hidden");
    box.innerHTML = `
      <h2 id="fidelite-title" class="font-serif text-2xl">Ma fidélité</h2>
      <p class="text-xs text-[#7F7973] border border-[#2C2A29]/15 bg-white p-4">Le programme de fidélité ne peut pas être affiché pour le moment. Vos points ne sont pas perdus : réessayez un peu plus tard.</p>`;
    return;
  }
  const cfg = normalizeLoyalty(state.loyalty);
  if (!cfg.actif) { box.classList.add("hidden"); return; }
  const bal = loyaltyBalance(state.orders || [], cfg);
  const next = cfg.paliers.find((p) => p.points > bal.solde);
  const top = cfg.paliers.filter((p) => p.points <= bal.solde).at(-1);
  const goal = next || top;
  const progress = goal ? Math.min(100, Math.round((bal.solde / goal.points) * 100)) : 0;

  box.classList.remove("hidden");
  box.innerHTML = `
    <h2 id="fidelite-title" class="font-serif text-2xl">Ma fidélité</h2>
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div class="lg:col-span-5 border border-[#2C2A29] bg-white p-6 space-y-4">
        <p class="text-[11px] uppercase tracking-[0.18em] text-[#7F7973]">Mes points</p>
        <p class="font-serif text-5xl leading-none">${bal.solde}<span class="text-xl ml-2">pt${bal.solde > 1 ? "s" : ""}</span></p>
        ${goal ? `
          <div class="h-1.5 bg-[#2C2A29]/10" role="progressbar" aria-valuemin="0" aria-valuemax="${goal.points}" aria-valuenow="${Math.min(bal.solde, goal.points)}" aria-label="Progression vers le prochain avantage">
            <div class="h-full bg-[#2C2A29]" style="width:${progress}%"></div>
          </div>
          <p class="text-xs">${next
            ? `Encore <strong>${next.points - bal.solde} pt${next.points - bal.solde > 1 ? "s" : ""}</strong> pour −${next.remisePct} % sur une commande.`
            : `Vous pouvez utiliser <strong>${top.points} pts</strong> pour −${top.remisePct} % dans votre panier.`}</p>` : ""}
        ${bal.enAttente ? `<p class="text-[11px] text-[#7F7973]">+${bal.enAttente} pts en attente : ils s'ajoutent quand l'atelier accepte la commande.</p>` : ""}
        ${bal.prochaineExpiration ? `<p class="text-[11px] text-[#7F7973]">${bal.prochaineExpiration.points} pt${bal.prochaineExpiration.points > 1 ? "s" : ""} expirent le ${esc(bal.prochaineExpiration.date.toLocaleDateString("fr-FR"))}.</p>` : ""}
      </div>
      <div class="lg:col-span-7 border border-[#2C2A29]/15 bg-white p-6 space-y-4 text-sm leading-relaxed">
        ${cfg.description ? `<div class="whitespace-pre-line">${esc(cfg.description)}</div>` : ""}
        <ul class="space-y-1 text-xs text-[#7F7973]">
          <li>1 € dépensé = 1 point (arrondi à l'euro inférieur : 4,50 € = 4 pts).</li>
          ${cfg.paliers.map((p) => `<li>${p.points} pts = −${p.remisePct} % sur une commande.</li>`).join("")}
          ${cfg.validiteJours ? `<li>Chaque point reste valable ${cfg.validiteJours} jours après la commande qui l'a rapporté.</li>` : ""}
        </ul>
      </div>
    </div>`;
}

// ---------- Historique ----------
function renderOrders() {
  const box = $("my-orders");
  if (state.orders === null) {
    box.innerHTML = `<p class="text-xs uppercase tracking-[0.2em] text-[#7F7973]">Chargement...</p>`;
    return;
  }
  if (!state.orders.length) {
    box.innerHTML = `
      <div class="text-center py-12 border border-[#2C2A29]/15 bg-white px-6 space-y-4">
        <p class="font-serif text-xl">Vous n'avez pas encore passé de commande</p>
        <a href="index.html" class="inline-block px-6 py-3 bg-[#2C2A29] text-[#FDFBF7] text-xs uppercase tracking-[0.2em] hover:bg-[#43403E] transition-colors">Découvrir nos créations</a>
      </div>`;
    return;
  }
  const loyaltyOn = normalizeLoyalty(state.loyalty).actif;

  box.innerHTML = state.orders.map((o) => {
    const statut = normalizeOrderStatut(o.statut);
    const st = CLIENT_STATUT[statut];
    const placed = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "à l'instant";
    const busy = state.busy.has(o.id);
    const partial = isPartiallyDelivered(o) && statut !== "Retirée";
    const lines = (o.articles || []).map((a) => `
      <li class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <span>${a.quantity} &times; <a href="${productUrl(a.id)}" class="hover:underline underline-offset-4">${esc(articleLabel(a))}</a> <span class="text-[#7F7973]">(${formatPrice(a.prix * a.quantity)})</span>${partial && a.remis ? ` <span class="text-[10px] uppercase tracking-[0.12em] bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 ml-1">Retiré${a.remisLe ? ` le ${esc(new Date(a.remisLe).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }))}` : ""}</span>` : ""}</span>
        <span class="text-[#7F7973]">${esc(formatDateFR(a.dateRetrait || o.dateRetrait))}</span>
      </li>`).join("");
    const lockedMsg = !canClientCancel(o) && (["En préparation", "Prête", "Retrait partiel"].includes(statut) || partial)
      ? `<p class="text-[11px] text-[#7F7973]">La préparation a commencé : pour toute modification, contactez la maison.</p>` : "";

    return `
      <article class="border border-[#2C2A29]/15 bg-white p-5 sm:p-6 space-y-4">
        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-[#2C2A29]/10 pb-3">
          <div>
            <p class="text-sm font-medium">Commande #${esc(o.id.slice(0, 8).toUpperCase())}</p>
            <p class="text-[11px] text-[#7F7973] mt-0.5">Passée le ${esc(placed)}</p>
          </div>
          <div class="text-right space-y-1.5">
            <span class="inline-block text-[11px] px-2 py-0.5 border ${st.cls}">${st.label}</span>
            ${partial ? `<div><span class="inline-block text-[11px] px-2 py-0.5 border bg-emerald-50 text-emerald-800 border-emerald-200">Retrait partiel</span></div>` : ""}
            <p class="font-serif text-xl">${formatPrice(o.total)}</p>
          </div>
        </div>
        <ul class="text-xs space-y-1.5">${lines}</ul>
        ${o.prixAjuste ? `<p class="text-xs text-[#7F7973]">Prix ajusté par la maison : ${formatPrice(o.prixAjuste.ancien)} → ${formatPrice(o.total)}${o.prixAjuste.motif ? ` (${esc(o.prixAjuste.motif)})` : ""}.</p>` : ""}
        ${o.remiseAnnulee ? `<p class="text-xs text-[#7F7973]">La remise fidélité n'a pas été appliquée : vos ${o.remiseAnnulee.points} pts vous ont été rendus.</p>` : ""}
        ${o.remise?.montant ? `<p class="text-xs text-[#7F7973]">Remise fidélité : −${formatPrice(o.remise.montant)} (${o.remise.points} pts utilisés${["Refusée", "Annulée"].includes(statut) ? ", rendus" : ""})</p>` : ""}
        ${loyaltyOn && !["Refusée", "Annulée"].includes(statut) && pointsFor(o.total) ? `<p class="text-xs text-[#7F7973]">${statut === "En attente" ? "Rapportera" : "A rapporté"} ${pointsFor(o.total)} pt${pointsFor(o.total) > 1 ? "s" : ""} de fidélité.</p>` : ""}
        ${statut === "Refusée" && o.motifRefus ? `<p class="text-xs bg-red-50 border border-red-200 text-red-800 p-3">Message de l'atelier : ${esc(o.motifRefus)}</p>` : ""}
        ${lockedMsg}
        <div class="flex flex-wrap gap-3 pt-1">
          <button type="button" data-reorder="${esc(o.id)}" ${busy ? "disabled" : ""} class="px-4 py-2.5 bg-[#2C2A29] text-[#FDFBF7] text-[11px] uppercase tracking-[0.18em] hover:bg-[#43403E] transition-colors disabled:opacity-50">Recommander</button>
          ${canClientCancel(o) ? `<button type="button" data-cancel="${esc(o.id)}" ${busy ? "disabled" : ""} class="px-4 py-2.5 border border-red-300 text-red-700 text-[11px] uppercase tracking-[0.18em] hover:bg-red-700 hover:text-white transition-colors disabled:opacity-50">Annuler la commande</button>` : ""}
        </div>
      </article>`;
  }).join("");
}

$("my-orders").addEventListener("click", async (e) => {
  const re = e.target.closest("button[data-reorder]");
  const ca = e.target.closest("button[data-cancel]");
  if (re) {
    const order = state.orders.find((o) => o.id === re.dataset.reorder);
    if (!order) return;
    if (!catalog.ready) return showToast("Chargement de la carte, réessayez");
    const result = reorderToCart(order, catalog.products);
    setFlash(reorderMessage(result));
    window.location.href = "panier.html";
  } else if (ca) {
    const order = state.orders.find((o) => o.id === ca.dataset.cancel);
    if (!order || !canClientCancel(order)) return;
    if (!confirm(`Annuler la commande #${order.id.slice(0, 8).toUpperCase()} ?\n\nL'atelier en sera prévenu par e-mail.`)) return;
    state.busy.add(order.id);
    renderOrders();
    try {
      await cancelOrder(order);
      showToast("Commande annulée");
    } catch (err) {
      console.error(err);
      showToast("Annulation impossible : la préparation a peut-être commencé");
    } finally {
      state.busy.delete(order.id);
      renderOrders();
    }
  }
});

$("account-signout").addEventListener("click", logout);

state.user = undefined; // inconnu tant que la session n'est pas restaurée
watchUser((user) => {
  state.user = user;
  unsubOrders?.();
  unsubOrders = null;
  state.orders = null;
  if (user) {
    gate.clear();
    unsubOrders = subscribeMyOrders(user.uid, (orders) => { state.orders = orders; render(); }, () => {
      $("my-orders").innerHTML = `<p class="text-xs text-red-700">Impossible de lire vos commandes pour le moment.</p>`;
    });
  }
  render();
}, { page: "compte.html", onLinkError: gate.showError });

subscribeLoyaltySettings((cfg, err) => {
  state.loyalty = cfg;
  state.loyaltyError = err;
  if (state.user) render();
});
subscribeCatalog(() => {}); // la carte est nécessaire pour « Recommander »
render();

// Lien direct vers #fidelite (depuis le panier)
if (location.hash === "#fidelite") {
  const go = () => $("fidelite").scrollIntoView({ behavior: "smooth" });
  setTimeout(go, 600);
}

// Alertes navigateur : proposition d'activation (avancement des commandes)
mountNotifOptIn($("notif-client"), {
  texte: "Être prévenu sur cet appareil dès que l'atelier accepte votre commande, puis quand elle passe aux fourneaux ?"
});
