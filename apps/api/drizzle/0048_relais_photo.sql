-- Le relais de photo du stand : la tablette affiche un code, le téléphone du
-- client y envoie sa photo, la tablette la récupère (apps/api/src/ia-relais.ts).
-- En base plutôt qu'en mémoire : un redémarrage de l'API entre l'affichage du
-- code et l'envoi de la photo ne doit rien perdre. Aucune donnée personnelle
-- ici — la photo vit sur le disque, le temps que la tablette la prenne.
CREATE TABLE "ia_relais_photo" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"jeton_hash" text NOT NULL,
	"stand_id" integer NOT NULL,
	"photo_path" text,
	"envois" integer DEFAULT 0 NOT NULL,
	"recue_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ia_relais_photo" ADD CONSTRAINT "ia_relais_photo_stand_id_stand_id_fk" FOREIGN KEY ("stand_id") REFERENCES "public"."stand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ia_relais_photo_code_uniq" ON "ia_relais_photo" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "ia_relais_photo_jeton_uniq" ON "ia_relais_photo" USING btree ("jeton_hash");--> statement-breakpoint
CREATE INDEX "ia_relais_photo_expire_idx" ON "ia_relais_photo" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ia_relais_photo_stand_idx" ON "ia_relais_photo" USING btree ("stand_id");