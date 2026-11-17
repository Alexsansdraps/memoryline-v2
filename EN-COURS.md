# Passation du 17/11 au soir, pour le Claude du PC de la maison

Ce fichier est écrit par le Claude du PC du bureau, qui s'est arrêté le 17/11 vers 17 h. Il donne l'état exact, ce qui reste à faire, dans l'ordre, et comment travailler. **`A-FAIRE.md` reste la référence générale** ; ce fichier-ci couvre le chantier en cours.

- `main` = ce qui tourne en prod (dernier commit mis en ligne : `1f073c0`).
- Aucun travail non commité, aucune branche de travail : Alexandra ne veut PAS de branche WIP, seulement ce fichier.

---

## 0. À lire avant tout : les règles d'Alexandra

**Langue et ton**
- Répondre en **français**, court. Elle est pressée et tutoie (« mec »).
- Textes pour Margaux (la cliente) : tutoiement. BO : vouvoiement.
- Textes du site : `apps/web/src/i18n/ui.ts`, dans les **5 langues** (fr, en, de, it, es).

**Après chaque correction vérifiée**
- Commit (message en français, qui se termine par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), puis push, puis **mise en ligne sur le VPS sans redemander**.
- **Noter dans `A-FAIRE.md`.**

**Interdits**
- Ne jamais lire ni afficher un `.env*`.
- Pas de lecture de la base ni des journaux de PROD par SSH (refusé) : passer par l'API publique.
- **Les clés de prod (Stripe, PayPal…) : Alexandra les saisit elle-même.**
- Pas de vrai paiement, pas de commande payante d'essai sur le VPS.
- **Ne plus jamais lancer `vider-donnees-test.sh`.**
- Ne jamais commiter `.env`, `data/`, `sauvegardes/`, les polices AnotherShabby, ni `.claude/launch.json`.

**Tests**
- Jamais de pilotage de l'écran pour une recette : Chrome sans écran par CDP (voir `tests-sans-prendre-l-ecran` dans la mémoire du bureau).
- Données d'essai fictives (`@example.test`), effacées après.

**Mise en ligne**
- Depuis le bureau : archive `git archive` de HEAD, plus les 2 polices AnotherShabby, `scp`, puis `apps/api/scripts/mettre-en-ligne.sh` sur le serveur.
- **Depuis la maison, la clé SSH du bureau n'est pas là** : utiliser la procédure de `MISE-EN-PROD.md` (la commande en une ligne, avec le mot de passe qu'Alexandra tape elle-même).
- La mise en ligne affiche une page de maintenance pendant environ 2 minutes. Ne pas lancer PageSpeed à ce moment-là : le 17/11, le score SEO de 42 venait de là.
- Avant de mettre en ligne : `ssh … "uptime; free -m"`. Le serveur n'a que 3,8 Go de mémoire : rien de lourd en même temps.

**Vérifications** (sur le PC du bureau, des conteneurs Docker `memoryline-*` ; à adapter à la maison)
- API : `npx tsc --noEmit -p .` et `npx tsx --test tests/*.test.ts` dans apps/api : **353 tests passent** au 17/11.
- BO : `npx astro check` dans apps/admin : 0 erreur.
- Site : `npx tsc --noEmit -p .` dans apps/web : 3 erreurs anciennes de StandSalon, tolérées.
- Configurateur : `tsc` dans packages/configurator.

**Piège** : sous Windows, les antislashs sont mangés dans `node -e '…'` et dans certains heredocs. Écrire le code avec les outils d'édition, ou dans un fichier `.cjs`.

---

## 1. Ce qui est EN LIGNE depuis le 17/11 (rien à refaire)

**Stand**
- La tablette enregistre la vente **« à encaisser »** (status `pending`, sans encaissement).
- Margaux clique **« Marquer payée »**, dans la liste « Ventes stand » ou sur la fiche (moyen `sur_place`, aucun courriel).
- Pas de « Rembourser » ni de bordereau sur une vente du stand. Pas d'« Annuler » une fois payée.
- La tablette peut rouvrir une vente à encaisser, pas une vente encaissée.
- La fiche d'une vente du stand reste sous « Ventes stand » (`rubrique` du layout Admin).

**Caisse du site**
- Retrait au stand « Offert », proposé jusqu'à la fermeture du dernier jour, avec les 7 prochains jours en tableau.
- « Une preuve d'identité vous sera demandée ».
- Case à cocher en gras à partir de « au plus tard… ».

**Codes promo et cartes cadeaux** (migration 0087)
- Le champ « **Code promo ou carte cadeau** » n'existe que sur la page de paiement (/commande).
- **Commande à 0 €** : « Valider ma commande », puis `POST /payments/gratuit`, puis `markOrderPaid(id, "aucun")`. Le montant est recalculé sous verrou.
- **Codes promo** :
  - pourcentage jusqu'à 100 %, option « Offrir aussi la livraison » ;
  - réglage « Réutilisable » ou « Usage unique », avec un compteur.
