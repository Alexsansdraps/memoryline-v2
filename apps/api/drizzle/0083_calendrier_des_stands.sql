-- Le calendrier des stands (Alexandra, 17/11) : dates de début et de fin,
-- horaires de base (un créneau le matin, un l'après-midi), jours qui s'en
-- écartent ou sont fermés, et qui décide de l'ouverture (« manuel » : le
-- bouton, comme avant ; « calendrier » : les jours de marché).
ALTER TABLE "stand" ADD COLUMN IF NOT EXISTS "date_debut" text;
--> statement-breakpoint
ALTER TABLE "stand" ADD COLUMN IF NOT EXISTS "date_fin" text;
--> statement-breakpoint
ALTER TABLE "stand" ADD COLUMN IF NOT EXISTS "horaires" jsonb;
--> statement-breakpoint
ALTER TABLE "stand" ADD COLUMN IF NOT EXISTS "pilotage" text DEFAULT 'manuel' NOT NULL;
