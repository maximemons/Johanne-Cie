import { $, showToast, saveCart, catalog, subscribeCatalog, subscribeShopSettings, LIST_STATE_KEY, RESTORE_FLAG } from "./shop-common.js";
import { loadCart, addItem } from "./cart.js";
import {
  esc, formatPrice, getAvailability, groupByCategory, seasonLabel,
  productUrl, formatParts, isPieces, formatPrixPour, shopGroups, isOrderable, isPreorder, preorderLabel,
  productTags, allTags, hasTag, tagKey,
  productParfums, findParfum, formatDisplayPrice
} from "./catalog.js";
import { getFavorites, toggleFavorite, onFavoritesChange, heartButton } from "./favorites.js";

const state = {
  activeCategory: null,   // catégorie en cours (scrollspy)
  parfums: {},            // parfum choisi sur chaque carte : { [idPâtisserie]: nom }
  tag: "",                // tag choisi dans le filtre ("" = toute la carte)
  tagFilterOn: true       // liste « Filtrer par tag » affichée (réglage admin, parametres/boutique)
};

const siteHeader = document.querySelector("header");
const categoriesBar = $("categories-bar");
const categoriesList = $("categories-list");
const tagRow = $("tag-filter-row");
const tagSelect = $("tag-filter");
const tagClear = $("tag-filter-clear");
const tagEmpty = $("tag-empty");
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

// ---------- Filtre par tag ----------
/** Pâtisseries affichées : toutes, ou celles qui portent le tag choisi. */
const visibleProducts = () => (state.tag ? catalog.products.filter((p) => hasTag(p, state.tag)) : catalog.products);
const visibleGroups = () => shopGroups(catalog.categories, visibleProducts(), getFavorites());

function renderTagFilter() {
  const tags = state.tagFilterOn ? allTags(catalog.products) : [];
  // filtre désactivé par l'atelier, ou tag retiré par l'atelier entre-temps : on revient à toute la carte
  if (state.tag && !tags.some((t) => tagKey(t) === tagKey(state.tag))) state.tag = "";
  else if (state.tag) state.tag = tags.find((t) => tagKey(t) === tagKey(state.tag));

  tagRow.classList.toggle("hidden", tags.length === 0);
  tagSelect.innerHTML = `<option value=""></option>` +
    tags.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  tagSelect.value = state.tag;
  tagSelect.classList.toggle("is-on", Boolean(state.tag));
  tagClear.classList.toggle("hidden", !state.tag);
}

function setTag(tag) {
  state.tag = tag || "";
  renderTagFilter();
  renderCategories();
  renderProducts();
  // on repart du haut de la carte filtrée
  const top = categoriesBar.getBoundingClientRect().top + window.scrollY - siteHeader.offsetHeight;
  if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  updateActiveCategory(true);
}

tagSelect.addEventListener("change", () => setTag(tagSelect.value));
tagClear.addEventListener("click", () => setTag(""));
tagEmpty.addEventListener("click", (e) => { if (e.target.closest("[data-clear-tag]")) setTag(""); });

