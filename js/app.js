import { db, auth, authReady } from "./firebase-config.js";
import {
  loadCart, persistCart, getCartCount, getCartTotal,
  addItem, setItemDate, applyFirstDateToAll, removeItem
} from "./cart.js";
import {
  ADMIN_EMAIL, EMAIL_LINK_KEY, esc, formatPrice, tomorrowISO, parseISODate,
  getAvailability, groupByCategory, seasonLabel, productImages, productUrl
} from "./catalog.js";
import {
  collection, onSnapshot, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendSignInLinkToEmail, isSignInWithEmailLink,
  signInWithEmailLink, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const state = {
  categories: [],
  products: [],
  selectedCategory: "ALL",
  cart: loadCart(),
  user: null,
  authReady: false,
  productsLoaded: false,
  productId: null,
  productQty: 1,
  galleryIndex: 0,
  currentView: "patisseries",
  showDateErrors: false
};

const $ = (id) => document.getElementById(id);
const viewPatisseries = $("view-patisseries");
const viewPanier = $("view-panier");
const viewProduit = $("view-produit");
const productDetail = $("product-detail");
const DEFAULT_TITLE = document.title;
const categoriesBar = $("categories-bar");
const productsGrid = $("products-grid");
const emptyCatalog = $("empty-catalog");
const cartBadge = $("cart-badge");
const authLoading = $("cart-auth-loading");
const authGate = $("cart-auth-gate");
const cartMain = $("cart-main");
const authInfo = $("auth-info");
const cartEmptyState = $("cart-empty-state");
const cartContent = $("cart-content");
const cartItemsList = $("cart-items-list");
const cartDatesBlock = $("cart-dates-block");
const cartDatesList = $("cart-dates-list");
const sameDateBtn = $("same-date-btn");
const authBox = $("auth-box");
const authError = $("auth-error");
const orderConfirmation = $("order-confirmation");

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("translate-y-20", "opacity-0");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => toast.classList.add("translate-y-20", "opacity-0"), 2600);
}

function syncCartStorage() {
  persistCart(state.cart);
  const count = getCartCount(state.cart);
  cartBadge.textContent = count;
  cartBadge.classList.toggle("hidden", count === 0);
}

// ---------- Navigation ----------
function handleRouting() {
  const { pathname, hash, search } = window.location;
  if (pathname === "/produit") {
    state.productId = new URLSearchParams(search).get("id");
    switchView("produit");
  } else if (pathname === "/panier" || hash === "#panier") {
    switchView("panier");
  } else {
    switchView("patisseries");
  }
}

function switchView(name) {
  state.currentView = name;
  viewPatisseries.classList.toggle("hidden", name !== "patisseries");
  viewPanier.classList.toggle("hidden", name !== "panier");
  viewProduit.classList.toggle("hidden", name !== "produit");
  orderConfirmation.classList.add("hidden");
  document.title = DEFAULT_TITLE;
  if (name === "panier") renderCartAccess();
  if (name === "produit") {
    state.productQty = 1;
    state.galleryIndex = 0;
    renderProductPage();
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function go(path) {
  window.history.pushState({}, "", path);
  handleRouting();
}

$("nav-logo-btn").addEventListener("click", () => go("/"));
$("nav-cart-btn").addEventListener("click", () => go("/panier"));
$("back-to-shop-btn").addEventListener("click", () => go("/"));
$("empty-continue-btn").addEventListener("click", () => go("/"));
window.addEventListener("popstate", handleRouting);

// Liens internes : navigation sans rechargement (le clic droit / nouvel onglet reste possible)
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-nav]");
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  if (a.dataset.cat) {
    state.selectedCategory = a.dataset.cat;
    renderCategories();
    renderProducts();
  }
  go(a.getAttribute("href"));
});

