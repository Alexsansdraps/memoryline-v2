# Mise en production — Memory Line

Le serveur de test (OVH, 51.255.34.187) **devient** la vraie boutique. Rien ne déménage : on enlève ce qui est TEST, on passe les clés en réel, on branche le nom de domaine.

À suivre **dans l'ordre**. Chaque case cochée = fait et vérifié.

> Pour lister les variables du `.env` du serveur **sans afficher les secrets** :
> `ssh debian@51.255.34.187 "grep -oE '^[A-Za-z_]+=' ~/memoryline/.env"`

---

## 0. Avant le jour J (à obtenir de Margaux)

- [ ] **Licence commerciale de la police « Another Shabby »** : la version actuelle est sous licence d'essai, *non commerciale*. Il faut l'acheter (ou que Margaux l'ait déjà), puis remplacer `apps/api/fonts/AnotherShabby-Regular.ttf` et `apps/web/public/fonts/AnotherShabby-Regular.ttf`.
- [ ] **Adresse et SIRET de la boutique** : mentions obligatoires des factures. Ils ne sont pas encore sur les factures, et aucun écran du BO ne permet de les saisir : c'est une correction de code à prévoir.
- [ ] **Pages légales** (BO › Pages) : mentions légales, CGV, confidentialité, cookies. Il reste une dizaine de « À COMPLÉTER » : forme juridique, siège, délai de préparation, durées de conservation, mesure d'audience, crédits.
- [ ] **Comptes Stripe, PayPal Business et Resend** au nom de la boutique, avec accès à l'onglet *Live*.
- [ ] Décision sur les **stands** : quels marchés à venir, et le sort de « Marché de Noël Mulhouse ».

## 1. Mettre la dernière version en ligne

Depuis PowerShell, dans `Documents\perso`, après avoir construit l'archive :

```
scp memoryline-deploiement.tar.gz debian@51.255.34.187:~/ ; ssh debian@51.255.34.187 "tar -xzf ~/memoryline-deploiement.tar.gz -C ~/memoryline apps/api/scripts/mettre-en-ligne.sh && bash ~/memoryline/apps/api/scripts/mettre-en-ligne.sh"
```

Le script fait la sauvegarde, construit, passe les migrations (jusqu'à 0066) et redémarre.

## 2. Vider la base des essais

```
ssh -t debian@51.255.34.187 "cd ~/memoryline && bash apps/api/scripts/vider-donnees-test.sh"
```

Sans argument, le script **montre seulement** : ce qui partira, ce qui restera, les comptes BO et cartes cadeaux à trier. Quand tout est bon, on relance avec `--vider`. Il faut alors taper `VIDER` : le script fait une sauvegarde, puis vide la base.

- **Part** : commandes, paniers et ventes de stand, avec paiements, bordereaux et fichiers d'impression. Partent aussi les clientes créées sur le nouveau site, les générations IA (photos comprises), les inscrites à la lettre, les lettres et les sessions du BO. Le compteur de factures est remis à zéro, pour que la première facture soit **F2026-0001**. Les stands d'essai sont supprimés et **tous les stands fermés**. Les caches d'aperçus et de PDF sont vidés.
- **Reste** : le catalogue, les réglages, les pages, la livraison et les promos. Restent aussi l'historique et les clientes **importés de Shopify**.
- **Archivés** (pas supprimés) : « Femme test », « Mariés (essai) ».
- Les numéros de commande repartent seuls à **WEB-0001** et **SAL-0001**.

⚠️ À faire **avant** l'étape 3 : dès que les vrais courriels partent, la relance de panier écrirait aux adresses de test.

## 3. Le `.env` du serveur : passer en réel

Éditer `~/memoryline/.env` sur le serveur (`nano ~/memoryline/.env`).

### Paiement
| Variable | Test → Production |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` → `sk_live_…` |
| `PUBLIC_STRIPE_KEY` | `pk_test_…` → `pk_live_…` (de la même paire) |
| `STRIPE_WEBHOOK_SECRET` | le `whsec_` du webhook **Live** (voir § 5) |
| `PAYPAL_CLIENT_ID` / `PAYPAL_SECRET` | identifiants de l'application **Live** (developer.paypal.com) |
| `PUBLIC_PAYPAL_CLIENT_ID` | le **même** client-id Live (il est prioritaire : l'oublier enverrait le navigateur en sandbox) |
| `PAYPAL_ENV` | `live`, en minuscules. **Obligatoire même sans PayPal** : sinon l'encadré « mode essai, aucun paiement réel » reste affiché à la caisse |

### Courriels
| Variable | Production |
|---|---|
| `MAIL_TEST_URL`, `MAIL_TEST_PUBLIC_URL` | **à supprimer** (sinon tout reste dans la boîte d'essai Mailpit) |
| `RESEND_API_KEY` | clé Resend de production |
| `MAIL_FROM` | ex. `Memory Line <commandes@memoryline.fr>` (domaine vérifié chez Resend) |
| `MAIL_BOUTIQUE` | adresse de Margaux (avis « nouvelle commande ») |
| `CONTACT_TO` | adresse de Margaux (formulaire de contact) |
| `MAIL_BCC` | adresse de la boutique ou vide, jamais une adresse de test |

### Site et domaine
| Variable | Production |
|---|---|
| `DOMAINE` | `memoryline.fr` |
| `PUBLIC_ORIGIN` | `https://memoryline.fr` (sans `/` final) |
| `COURRIEL_TLS` | une adresse lue par quelqu'un (alertes du certificat) |
| `PUBLIC_NOINDEX` | `false`. **Sinon Google n'indexe rien** : le défaut du serveur est `true` |
| `PUBLIC_JEU_ESSAI` | **à supprimer** (formulaires pré-remplis, compte fictif, bandeau « Site de test ») |
| `APP_SECRET` | une longue chaîne aléatoire (`openssl rand -hex 32`). À poser **avant** le premier vrai courriel, puis **ne plus jamais la changer** : la changer casse les vignettes des courriels déjà envoyés |

### Livraison et IA
| Variable | Production |
|---|---|
| `SENDCLOUD_ACHATS_REELS` | `oui` : chaque bordereau devient **payant**. Seulement sur décision explicite d'Alexandra |
| `SENDCLOUD_PUBLIC_KEY` / `SECRET_KEY` | inchangées (vérifier que c'est le compte de Margaux, pas `essai`) |
| `OPENAI_API_KEY` | inchangée. Conseillé : une clé de projet avec un budget mensuel côté OpenAI |

### À retirer s'ils y sont
`SENDCLOUD_SERVICEPOINTS_URL`, `SENDCLOUD_PANEL_URL`, `OPENAI_BASE_URL`, `NGROK_*`, `SHOPIFY_ADMIN_TOKEN`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`, `CONFIRMER_BASE`, `FAUX_POINTS_PORT`.

### Appliquer
Certaines valeurs sont figées **à la construction** : `PUBLIC_NOINDEX`, `PUBLIC_JEU_ESSAI`, le domaine. Un simple redémarrage ne suffit donc pas. Il faut relancer la mise en ligne (étape 1), ou sur le serveur :

```
cd ~/memoryline && docker compose -f docker-compose.prod.yml build && docker compose -f docker-compose.prod.yml up -d --force-recreate
```

Ensuite, supprimer du serveur les anciennes copies `.env.avant-*`, qui contiennent d'anciens secrets.

## 4. Nom de domaine

- [ ] Chez le registrar de memoryline.fr : enregistrement **A** `memoryline.fr` → `51.255.34.187` (et AAAA si le serveur a une IPv6). **Supprimer les anciens enregistrements Shopify**, sinon le certificat ne s'obtient pas.
- [ ] `www.memoryline.fr` : Caddy ne sert aujourd'hui que le domaine nu. Si le www est utilisé, ajouter une redirection www → memoryline.fr dans `Caddyfile.prod`, et faire pointer le www vers le serveur.
- [ ] Une fois le DNS propagé : `https://memoryline.fr` s'ouvre avec le cadenas (Caddy obtient le certificat tout seul).

## 5. Les comptes des prestataires (onglet *Live*)

- [ ] **Stripe** : créer le webhook `https://memoryline.fr/api/payments/stripe/webhook` avec l'événement `payment_intent.succeeded`, et reporter son `whsec_`. Activer les moyens de paiement. Déclarer `memoryline.fr` dans *Payment method domains* pour Apple Pay et Google Pay.
- [ ] **PayPal** : créer l'application dans l'onglet Live, sur le compte Business vérifié de Margaux. Pour vérifier, sans rien payer :
  `cd ~/memoryline && docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @memoryline/api run verifier:paypal`
- [ ] **Resend** : vérifier le domaine `memoryline.fr` (SPF, DKIM et DMARC dans le DNS) avant d'utiliser une adresse @memoryline.fr.
- [ ] **SendCloud** : vérifier l'adresse d'expédition (Paramètres › Adresses d'expédition, c'est la première qui sert) et le forfait. Vérifier aussi qu'aucun colis d'essai n'est resté ouvert.
- [ ] **OpenAI** : poser un budget mensuel sur la clé.

## 6. Dans le back-office

- [ ] **Comptes** : archiver les comptes de test (le script de l'étape 2 les liste) et créer le compte de Margaux :
  `cd ~/memoryline && docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @memoryline/api run create-admin <email> <motdepasse> owner`
  Changer les mots de passe utilisés pendant les tests.
- [ ] **Stands** : créer les vrais stands avec un **code neuf** (les anciens ont circulé pendant les tests), et n'en laisser aucun ouvert hors marché.
- [ ] **Bandeaux visuels** : supprimer « Essai recette (à supprimer) » s'il existe.
- [ ] **Personnages** : archiver « emond » et « ddd » (Fauteuil roulant) si Margaux confirme que ce sont des essais.
- [ ] **Relance de panier** : faire valider le délai et la base légale par Margaux **avant** d'activer les vrais courriels, car la relance part toute seule.
- [ ] **IA** : faire valider le plafond mensuel (50 € aujourd'hui).
- [ ] **Livraison** : « Retrait sur place » demande d'indiquer son créneau « en commentaire », or la caisse n'a pas de champ commentaire. Changer le texte.
- [ ] **Promotions** : faire confirmer « 3 achetées = 1 A4 offerte » et « Livraison offerte dès 60 € ».
- [ ] **Signature** : déposer le PNG transparent de Margaux (le logo Memory Line sert en attendant).
- [ ] **Vidéo tuto** (BO › Contenu) : déposer la vidéo ou coller son lien. Sans vidéo, la bulle ne s'affiche pas.

## 7. Corrections de code avant l'ouverture

À faire côté développement, avant le jour J :

- [ ] Écran pour saisir **l'adresse et le SIRET** des factures.
- [ ] **Aide du BO** : les rubriques « Comment passer une commande test ? » et « Où arrivent les courriers pendant les tests ? », ainsi que la section de BO › Courriers sur le `.env`, ne doivent s'afficher qu'en mode essai.
- [ ] Caisse : le message « Ajoutez vos clés Stripe et/ou PayPal dans le fichier .env » peut s'afficher à une cliente. Le remplacer par un message neutre.
- [ ] Image de partage par défaut `/og-default.png` : elle est absente, ce qui casse l'aperçu sur les réseaux sociaux.
- [ ] **Plan du site** : vérifier après la construction de prod que `https://memoryline.fr/sitemap-0.xml` contient bien les `/affiches/…`. L'API n'est peut-être pas joignable pendant la construction.
- [ ] **Redirections des anciennes adresses Shopify** (`/products/…`, `/collections/…`) vers les nouvelles : indispensables pour garder le référencement Google.

## 8. Vérifications le jour J

- [ ] `https://memoryline.fr/robots.txt` affiche `Allow: /` et la ligne `Sitemap:` du vrai domaine.
- [ ] `https://memoryline.fr/api/payments/config` répond `"essai": false`.
- [ ] Une **vraie petite commande** par carte, puis remboursée depuis le BO. Une autre par PayPal si PayPal est branché.
- [ ] Le courriel de confirmation arrive dans une vraie boîte, et n'est pas classé en spam.
- [ ] L'avis « nouvelle commande » arrive chez Margaux.
- [ ] La facture sort en **F2026-0001**, avec l'adresse et le SIRET.
- [ ] Le BO › Accueil montre Stripe (et PayPal) branchés, sans badge « essai ».
- [ ] La caisse arrive **vide** (pas de client fictif), et l'inscription n'affiche plus « Site de test ».
- [ ] **Google Search Console** : déclarer le domaine, soumettre `https://memoryline.fr/sitemap-index.xml`.

## 9. Sauvegardes

- [ ] Vérifier que la sauvegarde quotidienne tourne (`ls ~/memoryline/sauvegardes/base`).
- [ ] **Copier les sauvegardes hors du serveur** au moins une fois par semaine. La dernière ligne de `sauvegarder.sh` donne la commande : une copie sur le même disque ne protège pas d'une panne du serveur.
- [ ] Essayer une restauration au moins une fois. Attention : `restaurer.sh`, cité dans `sauvegarder.sh`, n'existe pas encore.
- [ ] Ne **jamais** restaurer une sauvegarde d'avant le vidage : elle ramènerait les essais.
