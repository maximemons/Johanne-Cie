import { $, showToast, saveCart, catalog, subscribeCatalog, LIST_STATE_KEY, RESTORE_FLAG } from "./shop-common.js";
import { loadCart, addItem } from "./cart.js";
import {
  esc, formatPrice, getAvailability, groupByCategory, seasonLabel,
  productUrl, formatParts, formatPrixPour, shopGroups
} from "./catalog.js";

const state = {
  activeCategory: null,   // catégorie en cours (scrollspy)
  rowPos: {}              // défilement horizontal de chaque ligne de catégorie
};

const siteHeader = document.querySelector("header");
const categoriesBar = $("categories-bar");
const productsGrid = $("products-grid");
const emptyCatalog = $("empty-catalog");

// La position de la liste est gérée ici (voir "Position" plus bas), pas par le navigateur
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

// Clic sur le logo depuis l'accueil : retour en haut, sans recharger la page
$("nav-logo-link").addEventListener("click", (e) => {
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ---------- Catalogue ----------
const CAT_BTN_BASE = "shrink-0 px-4 py-2 text-xs uppercase tracking-[0.2em] border transition-colors whitespace-nowrap";
const CAT_BTN_ON = "bg-[#2C2A29] text-[#FDFBF7] border-[#2C2A29]";
const CAT_BTN_OFF = "bg-transparent text-[#2C2A29] border-[#2C2A29]/20 hover:border-[#2C2A29]";

// La barre de catégories est collée sous l'en-tête (lui-même collant)
function syncStickyOffsets() {
  categoriesBar.style.top = `${siteHeader.offsetHeight}px`;
}
new ResizeObserver(syncStickyOffsets).observe(siteHeader);

const stickyOffset = () => siteHeader.offsetHeight + categoriesBar.offsetHeight;

function renderCategories() {
  const groups = shopGroups(catalog.categories, catalog.products);

  if (catalog.products.length === 0) {
    categoriesBar.innerHTML = "";
    categoriesBar.classList.add("hidden");
    return;
  }
  if (!groups.some((g) => g.id === state.activeCategory)) state.activeCategory = groups[0]?.id ?? null;

  categoriesBar.classList.remove("hidden");
  categoriesBar.innerHTML = `<div class="flex gap-2 sm:gap-3 mx-auto w-max">${groups
    .map((g) => `<button type="button" data-cat-id="${esc(g.id)}" class="${CAT_BTN_BASE} ${g.id === state.activeCategory ? CAT_BTN_ON : CAT_BTN_OFF}">${g.icon ? `${g.icon} ` : ""}${esc(g.nom)}</button>`)
    .join("")}</div>`;
  syncStickyOffsets();
}

// -- Scroll jusqu'à une catégorie, et catégorie en cours selon le scroll
let spyLocked = false;
let spyTimer = null;

function lockSpy() {
  spyLocked = true;
  clearTimeout(spyTimer);
  spyTimer = setTimeout(unlockSpy, 400); // si aucun scroll n'a lieu (déjà en place)
}
function unlockSpy() {
  spyLocked = false;
  updateActiveCategory();
}

function scrollToCategory(id, behavior = "smooth") {
  const section = document.getElementById(`cat-${id}`);
  if (!section) return;
  lockSpy();
  setActiveCategory(id);
  const top = section.getBoundingClientRect().top + window.scrollY - stickyOffset() - 16;
  window.scrollTo({ top: Math.max(0, top), behavior });
}

function setActiveCategory(id) {
  if (state.activeCategory === id) return;
  state.activeCategory = id;
  categoriesBar.querySelectorAll("button[data-cat-id]").forEach((btn) => {
    const on = btn.dataset.catId === id;
    btn.className = `${CAT_BTN_BASE} ${on ? CAT_BTN_ON : CAT_BTN_OFF}`;
    if (on) {
      // garde le bouton actif visible dans la barre (mobile)
      categoriesBar.scrollTo({ left: btn.offsetLeft - (categoriesBar.clientWidth - btn.clientWidth) / 2, behavior: "smooth" });
    }
  });
}

// Catégorie en cours = dernière ligne dont le haut a passé la ligne située sous la barre fixe
function updateActiveCategory(force = false) {
  if (spyLocked && !force) return;
  const sections = [...productsGrid.querySelectorAll("section[data-cat-section]")];
  if (!sections.length) return;
  const line = stickyOffset() + 24;
  let current = sections[0].dataset.catSection;
  for (const sec of sections) {
    if (sec.getBoundingClientRect().top <= line) current = sec.dataset.catSection;
  }
  // en bas de page, la dernière ligne (parfois courte) devient la catégorie en cours
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
    current = sections[sections.length - 1].dataset.catSection;
  }
  setActiveCategory(current);
}

let spyFrame = null;
window.addEventListener("scroll", () => {
  if (spyLocked) {
    // verrou levé 150 ms après la fin du scroll déclenché par un clic
    clearTimeout(spyTimer);
    spyTimer = setTimeout(unlockSpy, 150);
    return;
  }
  if (spyFrame) return;
  spyFrame = requestAnimationFrame(() => {
    spyFrame = null;
    updateActiveCategory();
  });
}, { passive: true });

window.addEventListener("resize", () => updateActiveCategory(true));

categoriesBar.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-cat-id]");
  if (btn) scrollToCategory(btn.dataset.catId);
});

