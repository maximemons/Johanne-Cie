// Identification client partagée (panier, compte) : Google, lien e-mail, ou e-mail + mot de passe.
import { auth, authReady } from "./config.js";
import { EMAIL_LINK_KEY } from "./catalog.js";
import {
  GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendSignInLinkToEmail, isSignInWithEmailLink,
  signInWithEmailLink, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

export { signOut };
export const logout = () => signOut(auth);

const GATE_HTML = (subtitle) => `
  <div class="text-center space-y-1">
    <h2 class="font-serif text-2xl">Identification requise</h2>
    <p class="text-xs text-[#7F7973]">${subtitle}</p>
  </div>
  <button data-auth="google" type="button" class="w-full py-3 px-4 border border-[#2C2A29] bg-[#FDFBF7] hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors text-xs uppercase tracking-[0.18em] flex items-center justify-center gap-3">
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z"/></svg>
    Continuer avec Google
  </button>
  <div class="relative flex py-1 items-center">
    <div class="flex-grow border-t border-[#2C2A29]/15"></div>
    <span class="flex-shrink mx-3 text-[10px] uppercase tracking-[0.2em] text-[#7F7973]">ou par courriel</span>
    <div class="flex-grow border-t border-[#2C2A29]/15"></div>
  </div>
  <form data-auth="form" class="space-y-3">
    <input type="email" data-auth="email" required autocomplete="email" placeholder="Adresse e-mail" class="w-full px-3.5 py-2.5 text-sm border border-[#2C2A29]/30 bg-[#FDFBF7] focus:outline-none focus:border-[#2C2A29]" />
    <button data-auth="link" type="button" class="w-full py-2.5 px-3 bg-[#2C2A29] text-[#FDFBF7] text-[11px] uppercase tracking-[0.15em] hover:bg-[#43403E] transition-colors">Recevoir un lien de connexion</button>
    <p class="text-[11px] text-[#7F7973] text-center">Sans mot de passe : un lien vous est envoyé par e-mail.</p>
    <div class="relative flex py-1 items-center">
      <div class="flex-grow border-t border-[#2C2A29]/15"></div>
      <span class="flex-shrink mx-3 text-[10px] uppercase tracking-[0.2em] text-[#7F7973]">ou avec un mot de passe</span>
      <div class="flex-grow border-t border-[#2C2A29]/15"></div>
    </div>
    <input type="password" data-auth="password" minlength="6" autocomplete="current-password" placeholder="Mot de passe (6 car. min.)" class="w-full px-3.5 py-2.5 text-sm border border-[#2C2A29]/30 bg-[#FDFBF7] focus:outline-none focus:border-[#2C2A29]" />
    <div class="grid grid-cols-2 gap-2">
      <button type="submit" class="py-2.5 px-3 border border-[#2C2A29] text-[11px] uppercase tracking-[0.15em] hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors">Se connecter</button>
      <button type="button" data-auth="register" class="py-2.5 px-3 border border-[#2C2A29] text-[11px] uppercase tracking-[0.15em] hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors">Créer un compte</button>
    </div>
  </form>
  <p data-auth="info" class="hidden text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 p-3"></p>
  <p data-auth="error" class="hidden text-xs text-red-700"></p>`;

/**
 * Affiche le formulaire d'identification dans `container` et le relie à Firebase.
 * `page` = page vers laquelle renvoie le lien de connexion e-mail (ex. "panier.html").
 */
export function mountAuthGate(container, { page, subtitle = "Connectez-vous pour continuer." }) {
  container.innerHTML = GATE_HTML(subtitle);
  const q = (k) => container.querySelector(`[data-auth="${k}"]`);
  const info = q("info"), error = q("error"), emailInput = q("email");

  const showError = (msg) => { info.classList.add("hidden"); error.textContent = msg; error.classList.remove("hidden"); };
  const showInfo = (msg) => { error.classList.add("hidden"); info.textContent = msg; info.classList.remove("hidden"); };

  q("google").addEventListener("click", async () => {
    error.classList.add("hidden");
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (err) { if (err.code !== "auth/popup-closed-by-user") showError("Connexion Google impossible. Réessayez."); }
  });

  q("link").addEventListener("click", async () => {
    const email = emailInput.value.trim();
    if (!email || !emailInput.checkValidity()) return showError("Saisissez une adresse e-mail valide.");
    const btn = q("link");
    btn.disabled = true;
    try {
      await sendSignInLinkToEmail(auth, email, { url: new URL(page, window.location.href).href, handleCodeInApp: true });
      localStorage.setItem(EMAIL_LINK_KEY, email);
      showInfo(`Lien envoyé à ${email}. Ouvrez-le depuis votre messagerie (pensez aux courriers indésirables).`);
    } catch (err) {
      console.error(err);
      showError("Envoi du lien impossible. Vérifiez l'adresse et réessayez.");
    } finally {
      btn.disabled = false;
    }
  });

  q("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    error.classList.add("hidden");
    const password = q("password").value;
    if (password.length < 6) return showError("Saisissez votre mot de passe (6 caractères min.).");
    try { await signInWithEmailAndPassword(auth, emailInput.value.trim(), password); }
    catch { showError("Identifiants invalides ou compte inexistant."); }
  });

  q("register").addEventListener("click", async () => {
    error.classList.add("hidden");
    const email = emailInput.value.trim();
    const password = q("password").value;
    if (!email || !emailInput.checkValidity() || password.length < 6) {
      return showError("Veuillez saisir un e-mail valide et un mot de passe (6 caractères min.).");
    }
    try { await createUserWithEmailAndPassword(auth, email, password); }
    catch (err) { showError(err.code === "auth/email-already-in-use" ? "Un compte existe déjà avec cet e-mail." : "Création du compte impossible."); }
  });

  return {
    showError,
    clear: () => { info.classList.add("hidden"); error.classList.add("hidden"); }
  };
}

/**
 * Suit la session (restaurée depuis le cache du navigateur) et termine une connexion par lien e-mail.
 * `cb(user)` est appelé dès que l'état est connu, puis à chaque changement.
 */
export function watchUser(cb, { page, onLinkError } = {}) {
  let linkPending = isSignInWithEmailLink(auth, window.location.href);
  onAuthStateChanged(auth, (user) => { if (!linkPending) cb(user); });
  authReady.then(async () => {
    if (!linkPending) return;
    try {
      let email = localStorage.getItem(EMAIL_LINK_KEY);
      if (!email) email = window.prompt("Pour confirmer votre connexion, saisissez votre adresse e-mail :");
      if (!email) throw new Error("email manquant");
      await signInWithEmailLink(auth, email.trim(), window.location.href);
      localStorage.removeItem(EMAIL_LINK_KEY);
    } catch (err) {
      console.error(err);
      onLinkError?.("Ce lien de connexion est invalide ou a expiré. Demandez-en un nouveau.");
    } finally {
      linkPending = false;
      window.history.replaceState({}, "", page || window.location.pathname); // retire les paramètres du lien
      cb(auth.currentUser);
    }
  });
}
