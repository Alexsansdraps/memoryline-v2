-- La date d'une vente du stand est celle de sa DERNIÈRE validation (20/11,
-- Alexandra : « il faut prendre la date à laquelle c'est validé !!! »).
--
-- SAL-0006 avait été validée à 11 h 32, rouverte à 11 h 37 (« Revenir à ma
-- commande ») sans être revalidée, puis revalidée à 20 h 03 pour la vente de
-- ce soir : elle gardait l'heure du matin. Le code date désormais une vente à
-- chaque validation ; ici, les ventes déjà faites prennent l'heure de leur
-- dernière validation, lue dans leur journal (« Commande prise au stand… »).
-- Une vente sans cette ligne, ou déjà à la bonne heure, ne bouge pas.
UPDATE "order" o
SET "created_at" = v.validee
FROM (
  SELECT e."order_id", max(e."created_at") AS validee
  FROM "order_event" e
  WHERE e."message" LIKE 'Commande prise au stand%'
  GROUP BY e."order_id"
) v
WHERE o."id" = v."order_id"
  AND o."number" LIKE 'SAL-%'
  AND o."created_at" < v.validee - interval '1 minute';
