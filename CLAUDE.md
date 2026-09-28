# Memory Line v2 — à lire avant de toucher quoi que ce soit

Boutique d'affiches personnalisées, refaite sur mesure pour remplacer Shopify.
**Tout s'écrit en français** : l'interface, les noms de variables, et les commentaires —
qui expliquent **pourquoi**, jamais quoi.

## Qui est qui

- **Alexandra** conduit le projet. Elle n'est pas développeuse, elle lit le français, et
  c'est **elle** qui lance les commandes sur sa machine et sur le serveur. Écris-lui en
  français, sans jargon, et donne-lui des commandes prêtes à coller.
- **Margaux** est la propriétaire de la boutique (« la cliente »). Les demandes viennent
  d'elle, par Alexandra, souvent sous forme de cartes Trello.

## Les règles qui ne se discutent pas

1. **Rien ne se supprime, tout s'archive.** Archiver = poser une date, garder le contenu,
   rester visible sous Réglages → Archives, restaurable d'un clic.
   `verifier:archivage` relit toute l'API et **échoue** sur tout `db.delete()` non justifié
   nommément dans `apps/api/scripts/verifier-archivage.mjs`.
2. **Jamais `pnpm`, `node` ou `tsc` sur Windows** : les `node_modules` côté Windows sont
   cassés. Tout tourne **dans les conteneurs**, avec le préfixe `MSYS_NO_PATHCONV=1`.
3. **Ne jamais se connecter au back-office, ne jamais fabriquer de session.** Une route
   `/admin/*` se prouve **au niveau des fonctions**, depuis un script temporaire
   `apps/api/.tmp-xxx.ts` lancé par `npx tsx` dans le conteneur, terminé par
   `process.exit(0)` (sinon le pool de base garde le processus en vie), puis supprimé.
4. **Ne jamais manipuler une clé d'API ni un secret.** Alexandra les saisit elle-même dans
   le back-office. Ne rien lire, ni afficher, ni écrire de `.env`. Si une clé apparaît dans
   une conversation, dis-lui de la régénérer.
5. **Ne jamais appeler une vraie API de transporteur ou de paiement.** Chez SendCloud,
   « annoncer un colis » **l'achète** : ça coûte de l'argent réel. On développe contre le
   faux serveur du dépôt (`apps/api/scripts/faux-sendcloud.ts`).
6. **Ne jamais toucher aux données d'Alexandra** (commandes, produits, personnages,
   clients) : un script de test crée ses propres jeux d'essai et les reprend à la fin.
7. **Aucune commande docker destructrice.** Jamais `docker compose down -v`.
8. **Ne jamais commiter** `.env` ni `data/assets/`. Ne pousser que si elle le demande.

## Démarrer

```bash
docker compose up -d
```

| Quoi | Où |
|---|---|
| Boutique | http://localhost:8080 |
| Back-office | http://localhost:4322/bo |
| API | http://localhost:8080/api |
| Boîte mail d'essai (Mailpit) | http://localhost:8025 |

Conteneurs : `memoryline-api`, `memoryline-web`, `memoryline-admin`, `memoryline-db`,
`memoryline-mailpit`, `memoryline-proxy`. L'API et le site rechargent à chaud.

**Docker n'a qu'environ 3,7 Go** : ne jamais lancer deux installations de dépendances en
même temps (api + web), sinon `ERR_PNPM_ENOMEM`.

## Vérifier

```bash
MSYS_NO_PATHCONV=1 docker exec memoryline-api sh -c "cd /app/apps/api && pnpm typecheck"
```
```bash
MSYS_NO_PATHCONV=1 docker exec memoryline-admin sh -c "cd /app/apps/admin && npx astro check"
```
```bash
MSYS_NO_PATHCONV=1 docker exec memoryline-web sh -c "cd /app/apps/web && npx astro check"
```
```bash
MSYS_NO_PATHCONV=1 docker exec memoryline-web sh -c "cd /app/packages/configurator && pnpm typecheck"
```
```bash
MSYS_NO_PATHCONV=1 docker exec memoryline-api sh -c "cd /app/apps/api && pnpm verifier:archivage"
```
```bash
MSYS_NO_PATHCONV=1 docker exec memoryline-api sh -c "cd /app/apps/api && pnpm verifier:bordereaux"
```

`astro check` sort une vingtaine d'« hints » : ils sont antérieurs, seuls les *errors* comptent.

## Base de données

**La base de développement est distante** (Neon), partagée avec le contenu d'essai
d'Alexandra : tout ce qu'on y écrit, elle le voit. Vérifier ce que vise `DATABASE_URL`
**avant** toute écriture.

Les migrations s'écrivent **à la main** : un fichier SQL dans `apps/api/drizzle/`, son
entrée dans `drizzle/meta/_journal.json`, et son instantané `NNNN_snapshot.json` chaîné sur
le précédent. Sans les deux derniers, le migrateur ne voit jamais le fichier.
**Dernière en place : `0056_bordereaux_transporteur`.**

```bash
MSYS_NO_PATHCONV=1 docker exec memoryline-api sh -c "cd /app && pnpm --filter @memoryline/api db:migrate"
```

Les scripts d'import **vident des tables** : ils demandent confirmation
(`apps/api/scripts/garde-base.ts`). Ne jamais contourner cette garde.

## Conventions à ne pas casser

- **Ordre des calques d'un personnage** : Base → Jean → T-shirt → cheveux → accessoires.
  Une seule liste fait foi, partagée par l'aperçu et l'impression.
- **Couleurs** : classes CSS `.stN` ; *groupes* de couleurs pour les dessins vectoriels,
  *familles* pour les images (PNG/JPG/WEBP), avec conservation des ombres. Le drapeau
  `proposee` décide seul de ce qu'un client a le droit de recolorer.
- **Polices** : la manuscrite « another shabby » est une version d'essai sans chiffres ni
  `€ $ & @ #` — ces caractères basculent en Caveat, par la même fonction à l'écran et à
  l'impression. Ses deux fichiers `.ttf` sont **hors Git** mais doivent voyager dans
  l'archive de déploiement.
- **Heures** : tout s'affiche à l'heure de Paris. Le fuseau est posé dans les deux fichiers
  `docker-compose*.yml` **et** nommé explicitement dans le code (`packages/types/src/fuseau.ts`).
  Ne jamais formater une date sans fuseau.
- **Impression** : le PDF est fabriqué d'avance dès le paiement et mis en cache
  (`data/assets/cache/`). Ne pas le recalculer à la demande.

## Où trouver le reste

`docs/PASSATION.md` : l'état de chaque chantier, la procédure de déploiement, les pièges
déjà rencontrés, et les questions en attente de réponse.
`docs/conception/` : les conceptions détaillées (relance de panier, bordereaux) — lire
avant de reconcevoir quoi que ce soit.
