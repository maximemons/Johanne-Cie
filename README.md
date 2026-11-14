# Johanne & Cie — Pâtisserie Fines

Maison Johanne & Cie — site de commande connecté à Firebase (`johanne-and-cie`) : boutique + administration, en **vraies pages HTML** (aucune réécriture d'URL) :

| Page | Rôle | Script |
|---|---|---|
| `index.html` | liste des pâtisseries, par catégorie | `js/app.js` |
| `produit.html?id=…` | fiche d'une pâtisserie | `js/produit.js` |
| `panier.html` | panier, identification, commande | `js/panier.js` |
| `admin.html` | administration | `js/admin.js` |

`js/shop-common.js` regroupe ce que partagent les trois pages boutique (catalogue en temps réel, pastille du panier, notifications). Le panier est conservé dans le navigateur (`localStorage`) et donc partagé entre les pages.

## Boutique
- **Best-Sellers** : sélection manuelle (étoile ★ sur la liste des pâtisseries en admin), sans lien avec les ventes. Ils apparaissent dans une fausse catégorie « Best-Sellers », en première position de la liste et de la barre de catégories (elle disparaît s'il n'y en a aucun). Un best-seller reste aussi dans sa vraie catégorie, avec une pastille ★.
- Catalogue en temps réel : **une ligne horizontale par catégorie** (« Autre » en dernier), cartes toutes de même taille (3 visibles sur ordinateur, flèches ‹ › quand une catégorie en compte davantage ; balayage au doigt sur mobile). Barre de catégories fixe en haut (type sommaire collant / scrollspy) : la catégorie en cours se surligne pendant le scroll, et un clic fait défiler jusqu'à sa ligne. Le nombre de parts est affiché sous la photo. En revenant d'une fiche produit (bouton précédent du navigateur ou « Retour aux pâtisseries ») ou du panier, on retrouve la position précédente (défilement vertical et horizontal des lignes, mémorisé dans `sessionStorage`). Le fil d'Ariane d'une fiche renvoie à `index.html#cat-ID`, qui fait défiler jusqu'à la catégorie.
- **Fiche produit** (`produit.html?id=…`, ouverte en cliquant sur une pâtisserie) : galerie d'images, prix, description, choix de la quantité, ajout au panier, mode de retrait, « Détails du produit » (conservation, composition, allergènes, parts, poids) et suggestions « Vous pourriez aussi aimer ». Seules les rubriques renseignées s'affichent.
- **Le panier exige une connexion** (Google, e-mail + mot de passe, ou lien e-mail sans mot de passe). La navigation et l'ajout au panier restent libres ; l'écran du panier affiche d'abord l'identification. La session est conservée dans le navigateur (persistance locale), donc le client reste connecté d'une visite à l'autre.
- Panier : **une date souhaitée par article**. La date du premier article est reprise par les autres tant qu'elle n'est pas modifiée à la main (bouton « Même date pour tous » pour tout réaligner).
- À la validation, chaque date est vérifiée (à partir de demain, et création de saison à cette date).

## Administration (`admin.html`, `pro.maxime.mons@gmail.com`, via Google ou lien e-mail)
- **Commandes** : vue par commande (changement de statut, suppression) ou **par jour** (planning de production : total à préparer par création).
- **Pâtisseries & Stocks** : étoile ★ Best-Seller (clic pour activer / retirer, filtre et compteur), créer / modifier / supprimer (avec la fiche détaillée : images supplémentaires, composition, allergènes, parts, poids, avertissement de conservation), bouton rapide « Marquer épuisé / Remettre en stock », **saisonnalité** (période de mois, y compris à cheval sur deux années).
- **Prix de revient** (privé) : saisie depuis le formulaire d'une pâtisserie ou depuis l'onglet dédié. Chaque modification est datée et conservée (une valeur par jour, note optionnelle, suppression possible). L'onglet affiche marge en € et en %, coefficient, variation depuis le premier relevé, un graphique par pâtisserie (courbe en escalier + prix de vente en pointillés) et un indice global d'évolution des coûts (base 100). **Prix de vente suggéré** : dès qu'un nouveau prix de revient devient le prix actuel (formulaire pâtisserie ou panneau d'historique), une popup propose de fixer le prix de vente à **revient + 40 % maximum, arrondi au 0,50 € inférieur** (donc toujours en `,00` ou `,50` — ex. revient 14,50 € → plafond 20,30 € → **20,00 €**). « Valider » met à jour le prix de vente de la pâtisserie ; « Garder » (ou Échap) ne change rien. Aucune popup si le prix est déjà le prix suggéré, si le relevé est daté avant le dernier, ou si aucun prix rond ne tient dans la fourchette. Le plafond est la constante `MAX_MARKUP_PCT` de `js/costs.js`. Ces données sont stockées dans la collection `couts`, **réservée à l'admin par `firestore.rules`** : jamais dans `patisseries`, jamais lues par la boutique.
- **Catégories** : créer, réordonner, masquer (« rendre indisponible ») ou supprimer.

## Déploiement
```
firebase deploy --only hosting,firestore:rules
```
`firebase.json` ne définit ni réécriture ni « URL propres » (`cleanUrls: false`) : les adresses restent `…/panier.html`, `…/produit.html?id=…`, `…/admin.html`. Les liens de connexion par e-mail renvoient vers `panier.html` (client) et `admin.html` (admin).

Les règles `firestore.rules` sont **indispensables** (en particulier pour la collection privée `couts`) : sans elles, la sécurité de l'admin ne repose que sur le navigateur.
Console Firebase → Authentication → Méthode de connexion : activer **Google**, **E-mail/Mot de passe** et **Lien envoyé par e-mail** (case à cocher dans le fournisseur E-mail/Mot de passe). Dans *Paramètres → Domaines autorisés*, ajouter le domaine du site (nécessaire pour les liens e-mail).
