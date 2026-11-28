-- 0122_affiche_stand_mulhouse_reglages — les réglages de l'affiche éphémère du
-- stand de Mulhouse (28/11/2026), après 0121.
--
-- Demandes d'Alexandra du 28/11, devant la fiche en local :
--   « on utilise plus les perso de face c'est perso sur le muret tout le
--   temps » : l'affiche passe en vue DE DOS. Son décor n'est pas écrit sur la
--   fiche (foreground_url reste vide) : c'est celui du type d'affiche « De
--   dos » — le muret —, comme pour les affiches personnalisables de dos ;
--   « faut une meilleure image », puis « mets plutôt ça en image pour le
--   produit » : trois nouveaux visuels, rendus par le moteur d'impression
--   (le sapin sur le fond rouge aux étoiles dorées en premier). Fichiers
--   NEUFS (-v2) : /assets est servi « immutable », un nom ne change jamais
--   de contenu.
--
-- Chaque instruction est rejouable (deux passages = un seul effet) et ne
-- vise que CE produit, par son slug. Les couleurs des motifs (réglage
-- « motifs.couleurs ») n'ont rien à écrire ici : réglage absent = les dix
-- couleurs de base (apps/api/src/motifs-couleurs.ts).
--
-- AVANT de passer cette migration en production : copier les fichiers de
-- travaux/affiche-stand-mulhouse/assets-prod dans data/assets (hors git),
-- dont mulhouse-marche-de-noel-exemple-1-v2.jpg, -2-v2.jpg et -3-v2.jpg.

UPDATE "product"
SET "default_view" = 'back', "updated_at" = now()
WHERE "slug" = 'mulhouse-marche-de-noel-affiche-personnalisee'
  AND "default_view" IS DISTINCT FROM 'back';
--> statement-breakpoint
-- Les deux visuels de 0121 prennent leurs remplaçants (même rang), le
-- troisième s'ajoute s'il n'y est pas encore.
UPDATE "product_image" pi
SET "url" = '/assets/mulhouse-marche-de-noel-exemple-1-v2.jpg'
FROM "product" p
WHERE p."id" = pi."product_id"
  AND p."slug" = 'mulhouse-marche-de-noel-affiche-personnalisee'
  AND pi."url" = '/assets/mulhouse-marche-de-noel-exemple-1-v1.jpg';
--> statement-breakpoint
UPDATE "product_image" pi
SET "url" = '/assets/mulhouse-marche-de-noel-exemple-2-v2.jpg'
FROM "product" p
WHERE p."id" = pi."product_id"
  AND p."slug" = 'mulhouse-marche-de-noel-affiche-personnalisee'
  AND pi."url" = '/assets/mulhouse-marche-de-noel-exemple-2-v1.jpg';
--> statement-breakpoint
INSERT INTO "product_image" ("product_id", "url", "alt", "position")
SELECT p."id", v.url, '', v.pos
FROM "product" p, (VALUES
  ('/assets/mulhouse-marche-de-noel-exemple-1-v2.jpg', 0),
  ('/assets/mulhouse-marche-de-noel-exemple-2-v2.jpg', 1),
  ('/assets/mulhouse-marche-de-noel-exemple-3-v2.jpg', 2)
) AS v(url, pos)
WHERE p."slug" = 'mulhouse-marche-de-noel-affiche-personnalisee'
  AND NOT EXISTS (
    SELECT 1 FROM "product_image" pi WHERE pi."product_id" = p."id" AND pi."url" = v.url
  );
--> statement-breakpoint
-- Le rang et le texte de chacun, réécrits à chaque passage (le même résultat).
UPDATE "product_image" pi
SET "position" = v.pos, "alt" = v.alt
FROM "product" p, (VALUES
  ('/assets/mulhouse-marche-de-noel-exemple-1-v2.jpg', 0,
   'Affiche du marché de Noël de Mulhouse : un sapin décoré sur un fond rouge aux étoiles dorées, « Sapin de Noël » en haut'),
  ('/assets/mulhouse-marche-de-noel-exemple-2-v2.jpg', 1,
   'Affiche du marché de Noël de Mulhouse : l''hôtel de ville doré sur un ciel de nuit d''hiver, une famille et son chien assis de dos sur le muret'),
  ('/assets/mulhouse-marche-de-noel-exemple-3-v2.jpg', 2,
   'Affiche du marché de Noël de Mulhouse : des maisons alsaciennes aux façades colorées sur un fond rose, un couple assis de dos sur le muret')
) AS v(url, pos, alt)
WHERE p."id" = pi."product_id"
  AND p."slug" = 'mulhouse-marche-de-noel-affiche-personnalisee'
  AND pi."url" = v.url;