function renderCategories() {
  const groups = visibleGroups();

  if (catalog.products.length === 0) {
    categoriesList.innerHTML = "";
    categoriesBar.classList.add("hidden");
    return;
  }
  if (!groups.some((g) => g.id === state.activeCategory)) state.activeCategory = groups[0]?.id ?? null;

  categoriesBar.classList.remove("hidden");
  categoriesList.classList.toggle("hidden", groups.length === 0);
  categoriesList.innerHTML = `<div class="flex gap-2 sm:gap-3 mx-auto w-max">${groups
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
  categoriesList.querySelectorAll("button[data-cat-id]").forEach((btn) => {
    const on = btn.dataset.catId === id;
    btn.className = `${CAT_BTN_BASE} ${on ? CAT_BTN_ON : CAT_BTN_OFF}`;
    if (on) {
      // garde le bouton actif visible dans la barre (mobile)
      categoriesList.scrollTo({ left: btn.offsetLeft - (categoriesList.clientWidth - btn.clientWidth) / 2, behavior: "smooth" });
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

categoriesList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-cat-id]");
  if (btn) scrollToCategory(btn.dataset.catId);
});

function productCard(p, catLabel) {
  const av = getAvailability(p);
  const preorder = isPreorder(p);           // hors saison, mais commandable pour une date dans sa saison
  const blocked = !isOrderable(p);          // épuisé ou retiré manuellement
  const season = seasonLabel(p.saison);
  const parts = formatParts(p.parts, isPieces(p));
  const pour = formatPrixPour(p.prixPour);
  const tags = productTags(p);
  const parfums = productParfums(p);
  const chosen = state.parfums[p.id] && findParfum(p, state.parfums[p.id]) ? state.parfums[p.id] : "";
  const link = `${productUrl(p.id)}${chosen ? `&parfum=${encodeURIComponent(chosen)}` : ""}`;
  const cardImage = (chosen && findParfum(p, chosen).image) || p.imageUrl;
  const img = cardImage
    ? `<img src="${esc(cardImage)}" data-card-img alt="${esc(p.nom)}" class="w-full h-full object-cover ${blocked ? "grayscale opacity-75" : ""}" loading="lazy" />`
    : `<img src="assets/logo.svg" alt="Maison Johanne &amp; Cie" class="w-full h-full object-contain p-6 bg-[#FDFBF7] opacity-80" />`;
  const stateBadge = blocked
    ? `<span class="absolute top-3 right-3 bg-[#2C2A29] text-[#FDFBF7] px-3 py-1 text-[10px] uppercase tracking-[0.2em]">${esc(av.reason)}</span>`
    : preorder
      ? `<span class="absolute top-3 right-3 bg-[#FDFBF7] text-[#2C2A29] border border-[#2C2A29]/40 px-3 py-1 text-[10px] uppercase tracking-[0.2em]">${esc(preorderLabel(p))}</span>`
      : "";
  const badge = stateBadge +
    (p.bestSeller === true ? `<span class="absolute top-3 left-3 bg-[#FDFBF7] text-[#2C2A29] border border-[#2C2A29] px-2.5 py-1 text-[10px] uppercase tracking-[0.2em]">&#9733; Best-Seller</span>` : "");
  const action = blocked
    ? `<button type="button" disabled class="w-full py-2.5 px-4 border border-[#2C2A29]/25 text-[#7F7973] bg-[#FDFBF7] text-[11px] uppercase tracking-[0.2em] cursor-not-allowed">${esc(av.reason)}</button>`
    : preorder
      ? `<button type="button" data-add-id="${esc(p.id)}" class="w-full py-2.5 px-4 border border-[#2C2A29] text-[#2C2A29] bg-[#FDFBF7] hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors text-[11px] uppercase tracking-[0.2em]">Précommander</button>`
      : `<button type="button" data-add-id="${esc(p.id)}" class="w-full py-2.5 px-4 bg-[#2C2A29] text-[#FDFBF7] hover:bg-[#43403E] transition-colors text-[11px] uppercase tracking-[0.2em]">Ajouter au panier</button>`;

  return `
    <article class="row-card product-card border border-[#2C2A29]/15 bg-white flex flex-col justify-between">
      <div>
        <div class="relative">
          <a href="${link}" class="block relative aspect-[4/3] overflow-hidden border-b border-[#2C2A29]/10 bg-[#F4F0E8]" aria-label="Voir ${esc(p.nom)}">${img}${badge}</a>
          ${heartButton(p.id, p.nom, "absolute bottom-3 right-3")}
        </div>
        ${parts ? `<p class="px-6 pt-3 text-[10px] uppercase tracking-[0.22em] text-[#2C2A29]">${esc(parts)}</p>` : ""}
        <div class="${parts ? "px-6 pb-6 pt-2" : "p-6"} space-y-2">
          <p class="text-[10px] uppercase tracking-[0.22em] text-[#7F7973]">${esc(catLabel)}</p>
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="font-serif text-2xl text-[#2C2A29] leading-snug"><a href="${link}" class="hover:underline underline-offset-4">${esc(p.nom || "Pâtisserie")}</a></h2>
            <div class="shrink-0 text-right">
              <span data-card-price class="font-serif text-lg text-[#2C2A29] whitespace-nowrap">${formatDisplayPrice(p, chosen)}</span>
              ${pour ? `<span class="block text-[10px] uppercase tracking-[0.15em] text-[#7F7973] whitespace-nowrap">Pour ${esc(pour)}</span>` : ""}
            </div>
          </div>
          ${season ? `<p class="text-[10px] uppercase tracking-[0.18em] text-[#7F7973]">Saison : ${esc(season.toLowerCase())}</p>` : ""}
          ${tags.length ? `<ul class="flex flex-wrap gap-1.5 pt-1" aria-label="Tags">${tags.map((t) => {
            if (!state.tagFilterOn) return `<li><span class="tag-chip">${esc(t)}</span></li>`;
            const on = state.tag && tagKey(t) === tagKey(state.tag);
            return `<li><button type="button" data-tag="${esc(t)}" aria-pressed="${on ? "true" : "false"}" title="${on ? "Voir toute la carte" : `Voir les pâtisseries « ${esc(t)} »`}" class="tag-chip${on ? " is-on" : ""}">${esc(t)}</button></li>`;
          }).join("")}</ul>` : ""}
          ${p.description ? `<p class="text-xs text-[#7F7973] leading-relaxed pt-1">${esc(p.description)}</p>` : ""}
          <a href="${link}" class="inline-block pt-1 text-[10px] uppercase tracking-[0.2em] text-[#2C2A29] underline underline-offset-4">Voir le détail &rarr;</a>
        </div>
      </div>
      <div class="px-6 pb-6 pt-2 space-y-2">${!blocked && parfums.length ? parfumSelect(p, parfums, chosen) : ""}${action}</div>
    </article>`;
}