// ---------- Catalogue ----------
function renderCategories() {
  const groups = groupByCategory(state.categories, state.products);

  if (state.selectedCategory !== "ALL" && !groups.some((g) => g.id === state.selectedCategory)) {
    state.selectedCategory = "ALL";
  }
  if (state.products.length === 0) {
    categoriesBar.innerHTML = "";
    categoriesBar.classList.add("hidden");
    return;
  }

  categoriesBar.classList.remove("hidden");
  const buttons = [{ id: "ALL", nom: "Toutes les créations" }, ...groups];
  categoriesBar.innerHTML = buttons
    .map((b) => {
      const active = state.selectedCategory === b.id;
      const cls = active
        ? "bg-[#2C2A29] text-[#FDFBF7] border-[#2C2A29]"
        : "bg-transparent text-[#2C2A29] border-[#2C2A29]/20 hover:border-[#2C2A29]";
      return `<button type="button" data-cat-id="${esc(b.id)}" class="px-4 py-2 text-xs uppercase tracking-[0.2em] border transition-colors ${cls}">${esc(b.nom)}</button>`;
    })
    .join("");
}

categoriesBar.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-cat-id]");
  if (!btn) return;
  state.selectedCategory = btn.dataset.catId;
  renderCategories();
  renderProducts();
});

function renderProducts() {
  if (state.products.length === 0) {
    productsGrid.innerHTML = "";
    emptyCatalog.classList.remove("hidden");
    return;
  }
  emptyCatalog.classList.add("hidden");

  // "Autre" est toujours en dernier ; au sein d'une catégorie, les articles disponibles passent d'abord
  const groups = groupByCategory(state.categories, state.products).filter(
    (g) => state.selectedCategory === "ALL" || g.id === state.selectedCategory
  );
  const items = groups.flatMap((g) =>
    [...g.products]
      .sort((a, b) => Number(!getAvailability(a).available) - Number(!getAvailability(b).available))
      .map((p) => ({ p, catLabel: g.nom }))
  );

  productsGrid.innerHTML = items
    .map(({ p, catLabel }) => {
      const av = getAvailability(p);
      const off = !av.available;
      const season = seasonLabel(p.saison);
      const img = p.imageUrl
        ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.nom)}" class="w-full h-full object-cover ${off ? "grayscale opacity-75" : ""}" loading="lazy" />`
        : `<img src="assets/logo.svg" alt="Johanne &amp; Cie" class="w-full h-full object-contain p-6 bg-[#FDFBF7] opacity-80" />`;
      const badge = off
        ? `<span class="absolute top-3 right-3 bg-[#2C2A29] text-[#FDFBF7] px-3 py-1 text-[10px] uppercase tracking-[0.2em]">${esc(av.reason)}</span>`
        : "";
      const action = off
        ? `<button type="button" disabled class="w-full py-2.5 px-4 border border-[#2C2A29]/25 text-[#7F7973] bg-[#FDFBF7] text-[11px] uppercase tracking-[0.2em] cursor-not-allowed">${esc(av.reason)}</button>`
        : `<button type="button" data-add-id="${esc(p.id)}" class="w-full py-2.5 px-4 bg-[#2C2A29] text-[#FDFBF7] hover:bg-[#43403E] transition-colors text-[11px] uppercase tracking-[0.2em]">Ajouter au panier</button>`;

      return `
        <article class="product-card border border-[#2C2A29]/15 bg-white flex flex-col justify-between">
          <div>
            <a href="${productUrl(p.id)}" data-nav class="block relative aspect-[4/3] overflow-hidden border-b border-[#2C2A29]/10 bg-[#F4F0E8]" aria-label="Voir ${esc(p.nom)}">${img}${badge}</a>
            <div class="p-6 space-y-2">
              <p class="text-[10px] uppercase tracking-[0.22em] text-[#7F7973]">${esc(catLabel)}</p>
              <div class="flex items-baseline justify-between gap-3">
                <h2 class="font-serif text-2xl text-[#2C2A29] leading-snug"><a href="${productUrl(p.id)}" data-nav class="hover:underline underline-offset-4">${esc(p.nom || "Pâtisserie")}</a></h2>
                <span class="font-serif text-lg text-[#2C2A29] shrink-0">${formatPrice(p.prix)}</span>
              </div>
              ${season ? `<p class="text-[10px] uppercase tracking-[0.18em] text-[#7F7973]">Saison : ${esc(season.toLowerCase())}</p>` : ""}
              ${p.description ? `<p class="text-xs text-[#7F7973] leading-relaxed pt-1">${esc(p.description)}</p>` : ""}
              <a href="${productUrl(p.id)}" data-nav class="inline-block pt-1 text-[10px] uppercase tracking-[0.2em] text-[#2C2A29] underline underline-offset-4">Voir le détail &rarr;</a>
            </div>
          </div>
          <div class="px-6 pb-6 pt-2">${action}</div>
        </article>`;
    })
    .join("");
}

