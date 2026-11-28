# Affiche éphémère du stand de Mulhouse — plan d'exécution

Plan écrit dans la nuit du 27 au 28/11 pour l'agent de réalisation. Tout se fait en LOCAL (site http://localhost:8080, BO http://localhost:4322/bo, conteneurs memoryline-api et memoryline-db18). Pas de prod, pas de commit : l'agent principal s'en charge.

Garde-fous, valables à chaque étape :
- Aucun des fichiers interdits n'est touché par ce plan : packages/types/src/*, apps/api/src/pdf.ts, apps/api/src/fichiers-impression.ts, apps/api/src/couleurs-image-fichier.ts. Si une étape semble l'exiger, s'arrêter et le dire.
- Logique de commande intacte : aucune modification des routes de panier, de la caisse, du paiement, des factures, du stand-caisse ni des données de commandes. Les seuls fichiers du site qui dessinent un panier (CartIsland, CheckoutIsland) ne changent pas : ils profitent du nouveau PosterPreview sans qu'on y touche.
- Base : écriture seulement par la migration neuve, appliquée sur memoryline-db18. Lectures psql libres. Ne jamais lire ni afficher de .env. Pas de mot de passe, pas de compte BO.
- Ne pas toucher à travaux/personnages-unifies/ (chantier garde-robe en parallèle). Fichiers temporaires du conteneur : /tmp/stand-mulhouse-*.
- Éditer avec l'outil Edit, ou avec des scripts Python écrits dans un fichier (pas de heredoc bash pour du texte avec guillemets).

## 1. L'architecture retenue

