import { db, auth, authReady } from "./firebase-config.js";
import { $, showToast, saveCart, catalog, subscribeCatalog } from "./shop-common.js";
import {
  loadCart, getCartTotal, setItemDate, applyFirstDateToAll, removeItem
} from "./cart.js";
import {
  ADMIN_EMAIL, EMAIL_LINK_KEY, esc, formatPrice, tomorrowISO, parseISODate,
  getAvailability, seasonLabel, productUrl
} from "./catalog.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendSignInLinkToEmail, isSignInWithEmailLink,
  signInWithEmailLink, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const state = {
  cart: loadCart(),
  user: null,
  authReady: false,
  showDateErrors: false
};

const authLoading = $("cart-auth-loading");
const authGate = $("cart-auth-gate");
const cartMain = $("cart-main");
const authInfo = $("auth-info");
const authError = $("auth-error");
const authBox = $("auth-box");
const cartEmptyState = $("cart-empty-state");
const cartContent = $("cart-content");
const cartItemsList = $("cart-items-list");
const cartDatesBlock = $("cart-dates-block");
const cartDatesList = $("cart-dates-list");
const sameDateBtn = $("same-date-btn");
const orderConfirmation = $("order-confirmation");

const syncCartStorage = () => saveCart(state.cart);

function dateProblem(item) {
  if (!item.date) return null;
  if (item.date < tomorrowISO()) return "Date trop proche : à partir de demain.";
  const live = catalog.products.find((p) => p.id === item.id);
  if (catalog.products.length && !live) return "Cette création n'est plus proposée.";
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
    const live = catalog.products.find((p) => p.id === item.id);
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
          <h3 class="font-serif text-xl text-[#2C2A29] truncate"><a href="${productUrl(item.id)}" class="hover:underline underline-offset-4">${esc(item.nom)}</a></h3>
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
  renderCartAccess();
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
      url: new URL("panier.html", window.location.href).href,
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
    window.history.replaceState({}, "", "panier.html"); // retire les paramètres du lien
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
// Le catalogue sert à vérifier disponibilité et saisonnalité des articles du panier
subscribeCatalog(() => {
  if (state.authReady && state.user && state.cart.length) renderCart();
});

renderCartAccess(); // « Chargement... » jusqu'à ce que la session soit connue
authReady.then(completeEmailLinkSignIn);