/** Liste déroulante des parfums d'une carte (chaque option indique son prix). */
function parfumSelect(p, parfums, chosen) {
  return `
    <label class="block">
      <span class="sr-only">Parfum de ${esc(p.nom)}</span>
      <select data-parfum-for="${esc(p.id)}" class="tag-select parfum-select w-full max-w-none${chosen ? " is-on" : ""}">
        <option value="" ${chosen ? "" : "selected"} disabled>Choisir un parfum</option>
        ${parfums.map((x) => `<option value="${esc(x.nom)}" ${x.nom === chosen ? "selected" : ""} ${x.dispo ? "" : "disabled"}>${esc(x.nom)} — ${formatPrice(x.prix)}${x.dispo ? "" : " (épuisé)"}</option>`).join("")}
      </select>
    </label>`;
}

// Un bloc par catégorie ("Autre" toujours en dernier) : cartes de même taille, qui passent à la ligne, centrées
function renderProducts() {
  if (catalog.products.length === 0) {
    productsGrid.innerHTML = "";
    emptyCatalog.classList.remove("hidden");
    return;
  }
  emptyCatalog.classList.add("hidden");
  const groups = visibleGroups();
  tagEmpty.classList.toggle("hidden", groups.length > 0);

  // Dans la fausse catégorie « Best-Sellers », chaque carte indique sa vraie catégorie
  const realName = new Map(groupByCategory(catalog.categories, catalog.products).flatMap((g) => g.products.map((p) => [p.id, g.nom])));

  productsGrid.innerHTML = groups
    .map((g) => {
      // au sein d'une catégorie : disponibles, puis précommandes, puis indisponibles
      const rank = (p) => (getAvailability(p).available ? 0 : isOrderable(p) ? 1 : 2);
      const items = [...g.products].sort((a, b) => rank(a) - rank(b));
      return `
        <section id="cat-${esc(g.id)}" data-cat-section="${esc(g.id)}" class="row-section" aria-label="${esc(g.nom)}">
          <div class="row-grid">${items.map((p) => productCard(p, g.virtual ? realName.get(p.id) : g.nom)).join("")}</div>
        </section>`;
    })
    .join("");

  updateActiveCategory();
}

productsGrid.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-add-id]");
  const fav = e.target.closest("button[data-fav-id]");
  const tag = e.target.closest("button[data-tag]");
  if (tag) setTag(tagKey(tag.dataset.tag) === tagKey(state.tag) ? "" : tag.dataset.tag);
  else if (btn) addToCart(btn.dataset.addId);
  else if (fav) showToast(toggleFavorite(fav.dataset.favId) ? "Ajouté aux favoris" : "Retiré des favoris");
});

