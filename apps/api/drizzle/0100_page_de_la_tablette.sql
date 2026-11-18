-- La page de la tablette de chaque stand (18/11, Alexandra : « il faut qu'un
-- stand ait une page attribuée et une seule ! », « chaque stand je veux
-- dire », « pour moi tout se config sur /bo/ventes-salon »). En mode stand,
-- la tablette n'affiche que cette page : l'accueil y mène, et une adresse
-- hors d'elle y ramène ; restent la fiche de ses affiches, le panier et la
-- validation de la vente. Vide : la tablette montre tout le catalogue, comme
-- avant. Une page supprimée libère le stand, qui reste.
ALTER TABLE "stand" ADD COLUMN IF NOT EXISTS "page_id" integer;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stand" ADD CONSTRAINT "stand_page_id_page_id_fk"
    FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
