-- Les étapes du traitement d'une commande (17/11) : la fiche du BO montre une
-- frise par parcours — stand (À imprimer → Terminée), livraison (En
-- préparation → Envoyée → Livrée), retrait (En préparation → Prête à
-- retirer → Retirée).
--
-- Ce qui est parti se lit toujours dans les expéditions (fulfillment) : rien
-- à reprendre pour les commandes d'avant. Il manquait seulement deux dates,
-- pour ce que les expéditions ne savent pas dire. Nulles par défaut : une
-- commande déjà passée garde l'étape que disent ses expéditions.
--
-- 1. « Prête à retirer » : la commande attend la cliente au lieu choisi,
--    rien n'est encore parti.
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "ready_at" timestamp with time zone;
--> statement-breakpoint
-- 2. « Livrée » : le colis envoyé est arrivé. Posée à la main au BO :
--    SendCloud ne renvoie pas encore l'état des colis.
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp with time zone;