function productCard(p, catLabel) {
  const av = getAvailability(p);
  const off = !av.available;
  const season = seasonLabel(p.saison);
  const parts = formatParts(p.parts);
  const pour = formatPrixPour(p.prixPour);
  const img = p.imageUrl
    ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.nom)}" class="w-full h-full object-cover ${off ? "grayscale opacity-75" : ""}" loading="lazy" />`
    : `<img src="assets/logo.svg" alt="Maison Johanne &amp; Cie" class="w-full h-full object-contain p-6 bg-[#FDFBF7] opacity-80" />`;
  const badge =
    (off ? `<span class="absolute top-3 right-3 bg-[#2C2A29] text-[#FDFBF7] px-3 py-1 text-[10px] uppercase tracking-[0.2em]">${esc(av.reason)}</span>` : "") +
    (p.bestSeller === true ? `<span class="absolute top-3 left-3 bg-[#FDFBF7] text-[#2C2A29] border border-[#2C2A29] px-2.5 py-1 text-[10px] uppercase tracking-[0.2em]">&#9733; Best-Seller</span>` : "");
  const action = off
    ? `<button type="button" disabled class="w-full py-2.5 px-4 border border-[#2C2A29]/25 text-[#7F7973] bg-[#FDFBF7] text-[11px] uppercase tracking-[0.2em] cursor-not-allowed">${esc(av.reason)}</button>`
    : `<button type="button" data-add-id="${esc(p.id)}" class="w-full py-2.5 px-4 bg-[#2C2A29] text-[#FDFBF7] hover:bg-[#43403E] transition-colors text-[11px] uppercase tracking-[0.2em]">Ajouter au panier</button>`;

  return `
    <article class="row-card product-card border border-[#2C2A29]/15 bg-white flex flex-col justify-between">
      <div>
        <a href="${productUrl(p.id)}" class="block relative aspect-[4/3] overflow-hidden border-b border-[#2C2A29]/10 bg-[#F4F0E8]" aria-label="Voir ${esc(p.nom)}">${img}${badge}</a>
        ${parts ? `<p class="px-6 pt-3 text-[10px] uppercase tracking-[0.22em] text-[#2C2A29]">${esc(parts)}</p>` : ""}
        <div class="${parts ? "px-6 pb-6 pt-2" : "p-6"} space-y-2">
          <p class="text-[10px] uppercase tracking-[0.22em] text-[#7F7973]">${esc(catLabel)}</p>
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="font-serif text-2xl text-[#2C2A29] leading-snug"><a href="${productUrl(p.id)}" class="hover:underline underline-offset-4">${esc(p.nom || "Pâtisserie")}</a></h2>
            <div class="shrink-0 text-right">
              <span class="font-serif text-lg text-[#2C2A29]">${formatPrice(p.prix)}</span>
              ${pour ? `<span class="block text-[10px] uppercase tracking-[0.15em] text-[#7F7973] whitespace-nowrap">Pour ${esc(pour)}</span>` : ""}
            </div>
          </div>
          ${season ? `<p class="text-[10px] uppercase tracking-[0.18em] text-[#7F7973]">Saison : ${esc(season.toLowerCase())}</p>` : ""}
          ${p.description ? `<p class="text-xs text-[#7F7973] leading-relaxed pt-1">${esc(p.description)}</p>` : ""}
          <a href="${productUrl(p.id)}" class="inline-block pt-1 text-[10px] uppercase tracking-[0.2em] text-[#2C2A29] underline underline-offset-4">Voir le détail &rarr;</a>
        </div>
      </div>
      <div class="px-6 pb-6 pt-2">${action}</div>
    </article>`;
}

