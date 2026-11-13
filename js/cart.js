const STORAGE_KEY = "johanne_cart";

export function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return raw.map((i) => ({ ...i, date: i.date || "", dateManual: Boolean(i.dateManual) }));
  } catch {
    return [];
  }
}

export function persistCart(cart) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
}

export function getCartCount(cart) {
  return cart.reduce((sum, item) => sum + item.quantity, 0);
}

export function getCartTotal(cart) {
  return cart.reduce((sum, item) => sum + item.prix * item.quantity, 0);
}

// Un nouvel article reprend la date du premier article du panier
export function addItem(cart, product, qty = 1) {
  const existing = cart.find((i) => i.id === product.id);
  if (existing) {
    existing.quantity += qty;
    return;
  }
  cart.push({
    id: product.id,
    nom: product.nom,
    prix: Number(product.prix) || 0,
    imageUrl: product.imageUrl || "",
    quantity: qty,
    date: cart.length ? cart[0].date : "",
    dateManual: false
  });
}

/**
 * Change la date d'un article.
 * - Premier article : la date est relayée à tous les articles dont la date n'a pas été modifiée à la main.
 * - Autre article : sa date devient "personnalisée" et n'est plus écrasée.
 */
export function setItemDate(cart, id, date) {
  const idx = cart.findIndex((i) => i.id === id);
  if (idx < 0) return;
  cart[idx].date = date;
  if (idx === 0) {
    cart.forEach((item, i) => {
      if (i > 0 && !item.dateManual) item.date = date;
    });
  } else {
    cart[idx].dateManual = true;
  }
}

// Remet tous les articles sur la date du premier
export function applyFirstDateToAll(cart) {
  if (!cart.length) return;
  cart.forEach((item) => {
    item.date = cart[0].date;
    item.dateManual = false;
  });
}

export function removeItem(cart, id) {
  const next = cart.filter((i) => i.id !== id);
  if (next.length) next[0].dateManual = false; // le nouveau premier devient la référence
  return next;
}
