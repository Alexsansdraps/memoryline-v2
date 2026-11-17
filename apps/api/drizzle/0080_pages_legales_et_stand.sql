-- Le 17/11, jour de la bascule de memoryline.fr. Alexandra : « ce que tu peux
-- faire, fais-le ». Chaque modification ne s'applique que si le texte ou le
-- réglage est encore celui d'avant : rejouable, et sans effet sur ce que la
-- boutique aurait déjà changé au BO.

-- 1. CGV : la date de mise à jour ; le téléphone et le RCS retirés, comme des
--    mentions légales le 12/11 (0077). Le médiateur reste à compléter : il est
--    obligatoire, et son nom n'est pas connu.
UPDATE "page"
SET "blocks" = regexp_replace(
      regexp_replace(
        "blocks"::text,
        '<p><strong>À COMPL[ÉE]TER : date de dernière mise à jour de ces conditions\.</strong></p>',
        '<p>Dernière mise à jour : 17 novembre 2026.</p>'
      ),
      '<p><strong>À COMPL[ÉE]TER : numéro de téléphone, et le cas échéant numéro d''inscription au RCS ou au répertoire des métiers\.</strong></p>',
      ''
    )::jsonb
WHERE "slug" = 'conditions-de-vente'
  AND "blocks"::text ~ 'À COMPL[ÉE]TER : (date de dernière mise à jour de ces conditions|numéro de téléphone, et le cas échéant)';
--> statement-breakpoint

-- 2. Confidentialité : la date ; SendCloud et OpenAI ajoutés aux destinataires
--    (la boutique leur transmet réellement des données : l'adresse pour
--    l'étiquette, la photo pour une affiche IA) ; la note interne retirée.
--    Les deux durées d'inactivité restent à décider par la boutique.
UPDATE "page"
SET "blocks" = regexp_replace(
      regexp_replace(
        regexp_replace(
          "blocks"::text,
          '<p><strong>À COMPL[ÉE]TER : date de dernière mise à jour de cette politique\.</strong></p>',
          '<p>Dernière mise à jour : 17 novembre 2026.</p>'
        ),
        '<li><strong>OVH</strong>',
        '<li><strong>SendCloud</strong> (Pays-Bas), qui prépare les étiquettes des colis à partir de l''adresse de livraison ;</li><li><strong>OpenAI</strong> (États-Unis), pour les affiches créées par intelligence artificielle : la photo envoyée et la consigne qui l''accompagne lui sont transmises pour fabriquer l''image ;</li><li><strong>OVH</strong>'
      ),
      ' ?<strong>À COMPL[ÉE]TER : vérifier, pour chaque prestataire réellement utilisé, le cadre du transfert, et retirer de cette liste ceux qui ne serviraient pas\.</strong>',
      ''
    )::jsonb
WHERE "slug" = 'confidentialite'
  AND "blocks"::text NOT LIKE '%<strong>SendCloud</strong>%'
  AND "blocks"::text LIKE '%<li><strong>OVH</strong>%';
--> statement-breakpoint

-- 3. Cookies : la note interne (« si un outil de mesure d'audience est ajouté
--    un jour… ») ne regarde pas les visiteuses.
UPDATE "page"
SET "blocks" = regexp_replace(
      "blocks"::text,
      '<p><strong>À COMPL[ÉE]TER : si un outil de mesure d''audience[^<]*</strong></p>',
      ''
    )::jsonb
WHERE "slug" = 'cookies'
  AND "blocks"::text ~ 'À COMPL[ÉE]TER : si un outil de mesure d''audience';
--> statement-breakpoint

-- 4. Mentions légales : la note sur les crédits (Twemoji est crédité depuis
--    0079 ; les illustrations sont de la boutique).
UPDATE "page"
SET "blocks" = regexp_replace(
      "blocks"::text,
      '<p><strong>À COMPL[ÉE]TER : s''il y a lieu, crédits[^<]*</strong></p>',
      ''
    )::jsonb
WHERE "slug" = 'mentions-legales'
  AND "blocks"::text ~ 'À COMPL[ÉE]TER : s''il y a lieu, crédits';
--> statement-breakpoint

-- 5. La page du stand (/pages/mulhouse) : réservée à la tablette, avec les
--    affiches de la collection du marché (marché de Noël de Mulhouse, à partir
--    du 20/11). Seulement si elle est encore la page d'essai « TEST TOUT VOIR »
--    sur la collection « cuisine ».
UPDATE "page"
SET "blocks" = '[{"type": "produits", "limite": 48, "source": "collection", "reference": "marche-de-noel-mulhouse-2026", "references": ["marche-de-noel-mulhouse-2026"]}]'::jsonb
WHERE "slug" = 'mulhouse'
  AND jsonb_typeof("blocks") = 'array'
  AND jsonb_array_length("blocks") = 1
  AND "blocks"->0->>'type' = 'produits'
  AND "blocks"->0->>'reference' = 'cuisine';
--> statement-breakpoint
UPDATE "page"
SET "title" = 'Marché de Noël de Mulhouse',
    "affichage" = 'stand'
WHERE "slug" = 'mulhouse'
  AND "title" = 'TEST TOUT VOIR';
--> statement-breakpoint

-- 6. Le bouton « Tuto » montrait la vidéo de test (Big Buck Bunny), sur le
--    site comme sur la tablette : éteint, tant que la vidéo est celle-là. Se
--    rallume au BO › Contenu du site, avec la vraie vidéo.
UPDATE "setting"
SET "value" = '"off"'::jsonb
WHERE "key" = 'configurateur.video.visible'
  AND EXISTS (
    SELECT 1 FROM "setting" s
     WHERE s."key" = 'configurateur.video.url'
       AND s."value"::text LIKE '%aqz-KE-bpKQ%'
  );
