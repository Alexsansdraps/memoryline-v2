# Recette — 6 octobre 2026

Tout ce qui n'est pas coché « terminé » sur le Trello, testé à l'écran sur la pile locale (site http://localhost:8080, BO http://localhost:4322/bo), plus les parcours complets. Trello n'a été que lu, jamais modifié.

Légende : ✅ bon · 🔧 n'allait pas, corrigé · ⚠️ n'allait pas, reste à faire · ❓ question pour Margaux

## Trouvé en chemin (hors cartes)

| Où | Ce qui n'allait pas | Statut |
|---|---|---|
| BO › Accueil | « Meilleure journée : 0,04 € » : la courbe compte des commandes, l'écran la lisait comme des euros. | 🔧 Elle dit maintenant « 4 commandes ». |
| BO › Accueil | Les boutons 7 / 30 / 90 jours ne changeaient rien : l'écran envoyait `jours=`, l'API lit `days=`. Toujours 30 jours. | 🔧 |
| BO › Accueil | « 13 affiches vendue s » (un « s » détaché). | 🔧 |
| BO, 8 écrans | Même défaut ailleurs : « 2 produit s rangé s », « commande s archivée s », « image s », « nouveaux client s », « décors affichés . », « Les voir . ». | 🔧 |
| BO › Cadres | Les en-têtes « Supplément A4 / A3 / Poids / Ordre / Affiché » étaient alignés sur du vide : tous les champs tenaient sous « Nom ». Le tri par colonne ne pouvait pas marcher. | 🔧 Un champ par colonne, colonne « Couleur » ajoutée, tri sur les vraies valeurs. Enregistrement re-testé. |
| Module › Fonds | Vieux Moulin : 2e vignette de fond cassée (« AFFICHES_V… »). L'image n'existe pas sur le disque. Même cas pour un fond de Forêt Animaux. 2 fonds sur 167. | 🔧 Le site ne propose plus un fond dont l'image manque ; BO › Décors des affiches les signale en rouge (onglet « Image introuvable »). |
| BO › Décors des affiches | Annonçait « rien ne correspond, aucun décor à choisir » pour les 3 Compiègne alors que le module leur en propose 9 (règle de recherche par nom différente de celle du module). L'affiche IA y était listée à tort. | 🔧 Une seule règle, partagée avec le module. |
| Tests | Les tests à l'écran tournent dans un Chrome sans fenêtre (profil à part) : un onglet caché derrière une autre fenêtre est mis en pause par Chrome, et ses mesures ne valent rien. | — |
| Site › en-tête, après paiement | Sur l'écran « Merci ! », la pastille du panier affichait encore « 1 » au-dessus d'un panier vidé (elle ne se corrigeait qu'à la page suivante). | 🔧 Le paiement prévient la pastille (`CheckoutIsland.tsx`, `CartBadge.tsx`). Revérifié sur une 2e commande : plus de chiffre. |
| Site › caisse | « Continuer vers le paiement » reste grisé tant qu'il manque le point relais ou l'adresse, sans rien dire de ce qui manque. | 🔧 Une phrase sous le bouton dit ce qui manque, dans les 5 langues (`CheckoutIsland.tsx`, `ui.ts`). Vérifié : « Pour continuer, il manque : un point relais. », puis à domicile « … l'adresse de livraison (rue, code postal et ville). », et en anglais « To continue, we still need a pickup point. ». |
| Site › caisse, « Retrait sur place » | Le texte du mode (saisi dans BO › Livraison) dit « À convenir — indiquez votre créneau en commentaire. », mais la caisse n'a **aucun champ commentaire** : la cliente ne peut pas le faire. | ❓ Changer le texte, ou ajouter un champ « commentaire » à la caisse ? |
| Site en anglais (données) | Tous les textes du site sont traduits. Restent en français, parce que la traduction n'a pas été saisie au BO : le bandeau « 3 affiches achetées… », les onglets de personnages (Femmes, Hommes…), les noms des cadres, les modes de livraison (« Point relais », « À domicile »…), les noms et descriptions des produits (1 produit traduit sur 177 ; sans traduction, la fiche anglaise n'a pas de description du tout). | ❓ À saisir par Margaux : BO › Bandeau et offre, Personnages (Traductions des catégories), Cadres (Traductions des cadres), Livraison, Produits. Chaque écran a « Proposer les traductions manquantes ». |
| Catalogue (données) | 3 personnages « **Femme test** » (silhouette orange sans habits) apparaissent en tête des Femmes. Créés le 10/09 pendant le développement, en local. Même cas dans « **Fauteuil roulant** » : « **emond** » et « **ddd** », dont le dessin est une capture d'écran (`capture-d-ecran-2026-05-…png`), proposés sur toutes les affiches de face. | ❓ S'ils existent aussi sur le site de test : BO › Personnages › Archiver. |
| Catalogue (données) | **Vieux Moulin** : la 2e vignette de fond est maintenant une affiche « **VERACRUZ** » (fond n° 6, fichier `AFFICHES_Villes_2_.pdf_1.svg`, nom hérité de l'ancienne boutique). Rien à voir avec Vieux-Moulin. | ❓ À retirer dans BO › Décors des affiches si ce n'est pas voulu. Pas touché. |
| Catalogue (données) | **FORÊT Animaux** propose 6 fonds, dont Paris rues Eiffel, Compiègne Hôtel de ville, Compiègne Beaux-monts jour et sunset. Pendant ce temps, les 3 affiches **Compiègne** (Beaux-monts, Beaux-monts sunset, Hôtel de ville) n'ont aucun fond à elles. Idem : **Côte d'Opale Plage #2** (son fond est rattaché à « Côte d'Opale Plage FACE »), **Montagne Neige** (rattaché à « Les Alpes Montagne neige »), **Paris Tour Eiffel sunset #1** (rattaché à « Paris Tour Eiffel toits sunset »). | ❓ À vérifier par Margaux dans BO › Décors des affiches : je n'ai pas touché au catalogue. |

## Colonne BO

| Carte | Ce que j'ai testé | Statut |
|---|---|---|
| CADRES › choisir de faire apparaître ou pas, et les prix | Case « Proposer les cadres sur le site » décochée → plus aucun cadre à l'étape Format. Case « Afficher le supplément » décochée → les cadres sans « + 14 € », mais le total passe bien de 23 à 37 € avec « Cadre noir ». Réglages remis ensuite. | ✅ (+ 🔧 tableau, voir plus haut) |
| Pages/Collection › trier l'ordre soi-même, « par pages aussi » | Collections › Thèmes & paysages : glisser « Côte d'Opale Plage #2 » en tête, enregistrer → la page du site suit. Ordre remis. L'accueil suit la collection « En vedette », les deux pages Affiches personnalisables / prêtes à imprimer suivent Produits › Ordre d'affichage. | ✅ |
| Couleur des personnages et éléments téléversés (« ce ne sont pas ceux du graphiste, il faut faire avec ») | Berger australien (image Canva, sans zones de couleur) : « Détecter les couleurs » trouve 5 couleurs ; cocher « Pelage » + enregistrer → dans le module, le pelage passe du noir à l'orange. Ça marche, mais **chaque animal téléversé doit être réglé une fois** : aujourd'hui Berger allemand, Berger australien, Chien york et Chat gris ne proposent rien. | ✅ + ❓ réglage à faire par Margaux |
| PAGES › « voir tout », « paysages… » pas répertoriées | Pages du site liste : ses pages, les pages de la boutique (accueil, toutes les affiches, personnalisables, prêtes à imprimer, contact) et la page de chaque collection, avec leur adresse et le menu. | ✅ |
| Partie « Clients » (« adresse mails, adresse, nombre d'achats, **si web ou stand**, statistiques ») | Liste façon Shopify : recherche, onglets, cases à cocher, étiquettes, export, import, 50 par page, fiche avec historique. Mais **« web ou stand » n'apparaissait nulle part** dans la liste (seulement dans l'export). | 🔧 Colonne « Vient de » (« Site », « Stand · Marché de Noël Mulhouse ») et onglets « Venues du site » / « Venues d'un stand ». Vérifié : 5 clientes de stand. |
| Commandes › paniers mêlés aux commandes (trouvé en testant les PDF) | L'onglet « Toutes » (et « Non traitées ») listait aussi les paniers en cours : 23 lignes « DRAFT-…, Panier, 0 €, aucun client » sur 33. | 🔧 Ils n'y sont plus (ils ont leur écran « Paniers abandonnés ») ; l'export CSV suit. |
| Stats › période libre, séparer les stands | « Du… au… » + 8 périodes toutes faites ; Site / Stands / Tout ; sous Stands, choix d'un stand et tableau « Stand par stand ». Vérifié sur le 25/09 : 4 commandes, 147 €. | ✅ |

## Colonne MODULE

| Carte | Ce que j'ai testé | Statut |
|---|---|---|
| Logo signature en bas à droite sur chaque création | Aperçu du module : le logo est en bas à droite (12 % de la largeur). Fichiers d'impression rendus (Vieux Moulin, Senlis, puis Honfleur au parcours complet) : fond, texte, personnage et signature en bas à droite. | ✅ + ❓ le vrai fichier de signature de Margaux |
| PERSONNAGES › ne pas proposer la couleur des détails (ruban du chapeau) | Le réglage par catégorie existait (0065) mais sur « toutes » partout : le chapeau de Femme 2 proposait **3 rangées** de pastilles identiques, sans titre. Et « couleur principale » laissait l'ombre de la calotte à sa couleur d'origine. | 🔧 Migration 0066 : toutes les catégories sur « couleur principale » (modifiable dans BO › Catégories de pièces). Les ombres de même teinte suivent la couleur choisie. Vérifié : 1 seule rangée ; chapeau passé au bleu avec son ombre, ruban resté orange — à l'écran puis sur le fichier d'impression d'une vraie commande (voir « Parcours complets »). |
| SCROLLE › boutons et barres trop discrets | Barre de la page : 15 px, curseur gris foncé. Fenêtre de personnalisation : barre épaisse avec flèches ▲▼. Rail des cadres : boutons ‹ › de 44 px + barre. Sommaire du personnage (Peau, Vêtements, Pantalon, Cheveux, Accessoires) : chaque pastille descend à sa section. | ✅ |
| Augmenter la taille des étapes | « 1. Fond & texte / 2. Personnages / 3. Format » : 15 px en gras, 40 px de haut (avant : 12 px). | ✅ |

## Colonne SITE

| Carte | Ce que j'ai testé | Statut |
|---|---|---|
| Bandeau visuel sur les pages (ex. marché de Noël) | Créé un bandeau d'essai (image, titre, étiquette, bouton, accueil) dans BO › Bandeaux visuels → il s'affiche sous le menu, en ordinateur comme en téléphone. Bandeau archivé ensuite. | ✅ |
| Police des produits : plus grasse, plus petite, comme le site actuel | Description : Inter 16 px, graisse 600, interligne 1,8 — mesurée à l'identique sur memoryline.fr. Titres des vignettes : 14 px, graisse 600. | ✅ |
| Boutons pleins noirs pas assez visibles au clic | Bouton « Personnaliser » enfoncé : passe au rouge brique, se resserre, anneau clair. Format choisi : double bordure + coche. | ✅ |
| Nombre de produits par ligne sur TOUTES les pages | Réglage passé à 4 (et 2 pour la recherche seule) : accueil, toutes les affiches, personnalisables, prêtes à imprimer, rayons → 4 ; recherche → 2 ; tablette portrait → 3 ; téléphone → 2. Réglage remis à 3. | ✅ |
| Commandes site : on ne peut pas télécharger le PDF | Tous les boutons PDF de la liste (10 commandes du site, 5 du stand) : réponse 200, vrais PDF de 7 à 15 Mo en 0,4 à 2,5 s ; « Tout » en .zip aussi. | ✅ |
| SCROLLE (côté site) | Voir colonne MODULE. | ✅ |

## Colonne MODE STAND

| Carte | Ce que j'ai testé | Statut |
|---|---|---|
| Télécharger LE ou LES PDF sans ouvrir la commande | Boutons « 1 », « 2 », « Tout » et « PDF » dans la liste des ventes stand : tous téléchargés (voir SITE). | ✅ |
| Page commande stand sur tablette | Stand d'essai ouvert dans le BO, code passé par l'adresse : rangé dans la tablette puis retiré de l'adresse. Pas de prix, pas de bandeau promo. Étape « 3. Format » sans défilement, en 1024 × 768 comme en 768 × 1024. Page panier : nom, adresse e-mail, « Valider mon affiche », sans prix. | ✅ |
| Page commande stand sur tablette, en portrait (trouvé en testant) | En 768 × 1024, la liste n'a que la moitié gauche : la quantité restée à droite laissait 75 px au texte — « VIEUX / MOULIN », « Format : A4 (21 × 29,7 / cm) » sur trois lignes. | 🔧 Entre 768 et 1023 px, la quantité passe sous la description (`CartIsland.tsx`). Rien ne change en 1024 × 768 ni sur le site. |
| « Une fois validé » : le message | « Votre commande est validée, vous pouvez maintenant vous adresser au vendeur », le numéro (SAL-0006) en grand. Plus de « nous vous écrirons à… ». Rien à faire défiler : la carte s'arrête à 547 px, en 1024 × 768 comme en 768 × 1024. | ✅ |
| « Une fois validé » : pouvoir revenir en arrière | **Flèche retour de la tablette** (`history.back()`) : la vente est rouverte, son panier revient sur la tablette, prêt à corriger. **Bouton « ← Revenir à ma commande »**, juste avant « Client suivant » : pareil. En base, la vente redevient un panier, son encaissement passe en « annulé » et le journal le dit ; revalidée, elle garde son numéro. « Client suivant » repart du catalogue avec un panier vide, le mode stand et le code restent. Mais les deux boutons étaient **collés l'un à l'autre** et décalés de 2 px (le `inline-flex` du bouton noir l'emportait sur le `flex` prévu). | ✅ + 🔧 Les deux boutons côte à côte, séparés, même hauteur ; l'un sous l'autre sur un téléphone (`CommandeStand.tsx`). |
| Corriger la commande après l'avoir validée (trouvé en testant) | Rouverte, passée d'A4 sans cadre à A3 + cadre noir, revalidée : le total suit (43 €), mais le fichier d'impression s'appelait toujours **`Recette-Stand-Tablette_A4_pas-cadre.pdf`** — le nom est figé à la première validation. La vendeuse aurait chargé du papier A4 et oublié le cadre. | 🔧 La réouverture efface les noms des fichiers de la vente ; la revalidation les refait (`salon.ts`). Vérifié : `Recette-Stand-Tablette_A3_noir.pdf`, page de 297 × 420 mm. |
| La commande en base et son PDF | SAL-0006 : canal « salon », stand « Essai recette (à fermer) », payée, 1 article, cliente créée (adresse @example.com). BO › Ventes stand : elle y est, avec son stand ; le PDF se télécharge (200, `application/pdf`, 6,8 Mo, nom « client_A4_pas-cadre »), puis 12 Mo en A3 après la correction. | ✅ |
| Petit confort | Après « Revenir à ma commande », le nom et l'adresse e-mail étaient à retaper. | 🔧 Ils reviennent tout seuls (gardés le temps du rechargement, effacés aussitôt relus) (`CommandeStand.tsx`). Vérifié sur un 2e stand d'essai (SAL-0007) : « Client Retour » et son adresse revenus, vente revalidée, puis vente archivée et stand fermé et archivé. |
| Remarque | Tant qu'un stand est ouvert, il est proposé au **retrait sur place** dans la caisse du site (« Où souhaitez-vous retirer ? »). Le stand d'essai y est apparu le temps de la recette. | — Ne pas laisser un stand d'essai ouvert sur le vrai site. |

## Colonne MARGAUX

| Carte | Ce que j'ai testé | Statut |
|---|---|---|
| Ados & enfants → + de coupes de cheveux | Ce que le module propose, personnage par personnage. **Ados** : 9 personnages, 8 n'ont qu'**une** coupe (la leur) ; seule « Ado fille 2 » de dos en a 4. **Filles** : 4 personnages, 1 coupe chacun. **Garçons** : 4 personnages, 1 coupe chacun. La base compte 53 coupes (27 de dos, 26 de face), presque toutes dessinées pour des adultes. | ❓ Contenu à fournir par Margaux : des coupes dessinées pour les enfants et les ados, à téléverser puis à cocher sur chaque personnage (BO › Personnages › Pièces par personnage). Rien à coder. |
| Amélioration en stand (panneaux, TV tuto, bruiteur) | Du matériel pour le stand. | — Rien côté site. |
| À la fin : vérifier les photos / svg | Les 577 images citées en base (178 visuels de produits, 164 pièces, 67 dessins de personnages, 167 fonds, 1 décor) : présentes dans `data/assets` et servies en HTTP 200 par `/api/assets/…`, sauf les **2 fonds déjà connus** (`AFFICHES_Villes_2_.pdf.png` et `AFFICHES_Villes_2_.pdf_cc4bfbba…svg`, voir plus haut). Aucun des 424 SVG ne pointe vers une image extérieure. | ✅ |
| Plusieurs comptes si je fais plusieurs marchés de Noël | Plusieurs stands à la fois, chacun son code et ses ventes : ✅ (deux stands ouverts pendant la recette). BO › Comptes : deux rôles, Propriétaire et Vendeur (un vendeur consulte commandes, catalogue et PDF sans rien modifier). **Un compte n'est rattaché à aucun stand** : un vendeur voit toutes les ventes. La tablette, elle, n'a besoin d'aucun compte, seulement du code du stand. Aucun compte créé. | ❓ Margaux veut-elle un accès au BO par marché, limité aux ventes de son stand ? Aujourd'hui : un code par stand, et des comptes Vendeur qui voient tout. |
| Nouveaux types de produit, à part de dos et de face (mariés) — « C'EST OÙ ? » + « faire test » | **Où** : 1) BO › Types d'affiche › « Ajouter un type d'affiche » (avec un décor de premier plan s'il en faut un) ; 2) BO › Personnages : sur chaque personnage, le champ « Type d'affiche » (et ses pièces avec le même type) ; 3) BO › Produits : le champ « Type d'affiche » de l'affiche. **Test** : type « Mariés (essai) », deux personnages (les « Femme test ») passés dessus, un produit d'essai sur ce type → le module ne propose que ces deux personnages, sous leur onglet. Mais d'abord, **« + Ajouter un personnage » ne faisait rien**, sans message : un type tout neuf n'a encore aucune pièce, et l'API lui donnait un tiroir de pièces vide `{}` au lieu de quatre listes vides. | ✅ + 🔧 Tiroir complet pour chaque type (`configurator-routes.ts`). Tout remis : personnages revenus « de dos » (vérifié champ par champ), produit d'essai et type archivés. |
| BUG COMPO PERSONNAGE : calques Base → Jean → T-shirt → cheveux → accessoires | Les vrais personnages n'ont qu'un haut et un bas chacun (seule la coupe se change) ; seuls les personnages d'essai proposent tout. Testé sur Femme 2 (t-shirt passé en blanc, pantalon en noir, longue coupe bouclée, chapeau) et Ado fille 2 (coupe longue choisie, son t-shirt passé en rouge, son chapeau d'origine) : **à l'écran puis sur le fichier d'impression**, les cheveux passent par-dessus le t-shirt, le t-shirt par-dessus le pantalon, le chapeau par-dessus les cheveux — y compris le chapeau du dessin d'origine par-dessus une coupe choisie. | ✅ |

## Parcours complets

| Parcours | Ce que j'ai testé | Statut |
|---|---|---|
| Site, en français, de la fiche au fichier d'impression | Honfleur, Femme 2 (chapeau passé au bleu : une seule rangée de pastilles, ruban resté orange), Berger australien (pelage passé au roux), A4 + cadre bois → panier 37 € → caisse. **Un compte est obligatoire** pour la caisse (voulu, voir `commande.astro`) : compte d'essai créé directement en base, sans mot de passe, puis déconnecté. Point relais : suggestions d'adresses, carte avec 12 points, bouton de géolocalisation (position simulée : point bleu, points re-triés, « 30 m ») ; domicile : adresse, code postal et ville débloquent le bouton. Paiement Stripe en mode essai (carte 4242…) → « Merci ! », WEB-0013 payée. Courriel « Votre commande WEB-0013 est confirmée » dans Mailpit, en français, avec l'affiche, le cadre, le point relais et le total. BO › Commandes : la commande, le point relais, « Prêt · 9,2 Mo » ; PDF `Recette-Site_A4_bois-facon-chene.pdf` en 0,4 s. Rendu d'impression : chapeau bleu, ruban orange, chien roux, signature en bas à droite. | ✅ (+ 🔧 pastille du panier, plus haut) |
| Site, en anglais | Fiche, module (les trois étapes, l'éditeur de personnage), panier, caisse : tous les textes du site sont en anglais. Commande WEB-0014 payée : courriel « Your order WEB-0014 is confirmed », en anglais. | ✅ + ❓ données à traduire au BO (plus haut) |
| Affiche IA (à partir d'une photo) | Les trois styles (Personnes / Animaux, Paysage, Maison / Bâtiment) ; sans style, la photo ne peut pas être choisie. Photo d'essai en paysage (1600 × 1000) : elle s'affiche, le sens passe tout seul sur « Paysage (en largeur) », et **rien n'est créé** (aucune génération en base, « Créer mon affiche » non touché). Photo en portrait : le sens revient sur « Portrait ». Sens choisi à la main, puis photo en portrait : le choix de la cliente est gardé. En anglais : tout est traduit, styles compris. | ✅ + ❓ les trois styles n'ont pas encore d'image d'exemple (cases grises) : BO › Affiches IA › Styles proposés |

## Cartes déjà « Terminé » (non-régression)

| Carte | Ce que j'ai vérifié | Statut |
|---|---|---|
| Photos de la fiche produit pas trop grosses | Le visuel tient dans la hauteur de l'écran : 478 × 656 px en 1280 × 800, 455 × 624 en 1024 × 768, 431 × 592 en 768 × 1024 ; « Personnaliser » visible sans défiler. | ✅ |
| Étape 2 = « Ajouter un personnage » | Pas de personnage d'office, pas de muret tant qu'il n'y a personne ; le muret arrive avec le premier personnage. | ✅ |
| Pas de flèche droite à l'étape 3 | À l'étape 3, le pied n'a que « Retour » et « Valider l'affiche ». La seule flèche › est celle du rail des cadres, grisée une fois au bout. | ✅ |
| Filtre des villes sur /affiches, à gauche | « Lieux » à gauche, « Trier » à droite ; « LE TRÉPORT (6) » → 6 affiches. | ✅ |
| Barre de recherche dans BO › Produits | « honfleur » → 1 ligne. | ✅ |
| Écran d'import CSV des produits | Export du catalogue, puis les lignes de Honfleur recollées dans l'import : « 1 affiche lue sur 2 lignes de fichier. 1 déjà à jour, rien à y changer. » Rien n'est enregistré à cette étape. | ✅ |
| Prix du cadre selon le format A4 / A3 | Le module, le panier et la facturation lisent le même calcul (`prixDuCadreCents`) ; A3 + cadre bois = 43 €, A4 + cadre bois = 37 €. Dans les données, les trois cadres valent 14 € dans les deux formats : je n'ai pas pu essayer deux prix différents (changer un prix du catalogue, même pour l'essai, a été refusé). | ✅ (mécanisme) — à revoir quand Margaux aura mis un prix A3 différent |
| Couleurs de cheveux « brun clair » et « châtain clair » | Le nuancier des coupes a 9 couleurs, sans nom : #E8E8E8, #F1CB9E, #E7B033, #B8551D, #D6B695, #BF8158, #6B3E1E, #541507, #24222C. Impossible de dire lesquelles sont « brun clair » et « châtain clair ». | ❓ Codes couleur à demander à Margaux (elle peut aussi les ajouter dans BO › Catégories de pièces › Coupes). |
| Nom du PDF d'impression = client + format + cadre | `Recette-Site_A4_bois-facon-chene.pdf`, `Recette-Stand-Tablette_A3_noir.pdf` (en-tête `Content-Disposition` des téléchargements). | ✅ |

## Remise en état

- Berger australien : réglage des couleurs remis à vide (`base_couleurs_image = NULL`) — il ne propose donc plus « Pelage » (voir colonne BO, ❓).
- Stand « Essai recette (à fermer) » : fermé puis archivé ; il n'est plus proposé au retrait sur place.
- Commandes d'essai SAL-0006, WEB-0013 et WEB-0014 : archivées (elles comptent encore dans les chiffres de la base locale, comme toute vente archivée). Paniers d'essai vidés.
- Type « Mariés (essai) » et produit d'essai archivés ; les deux « Femme test » revenus « de dos ».
- Chrome de test : mode stand refermé (`?stand=0`), code du stand oublié, cliente d'essai déconnectée.
- 2e stand d'essai (« Essai recette 2 ») fermé et archivé, sa vente SAL-0007 archivée.
- Restent en base locale, sans écran pour les archiver : les fiches clientes recette.stand@example.com, recette.site@example.com, recette.retour@example.com et le compte d'essai recette.caisse@example.com (créé par le formulaire d'inscription du site, déconnecté).
- Script `apps/api/scripts/recette-rendu.tmp.ts` supprimé.

## Vérifications finales

- `apps/api` : `tsc --noEmit` sans erreur.
- `packages/configurator` : `tsc --noEmit` sans erreur.
- `apps/web` : `tsc --noEmit` → les 3 erreurs anciennes de `src/islands/StandSalon.tsx`, aucune autre.
- `apps/admin` : `astro check` → 0 erreur, 0 avertissement (27 indications).
