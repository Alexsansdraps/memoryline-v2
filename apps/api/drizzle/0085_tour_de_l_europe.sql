-- « Tour d'Europe » devient « Tour de l'Europe », le nom de la tour de Mulhouse
-- (Alexandra, 17/11). Textes des affiches seulement : nom, description,
-- référencement, textes pré-remplis de l'affiche et traductions. L'adresse de
-- la fiche (slug) ne change pas, pour ne casser ni les liens ni Google. Les
-- commandes passées gardent le nom qu'elles avaient. La majuscule ou la
-- minuscule de « Tour » et l'apostrophe (' ou ’) sont gardées ; un texte tout
-- en capitales reste en capitales.
UPDATE "product"
SET
  "name" = regexp_replace(regexp_replace("name", 'TOUR D([''’])EUROPE', 'TOUR DE L\1EUROPE', 'g'), '([Tt])our d([''’])[Ee]urope', '\1our de l\2Europe', 'g'),
  "description" = regexp_replace(regexp_replace("description", 'TOUR D([''’])EUROPE', 'TOUR DE L\1EUROPE', 'g'), '([Tt])our d([''’])[Ee]urope', '\1our de l\2Europe', 'g'),
  "seo_title" = regexp_replace(regexp_replace("seo_title", 'TOUR D([''’])EUROPE', 'TOUR DE L\1EUROPE', 'g'), '([Tt])our d([''’])[Ee]urope', '\1our de l\2Europe', 'g'),
  "seo_description" = regexp_replace(regexp_replace("seo_description", 'TOUR D([''’])EUROPE', 'TOUR DE L\1EUROPE', 'g'), '([Tt])our d([''’])[Ee]urope', '\1our de l\2Europe', 'g'),
  "default_title" = regexp_replace(regexp_replace("default_title", 'TOUR D([''’])EUROPE', 'TOUR DE L\1EUROPE', 'g'), '([Tt])our d([''’])[Ee]urope', '\1our de l\2Europe', 'g'),
  "default_subtitle" = regexp_replace(regexp_replace("default_subtitle", 'TOUR D([''’])EUROPE', 'TOUR DE L\1EUROPE', 'g'), '([Tt])our d([''’])[Ee]urope', '\1our de l\2Europe', 'g'),
  "default_line3" = regexp_replace(regexp_replace("default_line3", 'TOUR D([''’])EUROPE', 'TOUR DE L\1EUROPE', 'g'), '([Tt])our d([''’])[Ee]urope', '\1our de l\2Europe', 'g'),
  "translations" = regexp_replace(regexp_replace("translations"::text, 'TOUR D([''’])EUROPE', 'TOUR DE L\1EUROPE', 'g'), '([Tt])our d([''’])[Ee]urope', '\1our de l\2Europe', 'g')::jsonb
WHERE concat_ws(' ', "name", "description", "seo_title", "seo_description", "default_title", "default_subtitle", "default_line3", "translations"::text) ~* 'tour d[''’]europe';
