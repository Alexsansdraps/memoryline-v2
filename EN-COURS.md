# En cours au 17/11 au soir (fusionné dans main et en ligne, sauf ce qui est dit « à faire »)

Ce fichier remplace la branche de travail, supprimée à la demande d’Alexandra : tout est dans `main`.

## 1. Codes promo, cartes cadeaux, commandes à 0 €, /commande sans panier : EN LIGNE le 17/11 (vérifié en local, plus un paiement Stripe normal en mode test)
Vérifications : `tsc` de l'API, 342 tests, astro check du BO à 0 erreur, `tsc` du site (3 erreurs StandSalon, anciennes), configurateur. Essai de bout en bout en local, sans Stripe ni PayPal réels.

**Ce qui est fait :**
- **Le champ « Code promo ou carte cadeau »**, seulement à la caisse ; le panier ne montre plus que les promos automatiques.
- **Commande à 0 €** : « Valider ma commande », puis `POST /payments/gratuit`, puis `markOrderPaid(id, "aucun")`. Le montant est recalculé sous verrou, et la route refuse s'il ne vaut pas exactement 0.
- **Carte cadeau en paiement partiel** :
  - `POST /orders` retient la carte (`gift_card_id`, `gift_card_cents`), sans la débiter ;
  - Stripe ou PayPal reçoivent seulement le reste ;
  - `markOrderPaid` débite la carte sous `SELECT … FOR UPDATE`, ce qui rend la double dépense impossible (testé).
- **Codes promo** :
  - pourcentage jusqu'à 100 % ;
  - « Offrir aussi la livraison » ;
  - réutilisable ou usage unique, avec un compteur au BO.
- **Code de test** `V7X9-KQ4M-Z8WP-3N6R`, inséré par la migration 0087 : 100 %, livraison offerte, réutilisable, priorité 999.
- **La page `/carte-cadeau`**, en 5 langues :
  - montant libre de 10 à 300 €, pas de frais de port ;
  - destinataire, prénom et petit mot ;
  - code au format 4×4 généré au paiement et inscrit au BO, courriel au destinataire ;
  - solde gardé sur le même code.
- **« Mes cartes cadeaux »** dans le compte : codes masqués, soldes, utilisations.
- **Plus de /panier sur le site** : il redirige vers /commande, en 302 (le panier reste au stand, avec `?stand=1`).
  - /commande s'ouvre sans compte : récapitulatif modifiable, puis bloc de connexion au moment de payer.
  - Un spinner masque le contenu jusqu'à ce que la page soit prête.
- **Annulation et remboursement** : la carte est recréditée. Un code à usage unique redevient utilisable. Les cartes achetées par une commande annulée sont désactivées.

**Reste :**
- **F** : l'entrée « Cartes cadeaux » du menu du BO devient « Code promo / Carte cadeau » et réunit les codes promo et les cartes. L'écran « Promotions » ne garde que les promotions SANS code, avec un lien. Idée : sortir le formulaire de promotions.astro en composant.
- **Base.astro** : ses liens mènent encore à `/panier`, qui redirige. Les faire pointer vers `/commande`, sauf au stand.
- **À décider avec Alexandra** :
  - ordre d'un remboursement partiel : le prestataire d'abord, puis la carte (le choix fait) ;
  - un code à usage unique qui n'a rien remisé compte-t-il comme utilisé ?
  - la présentation des cartes dans Finances : la vente de la carte puis sa dépense comptent deux fois.
- **Détails** :
  - dans le compte, une commande de cartes seules affiche « Expédiée » et une ligne « Livraison » ;
  - le courriel de la carte n'est pas dans l'aperçu BO › Courriers ;
  - la facture ne dit pas « dont carte cadeau ».
- **AVANT LA MISE EN LIGNE** : un essai Stripe en mode test d'un paiement partiel par carte, c'est-à-dire avec un vrai appel au prestataire. Les migrations 0087 et 0088 partent avec la mise en ligne.

Scripts d'essai, dans le scratchpad de la session (perdu au redémarrage) : `essai-cartes.mjs`, `essai-navigateur.mjs`, `essai-menage.mjs`.

## 2. États de traitement en étapes et module des stands à l'accueil : INTERROMPU (le code de l'API est en ligne mais en sommeil : aucun écran ne s'en sert encore, et les boutons actuels gardent leur règle d'avant)

**EXIGENCE (Alexandra, 17/11, 16 h 30) : UN SEUL STATUT par commande.** Sur la fiche, il ne doit plus y avoir deux en-têtes « Payée » (bloc paiement) et « Traitée » (bloc remise ou expédition). Un seul statut dit où en est la commande dans SON parcours : la frise ci-dessous, avec l’étape en cours. Il en va de même dans la liste du BO : une seule colonne « Statut » au lieu de « Paiement » et « Traitement », avec les filtres adaptés. Le détail des mouvements d’argent et des remises reste lisible plus bas, mais sans statut à lui.
Les parcours voulus, définis par Alexandra :
- **Stand** : À encaisser → Payée (« Marquer payée ») → À imprimer → Terminée. Aucun courriel. Annulable seulement avant le paiement.
- **Site livré** : En préparation → Envoyée (courriel « en route ») → Livrée. Annulable tant que la commande n'est pas envoyée.
- **Site en retrait** : En préparation → Prête à retirer (courriel « vous attend ») → Retirée.
- **Présentation** : une frise d'étapes cliquable, « Marquer comme remis » supprimé. Retour en arrière sans courriel, sauf si un bordereau a été acheté.
- **Accueil du BO** : pour chaque stand dont les dates incluent aujourd'hui, les ventes du jour (nombre, montant, à encaisser) et le total depuis le début.

**Où on en est :**
- Déjà écrits : `packages/types/src/traitement.ts`, la migration `0088_etapes_de_traitement.sql`, `apps/api/tests/etapes-traitement.test.ts`, et des morceaux de l'API et du BO.
- L'agent s'est arrêté en train d'ajouter « traitement » aux gestes refusés aux commandes reprises de Shopify (`GESTES_REFUSES_AUX_REPRISES`, index.ts), avant d'écrire les tests.
- À relire entièrement, compiler, tester et finir. Le module de l'accueil n'est sans doute pas commencé.
