-- Les ESSAIS du 17/11 en production, supprimés à la demande d'Alexandra
-- (18/11 : « supp ces commandes tests », « supp ces 2 clients tests ») :
-- WEB-0002 (a.porhansl@icloud.com), SAL-0001 (oooo@dff.fr) et SAL-0002
-- (a.porhansl96@gmail.com), puis les fiches oooo@dff.fr et
-- a.porhansl96@gmail.com.
--
-- La suppression du BO les refuse, et elle a raison pour une vraie vente :
-- payée (« Terminée »), une vente se garde dix ans. Ce sont des essais, sans
-- argent réel. La migration les vise une à une, par numéro ET par l'e-mail de
-- leur fiche : rien d'autre ne peut partir. Une commande qui porte un
-- paiement Stripe ou PayPal abouti reste (de l'argent réel a circulé, elle se
-- règle à part).
--
-- Partent avec elles (cascades) : lignes, journal, paiements manuels, envois,
-- remboursements, fichiers d'impression. Cartes cadeaux et mouvements de
-- carte : détachés (lien vidé).
DELETE FROM "order" o
USING "customer" c
WHERE o."customer_id" = c."id"
  AND (o."number", lower(c."email")) IN (
    ('WEB-0002', 'a.porhansl@icloud.com'),
    ('SAL-0001', 'oooo@dff.fr'),
    ('SAL-0002', 'a.porhansl96@gmail.com')
  )
  AND NOT EXISTS (
    SELECT 1 FROM "payment" p
    WHERE p."order_id" = o."id"
      AND p."provider" IN ('stripe', 'paypal')
      AND coalesce(p."status", '') NOT IN
        ('pending', 'failed', 'canceled', 'cancelled', 'requires_payment_method', 'expired', 'voided')
  );
--> statement-breakpoint
-- Les deux fiches d'essai, si plus rien de vendu ou de facturé ne s'y
-- rattache. Leurs adresses, sessions et jetons partent avec elles.
DELETE FROM "customer" c
WHERE lower(c."email") IN ('oooo@dff.fr', 'a.porhansl96@gmail.com')
  AND NOT EXISTS (
    SELECT 1 FROM "order" o
    WHERE o."customer_id" = c."id"
      AND (o."invoice_number" IS NOT NULL OR o."status" IN ('paid', 'authorized'))
  );
--> statement-breakpoint
-- Le compteur des factures de 2026 : s'il ne reste AUCUNE facture de 2026
-- (celles des essais viennent de partir), la première vraie facture sera la
-- F2026-0001. S'il en reste une seule, il ne bouge pas : la suite des vraies
-- factures ne repasse jamais par un numéro déjà donné.
DELETE FROM "facture_compteur" f
WHERE f."annee" = 2026
  AND NOT EXISTS (SELECT 1 FROM "order" o WHERE o."invoice_number" LIKE 'F2026-%');