// Choix d'un parfum sur une carte : le prix et la photo de toutes les cartes de cette pâtisserie suivent
// (une même pâtisserie peut apparaître deux fois : Favoris / Best-Sellers + sa catégorie)
productsGrid.addEventListener("change", (e) => {
  const sel = e.target.closest("select[data-parfum-for]");
  if (!sel) return;
  const id = sel.dataset.parfumFor;
  const product = catalog.products.find((p) => p.id === id);
  if (!product) return;
  state.parfums[id] = sel.value;
  const parfum = findParfum(product, sel.value);
  productsGrid.querySelectorAll(`select[data-parfum-for="${CSS.escape(id)}"]`).forEach((other) => {
    other.value = sel.value;
    other.classList.add("is-on");
    other.classList.remove("parfum-missing");
    const card = other.closest("article");
    card.querySelector("[data-card-price]").textContent = formatDisplayPrice(product, sel.value);
    card.querySelectorAll(`a[href^="produit.html"]`).forEach((a) => {
      a.href = `${productUrl(id)}${sel.value ? `&parfum=${encodeURIComponent(sel.value)}` : ""}`;
    });
    const img = card.querySelector("img[data-card-img]");
    const src = parfum?.image || product.imageUrl;
    if (img && src && img.getAttribute("src") !== src) img.src = src;
  });
});

function addToCart(productId, qty = 1) {
  const product = catalog.products.find((p) => p.id === productId);
  if (!product) return;
  if (!isOrderable(product)) return showToast(`Indisponible (${getAvailability(product).reason})`);
  let parfum = "";
  if (productParfums(product).length) {
    parfum = state.parfums[productId] || "";
    const found = parfum && findParfum(product, parfum);
    if (!found || !found.dispo) {
      const sel = productsGrid.querySelector(`select[data-parfum-for="${CSS.escape(productId)}"]`);
      sel?.focus();
      sel?.classList.add("parfum-missing");
      setTimeout(() => sel?.classList.remove("parfum-missing"), 1500);
      return showToast("Choisissez d'abord un parfum");
    }
    parfum = found.nom;
  }
  const cart = loadCart();
  addItem(cart, product, qty, parfum);
  saveCart(cart);
  const what = parfum ? ` (${parfum})` : "";
  showToast(isPreorder(product) ? `Précommande ajoutée${what} : ${preorderLabel(product).replace("Précommande dès", "retrait dès")}` : `Ajouté au panier${what}`);
}

// Favoris modifiés (ici, dans un autre onglet ou depuis le compte) : la catégorie « Favoris » suit
onFavoritesChange(() => {
  if (!catalog.ready) return;
  renderCategories();
  renderProducts();
});

// ---------- Position de la liste (retour depuis une fiche produit / le panier) ----------
// Sauvegardée en quittant la page ; retrouvée au retour (bouton précédent, rechargement, ou lien « Retour »).
// Un lien vers une catégorie (index.html#cat-ID, fil d'Ariane de la fiche) fait défiler jusqu'à elle.
function saveListState() {
  if (!catalog.ready) return;
  sessionStorage.setItem(LIST_STATE_KEY, JSON.stringify({ y: window.scrollY, tag: state.tag }));
}
window.addEventListener("pagehide", saveListState);

function applyInitialPosition() {
  const navType = performance.getEntriesByType("navigation")[0]?.type;
  const wantsRestore = sessionStorage.getItem(RESTORE_FLAG) === "1" || navType === "back_forward" || navType === "reload";
  sessionStorage.removeItem(RESTORE_FLAG);

  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(LIST_STATE_KEY) || "null"); } catch { /* ignoré */ }

  if (wantsRestore && saved) {
    if (state.tagFilterOn && saved.tag && saved.tag !== state.tag) {
      state.tag = saved.tag;
      renderTagFilter();
      renderCategories();
      renderProducts();
    }
    window.scrollTo({ top: saved.y, behavior: "auto" });
  } else if (window.location.hash.startsWith("#cat-")) {
    scrollToCategory(decodeURIComponent(window.location.hash.slice(5)), "auto");
  }
  updateActiveCategory(true);
}

// ---------- Firestore (temps réel) ----------
subscribeShopSettings((reglages) => {
  if (state.tagFilterOn === reglages.filtreTags) return;
  state.tagFilterOn = reglages.filtreTags;
  if (!catalog.ready) return;
  renderTagFilter();
  renderCategories();
  renderProducts();
});

let positioned = false;
subscribeCatalog(() => {
  renderTagFilter();
  renderCategories();
  renderProducts();
  if (catalog.ready && !positioned) {
    positioned = true;
    applyInitialPosition();
  }
});
