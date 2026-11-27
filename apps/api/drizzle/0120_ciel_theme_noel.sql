-- Le thème « Noël » du ciel étoilé, rouge et or (27/11, Alexandra : « Le ciel
-- de la nuit de Noël. […] On y ajoute un thème rouge et or. »).
--
-- Les thèmes de base (apps/api/src/ciel.ts, THEMES_CIEL_DE_BASE) ne servent
-- QUE tant que la boutique n'a rien enregistré au BO. Si le réglage
-- « ciel.themes » existe déjà, le thème s'y ajoute à la fin, sans toucher aux
-- autres ; s'il y est déjà (même identifiant), rien ne change. Sans réglage,
-- rien à faire : le thème vient de la liste de base. Margaux peut ensuite le
-- renommer, le recolorer ou le désactiver au BO comme les autres.
UPDATE "setting"
SET "value" = "value" || '[{"id":"noel","nom":"Noël","fond":"#7c1420","etoiles":"#fff6e5","dorures":"#e9c56b","actif":true}]'::jsonb,
    "updated_at" = now()
WHERE "key" = 'ciel.themes'
  AND jsonb_typeof("value") = 'array'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("value") e WHERE e->>'id' = 'noel');