- **Code de test** `V7X9-KQ4M-Z8WP-3N6R` : 100 %, livraison offerte, réutilisable. Il crée de vraies commandes à 0 €.
- **Page `/carte-cadeau`** :
  - montant libre de 10 à 300 €, pas de port ;
  - destinataire, prénom et petit mot ;
  - code `XXXX-XXXX-XXXX-XXXX` (alphabet sûr, sans O/0 ni I/1) créé au paiement, inscrit au BO, courriel au destinataire ;
  - **solde gardé sur le même code** jusqu'à épuisement.
- **Débit d'une carte cadeau** : dans `markOrderPaid`, sous `SELECT … FOR UPDATE`, pour éviter la double dépense. Annulation ou remboursement : la carte est recréditée.
- **« Mes cartes cadeaux »** dans le compte : codes masqués, soldes, utilisations.

**Plus de /panier sur le site**
- /panier redirige vers /commande. Seule la tablette garde son /panier (`?stand=1`).
- /commande s'ouvre **sans compte** : récapitulatif modifiable. La connexion est demandée seulement au paiement.
- Un spinner masque le contenu jusqu'à ce que la page soit prête, police comprise.
- Les liens de l'en-tête et du pied de page mènent à /commande, sauf au stand.

**BO**
- Pied de page réglable : onglet « Pied de page » de Menu du site (migration 0086).
- Textes légaux dans Réglages.
- Blocs « Ajouter » toujours ouverts.
- Calendrier des stands : non-stop, réglage de plusieurs jours d'un coup, IA avec spinner.

**Site**
- Favicon « ML ».
- Google Tag Manager `GTM-PJ2BFXCB` avec le Consent Mode, **chargé après la page**.
- Bandeau cookies : « Avec votre accord, il mesure aussi son audience et l'efficacité de ses publicités ».
- Newsletter : désabonnement en un clic.

**PageSpeed mobile** (16:19) : SEO 100, accessibilité 100, bonnes pratiques 100, performance 78 (avant Tag Manager différé). L'image de l'accueil : **Alexandra la remplace elle-même** par une plus légère, n'y touchez pas.

**Import Shopify** : prêt et sûr (`apps/api/scripts/import-historique.ts`, procédure dans A-FAIRE). On attend les deux CSV d'Alexandra.

---

## 2. À FAIRE, dans cet ordre

### 2.1 Le STATUT UNIQUE en étapes (le plus important, avant le marché de vendredi 20/11)
**Exigence d'Alexandra** : « il doit y avoir un seul statut ». Sur la fiche commande, plus deux en-têtes « Payée » (bloc paiement) et « Traitée / Non traitée » (bloc remise ou expédition). À la place, **une frise d'étapes** en tête, avec l'étape en cours bien visible et les étapes possibles en boutons. Le détail de l'argent et des remises reste lisible plus bas, sans statut à lui.

**Les parcours** (Alexandra) :
- **Stand** : À encaisser → Payée (« Marquer payée », existe déjà) → À imprimer → Terminée.
  - **Aucun courriel**, la personne est sur place.
  - Annulable **seulement avant le paiement**.
  - « **Marquer comme remis** » doit **DISPARAÎTRE** partout : fiche, liste, actions groupées. Il n'y a plus que « À imprimer » → « Terminée ».
- **Site, livraison** : En préparation (dès le paiement) → Envoyée → Livrée.
  - « Envoyée » envoie l'avis d'expédition existant (`courrierExpediee`, avec le suivi).
  - « Livrée » n'envoie rien.
  - Annulable tant que ce n'est pas envoyé.
- **Site, retrait** (lieu ou retrait au stand) : En préparation → Prête à retirer (courriel `courrierPreteAuRetrait`) → Retirée.
- **Retour en arrière** possible sans courriel, sauf si un bordereau SendCloud a été acheté (refus).
- Sous chaque bouton qui prévient le client, une ligne « Le client recevra : … ». Confirmation seulement si l'action envoie un courriel ou se défait mal. Lisible sur téléphone : Margaux regarde au stand.
- **Commandes reprises de Shopify** (`SHOP-…`) : pas de frise.

**Ce qui EXISTE déjà dans `main`, EN SOMMEIL** (aucun écran ne s'en sert, les boutons actuels gardent leur règle d'avant) :
- `packages/types/src/traitement.ts` : parcours et étapes ;
- la migration `0088` : colonnes `order.ready_at` et `order.delivered_at` ;
- `apps/api/tests/etapes-traitement.test.ts` ;
- dans `apps/api/src/commandes.ts` :
  - la route qui fait passer une commande à une étape ;
  - `etapeDeLaCommande` dans `resumeCommandes` ;
  - le filtre `?etape=` ;
  - `previenirDeLExpedition(…, quoi: "ancien" | "envoyee" | "prete")`, où « ancien » garde la règle d'avant pour les gestes pas encore basculés ;
