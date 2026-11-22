import { $, showToast, saveCart, catalog, subscribeCatalog } from "./shop-common.js";
import { loadCart, addItem } from "./cart.js";
import {
  esc, formatPrice, getAvailability, groupByCategory, seasonLabel,
  productImages, productUrl, formatParts, isPieces, formatPrixPour,
  isOrderable, isPreorder, preorderLabel, seasonWindow, formatDateFR,
  productParfums, findParfum, formatDisplayPrice, imagesForParfum, defaultParfum
} from "./catalog.js";
import { toggleFavorite, onFavoritesChange, heartButton } from "./favorites.js";

const productId = new URLSearchParams(window.location.search).get("id");
// ?parfum=… : parfum déjà choisi sur la carte de l'accueil (à défaut, le premier parfum disponible est présélectionné)
const state = { qty: 1, galleryIndex: 0, parfum: new URLSearchParams(window.location.search).get("parfum") || "" };
const productDetail = $("product-detail");

function addToCart(id, qty) {
  const product = catalog.products.find((p) => p.id === id);
  if (!product) return false;
  if (!isOrderable(product)) { showToast(`Indisponible (${getAvailability(product).reason})`); return false; }
  let parfum = "";
  if (productParfums(product).length) {
    const found = state.parfum && findParfum(product, state.parfum);
    if (!found || !found.dispo) {
      const box = productDetail.querySelector(".parfum-choices");
      box?.scrollIntoView({ behavior: "smooth", block: "center" });
      box?.classList.add("parfum-missing");
      setTimeout(() => box?.classList.remove("parfum-missing"), 1500);
      showToast("Choisissez d'abord un parfum");
      return false;
    }
    parfum = found.nom;
  }
  const cart = loadCart();
  addItem(cart, product, qty, parfum);
  saveCart(cart);
  const what = parfum ? ` (${parfum})` : "";
  showToast(isPreorder(product) ? `Précommande ajoutée${what}` : `Ajouté au panier${what}`);
  return true;
}

const QTY_MAX = 50;