productsGrid.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-add-id]");
  if (btn) addToCart(btn.dataset.addId);
});

function addToCart(productId, qty = 1) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return;
  const av = getAvailability(product);
  if (!av.available) return showToast(`Indisponible (${av.reason})`);
  addItem(state.cart, product, qty);
  syncCartStorage();
  showToast("Ajouté au panier");
}

// ---------- Fiche produit ----------
const QTY_MAX = 50;

function renderProductPage() {
  if (!state.productsLoaded) {
    productDetail.innerHTML = `<p class="text-center text-xs uppercase tracking-[0.2em] text-[#7F7973] py-20">Chargement...</p>`;
    return;
  }
  const p = state.products.find((x) => x.id === state.productId);
  if (!p) {
    productDetail.innerHTML = `
      <div class="text-center py-20 border border-[#2C2A29]/15 bg-white px-6 space-y-5">
        <p class="font-serif text-2xl">Cette création n'est plus à la carte</p>
        <a href="/" data-nav class="inline-block px-6 py-3 bg-[#2C2A29] text-[#FDFBF7] text-xs uppercase tracking-[0.2em] hover:bg-[#43403E] transition-colors">Découvrir nos créations</a>
      </div>`;
    return;
  }
  document.title = `${p.nom} — Johanne & Cie`;

  const groups = groupByCategory(state.categories, state.products);
  const group = groups.find((g) => g.products.some((x) => x.id === p.id));
  const av = getAvailability(p);
  const imgs = productImages(p);
  const idx = Math.min(state.galleryIndex, Math.max(imgs.length - 1, 0));
  const season = seasonLabel(p.saison);
  const allergenes = Array.isArray(p.allergenes) ? p.allergenes : [];

  // Galerie
  const main = imgs.length
    ? `<img src="${esc(imgs[idx])}" alt="${esc(p.nom)}" class="w-full h-full object-cover ${av.available ? "" : "grayscale opacity-75"}" />`
    : `<img src="assets/logo.svg" alt="Johanne &amp; Cie" class="w-full h-full object-contain p-10 opacity-80" />`;
  const thumbs = imgs.length > 1
    ? `<div class="flex gap-3 mt-3 overflow-x-auto">${imgs.map((u, i) => `
        <button type="button" data-gallery-idx="${i}" aria-label="Image ${i + 1}" class="w-20 h-20 shrink-0 overflow-hidden border ${i === idx ? "border-[#2C2A29]" : "border-[#2C2A29]/20 hover:border-[#2C2A29]/60"} bg-[#F4F0E8]">
          <img src="${esc(u)}" alt="" class="w-full h-full object-cover" loading="lazy" />
        </button>`).join("")}</div>`
    : "";

  // Détails (seules les rubriques renseignées apparaissent)
  const detailBlocks = [];
  if (p.conservation) detailBlocks.push(`<p class="font-medium text-[#2C2A29]">${esc(p.conservation)}</p>`);
  if (p.composition) detailBlocks.push(`<p>${esc(p.composition).replace(/\n/g, "<br>")}</p>`);
  if (allergenes.length) detailBlocks.push(`<p>Présence de : <span class="font-medium text-[#2C2A29]">${esc(allergenes.map((a) => a.toLowerCase()).join(", "))}</span></p>`);
  const facts = [p.parts && `Pour ${esc(p.parts)}`, p.poids && `Poids : ${esc(p.poids)}`, season && `Saison : ${esc(season.toLowerCase())}`].filter(Boolean);
  if (facts.length) detailBlocks.push(`<p class="text-[#7F7973]">${facts.join(" &nbsp;&bull;&nbsp; ")}</p>`);

  const detailsHtml = detailBlocks.length
    ? `<section id="product-details" class="border-t border-[#2C2A29]/15 pt-8 space-y-4 max-w-3xl">
         <h2 class="font-serif text-2xl">Détails du produit</h2>
         <div class="text-sm leading-relaxed space-y-3">${detailBlocks.join("")}</div>
       </section>`
    : "";

  // Suggestions : même catégorie d'abord, puis le reste
  const others = state.products.filter((x) => x.id !== p.id && getAvailability(x).available);
  const sameCat = others.filter((x) => group && group.products.some((g) => g.id === x.id));
  const similar = [...sameCat, ...others.filter((x) => !sameCat.includes(x))].slice(0, 3);
  const similarHtml = similar.length
    ? `<section class="border-t border-[#2C2A29]/15 pt-8 space-y-6">
         <h2 class="font-serif text-2xl">Vous pourriez aussi aimer</h2>
         <div class="grid grid-cols-1 sm:grid-cols-3 gap-6">${similar.map((x) => {
           const xi = productImages(x)[0];
           return `
           <a href="${productUrl(x.id)}" data-nav class="product-card block border border-[#2C2A29]/15 bg-white">
             <div class="aspect-[4/3] overflow-hidden border-b border-[#2C2A29]/10 bg-[#F4F0E8]">
               <img src="${esc(xi || "assets/logo.svg")}" alt="${esc(x.nom)}" class="w-full h-full ${xi ? "object-cover" : "object-contain p-6 opacity-80"}" loading="lazy" />
             </div>
             <div class="p-4 flex items-baseline justify-between gap-3">
               <span class="font-serif text-lg leading-snug">${esc(x.nom)}</span>
               <span class="font-serif text-base shrink-0">${formatPrice(x.prix)}</span>
             </div>
           </a>`;
         }).join("")}</div>
       </section>`
    : "";

  const action = av.available
    ? `<div class="flex flex-wrap items-stretch gap-3">
         <div class="flex items-center border border-[#2C2A29]/25">
           <button type="button" data-qty-step="-1" aria-label="Moins" class="px-4 py-3 text-sm hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors">&minus;</button>
           <span id="product-qty" class="px-4 py-3 text-sm font-medium min-w-[3rem] text-center">${state.productQty}</span>
           <button type="button" data-qty-step="1" aria-label="Plus" class="px-4 py-3 text-sm hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors">+</button>
         </div>
         <button type="button" data-product-add class="flex-1 min-w-[12rem] py-3 px-6 bg-[#2C2A29] text-[#FDFBF7] hover:bg-[#43403E] transition-colors text-xs uppercase tracking-[0.22em]">Ajouter au panier</button>
       </div>`
    : `<button type="button" disabled class="w-full py-3 px-6 border border-[#2C2A29]/25 text-[#7F7973] bg-[#FDFBF7] text-xs uppercase tracking-[0.22em] cursor-not-allowed">${esc(av.reason)}</button>`;

  productDetail.innerHTML = `
    <nav aria-label="Fil d'Ariane" class="text-[11px] uppercase tracking-[0.18em] text-[#7F7973] mb-8 flex flex-wrap items-center gap-2">
      <a href="/" data-nav data-cat="ALL" class="hover:text-[#2C2A29]">Accueil</a><span>&rsaquo;</span>
      ${group ? `<a href="/" data-nav data-cat="${esc(group.id)}" class="hover:text-[#2C2A29]">${esc(group.nom)}</a><span>&rsaquo;</span>` : ""}
      <span class="text-[#2C2A29]">${esc(p.nom)}</span>
    </nav>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 mb-14">
      <div>
        <div class="relative aspect-[4/3] sm:aspect-square overflow-hidden border border-[#2C2A29]/15 bg-[#F4F0E8]">
          ${main}
          ${av.available ? "" : `<span class="absolute top-4 right-4 bg-[#2C2A29] text-[#FDFBF7] px-3 py-1 text-[10px] uppercase tracking-[0.2em]">${esc(av.reason)}</span>`}
        </div>
        ${thumbs}
      </div>

      <div class="space-y-6">
        ${group ? `<p class="text-[10px] uppercase tracking-[0.25em] text-[#7F7973]">${esc(group.nom)}</p>` : ""}
        <h1 class="font-serif text-4xl sm:text-5xl leading-tight">${esc(p.nom)}</h1>
        <p class="font-serif text-3xl">${formatPrice(p.prix)}</p>
        ${p.description ? `<p class="text-sm text-[#7F7973] leading-relaxed">${esc(p.description)}${detailBlocks.length ? ` <a href="#product-details" data-scroll class="text-[#2C2A29] underline underline-offset-4">Plus de détails</a>` : ""}</p>` : ""}
        ${season ? `<p class="text-[11px] uppercase tracking-[0.18em] text-[#7F7973]">Saison : ${esc(season.toLowerCase())}</p>` : ""}
        ${action}

        <div class="border border-[#2C2A29]/15 bg-white divide-y divide-[#2C2A29]/10">
          <div class="p-4 flex items-start justify-between gap-4">
            <div>
              <p class="text-xs uppercase tracking-[0.18em] font-medium">Retrait à l'atelier</p>
              <p class="text-xs text-[#7F7973] mt-1">Mons &mdash; Ceuninck &middot; date choisie dans votre panier</p>
            </div>
            <span class="text-xs uppercase tracking-[0.15em] text-[#7F7973] shrink-0">Gratuit</span>
          </div>
        </div>
      </div>
    </div>

    <div class="space-y-12">${detailsHtml}${similarHtml}</div>`;
}

productDetail.addEventListener("click", (e) => {
  const thumb = e.target.closest("button[data-gallery-idx]");
  const step = e.target.closest("button[data-qty-step]");
  const add = e.target.closest("button[data-product-add]");
  const scroll = e.target.closest("a[data-scroll]");
  if (thumb) {
    state.galleryIndex = Number(thumb.dataset.galleryIdx);
    renderProductPage();
  } else if (step) {
    state.productQty = Math.min(QTY_MAX, Math.max(1, state.productQty + Number(step.dataset.qtyStep)));
    $("product-qty").textContent = state.productQty;
  } else if (add) {
    addToCart(state.productId, state.productQty);
    state.productQty = 1;
    $("product-qty").textContent = 1;
  } else if (scroll) {
    e.preventDefault();
    document.getElementById("product-details")?.scrollIntoView({ behavior: "smooth" });
  }
});

// ---------- Panier ----------
function dateProblem(item) {
  if (!item.date) return null;
  if (item.date < tomorrowISO()) return "Date trop proche : à partir de demain.";
  const live = state.products.find((p) => p.id === item.id);
  if (state.products.length && !live) return "Cette création n'est plus proposée.";
  if (live && !getAvailability(live, parseISODate(item.date)).available) {
    const s = seasonLabel(live.saison);
    return `Hors-saison à cette date${s ? ` (${s.toLowerCase()})` : ""}. Choisissez une autre date.`;
  }
  return null;
}

// Le panier n'est visible qu'une fois connecté
function renderCartAccess() {
  const logged = Boolean(state.user);
  authLoading.classList.toggle("hidden", state.authReady);
  authGate.classList.toggle("hidden", !state.authReady || logged);
  cartMain.classList.toggle("hidden", !state.authReady || !logged);
  if (state.authReady && logged) renderCart();
}

function renderCart() {
  // Retire les créations devenues indisponibles
  state.cart = state.cart.filter((item) => {
    const live = state.products.find((p) => p.id === item.id);
    return !live || getAvailability(live).available;
  });
  if (state.cart.length) state.cart[0].dateManual = false;
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
    .map((item) => `
      <div class="flex items-center justify-between gap-4 p-4 border border-[#2C2A29]/15 bg-white">
        <div class="min-w-0 flex-1">
          <h3 class="font-serif text-xl text-[#2C2A29] truncate"><a href="${productUrl(item.id)}" data-nav class="hover:underline underline-offset-4">${esc(item.nom)}</a></h3>
          <p class="text-xs text-[#7F7973] mt-0.5">${formatPrice(item.prix)} / pièce</p>
        </div>
        <div class="flex items-center border border-[#2C2A29]/25">
          <button type="button" data-qty-delta="-1" data-id="${esc(item.id)}" class="px-3 py-1 text-sm hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors">&minus;</button>
          <span class="px-3 py-1 text-xs font-medium">${item.quantity}</span>
          <button type="button" data-qty-delta="1" data-id="${esc(item.id)}" class="px-3 py-1 text-sm hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors">+</button>
        </div>
        <div class="text-right shrink-0 w-24">
          <p class="font-serif text-lg text-[#2C2A29]">${formatPrice(item.prix * item.quantity)}</p>
          <button type="button" data-remove-id="${esc(item.id)}" class="text-[10px] uppercase tracking-[0.15em] text-[#7F7973] hover:text-[#2C2A29] underline">Retirer</button>
        </div>
      </div>`)
    .join("");

  const total = getCartTotal(state.cart);
  $("cart-subtotal").textContent = formatPrice(total);
  $("cart-total").textContent = formatPrice(total);
  renderCartDates();
}

function renderCartDates() {
  const min = tomorrowISO();
  sameDateBtn.classList.toggle("hidden", state.cart.length < 2);

  cartDatesList.innerHTML = state.cart
    .map((item, idx) => {
      const problem = dateProblem(item);
      const missing = state.showDateErrors && !item.date;
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
            <input type="date" data-date-id="${esc(item.id)}" min="${min}" value="${esc(item.date)}"
              aria-label="Date souhaitée pour ${esc(item.nom)}"
              class="px-3.5 py-2.5 text-sm border ${border} bg-[#FDFBF7] focus:outline-none focus:border-[#2C2A29]" />
          </div>
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
  syncCartStorage();
  renderCartDates();
});

sameDateBtn.addEventListener("click", () => {
  applyFirstDateToAll(state.cart);
  syncCartStorage();
  renderCartDates();
});

// ---------- Authentification ----------
// La session est conservée en cache (voir firebase-config.js) : onAuthStateChanged la restaure au chargement.
// Si la page est ouverte via un lien e-mail, on attend de l'avoir traité avant d'afficher quoi que ce soit
let linkPending = isSignInWithEmailLink(auth, window.location.href);

function applyAuthState() {
  const user = state.user;
  state.authReady = true;
  $("admin-shortcut-badge").classList.toggle("hidden", !(user && user.email === ADMIN_EMAIL));
  if (user) {
    $("user-display-email").textContent = user.email || user.displayName || "Client";
    authError.classList.add("hidden");
    authInfo.classList.add("hidden");
  }
  if (state.currentView === "panier") renderCartAccess();
}

onAuthStateChanged(auth, (user) => {
  state.user = user;
  if (!linkPending) applyAuthState();
});

function showAuthError(msg) {
  authInfo.classList.add("hidden");
  authError.textContent = msg;
  authError.classList.remove("hidden");
}

function showAuthInfo(msg) {
  authError.classList.add("hidden");
  authInfo.textContent = msg;
  authInfo.classList.remove("hidden");
}

$("google-signin-btn").addEventListener("click", async () => {
  authError.classList.add("hidden");
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    if (err.code !== "auth/popup-closed-by-user") showAuthError("Connexion Google impossible. Réessayez.");
  }
});

// Connexion par lien envoyé par e-mail (sans mot de passe)
$("email-link-btn").addEventListener("click", async () => {
  const email = $("auth-email").value.trim();
  if (!email || !$("auth-email").checkValidity()) return showAuthError("Saisissez une adresse e-mail valide.");
  const btn = $("email-link-btn");
  btn.disabled = true;
  try {
    await sendSignInLinkToEmail(auth, email, {
      url: `${window.location.origin}/panier`,
      handleCodeInApp: true
    });
    localStorage.setItem(EMAIL_LINK_KEY, email);
    showAuthInfo(`Lien envoyé à ${email}. Ouvrez-le depuis votre messagerie pour accéder à votre panier (pensez aux courriers indésirables).`);
  } catch (err) {
    console.error(err);
    showAuthError("Envoi du lien impossible. Vérifiez l'adresse et réessayez.");
  } finally {
    btn.disabled = false;
  }
});

// Retour depuis le lien reçu par e-mail
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
    showAuthError("Ce lien de connexion est invalide ou a expiré. Demandez-en un nouveau.");
  } finally {
    linkPending = false;
    window.history.replaceState({}, "", "/panier"); // retire les paramètres du lien
    state.user = auth.currentUser;
    applyAuthState();
  }
}