- dans `apps/api/src/index.ts` : le geste « traitement », refusé aux commandes reprises de Shopify.

**Reste** :
1. Relire ce code et le terminer.
2. **La frise** sur `apps/admin/src/pages/commandes/[id].astro`, à la place des deux en-têtes et des boutons d'expédition et de remise actuels.
3. **La liste** (`apps/admin/src/components/OrderTable.astro`, pour /commandes et /ventes-salon) : une seule colonne « Statut » à la place de « Paiement » et « Traitement », avec les mêmes libellés et couleurs. Les filtres, onglets et compteurs doivent rester justes (« À préparer », « À expédier », « À imprimer (stand) », « Impayées »…). Le bouton « Marquer payée » reste dans la liste pour les ventes du stand.
4. Basculer les anciens gestes (« Expédier », actions groupées) sur les étapes, puis retirer le mode « ancien ».
5. Tests (transitions, courriels, retour arrière, annulation), puis essai au navigateur sur des commandes fictives, puis mise en ligne.

### 2.2 Le module « Ventes des stands en cours » à l'accueil du BO
Dans `apps/admin/src/pages/index.astro`, pour chaque stand actif et non archivé dont la période (`date_debut` et `date_fin`) inclut aujourd'hui à Paris :
- **aujourd'hui** : le nombre de ventes, le montant, et combien restent **à encaisser** ;
- **depuis le début du stand** : le nombre de ventes et le montant.

Hors paniers, annulées et voided. Avec un lien vers Ventes stand, et rien si aucun stand n'est en cours.

### 2.3 L'écran « Code promo / Carte cadeau » du BO
- **« Promotions » RESTE**, pour les promotions AUTOMATIQUES sans code (« 3 achetées = 1 A4 offerte », livraison offerte dès X €). Son écran ne montre plus qu'elles, avec la phrase « Les codes promo se gèrent dans Code promo / Carte cadeau ».
- **L'entrée « Cartes cadeaux » du menu devient « Code promo / Carte cadeau »** (`apps/admin/src/lib/menu.ts`). Son écran réunit les CODES PROMO (`promo_rule` avec code) et les CARTES CADEAUX :
  - **liste** : colonne **Type**, code, valeur, usage, état, et filtres par type ;
  - **création** : choix du TYPE d'abord, puis le formulaire de ce type ;
  - **lecture et modification** : le type en tête.
- **Rien ne se perd** : impression d'une carte, journal, ajustement, désactivation, archivage et restauration, traductions, compteur d'usages, synthèse « ce que la boutique doit encore ». /bo/cartes-cadeaux mène au nouvel écran.

### 2.4 Trois décisions d'Alexandra sur les cartes et les codes (17/11)
1. **Remboursement partiel** d'une commande payée par carte cadeau et carte bancaire : **la carte bancaire d'abord**, puis la carte cadeau. C'est déjà le cas, rien à changer.
2. **Code à usage unique qui n'a rien remisé** (minimum pas atteint) : il **reste utilisable**. Il ne compte comme utilisé que s'il a fait baisser le prix. À CHANGER dans `apps/api/src/promotions.ts` et dans le verrou de `markOrderPaid`, avec un test.
3. **Finances** : le chiffre d'affaires d'une carte cadeau se compte **à l'utilisation**. À la vente, c'est de l'argent encaissé d'avance, une dette, affiché à part (« Cartes cadeaux vendues »). Aujourd'hui, ça compte deux fois. À CHANGER dans `apps/api/src/finances.ts`, avec un test.

### 2.5 Petits restes de la carte cadeau
- **Compte client** (`apps/web/src/pages/[...lang]/compte/commande/[id].astro`) : une commande de cartes seules ne doit dire ni « Expédiée » ni afficher de ligne « Livraison » (« Envoyée par e-mail au destinataire »).
- **Aperçu BO › Courriers** : le courriel de la carte cadeau doit y figurer.
- **Facture** d'une commande payée en partie par carte : « dont carte cadeau : X € » (`composerLaFacture`, dans commandes.ts).
- **Essai Stripe en mode TEST** (clés de test en local, jamais en prod) : une carte de 10 € sur une commande de 15 € + port. L'intention Stripe doit s'ouvrir pour total − 10 € (montant dans la table `payment`). Le paiement normal sans carte a déjà été vérifié ainsi le 17/11.

### 2.6 Ensuite
- **Import Shopify**, dès qu'Alexandra dépose les 2 CSV.
- Relancer PageSpeed après le changement d'image d'Alexandra.
