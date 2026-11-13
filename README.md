# Johanne & Cie — Pâtisserie Fines

Site de commande connecté à Firebase (`johanne-and-cie`) : boutique (`index.html`) + administration (`admin.html`, servie sur `/admin`).

## Boutique
- Catalogue en temps réel, **trié par catégorie** : une section par catégorie, avec une barre de catégories fixe sous l'en-tête. Un clic sur une catégorie fait défiler jusqu'à sa section ; en faisant défiler la page, la catégorie en cours se sélectionne automatiquement. Le nombre de parts est affiché sous la photo de chaque carte. En revenant d'une fiche produit (bouton retour du navigateur ou « Retour aux pâtisseries »), ou du panier, on retrouve la position précédente. Les pâtisseries sans catégorie (supprimée, masquée ou jamais définie) sont rangées dans **« Autre »**, toujours en dernier.
- **Fiche produit** (`/produit?id=…`, ouverte en cliquant sur une pâtisserie) : galerie d'images, prix, description, choix de la quantité, ajout au panier, mode de retrait, « Détails du produit » (conservation, composition, allergènes, parts, poids) et suggestions « Vous pourriez aussi aimer ». Seules les rubriques renseignées s'affichent.
- **Le panier exige une connexion** (Google, e-mail + mot de passe, ou lien e-mail sans mot de passe). La navigation et l'ajout au panier restent libres ; l'écran du panier affiche d'abord l'identification. La session est conservée dans le navigateur (persistance locale), donc le client reste connecté d'une visite à l'autre.
- Panier : **une date souhaitée par article**. La date du premier article est reprise par les autres tant qu'elle n'est pas modifiée à la main (bouton « Même date pour tous » pour tout réaligner).
- À la validation, chaque date est vérifiée (à partir de demain, et création de saison à cette date).