$("email-auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.classList.add("hidden");
  const password = $("auth-password").value;
  if (password.length < 6) return showAuthError("Saisissez votre mot de passe (6 caractères min.).");
  try {
    await signInWithEmailAndPassword(auth, $("auth-email").value.trim(), password);
  } catch {
    showAuthError("Identifiants invalides ou compte inexistant.");
  }
});

$("email-register-btn").addEventListener("click", async () => {
  authError.classList.add("hidden");
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  if (!email || !$("auth-email").checkValidity() || password.length < 6) {
    return showAuthError("Veuillez saisir un e-mail valide et un mot de passe (6 caractères min.).");
  }
  try {
    await createUserWithEmailAndPassword(auth, email, password);
  } catch (err) {
    showAuthError(err.code === "auth/email-already-in-use" ? "Un compte existe déjà avec cet e-mail." : "Création du compte impossible.");
  }
});

$("signout-btn").addEventListener("click", () => signOut(auth));

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
    id: i.id, nom: i.nom, prix: i.prix, quantity: i.quantity, dateRetrait: i.date
  }));
  const dates = [...new Set(articles.map((a) => a.dateRetrait))].sort();

  try {
    const ref = await addDoc(collection(db, "commandes"), {
      userId: state.user.uid,
      userEmail: state.user.email || "",
      articles,
      total: getCartTotal(state.cart),
      dateRetrait: dates[0],
      datesRetrait: dates,
      notes: $("order-notes").value.trim(),
      statut: "En attente",
      createdAt: serverTimestamp()
    });

    state.cart = [];
    state.showDateErrors = false;
    syncCartStorage();
    $("order-notes").value = "";
    cartEmptyState.classList.add("hidden");
    cartContent.classList.remove("hidden");
    cartItemsList.classList.add("hidden");
    cartDatesBlock.classList.add("hidden");
    authBox.classList.add("hidden");
    $("order-id-display").textContent = ref.id.slice(0, 8).toUpperCase();
    orderConfirmation.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    showToast("Erreur lors de la commande");
  } finally {
    btn.disabled = false;
    btn.textContent = "Valider la commande";
  }
});

// ---------- Firestore (temps réel) ----------
onSnapshot(collection(db, "categories"), (snap) => {
  state.categories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderCategories();
  renderProducts();
  if (state.currentView === "produit") renderProductPage();
});

onSnapshot(collection(db, "patisseries"), (snap) => {
  state.products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  state.productsLoaded = true;
  renderCategories();
  renderProducts();
  if (state.currentView === "produit") renderProductPage();
  if (state.currentView === "panier" && state.user && state.cart.length) renderCart();
});

syncCartStorage();
handleRouting();
authReady.then(completeEmailLinkSignIn);