// Une ligne horizontale par catégorie ("Autre" toujours en dernier), cartes toutes de même taille
function renderProducts() {
  if (catalog.products.length === 0) {
    productsGrid.innerHTML = "";
    emptyCatalog.classList.remove("hidden");
    return;
  }
  emptyCatalog.classList.add("hidden");

  captureRowPositions(); // un re-rendu temps réel ne doit pas ramener les lignes au début

  // Dans la fausse catégorie « Best-Sellers », chaque carte indique sa vraie catégorie
  const realName = new Map(groupByCategory(catalog.categories, catalog.products).flatMap((g) => g.products.map((p) => [p.id, g.nom])));

  productsGrid.innerHTML = shopGroups(catalog.categories, catalog.products)
    .map((g) => {
      // au sein d'une catégorie, les créations disponibles passent d'abord
      const items = [...g.products].sort(
        (a, b) => Number(!getAvailability(a).available) - Number(!getAvailability(b).available)
      );
      return `
        <section id="cat-${esc(g.id)}" data-cat-section="${esc(g.id)}" class="row-section" aria-label="${esc(g.nom)}">
          <div class="row-scroller">${items.map((p) => productCard(p, g.virtual ? realName.get(p.id) : g.nom)).join("")}</div>
          <button type="button" data-row-scroll="-1" class="row-arrow row-arrow-prev" aria-label="Précédent">&lsaquo;</button>
          <button type="button" data-row-scroll="1" class="row-arrow row-arrow-next" aria-label="Suivant">&rsaquo;</button>
        </section>`;
    })
    .join("");

  restoreRowPositions();
  updateRowArrows();
  updateActiveCategory();
}

function captureRowPositions() {
  const pos = {};
  productsGrid.querySelectorAll("section[data-cat-section]").forEach((sec) => {
    pos[sec.dataset.catSection] = sec.querySelector(".row-scroller").scrollLeft;
  });
  state.rowPos = pos;
  return pos;
}

function restoreRowPositions() {
  productsGrid.querySelectorAll("section[data-cat-section]").forEach((sec) => {
    const x = state.rowPos[sec.dataset.catSection];
    if (!x) return;
    const sc = sec.querySelector(".row-scroller");
    sc.style.scrollBehavior = "auto"; // instantané, pas d'animation
    sc.scrollLeft = x;
    sc.style.scrollBehavior = "";
  });
}

// Flèches de défilement : visibles seulement quand la ligne déborde, et seulement dans le sens utile
function updateRowArrows() {
  productsGrid.querySelectorAll("section[data-cat-section]").forEach((sec) => {
    const sc = sec.querySelector(".row-scroller");
    const canPrev = sc.scrollLeft > 2;
    const canNext = sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 2;
    const toggle = (btn, on) => (on ? btn.setAttribute("data-on", "") : btn.removeAttribute("data-on"));
    toggle(sec.querySelector("[data-row-scroll='-1']"), canPrev);
    toggle(sec.querySelector("[data-row-scroll='1']"), canNext);
  });
}

productsGrid.addEventListener("scroll", updateRowArrows, true);
window.addEventListener("resize", updateRowArrows);

productsGrid.addEventListener("click", (e) => {
  const arrow = e.target.closest("button[data-row-scroll]");
  if (!arrow) return;
  const sc = arrow.closest("section").querySelector(".row-scroller");
  const card = sc.querySelector(".row-card");
  const step = card.offsetWidth + 32; // largeur d'une carte + espace
  const perPage = Math.max(1, Math.floor((sc.clientWidth + 32) / step));
  sc.scrollBy({ left: Number(arrow.dataset.rowScroll) * step * perPage, behavior: "smooth" });
});

productsGrid.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-add-id]");
  if (btn) addToCart(btn.dataset.addId);
});

function addToCart(productId, qty = 1) {
  const product = catalog.products.find((p) => p.id === productId);
  if (!product) return;
  const av = getAvailability(product);
  if (!av.available) return showToast(`Indisponible (${av.reason})`);
  const cart = loadCart();
  addItem(cart, product, qty);
  saveCart(cart);
  showToast("Ajouté au panier");
}

// ---------- Position de la liste (retour depuis une fiche produit / le panier) ----------
// Sauvegardée en quittant la page ; retrouvée au retour (bouton précédent, rechargement, ou lien « Retour »).
// Un lien vers une catégorie (index.html#cat-ID, fil d'Ariane de la fiche) fait défiler jusqu'à elle.
function saveListState() {
  if (!catalog.ready) return;
  sessionStorage.setItem(LIST_STATE_KEY, JSON.stringify({ y: window.scrollY, rows: captureRowPositions() }));
}
window.addEventListener("pagehide", saveListState);

function applyInitialPosition() {
  const navType = performance.getEntriesByType("navigation")[0]?.type;
  const wantsRestore = sessionStorage.getItem(RESTORE_FLAG) === "1" || navType === "back_forward" || navType === "reload";
  sessionStorage.removeItem(RESTORE_FLAG);

  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(LIST_STATE_KEY) || "null"); } catch { /* ignoré */ }

  if (wantsRestore && saved) {
    window.scrollTo({ top: saved.y, behavior: "auto" });
    state.rowPos = saved.rows || {};
    restoreRowPositions();
  } else if (window.location.hash.startsWith("#cat-")) {
    scrollToCategory(decodeURIComponent(window.location.hash.slice(5)), "auto");
  }
  updateRowArrows();
  updateActiveCategory(true);
}

// ---------- Firestore (temps réel) ----------
let positioned = false;
subscribeCatalog(() => {
  renderCategories();
  renderProducts();
  if (catalog.ready && !positioned) {
    positioned = true;
    applyInitialPosition();
  }
});
