-- Les ventes du stand, toutes payées et terminées (20/11, Alexandra : « mets
-- toutes celles que tu trouves, payées et terminées (toutes doivent être
-- terminées) »).
--
-- 1. Une vente ROUVERTE au stand et jamais revalidée redevient un panier, et
--    un panier n'apparaît nulle part au back-office : SAL-0003 (58 €, deux
--    affiches), validée à 09:12, rouverte 31 secondes plus tard par « Revenir
--    à ma commande », avait « disparu ». Elle reprend ce que sa validation
--    avait écrit (salon.ts) : payée, encaissement au grand livre, remise de
--    chaque affiche (« Terminée »), à l'heure de sa validation. Elle garde
--    son numéro, libre : c'est celui qui manquait dans la liste. Une vente
--    rouverte depuis moins d'une demi-heure n'est pas touchée : la tablette
--    est peut-être en train de la corriger.
-- 2. Une vente du stand payée dont des affiches ne sont pas remises (SAL-0001,
--    encaissée au back-office le 19/11, avant que la vente naisse remise)
--    reçoit sa remise : elle passe « Terminée ».
-- Rien ne bouge là où ces ventes n'existent pas.
DO $$
DECLARE
  v RECORD;
  remise integer;
BEGIN
  FOR v IN
    SELECT o."id",
      (SELECT max(e."created_at") FROM "order_event" e
        WHERE e."order_id" = o."id" AND e."message" LIKE 'Commande prise au stand%') AS validee,
      (SELECT max(e."created_at") FROM "order_event" e
        WHERE e."order_id" = o."id" AND e."message" LIKE 'Commande rouverte au stand%') AS rouverte,
      (SELECT coalesce(sum(i."unit_price_cents" * i."quantity"), 0)::int FROM "order_item" i
        WHERE i."order_id" = o."id") AS total
    FROM "order" o
    WHERE o."channel" = 'salon'
      AND o."status" = 'draft'
      AND o."cancelled_at" IS NULL
      AND o."number" ~ '^SAL-[0-9]+$'
      AND EXISTS (SELECT 1 FROM "order_item" i WHERE i."order_id" = o."id")
  LOOP
    CONTINUE WHEN v.validee IS NULL OR v.rouverte IS NULL
      OR v.rouverte < v.validee
      OR v.rouverte > now() - interval '30 minutes';

    UPDATE "order"
    SET "status" = 'paid', "total_cents" = v.total, "fulfilled_at" = v.validee, "last_activity_at" = now()
    WHERE "id" = v.id AND "status" = 'draft';

    INSERT INTO "order_transaction" ("order_id", "kind", "status", "amount_cents", "gateway", "created_at")
    VALUES (v.id, 'sale', 'success', v.total, 'stand', v.validee);

    INSERT INTO "fulfillment" ("order_id", "status", "created_at")
    VALUES (v.id, 'success', v.validee)
    RETURNING "id" INTO remise;
    INSERT INTO "fulfillment_item" ("fulfillment_id", "order_item_id", "quantity")
    SELECT remise, i."id", i."quantity" FROM "order_item" i
    WHERE i."order_id" = v.id AND i."gift_card" IS NULL AND i."quantity" > 0;

    INSERT INTO "order_event" ("order_id", "kind", "message")
    VALUES (v.id, 'event', format(
      'Vente retrouvée le 20/11 : rouverte au stand à %s pour être corrigée, elle n''avait jamais été revalidée et, redevenue un panier, n''apparaissait plus au back-office. Remise payée et terminée, comme à sa validation de %s ; son encaissement de %s € revient au grand livre.',
      to_char(v.rouverte AT TIME ZONE 'Europe/Paris', 'HH24:MI'),
      to_char(v.validee AT TIME ZONE 'Europe/Paris', 'HH24:MI'),
      replace(to_char(v.total / 100.0, 'FM999990.00'), '.', ',')));
  END LOOP;

  FOR v IN
    SELECT o."id",
      coalesce(
        (SELECT max(t."created_at") FROM "order_transaction" t
          WHERE t."order_id" = o."id" AND t."kind" = 'sale' AND t."status" = 'success'),
        o."created_at") AS encaissee
    FROM "order" o
    WHERE o."channel" = 'salon'
      AND o."status" = 'paid'
      AND o."cancelled_at" IS NULL
      AND EXISTS (
        SELECT 1 FROM "order_item" i
        WHERE i."order_id" = o."id" AND i."gift_card" IS NULL AND i."quantity" > coalesce((
          SELECT sum(fi."quantity") FROM "fulfillment_item" fi
          JOIN "fulfillment" f ON f."id" = fi."fulfillment_id"
          WHERE fi."order_item_id" = i."id" AND f."status" = 'success'), 0))
  LOOP
    INSERT INTO "fulfillment" ("order_id", "status", "created_at")
    VALUES (v.id, 'success', v.encaissee)
    RETURNING "id" INTO remise;
    INSERT INTO "fulfillment_item" ("fulfillment_id", "order_item_id", "quantity")
    SELECT remise, i."id", i."quantity" - coalesce((
      SELECT sum(fi."quantity") FROM "fulfillment_item" fi
      JOIN "fulfillment" f ON f."id" = fi."fulfillment_id"
      WHERE fi."order_item_id" = i."id" AND f."status" = 'success' AND f."id" <> remise), 0)
    FROM "order_item" i
    WHERE i."order_id" = v.id AND i."gift_card" IS NULL AND i."quantity" > coalesce((
      SELECT sum(fi."quantity") FROM "fulfillment_item" fi
      JOIN "fulfillment" f ON f."id" = fi."fulfillment_id"
      WHERE fi."order_item_id" = i."id" AND f."status" = 'success' AND f."id" <> remise), 0);

    UPDATE "order" SET "fulfilled_at" = coalesce("fulfilled_at", v.encaissee) WHERE "id" = v.id;

    INSERT INTO "order_event" ("order_id", "kind", "message")
    VALUES (v.id, 'event', 'Vente du stand marquée remise, donc terminée, le 20/11 : toutes les ventes du stand le sont, l''affiche se remet sur place.');
  END LOOP;

  -- Remise complète mais sans date de fin : la date de sa dernière remise.
  UPDATE "order" o
  SET "fulfilled_at" = (SELECT max(f."created_at") FROM "fulfillment" f WHERE f."order_id" = o."id" AND f."status" = 'success')
  WHERE o."channel" = 'salon' AND o."status" = 'paid' AND o."cancelled_at" IS NULL AND o."fulfilled_at" IS NULL
    AND EXISTS (SELECT 1 FROM "fulfillment" f WHERE f."order_id" = o."id" AND f."status" = 'success');
END $$;
