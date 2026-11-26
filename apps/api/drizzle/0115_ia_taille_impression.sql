-- Les affiches « à partir de votre photo » sortent en 1584 × 2240 au lieu de
-- 1024 × 1536 (26/11, Alexandra : « fais ce qu'il faut, il faut que les
-- affiches soient haute qualité ! au moins à l'impression tu vois » ;
-- Margaux : « qualité affiches IA pas top »).
--
-- En 1024 × 1536, une affiche s'imprime à 124 ppp en A4 et 88 en A3 ; en
-- 1584 × 2240 (même proportion que le papier A), à 192 et 136 ppp, avant
-- l'agrandissement et l'accentuation du fichier d'impression (pdf.ts).
-- Coût : environ 26 c l'image en qualité « high » au lieu d'environ 16 c en
-- 1024 × 1536 (vrai coût dans la galerie du BO, d'après ce qu'OpenAI compte).
--
-- La valeur 1024x1536 avait été écrite par le formulaire du BO, qui ne
-- proposait pas 1584 × 2240 (ia.astro corrigé le 26/11). Seule cette valeur
-- exacte change : un autre réglage choisi depuis au BO reste tel quel. Le
-- paysage reste en 2240 × 1584 (ia.ts).
UPDATE "setting"
SET "value" = '"1584x2240"'::jsonb, "updated_at" = now()
WHERE "key" = 'ia.taille'
  AND "value" = '"1024x1536"'::jsonb;