1. **Le motif est un « personnage » d'un jeu de motifs.** Un type d'affiche réservé `motifs-alsace` (« Motifs du stand (Alsace) », décoché : il n'est proposé à aucun client comme type d'affiche), sept catégories de personnages neuves (les rayons du choix, dans l'ordre demandé), et 28 motifs (47 avec motifs-3). Margaux range, renomme, traduit, masque et ajoute des motifs dans BO › Personnages, sans code.
2. **Le produit est une affiche personnalisable ordinaire, de face** (`default_view = 'front'`) : mêmes personnages, même étape, mêmes réglages qu'ailleurs. Deux colonnes neuves sur `product` : `vue_motifs` (le jeu de motifs que la fiche propose ; vide = affiche classique) et `stand_id` (le stand de rattachement ; vide = affiche ordinaire).
3. **Le motif choisi voyage dans `config.characters`**, en tête (position 0), avec un x/y/scale calculé par le module. pdf.ts, le panier, la caisse, les aperçus serveur et les courriels le dessinent comme un personnage : rien à changer chez eux.
4. **Texte en bas** : chaque ligne remplie porte `x = 0,5` et `y` (son centre). pdf.ts pose déjà ces lignes (buildTextSvg, l. 1031). PosterPreview apprend à les dessiner (panier et caisse suivent). Texte en haut : l'empilement d'aujourd'hui, sans x/y, donc empreinte des affiches existantes inchangée.
5. **Les fonds sont de vrais fichiers SVG** générés (8 unis, 6 dégradés, 5 motifs répétés), rangés comme des fonds normaux et rattachés au produit. Margaux en ajoute ou en archive dans la fiche produit › Visuels, comme d'habitude.
6. **Le stand** : une condition SQL unique, `enVente()`, remplace `status = 'active'` partout où une affiche est listée ou ouverte. Une affiche dont le stand est désactivé, archivé, supprimé ou dont le dernier jour est passé disparaît d'elle-même : fiche en 404, rayons, recherche, page du stand, plan du site. Un stand fermé pour la nuit ne change rien. Un panier qui la contient déjà n'est pas touché.
7. **La collection « Marché de Noël de Mulhouse »** est une collection ordinaire. Vidée par le stand, elle sort seule du site (menu des rayons, plan du site, page du rayon en 404) ; Margaux peut aussi la décocher ou l'archiver au BO.

Option écartée pour le motif : en faire un fond (il faut deux choix, pas de recoloration ni de centrage), ou un décor d'avant-plan (un produit par motif, invisible sans personnage, calé en bas).

## 2. Ordre d'exécution

0. Captures « avant » de deux affiches classiques (G9), avant tout changement de code.
A. Fichiers : motifs, fonds, migration générée. Aucune écriture en base.
B. Migration appliquée en local. **Avant** toute modification de schema.ts : sinon l'API, rechargée par tsx watch, sélectionne des colonnes absentes et tombe.
C. API. D. Configurateur. E. Site. F. BO. G. Vérifications. H. Visuels de la fiche. I. Bilan et liste des fichiers pour la prod.

## 3. Étape A — fichiers

### A1. Les motifs et leur classement (« tu les classes en plus pour les clients »)

Sources : `travaux/affiche-stand-mulhouse/motifs/` (28 SVG, `index.json`, `categories.json`) et `travaux/affiche-stand-mulhouse/motifs-3/` (19 SVG à l'heure du plan, planches 3 à 5, découpés par un autre agent ; `index.json` sans `nom` ni `zones_noms` : prendre `noms.fr`).

**motifs-3 est intégré seulement s'il est complet** : chaque entrée a `id`, `fichier`, `categorie` parmi les 7 ids de categories.json, `noms` dans les 7 langues (non vides), `zones` avec `st0` ; le fichier existe, se lit en XML, a un `viewBox` ; aucun `id` en double avec motifs/ ; aucun fichier de motifs-3 modifié depuis moins de 10 minutes (l'autre agent a fini). Sinon : seulement les 28, et la procédure du § 13.

Rangement (ordre des onglets du client), catégories de personnages créées par la migration :

| position | slug | nom (fr) | motifs, dans l'ordre |
|---|---|---|---|
| 100 | motifs-mulhouse | Mulhouse | hotel-de-ville, temple-saint-etienne, tour-de-l-europe, tour-bollwerk, tour-ronde, klapperstein, chapelle, maisons-ouvrieres |
| 101 | motifs-textile-musees | Textile et musées | usine-textile, metier-a-tisser, tampon-textile, bobine-et-tissu, tissu-fleuri, locomotive, voiture-ancienne |
| 102 | motifs-strasbourg-colmar | Strasbourg et Colmar | (motifs-3) cathedrale-strasbourg, petite-france, ponts-couverts, tram-strasbourg, petite-venise |
| 103 | motifs-maisons-alsace | Maisons d'Alsace | maisons-alsaciennes, puis (motifs-3) maison-tourelle, maison-colombages, maison-pignon-redents |
| 104 | motifs-noel | Noël | chalet-de-noel, sapin, etoile, lanterne, couronne-avent, poinsettia, puis (motifs-3) couronne-bougies, coeur-vichy, maison-enneigee, boule-de-noel, bougie-de-noel |
| 105 | motifs-gourmandises | Gourmandises | bonhomme-pain-epice, coeur-pain-epice, kougelhopf, bretzel, puis (motifs-3) bredele, coeur-cigognes, vin-chaud |
| 106 | motifs-alsace | Alsace | cigogne, vignoble, puis (motifs-3) cigogne-debout, grappe-raisin, noeud-alsacien |

Libellés traduits : `categories.json` (7 langues). Corriger `mulhouse` en japonais et en chinois : ミュルーズ / 米卢斯 (comme la page 0101). La catégorie Strasbourg et Colmar est créée même vide : un onglet sans motif ne s'affiche pas chez le client.

Deux noms en double à corriger (sinon deux vignettes et deux lignes 1 identiques) :
- `cigogne` (sur son nid) → fr « Cigogne sur son nid », en « Stork on its nest », de « Storch im Nest », it « Cicogna sul nido », es « Cigüeña en su nido », ja 「巣の上のコウノトリ」, zh「巢中的白鹳」.
- `couronne-bougies` → fr « Couronne aux bougies », en « Wreath with candles », de « Kranz mit Kerzen », it « Corona con candele », es « Corona con velas », ja「キャンドルのリース」, zh「蜡烛花环」.

Fichiers : copier chaque `motif-<id>.svg` vers `data/assets/motif-alsace-<id>-v1.svg` ET vers `travaux/affiche-stand-mulhouse/assets-prod/` (même nom). Le SVG est copié tel quel (classes .stN déjà au format de recolorSvg). **Ne jamais réutiliser un nom avec un autre contenu** : /assets est servi « immutable » et les vignettes ?l= sont gardées par nom dans data/assets/tailles. Un motif corrigé plus tard = un fichier `-v2` et une nouvelle migration (UPDATE de `base_svg_url`).

Contrôle : `curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/assets/motif-alsace-hotel-de-ville-v1.svg?l=400"` rend 200 ; planche de contrôle `captures/planche-motifs-api.jpg` assemblée (PIL) depuis les webp `?l=400` de tous les motifs (c'est ce que voit le client).

### A2. Les fonds

Script rejouable `travaux/affiche-stand-mulhouse/fonds/generer_fonds.py`. Il écrit 19 fichiers `fond-noel-<id>-v1.svg` (`width="1000" height="1414" viewBox="0 0 1000 1414"`, la proportion A4/A3) et `fonds/index.json` `[{id, fichier, nom, genre, position}]`. Rien d'autre que `rect`, `linearGradient` vertical et `pattern` en `patternUnits="userSpaceOnUse"` : ni filtre, ni image, ni texte, ni référence externe. L'impression (pdf.ts) et l'aperçu (l'API convertit le SVG en webp avec ?l=1400) passent tous deux par sharp/librsvg : ce qu'on voit est ce qu'on imprime.

| position | id | nom (BO, infobulle) | dessin |
|---|---|---|---|
| 0 | uni-rouge-noel | Rouge Noël (uni) | #A4161A |
| 1 | uni-vert-sapin | Vert sapin (uni) | #1F4D3A |
| 2 | uni-bleu-nuit | Bleu nuit (uni) | #1B2A4A |
| 3 | uni-bordeaux | Bordeaux (uni) | #6B1F2A |
| 4 | uni-creme | Crème (uni) | #F4ECDD |
| 5 | uni-ocre | Ocre (uni) | #E2B659 |
| 6 | uni-rose-saumon | Rose saumon (uni) | #E8A598 |
| 7 | uni-bleu-ciel | Bleu ciel (uni) | #CFE3EE |
| 8 | degrade-nuit-d-hiver | Nuit d'hiver (dégradé) | #0E1A33 en haut → #36598C en bas |
| 9 | degrade-braise | Braise (dégradé) | #6E0F17 → #C0392B |
| 10 | degrade-foret | Forêt (dégradé) | #10382A → #2F6B4F |
| 11 | degrade-crepuscule | Crépuscule (dégradé) | #28224C → #C46B6B |
| 12 | degrade-neige | Neige (dégradé) | #FFFFFF → #D9E6EF |
| 13 | degrade-aube | Aube rosée (dégradé) | #F5D3C6 → #FBF4EA |
| 14 | repete-flocons | Flocons | flocons blancs à six branches (trait arrondi) sur #1B2A4A, tuile 125, flocons décalés d'une demi-tuile |
| 15 | repete-vichy-rouge | Vichy rouge | bandes rouges #A4161A à 45 % d'opacité croisées sur #F4ECDD |
| 16 | repete-etoiles | Étoiles dorées | petites étoiles #D4A73B (deux tailles) sur #8E1B1F |
| 17 | repete-coeurs | Cœurs alsaciens | petits cœurs #B3262E sur #F4ECDD |
| 18 | repete-pois-neige | Pois de neige | pois blancs sur #1F4D3A |

Le premier fond (Rouge Noël) est celui que le module présélectionne à l'ouverture : le texte blanc par défaut et le motif anthracite à intérieurs crème y restent lisibles. Copie vers `data/assets/` et `assets-prod/` ; planche de contrôle `captures/planche-fonds.jpg` depuis `?l=400`.

### A3. La migration, générée par script

Script `travaux/affiche-stand-mulhouse/generer_migration.py` :
1. Relit la FIN de `apps/api/drizzle/meta/_journal.json` juste avant d'écrire. Au moment du plan, la dernière entrée est idx 120, `0120_ciel_theme_noel`, when 1795300000000. Le chantier garde-robe peut en avoir ajouté une : prendre idx = dernier + 1, when = plus grand when + 10000000, tag `0<idx>_affiche_stand_mulhouse` (en principe `0121_affiche_stand_mulhouse`, when 1795310000000). Ajoute l'entrée `{idx, version: "7", when, tag, breakpoints: true}` en DERNIER, même mise en forme que le fichier.
2. Écrit `apps/api/drizzle/<tag>.sql` en UTF-8 (fins de ligne LF), une instruction par bloc séparé par `--> statement-breakpoint`, apostrophes doublées dans les chaînes SQL, JSON produit par `json.dumps(..., ensure_ascii=False)`.
3. Copie les fichiers de A1 et A2 (data/assets et assets-prod).
4. Option `--motifs-seulement --tag <tag>` pour le § 13 : n'écrit que les motifs manquants.

Contenu, dans cet ordre, chaque instruction rejouable (deux passages = un seul effet). Viser les lignes par slug, jamais par id :

```sql
-- En-tête : ce que fait la migration, pourquoi (demandes d'Alexandra du 27/11), et
-- « copier les fichiers de travaux/affiche-stand-mulhouse/assets-prod dans data/assets AVANT ».

ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "vue_motifs" text;--> statement-breakpoint
-- Sans clé étrangère, exprès : un stand supprimé doit laisser l'affiche cachée
-- (la règle échoue fermée), pas la remettre en vente comme « on delete set null ».
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "stand_id" integer;--> statement-breakpoint

INSERT INTO "poster_view" ("slug", "name", "foreground_url", "active", "position")
VALUES ('motifs-alsace', 'Motifs du stand (Alsace)', NULL, false, 90)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

INSERT INTO "character_category" ("slug", "name", "position", "translations") VALUES
  ('motifs-mulhouse', 'Mulhouse', 100, '{"en":{"name":"Mulhouse"},"de":{"name":"Mulhouse"},...,"ja":{"name":"ミュルーズ"},"zh":{"name":"米卢斯"}}'::jsonb),
  ... (les 7)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

INSERT INTO "character_type" ("slug", "name", "translations", "category_id", "orientation", "position",
  "base_svg_url", "base_color_zones", "bottom_pct", "facteur_taille", "decalage_x", "active")
SELECT v.slug, v.nom, v.trad::jsonb, cc."id", 'motifs-alsace', v.pos, v.url, v.zones::jsonb, 1, 1, 0, true
FROM (VALUES
  ('motif-hotel-de-ville', 'Hôtel de ville', '{"en":{"name":"Town Hall"},...}', 'motifs-mulhouse', 0,
   '/assets/motif-alsace-hotel-de-ville-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ... (un motif par ligne, `position` = rang dans sa catégorie)
) AS v(slug, nom, trad, cat, pos, url, zones)
JOIN "character_category" cc ON cc."slug" = v.cat
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
-- base_groupes_couleurs, base_zones_proposees, slot_variants, default_assets : NULL.

INSERT INTO "collection" ("slug", "name", "description", "position", "active", "translations")
VALUES ('marche-de-noel-de-mulhouse', 'Marché de Noël de Mulhouse',
  'Les affiches du stand Memory Line au marché de Noël de Mulhouse, proposées le temps du marché.',
  (SELECT coalesce(max("position"), 0) + 1 FROM "collection"), true, '{...7 langues...}'::jsonb)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
-- (Pas de « INSERT … SELECT max() … WHERE NOT EXISTS » : un agrégat sans GROUP BY rend
--  une ligne même quand le WHERE écarte tout, et l'insertion se ferait quand même.)

INSERT INTO "product" ("slug", "name", "description", "kind", "default_view", "foreground_url",
  "default_title", "default_subtitle", "default_line3", "base_price_cents", "weight_grams",
  "vendor", "product_type", "status", "translations", "vue_motifs", "stand_id")
SELECT 'mulhouse-marche-de-noel-affiche-personnalisee',
  'MULHOUSE Marché de Noël - Affiche personnalisée', '<description fr, § 9>',
  'personnalisable', 'front', NULL,
  NULL, 'Marché de Noël de Mulhouse', NULL,
  p."base_price_cents", p."weight_grams", p."vendor", p."product_type",
  CASE WHEN s."id" IS NULL THEN 'draft' ELSE 'active' END,
  '<traductions nom + description, § 9>'::jsonb, 'motifs-alsace', s."id"
FROM "product" p
LEFT JOIN LATERAL (
  SELECT st."id" FROM "stand" st JOIN "page" pg ON pg."id" = st."page_id"
  WHERE pg."slug" = 'mulhouse' AND st."archived_at" IS NULL
  ORDER BY st."id" LIMIT 1
) s ON true
WHERE p."slug" = 'mulhouse-hotel-de-ville-affiche-personnalisee'
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
-- Le stand est trouvé par sa page (« mulhouse », 0101), jamais par son code (il ouvre la
-- tablette, il n'a rien à faire dans le dépôt). Pas de stand trouvé : brouillon, jamais
-- une affiche en vente pour toujours.

INSERT INTO "variant" ("product_id", "format", "price_cents", "width_mm", "height_mm", "weight_grams",
  "compare_at_cents", "cost_cents", "stock_qty", "stock_policy", "sku")
SELECT c."id", v."format", v."price_cents", v."width_mm", v."height_mm", v."weight_grams",
  v."compare_at_cents", v."cost_cents", v."stock_qty", v."stock_policy",
  'ML-MULHOUSE-MARCHE-DE-NOEL-' || v."format"
FROM "variant" v
JOIN "product" p ON p."id" = v."product_id" AND p."slug" = 'mulhouse-hotel-de-ville-affiche-personnalisee'
JOIN "product" c ON c."slug" = 'mulhouse-marche-de-noel-affiche-personnalisee'
WHERE NOT EXISTS (SELECT 1 FROM "variant" WHERE "product_id" = c."id");--> statement-breakpoint

INSERT INTO "product_collection" ("product_id", "collection_id", "position")
SELECT p."id", c."id", 0 FROM "product" p, "collection" c
WHERE p."slug" = 'mulhouse-marche-de-noel-affiche-personnalisee' AND c."slug" = 'marche-de-noel-de-mulhouse'
ON CONFLICT ("product_id", "collection_id") DO NOTHING;--> statement-breakpoint

INSERT INTO "product_image" ("product_id", "url", "alt", "position")
SELECT p."id", v.url, v.alt, v.pos FROM "product" p, (VALUES
  ('/assets/mulhouse-marche-de-noel-exemple-1-v1.jpg', 'Affiche du marché de Noël de Mulhouse : maisons alsaciennes colorées, texte en bas', 0),
  ('/assets/mulhouse-marche-de-noel-exemple-2-v1.jpg', 'Affiche du marché de Noël de Mulhouse : l''hôtel de ville sur un fond de nuit d''hiver', 1)
) AS v(url, alt, pos)
WHERE p."slug" = 'mulhouse-marche-de-noel-affiche-personnalisee'
  AND NOT EXISTS (SELECT 1 FROM "product_image" WHERE "product_id" = p."id");--> statement-breakpoint

INSERT INTO "background" ("product_id", "url", "name", "position")
SELECT p."id", v.url, v.nom, v.pos FROM "product" p, (VALUES
  ('/assets/fond-noel-uni-rouge-noel-v1.svg', 'Rouge Noël (uni)', 0), ... (les 19)
) AS v(url, nom, pos)
WHERE p."slug" = 'mulhouse-marche-de-noel-affiche-personnalisee'
  AND NOT EXISTS (SELECT 1 FROM "background" WHERE "product_id" = p."id");--> statement-breakpoint

-- La page de la tablette : un bloc d'affiches EN TÊTE, avec cette seule affiche. Le bloc
-- existant porte déjà 200 références, le plafond de cms.ts (LIMITE_PRODUITS_MAX) : y
-- ajouter la nouvelle en ferait tomber une. Garde-fous : une seule fois, et seulement si
-- la page n'a pas de blocs traduits (fusionnerBlocs les aligne par rang).
UPDATE "page" pg
SET "blocks" = jsonb_build_array(jsonb_build_object(
      'type', 'produits', 'source', 'affiches', 'reference', p."id"::text,
      'references', jsonb_build_array(p."id"::text), 'limite', 1)) || pg."blocks",
    "updated_at" = now()
FROM "product" p
WHERE pg."slug" = 'mulhouse'
  AND p."slug" = 'mulhouse-marche-de-noel-affiche-personnalisee'
  AND jsonb_typeof(pg."blocks") = 'array'
  AND NOT (pg."blocks" @> jsonb_build_array(jsonb_build_object('references', jsonb_build_array(p."id"::text))))
  AND NOT jsonb_path_exists(coalesce(pg."translations", '{}'::jsonb), '$.*.blocks');
```

Les deux visuels de la fiche n'existent pas encore : ils sont produits à l'étape H, depuis deux lignes de panier. D'ici là, la fiche locale montre une image cassée ; c'est attendu.

## 4. Étape B — migration locale

```bash
# La base du conteneur est bien la locale (affiche seulement « ok », jamais l'adresse) :
docker exec memoryline-api sh -c 'case "$DATABASE_URL" in *@db18:*) echo ok;; *) echo ARRET;; esac'
# Sans --env-file : l'environnement du conteneur vise memoryline-db18.
docker exec -w /app/apps/api memoryline-api npx tsx src/db/migrate.ts
```

Contrôles (lecture seule, `docker exec memoryline-db18 psql -U memoryline -d memoryline -c ...`) : 1 poster_view `motifs-alsace` ; 7 catégories `motifs-%` ; 28 (ou 47) `character_type` en orientation `motifs-alsace` ; la collection ; le produit (`status = 'active'`, `stand_id = 1`, `vue_motifs = 'motifs-alsace'`, `default_view = 'front'`) ; 2 variantes A4 2300 / A3 2900 ; 2 images ; 19 fonds ; la page `mulhouse` a 2 blocs, le premier ne référence que le nouveau produit.

Rejouabilité, sans rien écrire (transaction annulée) :

```bash
( echo 'BEGIN;'; sed 's/--> statement-breakpoint//' apps/api/drizzle/0121_affiche_stand_mulhouse.sql; echo 'ROLLBACK;' ) \
  | docker exec -i memoryline-db18 psql -U memoryline -d memoryline -v ON_ERROR_STOP=1
```

Attendu : les ALTER passent avec « already exists, skipping », chaque INSERT dit `INSERT 0 0`, l'UPDATE `UPDATE 0`.

## 5. Étape C — API (apps/api)

**C1. `src/db/schema.ts`**, table `products` (après `foregroundUrl`) :

```ts
/** Le jeu de motifs que la fiche propose (slug d'un type d'affiche « motifs-… », 28/11). Vide : affiche classique. */
vueMotifs: text("vue_motifs"),
/**
 * Le stand de rattachement (28/11, Alexandra : « le produit doit disparaître quand le
 * stand sera clôturé »). Proposée tant que ce stand est en service (affiches-de-stand.ts).
 * Sans clé étrangère, exprès : un stand supprimé laisse l'affiche cachée.
 */
standId: integer("stand_id"),
```

**C2. Nouveau `src/affiches-de-stand.ts`** : la règle, en un seul endroit.

```ts
import { and, eq, sql, type SQL } from "drizzle-orm";
import { jourAParis, jourValide } from "@memoryline/types";
import { db, schema } from "./db/client.js";

/** Vrai pour une affiche sans stand, ou dont le stand est en service : activé,
 *  non archivé, dernier jour (à Paris) pas encore passé. Ouvert ou fermé n'y fait
 *  rien. Un stand introuvable cache l'affiche. */
export function standEnService(maintenant: Date = new Date()): SQL {
  const jour = jourAParis(maintenant);
  return sql`(${schema.products.standId} is null or exists (select 1 from ${schema.stands} s
    where s.id = ${schema.products.standId} and s.actif = true and s.archived_at is null
    and (s.date_fin is null or s.date_fin !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or s.date_fin >= ${jour})))`;
}

/** Ce que le site propose : « active », et son stand en service s'il en a un. */
export function enVente(maintenant?: Date): SQL {
  return and(eq(schema.products.status, "active"), standEnService(maintenant))!;
}

/** Cette affiche est-elle proposée côté stand (sans regarder son statut) ? Sert à la fiche et au script G2. */
export async function standDuProduitEnService(id: number, maintenant?: Date): Promise<boolean> {
  const [ligne] = await db.select({ id: schema.products.id }).from(schema.products)
    .where(and(eq(schema.products.id, id), standEnService(maintenant)));
  return !!ligne;
}

export type EtatStand = "en-service" | "desactive" | "archive" | "termine";
/** La même règle, pour l'affichage du BO. */
export function etatDuStand(
  s: { actif: boolean; archivedAt: Date | string | null; dateFin: string | null },
  maintenant = new Date(),
): EtatStand {
  if (s.archivedAt) return "archive";
  if (!s.actif) return "desactive";
  if (jourValide(s.dateFin) && s.dateFin < jourAParis(maintenant)) return "termine";
  return "en-service";
}
```

La fin se compte au jour (l'affiche part à minuit après le dernier jour), comme la liste « Stands en cours » de l'accueil du BO (salon.ts, l. 657).

**C3. Partout où une affiche est listée** : remplacer `eq(schema.products.status, "active")` par `enVente()` (import depuis `./affiches-de-stand.js`) :
- `src/index.ts` : l. 787 (`/villes`), l. 837 (`/products` : catalogue, rayons, recherche ?q=, recherche instantanée), l. 870 (candidats du filtre par ville), l. 1023 (jointure de `/collections` : un rayon vidé par le stand sort du menu).
- `src/cms.ts` : l. 924 (`produitsDuneReference`), l. 960 (`affichesChoisiesEnVente` : page du stand, tablette, `pageDeLaTablette`).
- `src/maillage.ts` : l. 128, 210, 216 (rayon du fil d'Ariane et affiches voisines).
- `src/plan-du-site.ts` : l. 43, 65, 107 (fiches, rayons, visuels).

Non touchés, exprès : les écrans du BO (ordre-affichage, redirections-ecran, produits-masse…), ia-reutiliser (affiches IA), affiches-demo, GET /backgrounds (un panier rouvert doit retrouver ses fonds).

**C4. La fiche, `src/index.ts`, `GET /products/:slug`** (après la vérification du statut, l. 1076) :

```ts
// Stand désactivé, archivé, supprimé ou terminé : l'affiche n'existe plus pour le site.
if (brut.standId != null && !(await standDuProduitEnService(brut.id))) return c.notFound();
```

et dans le JSON renvoyé, à côté de `foregroundUrl` : `vueMotifs: product.vueMotifs ?? null,`.

**C5. BO, `src/configurator-routes.ts`** :
- `GET /admin/products/:id/config` (l. 6158) renvoie en plus `vueMotifs`, `standId` et `stands: { id, nom, dateFin, etat }[]` (tous les stands, archivés compris, `etat` par `etatDuStand`), triés par nom.
- `POST /admin/products/:id/config` (l. 6190) accepte `vueMotifs` (vide → null, sinon `await typeAfficheValide(b.vueMotifs)`) et `standId` (vide ou null → null ; sinon le stand doit exister, sinon 400 « Ce stand n'existe plus. Rechargez la page. »).

Facultatif : `src/fiche-produit.ts`, duplication (l. 317) : reprendre `vueMotifs` et `standId` de la source.

Puis `npx tsc --noEmit -p .` dans apps/api.

## 6. Étape D — configurateur (packages/configurator/src)

### D1. Nouveau `mise-en-page-motif.ts` (fonctions pures, imports @memoryline/types seulement, types par `import type` depuis ./store)

Toutes les mesures en fraction de la HAUTEUR de l'affiche (portrait, H = √2·W), sauf mention.

```ts
export const ECART_BLOCS = 0.025;      // entre texte, motif et personnages (~7 mm sur un A4)
export const LARGEUR_MAX_MOTIF = 0.8;  // en fraction de la LARGEUR
const PLACE_MINI = 0.15;
// Les pieds d'un personnage seul : centre Y_SOL_PERSONNAGES + demi-cadre à l'échelle 0,7 (≈ 0,925)
const PIEDS = Y_SOL_PERSONNAGES + (LARGEUR_CADRE_PERSONNAGE * ECHELLE_PERSONNAGE_SEUL * Math.SQRT2) / 2;

// Taille d'une ligne (rang parmi les lignes REMPLIES, comme pdf.ts) en fraction de H :
//   tailleDeLigne(rang) * facteurTailleLigne(l.taille) / Math.SQRT2
// Police : policeParId(l.font, rang === 0 ? POLICE_TITRE_DEFAUT : POLICE_SOUSTITRE_DEFAUT)
// Hauteur d'une ligne pour un interligne donné : somme, sur sousLignes(l.value), de
//   boiteDeLigne([police, ...morceauxDeTexte(s, police).map((m) => m.police)], interligne).hauteur × taille
export function hauteurTexteEnHaut(lignes: LigneTexte[]): number;
//   Σ espaceAvantLigne(i)·taille_i + hauteur(l_i, interligneDeLigne(i))  — l'empilement de pdf.ts
export function placesTexteEnBas(lignes: LigneTexte[]): { x: number; y: number }[];
//   bloc posé (INTERLIGNE_LIGNE_POSEE), écarts espaceAvantLigne(i)·taille_i entre lignes,
//   bas du bloc à 1 - HAUT_DU_TEXTE ; y = centre de chaque ligne, x = 0,5, arrondis à 4 décimales
export function hauteurTexteEnBas(lignes: LigneTexte[]): number;
export function decalagePersonnages(lignes: LigneTexte[], enBas: boolean): number;
//   0 en haut ou sans ligne ; sinon min(0, (1 - HAUT_DU_TEXTE - hauteurTexteEnBas - ECART_BLOCS) - PIEDS)
export function proportionDuSvg(svg: string | undefined): number | null;  // viewBox → hauteur / largeur
export function placementDuMotif(o: {
  lignes: LigneTexte[]; enBas: boolean;
  hautsPersonnages: number[];   // haut du DESSIN de chaque personnage, décalage compris
  proportion: number;           // hauteur / largeur du motif (1 tant que le SVG n'est pas chargé)
  facteur?: number;             // facteurTaille du BO, borné à [0,3 ; 1] : il ne peut que réduire
}): { x: number; y: number; scale: number };
```

`placementDuMotif` :
- haut de la place = `enBas ? HAUT_DU_TEXTE : HAUT_DU_TEXTE + hauteurTexteEnHaut + ECART_BLOCS` ;
- bas libre = `enBas ? 1 - HAUT_DU_TEXTE - hauteurTexteEnBas - ECART_BLOCS : 1 - HAUT_DU_TEXTE` ;
- bas = avec des personnages, `min(bas libre, min(hautsPersonnages) - ECART_BLOCS)` ;
- place = `max(PLACE_MINI, bas - haut)` ;
- largeur (fraction de W) = `min(LARGEUR_MAX_MOTIF, place·√2 / proportion) × facteur` ;
- résultat `{ x: 0.5, y: haut + place/2, scale: largeur / LARGEUR_CADRE_PERSONNAGE }`, arrondis à 4 décimales.

Vérification de cohérence (aucun changement de pdf.ts) : pdf.ts pose la couche à la largeur `0,22 × scale × W = largeur × W`, hauteur proportionnelle au SVG, centrée en (x·W, y·H), `bottom_pct = 1` (aucune descente). L'aperçu pose une boîte 1:2 de même largeur, centrée au même point, où le SVG se centre (« meet ») : même place tant que hauteur/largeur ≤ 2 (tous les motifs sont entre 0,51 et 1,32).

Ordres de grandeur attendus : texte en haut sur trois lignes et un adulte, place du motif ≈ 0,21 → 0,69 H ; texte en bas, personnages remontés d'environ 0,13 H, place ≈ 0,05 → 0,56 H ; sans personnage, la place descend jusqu'au texte ou au bas.

### D2. `store.ts`

- `LigneTexte` : `x?: number; y?: number` (places ENREGISTRÉES, lues par PosterPreview seulement).
- `ConfiguratorState` : `motif: WorkingCharacter | null` et `texteEnBas: boolean` ; `emptyState()` : `motif: null, texteEnBas: false`.
- `stateFromConfig(cfg, estMotif?: (typeId: string | number) => boolean)` : recopie `x`/`y` des lignes quand ce sont des nombres ; si `estMotif` est donné, la PREMIÈRE entrée de `cfg.characters` qui en est un devient `motif` (WorkingCharacter, couleurs comprises) et sort de `characters`. Ne JAMAIS déduire `texteEnBas` ici (une affiche IA à lignes posées rouvrirait ses personnages décalés) : c'est index.tsx qui le fait, pour un produit à motifs seulement.
- `placementsAffiche` : `const dy = decalagePersonnages(remplies(state), state.texteEnBas)` ajouté au `y` des places AUTOMATIQUES (pas aux places posées à la main). Sans texte en bas, dy = 0 : rien ne bouge pour les autres affiches. Le type de `state` s'élargit à `"characters" | "view" | "lignes" | "texteEnBas"`.
- Nouvelle `placeDuMotif(state, personnage, places, proportion)` : `hautsPersonnages` = pour chaque personnage, `h = LARGEUR_CADRE_PERSONNAGE × place.scale × √2`, `place.y - h/2 + (1 - bottomPct)·h + (emprise?.haut ?? 0)·h` ; puis `placementDuMotif` avec `facteur = personnage(motif).facteurTaille`.
- `configFromState(state, productId, personnage, etalon, proportionMotif = 1)` : avec un motif, les personnages prennent `position = plan + 1`, et le motif est AJOUTÉ EN TÊTE : `{ typeId, position: 0, x, y, scale, assets: {}, colors: { ...state.motif.colors } }`. Sans motif, sortie identique à aujourd'hui.
- `lignesEnregistrees` : avec `state.texteEnBas`, chaque ligne remplie reçoit `x: 0.5, y` de `placesTexteEnBas` ; sinon jamais de x/y (comme aujourd'hui, même si une ligne d'état en porte).

### D3. `index.tsx`

- Prop `vueMotifs?: string | null` (doc : « le jeu de motifs que la fiche propose »).
- `estMotif(c)` : `c.orientation === props.vueMotifs || (c.orientation ?? "").startsWith("motifs-")`.
- `motifs = createMemo(...)` : les personnages d'orientation `props.vueMotifs`, non archivés, `active !== false` (sauf le motif déjà choisi), dans l'ordre de l'API (catégorie, puis position).
- `visibleCharacters` : retirer `estMotif` AVANT le filtre par vue ET du repli « toute la liste ».
- État initial : déplacer `characterById` avant. Si `props.vueMotifs` : `stateFromConfig(props.initialConfig, (id) => estMotif(characterById(id)))`, puis `texteEnBas` = une ligne de la config a un `y` > 0,5, puis on EFFACE x/y des lignes d'état (le module les recalcule). En ajout : présélectionner le premier motif de `motifs()` (`defaultCharacter(base, 0)`).
- Ligne 1 remplie par le nom du motif (traduit par l'API, `?lang=`), en majuscules comme la ligne 1 (`toLocaleUpperCase`) : variable `nomAuto` (non enregistrée). Choisir un motif remplace la ligne 1 si elle est vide, ou égale au texte par défaut du produit (`defaults.lignes[0]`), ou égale à `nomAuto` ; sinon on n'y touche pas. Rouverte depuis le panier : `nomAuto` = la ligne 1 si elle vaut le nom du motif en majuscules.
- `choisirMotif(base)` : nouveau WorkingCharacter, en gardant la couleur de motif choisie (`colors["base:st0"]`) ; `setCouleurMotif(hex | null)` (null = couleurs du dessin) ; `setTexteEnBas(b)`.
- `proportion = () => proportionDuSvg(cache.raw[baseDuMotif.baseSvgUrl]) ?? 1` ; prélecture : `fetchSvg` du motif choisi. Dans la boucle « En édition : toutes les bases » (l. 310), sauter `estMotif` : sinon chaque édition de personnage, sur TOUTES les affiches, télécharge les 47 SVG de motifs.
- `placeMotif = createMemo(...)` → `placeDuMotif(state, characterById, placementsAffiche(state, characterById, etalon()), proportion())`, passée aux DEUX PosterPreview (aperçu et « Voir sur un mur ») par une prop `motif={{ character: state.motif, base, place }}`.
- `submit()` : `configFromState(state, props.product.id, characterById, etalon(), proportion())`.
- `StepBackgroundText` reçoit, seulement si `props.vueMotifs` : `motifs`, `motifChoisi`, `onChoisirMotif`, `couleurMotif`, `onCouleurMotif`, `texteEnBas`, `onTexteEnBas`.

### D4. `components/PosterPreview.tsx`

- Prop `motif?: { character: WorkingCharacter; base: CharacterDTO | undefined; place: { x: number; y: number; scale: number } } | null` : dessinée comme un personnage (même boîte : `left/top` en %, largeur `CHAR_BASE_WIDTH × scale × 100 %`, `aspect-ratio: 1 / 2`, `translate(-50%, -50%)`), `CharacterStack` avec `slots = variantesDeVue(props.slots, base?.orientation)`, `z-index: 9` (devant le décor z 5, derrière les personnages z 10+), `pointer-events: none`. Au panier, le motif n'arrive pas par cette prop : c'est une entrée de `characters` (position 0, z 10, personnages 11 et plus).
- Lignes : `lignesADessiner()` garde x/y. Une ligne est POSÉE si elle porte x/y enregistrés ; sinon, si `state.texteEnBas`, ses places viennent de `placesTexteEnBas` (exemple « Memory Line » compris) ; sinon elle s'empile comme aujourd'hui.
- Couche empilée inchangée, mais `<Show when={!posee}>` autour de chaque ligne (le rang reste celui de la ligne parmi les dessinées, comme pdf.ts).
- Nouvelle couche des lignes posées, calquée sur AfficheIA (`calquePose`, l. 2665-2705) : `position: absolute; inset: 0; padding: 0 MARGE_DU_TEXTE×100 %; container-type: inline-size; z-index: 200`, chaque ligne en `position: absolute`, `left: x×100 %`, `top: y×100 %`, `translate(-50%, -50%)`, `text-align: center`, `white-space: nowrap`, `line-height: INTERLIGNE_LIGNE_POSEE`, taille `tailleDeLigneCqw(rang) × réduction × facteurTailleLigne(taille)` cqw, `letter-spacing: espacementDeLigne(rang)em`, sans `margin-top`, avec `data-rang-texte` et les `data-sous-ligne` (mêmes morceaux que la couche empilée).
- Réduction : `createReductionDesLignes(() => [coucheTexte, couchePosee], ...)`, la clé incluant « posée ou non » (comme AfficheIA l. 566).
- Une affiche classique n'a jamais de ligne posée : la couche posée reste vide, l'aperçu est identique (contrôle G9).

### D5. Le choix du motif : `components/ChoixMotif.tsx` (nouveau) et `components/StepBackgroundText.tsx`

ChoixMotif, sur le modèle de la galerie de personnages (CharacterEditor, l. 1190-1290) :
- intitulé `m().motif` et une aide `m().motifAide` (petite, grise) ;
- les onglets de catégories (pastilles arrondies, `ZoneDefilante sens="horizontal"`), dans l'ordre d'apparition de l'API ; motif sans catégorie : `m().autres` ; onglet actif = celui du motif choisi tant que le client n'en touche pas un autre ;
- une grille de vignettes (`ZoneDefilante sens="vertical"`, `repeat(auto-fill, minmax(84px, 1fr))`, hauteur maxi ~236 px) : bouton `ml-choix ml-choix-dedans`, `aria-pressed`, `title` = nom ; image `aLaLargeur(urlAsset(assetBaseUrl, baseSvgUrl), 200)` (webp servi par l'API), `loading="lazy"`, `alt` = nom, carré, `object-fit: contain`, fond #f3f4f6 ; le nom dessous (11 px, deux lignes au plus) ;
- dessous, `m().couleurMotif` : deux `PastilleCouleur` (anthracite #2B2B2B = couleurs du dessin, blanc #FFFFFF = `base:st0` en blanc), libellés `m().libellesCouleursTexte.anthracite` / `.blanc`. Utile sur les fonds sombres ; les façades des maisons gardent leurs couleurs.

StepBackgroundText (toutes les props neuves facultatives : rien ne change sans elles) : dans l'ordre, le titre, ChoixMotif, la galerie de fonds (inchangée), « Place du texte » (`m().textePlace`, deux boutons `m().texteHaut` / `m().texteBas`, `aria-pressed`, style des boutons de police), les lignes, la couleur du texte.

### D6. `messages.ts`

Ajouter à `MessagesConfigurateur` et à `MESSAGES_DEFAUT` : `motif` « Motif », `motifAide` « Son nom s'écrit sur la ligne 1 ; vous pouvez le changer. », `couleurMotif` « Couleur du motif », `textePlace` « Place du texte », `texteHaut` « En haut », `texteBas` « En bas ».

Puis tsc dans packages/configurator.

## 7. Étape E — site (apps/web)

- `src/lib/api.ts`, `ProductDetail` : `vueMotifs?: string | null`.
- `src/pages/[...lang]/affiches/[slug].astro` (l. 754) : `vueMotifs={product.vueMotifs ?? null}` sur `ProductConfigurator`.
- `src/islands/ProductConfigurator.tsx` : prop `vueMotifs?: string | null`, transmise à `ConfiguratorIsland` (l. 489).
- `src/islands/ConfiguratorIsland.tsx` : prop transmise à `<Configurator vueMotifs={props.vueMotifs ?? null} />`.
- `src/lib/messages-configurateur.ts` : `motif: tr("cfg.motif"), motifAide: tr("cfg.motif_aide"), couleurMotif: tr("cfg.couleur_motif"), textePlace: tr("cfg.texte_place"), texteHaut: tr("cfg.texte_haut"), texteBas: tr("cfg.texte_bas")`.
- `src/i18n/ui.ts` : les six clés du § 9, juste après `"cfg.fond"` dans chacune des sept langues (fr l. 524, en 1487, de 2436, it 3382, es 4316, ja 5204, zh 6029), par un script Python.

Puis `npx tsc --noEmit -p .` dans apps/web (les 3 erreurs anciennes de StandSalon.tsx sont tolérées).

## 8. Étape F — BO (apps/admin)

- `src/lib/api.ts` : `ProductConfig` gagne `vueMotifs: string | null`, `standId: number | null`, `stands: { id: number; nom: string; dateFin: string | null; etat: "en-service" | "desactive" | "archive" | "termine" }[]` ; `setProductConfig` accepte `vueMotifs` et `standId`.
- `src/pages/produits/[id].astro`, formulaire de configuration (après « Type d'affiche », l. 1970) :
  - « Motifs au choix du client » : liste « Aucun (affiche classique) » + les types d'affiche (`vues`), `name="vueMotifs"`. Aide : « Le client choisit un motif parmi les personnages de ce type d'affiche (BO › Personnages), rangés par catégorie. Un jeu de motifs est un type d'affiche dont le nom commence par « Motifs ». »
  - « Stand » : liste « Aucun : en vente comme les autres affiches » + chaque stand avec son état (« Marché de Noël Mulhouse — en service, dernier jour le 27/12/2026 »), `name="standId"`. Aide : « Rattachée à un stand, l'affiche n'est proposée (site, tablette, rayons, recherche, plan du site) que tant que ce stand est activé, non archivé et que son dernier jour n'est pas passé. Elle disparaît ensuite d'elle-même ; un stand fermé pour la nuit ne change rien ; les paniers qui la contiennent ne bougent pas. »
  - Traitement du formulaire (l. 588-598) : `vueMotifs: String(form.get("vueMotifs") || "") || null`, `standId: form.get("standId") ? Number(form.get("standId")) : null`.
  - Sous le titre de la page, si l'affiche est rattachée : « Rattachée au stand « Marché de Noël Mulhouse » : en ligne tant qu'il est en service (dernier jour : 27/12/2026). » ; hors service, le même bandeau en orange : « Hors ligne : le stand est désactivé / archivé / terminé. »

Puis `npx astro check` dans apps/admin.

## 9. Textes

### ui.ts (vouvoiement)

| clé | fr | en | de | it | es | ja | zh |
|---|---|---|---|---|---|---|---|
| cfg.motif | Motif | Design | Motiv | Motivo | Motivo | モチーフ | 图案 |
| cfg.motif_aide | Son nom s'écrit sur la ligne 1 ; vous pouvez le changer. | Its name goes on line 1; you can change it. | Sein Name steht dann in Zeile 1; Sie können ihn ändern. | Il suo nome va nella riga 1; può modificarlo. | Su nombre se escribe en la línea 1; puede cambiarlo. | 名前が1行目に入ります。変更もできます。 | 名称会填入第1行，您可以修改。 |
| cfg.couleur_motif | Couleur du motif | Design colour | Farbe des Motivs | Colore del motivo | Color del motivo | モチーフの色 | 图案颜色 |
| cfg.texte_place | Place du texte | Text position | Position des Textes | Posizione del testo | Posición del texto | 文字の位置 | 文字位置 |
| cfg.texte_haut | En haut | Top | Oben | In alto | Arriba | 上 | 上方 |
| cfg.texte_bas | En bas | Bottom | Unten | In basso | Abajo | 下 | 下方 |

### Données (dans la migration)

Produit, nom : fr « MULHOUSE Marché de Noël - Affiche personnalisée » (convention du catalogue : la ville en capitales, la fiche coupe « - Affiche… » ; le filtre par ville la range à Mulhouse) ; en « MULHOUSE Christmas Market », de « MULHOUSE Weihnachtsmarkt », it « MULHOUSE Mercatino di Natale », es « MULHOUSE Mercado de Navidad », ja « MULHOUSE クリスマスマーケット », zh « MULHOUSE 圣诞市场 ».

Produit, description :
- fr : Une affiche à composer au marché de Noël de Mulhouse : choisissez un motif d'Alsace (l'hôtel de ville, le temple Saint-Étienne, des maisons à colombages, un bredele…), un fond uni, en dégradé ou à motifs, placez votre texte en haut ou en bas, puis ajoutez vos personnages. Proposée le temps du marché seulement.
- en : A poster to design at the Mulhouse Christmas market: choose an Alsatian design (the town hall, the Temple Saint-Étienne, half-timbered houses, bredele biscuits…), a plain, gradient or patterned background, put your text at the top or bottom, then add your characters. Available during the market only.
- de : Ein Poster zum Gestalten auf dem Weihnachtsmarkt in Mulhouse: Wählen Sie ein elsässisches Motiv (das Rathaus, den Temple Saint-Étienne, Fachwerkhäuser, Bredele …), einen einfarbigen, verlaufenden oder gemusterten Hintergrund, setzen Sie Ihren Text oben oder unten und fügen Sie Ihre Figuren hinzu. Nur während des Marktes erhältlich.
- it : Un poster da comporre al mercatino di Natale di Mulhouse: scelga un motivo alsaziano (il municipio, il Temple Saint-Étienne, case a graticcio, bredele…), uno sfondo a tinta unita, sfumato o a motivi, metta il testo in alto o in basso e aggiunga i suoi personaggi. Disponibile solo durante il mercatino.
- es : Un póster para componer en el mercado de Navidad de Mulhouse: elija un motivo alsaciano (el ayuntamiento, el Temple Saint-Étienne, casas de entramado, bredele…), un fondo liso, degradado o estampado, coloque su texto arriba o abajo y añada sus personajes. Disponible solo durante el mercado.
- ja : ミュルーズのクリスマスマーケットで作るポスターです。アルザスのモチーフ（市庁舎、サン・テティエンヌ教会、木骨造りの家、ブレデルなど）と、無地・グラデーション・柄の背景を選び、文字を上か下に配置して、キャラクターを加えてください。マーケット開催期間中のみの販売です。
- zh : 在米卢斯圣诞市场定制的海报：选择一个阿尔萨斯图案（市政厅、圣艾蒂安教堂、半木结构房屋、圣诞小饼干等）、纯色、渐变或花纹背景，将文字放在上方或下方，再添加您的人物。仅在市场期间提供。

Collection : fr « Marché de Noël de Mulhouse » ; en « Mulhouse Christmas Market » ; de « Weihnachtsmarkt Mulhouse » ; it « Mercatino di Natale di Mulhouse » ; es « Mercado de Navidad de Mulhouse » ; ja « ミュルーズのクリスマスマーケット » ; zh « 米卢斯圣诞市场 ». Description (fr dans la colonne, traductions dans `translations`) : « Les affiches du stand Memory Line au marché de Noël de Mulhouse, proposées le temps du marché. » / « The Memory Line stand posters at the Mulhouse Christmas market, available while the market lasts. » / « Die Poster des Memory-Line-Stands auf dem Weihnachtsmarkt in Mulhouse, nur während des Marktes. » / « I poster dello stand Memory Line al mercatino di Natale di Mulhouse, disponibili per la durata del mercatino. » / « Los pósteres del puesto Memory Line en el mercado de Navidad de Mulhouse, disponibles mientras dure el mercado. » / « ミュルーズのクリスマスマーケットに出店するMemory Lineのポスター。開催期間中のみ。 » / « Memory Line 在米卢斯圣诞市场摊位的海报，仅在市场期间提供。 »

Lignes par défaut du produit : ligne 1 vide (le nom du motif la remplit), ligne 2 « Marché de Noël de Mulhouse », ligne 3 vide. Margaux les change dans la fiche › Textes pré-remplis.

## 10. Étape G — vérifications

Captures dans `travaux/affiche-stand-mulhouse/captures/`, regardées (Read) à chaque étape. Navigateur : l'outil Browser du poste s'il est là, sinon Chrome sans écran (CDP) ou playwright. **Jamais de paiement** : on s'arrête au panier et à la page de commande.

Les scripts .ts de travaux/ tournent dans le conteneur API et n'importent QUE des fichiers de `../../apps/api/src/…` (chemins relatifs, extension .js). Pas de paquet nu (drizzle-orm, @memoryline/types…) : depuis travaux/, Node ne le trouverait pas. Ils finissent par `process.exit(0)` (le client de base garde la connexion ouverte).

- **G1. API** (`curl` sur http://localhost:3000) : `/products/mulhouse-marche-de-noel-affiche-personnalisee` → 200 et `vueMotifs = "motifs-alsace"` ; `/products?q=march` et `/products?collection=marche-de-noel-de-mulhouse` la contiennent ; `/collections` contient `marche-de-noel-de-mulhouse` ; `/plan-du-site` contient l'adresse ; `/stand/page-de-la-tablette?stand=1` la cite en premier ; `/characters?lang=en` contient les motifs avec leur catégorie traduite.
- **G2. Règle du stand, sans rien écrire** : script `travaux/affiche-stand-mulhouse/verifier-stand.ts <id du produit> <id d'une affiche classique>` (ids lus en psql), lancé par `docker exec -w /app/apps/api memoryline-api npx tsx /app/travaux/affiche-stand-mulhouse/verifier-stand.ts <id> 204` (204 : l'affiche « Hôtel de ville » classique). Avec `standDuProduitEnService(id, maintenant)` : aujourd'hui → vrai ; `new Date("2026-12-27T23:00:00+01:00")` → vrai ; `new Date("2026-12-28T00:30:00+01:00")` → faux ; l'affiche classique → vrai à toutes les dates. Il affiche aussi `etatDuStand` des stands réels (`db.select().from(schema.stands)`), puis des mêmes avec `actif: false`, avec `archivedAt` posé et au 28/12 (copies en mémoire seulement).
- **G3. Parcours du site** (http://localhost:8080/affiches/mulhouse-marche-de-noel-affiche-personnalisee) : ouvrir « Personnaliser » ; les onglets dans l'ordre Mulhouse, Textile et musées, (Strasbourg et Colmar), Maisons d'Alsace, Noël, Gourmandises, Alsace ; la ligne 1 vaut « HÔTEL DE VILLE » dès l'ouverture ; choisir Maisons d'Alsace › Maisons alsaciennes : la ligne 1 devient « MAISONS ALSACIENNES », les façades sont colorées (saumon, ocre, bleu ciel) et les colombages sombres ; taper « FAMILLE MARTIN » en ligne 1 puis changer de motif : la ligne 1 ne bouge pas ; l'effacer puis changer de motif : le nom revient. Choisir un uni, un dégradé, un fond à motifs ; passer le motif en blanc sur un fond sombre ; « En bas » : le texte descend. Étape Personnages : ajouter 1 puis 3 personnages, texte en haut puis en bas : le motif ne touche ni le texte ni les têtes (captures `motif-1-perso-haut.png`, `motif-3-persos-bas.png`…). Format A4, « Valider l'affiche » → page de commande : la vignette montre le motif et le texte en bas (`panier-texte-bas.png`). Ajouter de même une affiche « Hôtel de ville, dégradé Nuit d'hiver, motif blanc, texte en haut, sans personnage » (elle servira au visuel 2).
- **G4. Langue** : /en/affiches/… : onglets, noms des motifs et ligne 1 automatique en anglais (« TOWN HALL ») ; « Tour de l'Europe » reste tel quel.
- **G5. Réouverture depuis le panier** (« Modifier ») : même motif, même fond, texte toujours en bas, ligne 1 gardée ; changer de motif remplace la ligne 1 si elle valait le nom du motif ; « Valider » met la ligne à jour.
- **G6. Tablette** : http://localhost:8080/?stand=1 → la page du stand, la nouvelle affiche en tête ; sa fiche sans aucun prix ; parcours jusqu'au panier de la tablette, sans valider la vente.
- **G7. Fichier d'impression** : la config de la ligne de panier, lue en psql (lecture seule) et rangée dans un fichier : `docker exec memoryline-db18 psql -U memoryline -d memoryline -At -c "SELECT oi.config FROM order_item oi JOIN product p ON p.id = oi.product_id WHERE p.slug = 'mulhouse-marche-de-noel-affiche-personnalisee' ORDER BY oi.id DESC LIMIT 1" > travaux/affiche-stand-mulhouse/captures/ligne-texte-bas.json`. Puis `travaux/affiche-stand-mulhouse/rendu-impression.ts <config.json> <sortie.png>` (`docker exec -w /app/apps/api memoryline-api npx tsx /app/travaux/affiche-stand-mulhouse/rendu-impression.ts /app/travaux/affiche-stand-mulhouse/captures/ligne-texte-bas.json /app/travaux/affiche-stand-mulhouse/captures/impression-texte-bas.png`) : il lit le JSON, appelle `renderPosterPng(config, { data: await donneesDImpression() })` (imports `../../apps/api/src/pdf.js` et `../../apps/api/src/fichiers-impression.js`) et écrit le PNG pleine définition. De même `impression-texte-haut.png`. Réduire une copie à 1200 px (PIL) pour la regarder, et la comparer à la vignette du panier : même place du motif, mêmes couleurs, texte au même endroit.
- **G8. Listes** : /affiches?genre=personnalisable&collection=marche-de-noel-de-mulhouse montre l'affiche ; la recherche du site « marché » la trouve ; /sitemap.xml contient son adresse.
- **G9. Aucune régression** : à l'étape 0, captures « avant » du configurateur de deux affiches classiques (mulhouse-hotel-de-ville-affiche-personnalisee, de dos avec muret, et une affiche de face), un personnage ajouté, textes par défaut ; à la fin, les mêmes « après » : identiques à l'œil (différence PIL). Pas de « Motif » ni de « Place du texte » sur elles. Mettre l'une d'elles au panier : sa `config` n'a aucun x/y de ligne, ses personnages commencent à la position 0.
- **G10. Désactivé, archivé** : l'agent ne peut pas se connecter au BO. Soit Alexandra le fait dans le BO local (Ventes stand › Désactiver : l'affiche disparaît du site, de la tablette et de la recherche ; Réactiver : elle revient), soit, avec l'accord de l'agent principal, une transaction annulée en psql (`BEGIN; UPDATE stand SET actif = false WHERE id = 1; SELECT … la même condition …; ROLLBACK;`).
- **G11.** tsc dans apps/api, apps/web, packages/configurator ; `npx astro check` dans apps/admin.

## 11. Étape H — les visuels de la fiche

Depuis les deux lignes de panier de G3 (maisons alsaciennes, texte en bas, avec personnages ; hôtel de ville, dégradé de nuit, motif blanc, texte en haut) : `rendu-impression.ts` en A4, puis PIL : 1200 px de large, JPEG qualité 88, vers `data/assets/mulhouse-marche-de-noel-exemple-1-v1.jpg` et `-2-v1.jpg`, et copie dans `assets-prod/`. Ce sont les noms déjà écrits dans la migration. Vérifier la fiche et la vignette de la page du stand.

## 12. Mise en prod (pour l'agent principal)

1. Copier `travaux/affiche-stand-mulhouse/assets-prod/*` (47 ou 28 motifs, 19 fonds, 2 visuels) dans data/assets de la prod AVANT de déployer : data/assets n'est pas dans git (.gitignore:19), et la migration rend l'affiche visible tout de suite.
2. Déployer le code avec la migration. L'affiche est en ligne dès la migration (statut « active », stand 1 en service), sur le site et sur la tablette.
3. Hors ouverture du marché (avant 11 h, après 20 h) ou sur le « met en prod » d'Alexandra.
4. Contrôle : la fiche, une vignette de motif, un fond, la page du stand avec ?stand=1.

## 13. Ajouter les motifs de motifs-3 plus tard (une ligne)

`python travaux/affiche-stand-mulhouse/generer_migration.py --motifs-seulement --tag 0122_motifs_alsace_planches_3_5 && docker exec -w /app/apps/api memoryline-api npx tsx src/db/migrate.ts` (copie les SVG en `motif-alsace-<id>-v1.svg` dans data/assets et assets-prod, écrit une migration neuve qui n'insère que les motifs absents dans les catégories déjà créées, ajoute l'entrée au journal ; relire la fin du journal avant).

## 14. Limites connues, hors périmètre, options

- Le résumé du panier compte le motif comme un personnage (« 1 personnage » pour une affiche sans personnage), le BO aussi (« personnages : N »). Corriger demande de toucher l'affichage du panier et de la caisse : non fait, à décider.
- La relance de panier abandonné peut renvoyer vers la fiche après la fin du stand (404) : non touchée (logique de commande).
- Le menu du site n'a pas d'entrée vers la collection. En ajouter une au BO est possible, mais le menu ne cache pas un rayon vide : le lien mènerait à une 404 après le marché, à retirer à la main.
- Le BO (liste des produits, ordre d'affichage) montre l'affiche « en ligne » même stand éteint : seule sa fiche dit l'état du stand.
- Fin au jour près : l'affiche part à minuit après le dernier jour, pas à l'heure de fermeture (la règle du retrait au stand, elle, compte l'heure).
- « Voir sur un mur » dessine les personnages aux places non composées de l'état (comportement actuel, toutes affiches) ; le motif et le texte y sont à leur place. Correction possible en une ligne (`recomposer etalon={etalon()}` sur le second PosterPreview d'index.tsx) : changerait aussi les affiches classiques, à valider.
- Option non faite, sans fichier interdit : un uni de couleur LIBRE. Une route publique créerait à la demande `data/assets/fond-uni-<hex>.svg` (hex validé strictement, nombre plafonné) et rendrait son adresse ; le module l'enverrait en `backgroundUrl` ; pdf.ts le lirait comme tout fichier. Risques : disque, abus ; à n'ouvrir que sur demande.
- À valider par Alexandra : le nom du produit (convention « MULHOUSE Marché de Noël »), la ligne 2 par défaut, les deux noms corrigés (Cigogne sur son nid, Couronne aux bougies), la couleur des maisons, la palette des fonds.
