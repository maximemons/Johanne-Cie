# Johanne & Cie — Pâtisserie Fines

Maison Johanne & Cie — site de commande connecté à Firebase (`johanne-and-cie`) : boutique (`index.html`) + administration (`admin.html`, servie sur `/admin`).

## Boutique
- Catalogue en temps réel : **une ligne horizontale par catégorie** (« Autre » en dernier), cartes toutes de même taille (3 visibles sur ordinateur, flèches ‹ › quand une catégorie en compte davantage ; balayage au doigt sur mobile). Barre de catégories fixe en haut (type sommaire collant / scrollspy) : la catégorie en cours se surligne pendant le scroll, et un clic fait défiler jusqu'à sa ligne. Le nombre de parts est affiché sous la photo. En revenant d'une fiche produit (retour navigateur ou « Retour aux pâtisseries ») ou du panier, on retrouve la position précédente.
- **Fiche produit** (`/produit?id=…`, ouverte en cliquant sur une pâtisserie) : galerie d'images, prix, description, choix de la quantité, ajout au panier, mode de retrait, « Détails du produit » (conservation, composition, allergènes, parts, poids) et suggestions « Vous pourriez aussi aimer ». Seules les rubriques renseignées s'affichent.
- **Le panier exige une connexion** (Google, e-mail + mot de passe, ou lien e-mail sans mot de passe). La navigation et l'ajout au panier restent libres ; l'écran du panier affiche d'abord l'identification. La session est conservée dans le navigateur (persistance locale), donc le client reste connecté d'une visite à l'autre.
- Panier : **une date souhaitée par article**. La date du premier article est reprise par les autres tant qu'elle n'est pas modifiée à la main (bouton « Même date pour tous » pour tout réaligner).
- À la validation, chaque date est vérifiée (à partir de demain, et création de saison à cette date).

## Administration (`/admin`, `pro.maxime.mons@gmail.com`, via Google ou lien e-mail)
- **Commandes** : vue par commande (changement de statut, suppression) ou **par jour** (planning de production : total à préparer par création).
- **Pâtisseries & Stocks** : créer / modifier / supprimer (avec la fiche détaillée : images supplémentaires, composition, allergènes, parts, poids, avertissement de conservation), bouton rapide « Marquer épuisé / Remettre en stock », **saisonnalité** (période de mois, y compris à cheval sur deux années).
- **Prix de revient** (privé) : saisie depuis le formulaire d'une pâtisserie ou depuis l'onglet dédié. Chaque modification est datée et conservée (une valeur par jour, note optionnelle, suppression possible). L'onglet affiche marge en € et en %, coefficient, variation depuis le premier relevé, un graphique par pâtisserie (courbe en escalier + prix de vente en pointillés) et un indice global d'évolution des coûts (base 100). Ces données sont stockées dans la collection `couts`, **réservée à l'admin par `firestore.rules`** : jamais dans `patisseries`, jamais lues par la boutique.
- **Catégories** : créer, réordonner, masquer (« rendre indisponible ») ou supprimer.

## Déploiement
```
firebase deploy --only hosting,firestore:rules
```
Les règles `firestore.rules` sont **indispensables** (en particulier pour la collection privée `couts`) : sans elles, la sécurité de l'admin ne repose que sur le navigateur.
Console Firebase → Authentication → Méthode de connexion : activer **Google**, **E-mail/Mot de passe** et **Lien envoyé par e-mail** (case à cocher dans le fournisseur E-mail/Mot de passe). Dans *Paramètres → Domaines autorisés*, ajouter le domaine du site (nécessaire pour les liens e-mail).
