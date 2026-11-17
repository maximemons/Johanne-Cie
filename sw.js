// Service worker — Johanne & Cie
// Rôle unique : afficher les alertes de commande et ouvrir la bonne page quand on clique dessus.
// (Aucune mise en cache : le site fonctionne exactement comme avant.)

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const samePage = (c) => new URL(c.url).pathname === new URL(target).pathname;
    // Un onglet déjà ouvert sur la bonne page : on le remet au premier plan
    const existing = wins.find(samePage) || null;
    if (existing) {
      if (existing.url !== target && "navigate" in existing) {
        try { await existing.navigate(target); } catch { /* onglet non contrôlé : on se contente du focus */ }
      }
      return existing.focus();
    }
    return self.clients.openWindow(target);
  })());
});
