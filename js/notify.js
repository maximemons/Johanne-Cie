// Notifications e-mail à l'atelier via l'API REST d'EmailJS (aucune dépendance à charger).
import { EMAILJS } from "./config.js";
import { formatPrice, formatDateFR } from "./catalog.js";

const ENDPOINT = "https://api.emailjs.com/api/v1.0/email/send";

export const emailEnabled = () => Boolean(EMAILJS.publicKey && EMAILJS.serviceId && EMAILJS.templateCommandePassee);

function details(order) {
  return (order.articles || [])
    .map((a) => `${a.quantity} × ${a.nom} — ${formatPrice(a.prix * a.quantity)} — pour le ${formatDateFR(a.dateRetrait || order.dateRetrait)}`)
    .join("\n");
}

/**
 * Envoie un e-mail à l'atelier. type : "passee" | "annulee".
 * N'échoue jamais : une notification manquée ne doit pas bloquer la commande.
 */
export async function notifyAtelier(type, order) {
  if (!emailEnabled()) return false;
  const template = type === "annulee"
    ? (EMAILJS.templateCommandeAnnulee || EMAILJS.templateCommandePassee)
    : EMAILJS.templateCommandePassee;
  const remise = order.remise?.montant > 0
    ? `Remise fidélité : −${formatPrice(order.remise.montant)} (${order.remise.pct} %, ${order.remise.points} pts)`
    : "";
  const params = {
    to_email: EMAILJS.destinataire,
    evenement: type === "annulee" ? "Commande annulée par le client" : "Nouvelle commande",
    commande_id: String(order.id || "").slice(0, 8).toUpperCase(),
    client_email: order.userEmail || "",
    total: formatPrice(order.total),
    remise,
    details: details(order),
    notes: order.notes || "",
    admin_url: new URL("admin.html#commandes", window.location.href).href
  };
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service_id: EMAILJS.serviceId, template_id: template, user_id: EMAILJS.publicKey, template_params: params })
    });
    if (!res.ok) console.warn("EmailJS :", res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.warn("EmailJS indisponible :", err);
    return false;
  }
}
