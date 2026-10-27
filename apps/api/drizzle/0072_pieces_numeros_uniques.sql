-- Une pièce générique = un numéro à elle dans son emplacement.
--
-- Le numéro (`asset.position`) désigne la pièce partout : pièces autorisées
-- d'un personnage (slot_variants), calage (slot_adjust, clé « hair:2 »),
-- tenue par défaut (default_assets). « Nouvelle pièce » proposait 0 d'office :
-- en prod, trois coupes ont reçu 0 et une quatrième le 2 de « Hair 2 ». Caler
-- l'une calait les autres, cocher l'une les cochait toutes.
--
-- Pour chaque doublon, la pièce la plus ancienne garde son numéro (c'est
-- elle que la boutique affichait pour une tenue par défaut). Les autres
-- reçoivent le premier numéro libre de leur emplacement, et HÉRITENT de ce
-- qui valait pour elles jusqu'ici : cochées là où l'ancien numéro l'était,
-- calées comme lui. Rien ne bouge donc à l'écran ni à l'impression ; chaque
-- pièce se règle simplement à part désormais. Rejouable : sans doublon, rien
-- ne se passe.
DO $$
DECLARE
  r record;
  nouveau integer;
  ancienne_cle text;
BEGIN
  FOR r IN
    SELECT a.id, a.slot, coalesce(a.view, 'front') AS vue, a.position AS ancien
    FROM asset a
    WHERE a.character_type_id IS NULL
      AND EXISTS (
        SELECT 1 FROM asset b
        WHERE b.character_type_id IS NULL
          AND b.slot = a.slot
          AND coalesce(b.view, 'front') = coalesce(a.view, 'front')
          AND b.position = a.position
          AND b.id < a.id
      )
    ORDER BY a.id
  LOOP
    SELECT coalesce(max(position), 0) + 1 INTO nouveau
    FROM asset
    WHERE character_type_id IS NULL
      AND slot = r.slot
      AND coalesce(view, 'front') = r.vue;

    UPDATE asset SET position = nouveau WHERE id = r.id;

    -- Cochée là où son ancien numéro l'était.
    UPDATE character_type
    SET slot_variants = jsonb_set(
      slot_variants,
      ARRAY[r.slot],
      (slot_variants -> r.slot) || to_jsonb(nouveau)
    )
    WHERE orientation = r.vue
      AND jsonb_typeof(slot_variants -> r.slot) = 'array'
      AND (slot_variants -> r.slot) @> to_jsonb(r.ancien);

    -- Calée comme son ancien numéro.
    ancienne_cle := r.slot || ':' || r.ancien;
    UPDATE character_type
    SET slot_adjust = slot_adjust
      || jsonb_build_object(r.slot || ':' || nouveau, slot_adjust -> ancienne_cle)
    WHERE orientation = r.vue
      AND slot_adjust ? ancienne_cle;
  END LOOP;
END $$;
