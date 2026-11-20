-- La date des ventes du stand (20/11, Alexandra : « je viens de la créer !!!
-- Y'a un problème de date là ») : une vente garde la ligne du panier de la
-- tablette, et sa date était celle où ce panier s'était ouvert — SAL-0004,
-- faite le 20/11 à 10 h 10, s'affichait « le 18 novembre à 09:58 ». Le code
-- date désormais la vente à sa validation ; ici, les ventes déjà faites
-- reprennent l'heure de leur première validation, lue dans leur journal
-- (« Commande prise au stand… »). Une vente sans cette ligne ne bouge pas.
UPDATE "order" o
SET "created_at" = v.validee
FROM (
  SELECT e."order_id", min(e."created_at") AS validee
  FROM "order_event" e
  WHERE e."message" LIKE 'Commande prise au stand%'
  GROUP BY e."order_id"
) v
WHERE o."id" = v."order_id"
  AND o."number" LIKE 'SAL-%'
  AND o."created_at" < v.validee - interval '1 minute';
