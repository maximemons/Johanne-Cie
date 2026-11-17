// Alertes navigateur (API Notification + service worker), sans serveur ni service payant.
// Elles sont déclenchées par les écoutes Firestore en temps réel : il suffit qu'un onglet
// du site soit ouvert (même en arrière-plan / fenêtre réduite) pour être alerté.
import { normalizeOrderStatut } from "./catalog.js";

const SW_URL = new URL("../sw.js", import.meta.url);
const ICON = new URL("../assets/logo.svg", import.meta.url).href;
let regPromise = null;

export const notifSupported = () => typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
export const notifPermission = () => (notifSupported() ? Notification.permission : "unsupported");

function registration() {
  if (!regPromise) {
    regPromise = navigator.serviceWorker.register(SW_URL).then(() => navigator.serviceWorker.ready);
    regPromise.catch((err) => { console.warn("Service worker indisponible :", err); regPromise = null; });
  }
  return regPromise;
}
// Déjà autorisé lors d'une visite précédente : on prépare le service worker tout de suite
if (notifPermission() === "granted") registration();

/** Demande l'autorisation (doit être appelée suite à un clic). Renvoie "granted" | "denied" | "default" | "unsupported". */
export async function requestNotifPermission() {
  if (!notifSupported()) return "unsupported";
  const p = await Notification.requestPermission();
  if (p === "granted") await registration().catch(() => {});
  return p;
}

/** Affiche une alerte ; un clic ouvre (ou remet au premier plan) `url`. */
export async function showAlert(title, { body = "", url = "./", tag } = {}) {
  if (notifPermission() !== "granted") return false;
  const options = { body, tag, renotify: Boolean(tag), icon: ICON, badge: ICON, data: { url: new URL(url, location.href).href } };
  try {
    const reg = await registration();
    await reg.showNotification(title, options);
  } catch {
    // Repli (navigateurs de bureau sans service worker utilisable)
    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); location.href = options.data.url; n.close(); };
  }
  return true;
}

/**
 * Compare les commandes reçues avec l'état mémorisé dans ce navigateur (localStorage)
 * et renvoie les changements : [{ order, before, now }]. `before` vaut undefined pour une
 * commande jamais vue. Au tout premier passage sur cet appareil, on mémorise sans rien
 * signaler (pas d'avalanche d'alertes sur l'historique). La mémoire est partagée entre
 * onglets, donc un même changement n'est signalé qu'une fois. Les changements survenus
 * pendant que le site était fermé sont signalés à la prochaine ouverture.
 */
export function createOrderWatcher(storageKey) {
  let fallback = null; // si localStorage est indisponible
  const load = () => { try { return JSON.parse(localStorage.getItem(storageKey) || "null"); } catch { return fallback; } };
  const save = (m) => { fallback = m; try { localStorage.setItem(storageKey, JSON.stringify(m)); } catch { /* mémoire seule */ } };
  return (orders) => {
    const prev = load();
    const next = Object.fromEntries(orders.map((o) => [o.id, normalizeOrderStatut(o.statut)]));
    save(next);
    if (!prev) return [];
    return orders
      .filter((o) => prev[o.id] !== next[o.id])
      .map((o) => ({ order: o, before: prev[o.id], now: next[o.id] }));
  };
}

export const orderNumber = (o) => String(o.id || "").slice(0, 8).toUpperCase();

/**
 * Bloc « Activer les alertes » à placer dans une page (bouton, état, aide si refusé).
 * `texte` : phrase d'explication affichée au-dessus du bouton.
 */
export function mountNotifOptIn(container, { texte, onTest } = {}) {
  if (!container) return;
  const render = () => {
    const p = notifPermission();
    container.classList.remove("hidden");
    if (p === "unsupported") {
      container.innerHTML = `<p class="text-xs text-[#7F7973]">Ce navigateur ne gère pas les alertes. Sur iPhone / iPad, ajoutez d'abord le site à l'écran d'accueil (Partager → « Sur l'écran d'accueil »), puis ouvrez-le depuis l'icône.</p>`;
    } else if (p === "granted") {
      container.innerHTML = `<p class="text-xs text-[#2C2A29]">✓ Alertes activées sur cet appareil.</p>${onTest ? `<button type="button" data-notif-test class="text-[11px] uppercase tracking-[0.15em] underline text-[#7F7973] hover:text-[#2C2A29]">Envoyer une alerte de test</button>` : ""}`;
    } else if (p === "denied") {
      container.innerHTML = `<p class="text-xs text-amber-800">Les alertes sont bloquées pour ce site. Pour les autoriser : icône à gauche de l'adresse (cadenas / réglages) → Notifications → Autoriser, puis rechargez la page.</p>`;
    } else {
      container.innerHTML = `${texte ? `<p class="text-xs text-[#7F7973]">${texte}</p>` : ""}<button type="button" data-notif-enable class="px-5 py-2.5 border border-[#2C2A29] text-[11px] uppercase tracking-[0.18em] hover:bg-[#2C2A29] hover:text-[#FDFBF7] transition-colors">Activer les alertes</button>`;
    }
  };
  container.addEventListener("click", async (e) => {
    if (e.target.closest("[data-notif-enable]")) { await requestNotifPermission(); render(); }
    if (e.target.closest("[data-notif-test]")) onTest?.();
  });
  render();
}