function renderProductPage() {
  if (!catalog.ready) {
    productDetail.innerHTML = `<p class="text-center text-xs uppercase tracking-[0.2em] text-[#7F7973] py-20">Chargement...</p>`;
    return;
  }
  const p = catalog.products.find((x) => x.id === productId);
  if (!p) {
    productDetail.innerHTML = `
      <div class="text-center py-20 border border-[#2C2A29]/15 bg-white px-6 space-y-5">
        <p class="font-serif text-2xl">Cette création n'est plus à la carte</p>
        <a href="index.html" class="inline-block px-6 py-3 bg-[#2C2A29] text-[#FDFBF7] text-xs uppercase tracking-[0.2em] hover:bg-[#43403E] transition-colors">Découvrir nos créations</a>
      </div>`;
    return;
  }
  document.title = `${p.nom} — Johanne & Cie`;

  const groups = groupByCategory(catalog.categories, catalog.products);
  const group = groups.find((g) => g.products.some((x) => x.id === p.id));
  const av = getAvailability(p);
  const orderable = isOrderable(p);
  const preorder = isPreorder(p);
  const win = preorder ? seasonWindow(p.saison) : null;
  const parfums = productParfums(p);
  if (state.parfum && !findParfum(p, state.parfum)?.dispo) state.parfum = ""; // parfum retiré ou épuisé entre-temps
  else if (state.parfum) state.parfum = findParfum(p, state.parfum).nom;
  if (!state.parfum) state.parfum = defaultParfum(p); // présélection : premier parfum disponible
  const imgs = imagesForParfum(p, state.parfum);
  const idx = Math.min(state.galleryIndex, Math.max(imgs.length - 1, 0));
  const season = seasonLabel(p.saison);
  const allergenes = Array.isArray(p.allergenes) ? p.allergenes : [];

  // Galerie
  const main = imgs.length
    ? `<img src="${esc(imgs[idx])}" alt="${esc(p.nom)}" class="w-full h-full object-cover ${orderable ? "" : "grayscale opacity-75"}" />`
    : `<img src="assets/logo.svg" alt="Maison Johanne &amp; Cie" class="w-full h-full object-contain p-10 opacity-80" />`;
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
  const partsTxt = formatParts(p.parts, isPieces(p));
  const facts = [partsTxt && `Pour ${esc(partsTxt)}`, p.poids && `Poids : ${esc(p.poids)}`, season && `Saison : ${esc(season.toLowerCase())}`].filter(Boolean);
  if (facts.length) detailBlocks.push(`<p class="text-[#7F7973]">${facts.join(" &nbsp;&bull;&nbsp; ")}</p>`);

  const detailsHtml = detailBlocks.length
    ? `<section id="product-details" class="border-t border-[#2C2A29]/15 pt-8 space-y-4 max-w-3xl">
         <h2 class="font-serif text-2xl">Détails du produit</h2>
         <div class="text-sm leading-relaxed space-y-3">${detailBlocks.join("")}</div>
       </section>`
    : "";

  // Suggestions : même catégorie d'abord, puis le reste
  const others = catalog.products.filter((x) => x.id !== p.id && getAvailability(x).available);
  const sameCat = others.filter((x) => group && group.products.some((g) => g.id === x.id));
  const similar = [...sameCat, ...others.filter((x) => !sameCat.includes(x))].slice(0, 3);
  const similarHtml = similar.length
    ? `<section class="border-t border-[#2C2A29]/15 pt-8 space-y-6">
         <h2 class="font-serif text-2xl">Vous pourriez aussi aimer</h2>
         <div class="grid grid-cols-1 sm:grid-cols-3 gap-6">${similar.map((x) => {
           const xi = productImages(x)[0];
           return `
           <a href="${productUrl(x.id)}" class="product-card block border border-[#2C2A29]/15 bg-white">
             <div class="aspect-[4/3] overflow-hidden border-b border-[#2C2A29]/10 bg-[#F4F0E8]">
               <img src="${esc(xi || "assets/logo.svg")}" alt="${esc(x.nom)}" class="w-full h-full ${xi ? "object-cover" : "object-contain p-6 opacity-80"}" loading="lazy" />
             </div>
             <div class="p-4 flex items-baseline justify-between gap-3">
               <span class="font-serif text-lg leading-snug">${esc(x.nom)}</span>
               <span class="font-serif text-base shrink-0">${formatDisplayPrice(x)}</span>
             </div>
           </a>`;
         }).join("")}</div>
       </section>`
    : "";

  const preorderNote = preorder
    ? `<p class="text-xs leading-relaxed border border-[#2C2A29]/20 bg-[#F4F0E8] p-3">Hors saison aujourd'hui : vous pouvez la précommander dès maintenant pour un retrait entre le <strong>${esc(formatDateFR(win.start, false))}</strong> et le <strong>${esc(win.end ? formatDateFR(win.end) : "")}</strong>. La date se choisit dans le panier.</p>`
    : "";
  const parfumsHtml = parfums.length
    ? `<fieldset class="space-y-3">
         <legend class="text-xs uppercase tracking-[0.18em] font-medium mb-3">Parfum${state.parfum ? ` : <span class="font-normal normal-case tracking-normal">${esc(state.parfum)}</span>` : ` <span class="font-normal normal-case tracking-normal text-[#7F7973]">— à choisir</span>`}</legend>
         <div class="parfum-choices flex flex-wrap gap-2">${parfums.map((x) => {
           const on = x.nom === state.parfum;
           const off = !x.dispo || !orderable;
           return `<button type="button" data-parfum="${esc(x.nom)}" aria-pressed="${on}" ${off ? "disabled" : ""} class="parfum-opt">
             ${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy" />` : ""}
             <span><span class="block">${esc(x.nom)}</span><span class="block text-[11px] opacity-75">${x.dispo ? formatPrice(x.prix) : "Épuisé"}</span></span>
           </button>`;
         }).join("")}</div>
       </fieldset>`
    : "";

  const action = orderable
    ? `${preorderNote}<div class="flex flex-wrap items-stretch gap-3">
         <div class="flex items-center border border-[#2C2A29]/25">
           <button type="button" data-qty-step="-1" aria-label="Moins" class="px-4 py-3 text-sm hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors">&minus;</button>
           <span id="product-qty" class="px-4 py-3 text-sm font-medium min-w-[3rem] text-center">${state.qty}</span>
           <button type="button" data-qty-step="1" aria-label="Plus" class="px-4 py-3 text-sm hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors">+</button>
         </div>
         <button type="button" data-product-add class="flex-1 min-w-[12rem] py-3 px-6 bg-[#2C2A29] text-[#FDFBF7] hover:bg-[#43403E] transition-colors text-xs uppercase tracking-[0.22em]">${preorder ? "Précommander" : "Ajouter au panier"}</button>
       </div>`
    : `<button type="button" disabled class="w-full py-3 px-6 border border-[#2C2A29]/25 text-[#7F7973] bg-[#FDFBF7] text-xs uppercase tracking-[0.22em] cursor-not-allowed">${esc(av.reason)}</button>`;

  productDetail.innerHTML = `
    <nav aria-label="Fil d'Ariane" class="text-[11px] uppercase tracking-[0.18em] text-[#7F7973] mb-8 flex flex-wrap items-center gap-2">
      <a href="index.html" class="hover:text-[#2C2A29]">Accueil</a><span>&rsaquo;</span>
      ${group ? `<a href="index.html#cat-${esc(group.id)}" class="hover:text-[#2C2A29]">${esc(group.nom)}</a><span>&rsaquo;</span>` : ""}
      <span class="text-[#2C2A29]">${esc(p.nom)}</span>
      <a href="index.html" data-restore class="ml-auto hover:text-[#2C2A29]">&larr; Retour aux pâtisseries</a>
    </nav>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 mb-14">
      <div>
        <div class="relative aspect-[4/3] sm:aspect-square overflow-hidden border border-[#2C2A29]/15 bg-[#F4F0E8]">
          ${main}
          ${orderable
            ? (preorder ? `<span class="absolute top-4 right-4 bg-[#FDFBF7] text-[#2C2A29] border border-[#2C2A29]/40 px-3 py-1 text-[10px] uppercase tracking-[0.2em]">${esc(preorderLabel(p))}</span>` : "")
            : `<span class="absolute top-4 right-4 bg-[#2C2A29] text-[#FDFBF7] px-3 py-1 text-[10px] uppercase tracking-[0.2em]">${esc(av.reason)}</span>`}
        </div>
        ${thumbs}
      </div>

      <div class="space-y-6">
        ${group || p.bestSeller === true ? `<p class="text-[10px] uppercase tracking-[0.25em] text-[#7F7973]">${group ? esc(group.nom) : ""}${p.bestSeller === true ? `${group ? " &middot; " : ""}<span class="text-[#2C2A29]">&#9733; Best-Seller</span>` : ""}</p>` : ""}
        <div class="flex items-start justify-between gap-4">
          <h1 class="font-serif text-4xl sm:text-5xl leading-tight">${esc(p.nom)}</h1>
          ${heartButton(p.id, p.nom, "shrink-0 mt-2")}
        </div>
        <div>
          <p class="font-serif text-3xl">${formatDisplayPrice(p, state.parfum)}</p>
          ${formatPrixPour(p.prixPour) ? `<p class="mt-1 text-xs uppercase tracking-[0.2em] text-[#7F7973]">Pour ${esc(formatPrixPour(p.prixPour))}</p>` : ""}
        </div>
        ${p.description ? `<p class="text-sm text-[#7F7973] leading-relaxed">${esc(p.description)}${detailBlocks.length ? ` <a href="#product-details" data-scroll class="text-[#2C2A29] underline underline-offset-4">Plus de détails</a>` : ""}</p>` : ""}
        ${season ? `<p class="text-[11px] uppercase tracking-[0.18em] text-[#7F7973]">Saison : ${esc(season.toLowerCase())}</p>` : ""}
        ${parfumsHtml}
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
  const fav = e.target.closest("button[data-fav-id]");
  const parfumBtn = e.target.closest("button[data-parfum]");
  if (parfumBtn) {
    state.parfum = parfumBtn.dataset.parfum;
    state.galleryIndex = 0; // la photo du parfum (s'il en a une) passe en premier
    renderProductPage();
  } else if (fav) {
    showToast(toggleFavorite(fav.dataset.favId) ? "Ajouté aux favoris" : "Retiré des favoris");
  } else if (thumb) {
    state.galleryIndex = Number(thumb.dataset.galleryIdx);
    renderProductPage();
  } else if (step) {
    state.qty = Math.min(QTY_MAX, Math.max(1, state.qty + Number(step.dataset.qtyStep)));
    $("product-qty").textContent = state.qty;
  } else if (add) {
    if (addToCart(productId, state.qty)) {
      state.qty = 1;
      $("product-qty").textContent = 1;
    }
  } else if (scroll) {
    e.preventDefault();
    document.getElementById("product-details")?.scrollIntoView({ behavior: "smooth" });
  }
});


// « Retour aux pâtisseries » : si l'on vient de la liste, on utilise l'historique du navigateur
// (position exactement retrouvée) ; sinon le lien classique vers index.html fait office de repli.
function cameFromList() {
  try {
    const ref = new URL(document.referrer);
    return ref.origin === window.location.origin && /(^|\/)(index\.html)?$/.test(ref.pathname) && history.length > 1;
  } catch { return false; }
}
productDetail.addEventListener("click", (e) => {
  const back = e.target.closest("a[data-restore]");
  if (back && cameFromList() && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
    history.back();
  }
});

subscribeCatalog(renderProductPage);
onFavoritesChange(() => {
  const btn = productDetail.querySelector("button[data-fav-id]");
  if (btn) btn.outerHTML = heartButton(btn.dataset.favId, catalog.products.find((x) => x.id === productId)?.nom, "shrink-0 mt-2");
});
renderProductPage();
