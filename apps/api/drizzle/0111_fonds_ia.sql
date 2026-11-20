-- « Créer un fond » (BO › Atelier, 20/11). Margaux : « Si seulement tu
-- pouvais me faire un programme où j'ai juste à mettre des photos et qu'il me
-- génère des fonds automatiquement sans que je discute pendant 2h pour faire
-- un seule fond de ville ». Voir apps/api/src/fonds-ia.ts.
--
-- SCHÉMA SEULEMENT : deux tables neuves et deux colonnes neuves, aucune
-- donnée écrite.
--
-- 1. « fond_ia » : un fond, c'est-à-dire UNE photo d'un lieu (plusieurs photos
--    déposées d'un coup forment un lot, et chacune a son fond), son nom, le
--    style des affiches IA dont la consigne est relue à chaque dessin, la
--    version courante et celle enregistrée comme décor. Le jeton, unique,
--    rend l'envoi sûr contre le double clic.
-- 2. « fond_ia_message » : la discussion de chaque fond ; un message = une
--    demande et le dessin qui en sort.
-- 3. « ai_generation.fond_id » et « fond_message_id » : chaque version est
--    une génération comme une autre — même coût, même plafond du mois —,
--    marquée comme fond. La purge des photos de visiteurs ne la touche pas
--    (ia.ts, generationPerimee).
CREATE TABLE "fond_ia" (
	"id" serial PRIMARY KEY NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"cree_par" text,
	"jeton" text NOT NULL,
	"lot" text NOT NULL,
	"nom" text NOT NULL,
	"precision" text,
	"photos" jsonb NOT NULL,
	"exemples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"style_id" integer,
	"versions" integer NOT NULL,
	"version_courante" text,
	"version_gardee" text,
	"background_id" integer,
	"enregistre_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fond_ia_message" (
	"id" serial PRIMARY KEY NOT NULL,
	"fond_id" integer NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"cree_par" text,
	"jeton" text NOT NULL,
	"texte" text DEFAULT '' NOT NULL,
	"demande" text DEFAULT '' NOT NULL,
	"base_version" text,
	"versions" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fond_ia" ADD CONSTRAINT "fond_ia_style_id_ia_prompt_id_fk" FOREIGN KEY ("style_id") REFERENCES "public"."ia_prompt"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fond_ia" ADD CONSTRAINT "fond_ia_background_id_background_id_fk" FOREIGN KEY ("background_id") REFERENCES "public"."background"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fond_ia_jeton_uniq" ON "fond_ia" USING btree ("jeton");--> statement-breakpoint
CREATE INDEX "fond_ia_lot_idx" ON "fond_ia" USING btree ("lot");--> statement-breakpoint
ALTER TABLE "fond_ia_message" ADD CONSTRAINT "fond_ia_message_fond_id_fond_ia_id_fk" FOREIGN KEY ("fond_id") REFERENCES "public"."fond_ia"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fond_ia_message_jeton_uniq" ON "fond_ia_message" USING btree ("jeton");--> statement-breakpoint
CREATE INDEX "fond_ia_message_fond_idx" ON "fond_ia_message" USING btree ("fond_id");--> statement-breakpoint
ALTER TABLE "ai_generation" ADD COLUMN "fond_id" integer;--> statement-breakpoint
ALTER TABLE "ai_generation" ADD COLUMN "fond_message_id" integer;--> statement-breakpoint
ALTER TABLE "ai_generation" ADD CONSTRAINT "ai_generation_fond_id_fond_ia_id_fk" FOREIGN KEY ("fond_id") REFERENCES "public"."fond_ia"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generation" ADD CONSTRAINT "ai_generation_fond_message_id_fond_ia_message_id_fk" FOREIGN KEY ("fond_message_id") REFERENCES "public"."fond_ia_message"("id") ON DELETE set null ON UPDATE no action;
