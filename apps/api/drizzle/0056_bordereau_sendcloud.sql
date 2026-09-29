CREATE TABLE "bordereau" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"cle_demande" text NOT NULL,
	"statut" text DEFAULT 'en_cours' NOT NULL,
	"essai" boolean DEFAULT false NOT NULL,
	"methode_code" text NOT NULL,
	"methode_nom" text NOT NULL,
	"transporteur" text,
	"poids_grammes" integer NOT NULL,
	"prix_annonce_cents" integer,
	"shipment_id" text,
	"parcel_id" integer,
	"tracking_number" text,
	"tracking_url" text,
	"erreur" text,
	"auteur" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"achete_at" timestamp with time zone,
	"annule_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bordereau" ADD CONSTRAINT "bordereau_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bordereau_order_idx" ON "bordereau" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bordereau_cle_demande_uniq" ON "bordereau" USING btree ("cle_demande");--> statement-breakpoint
CREATE UNIQUE INDEX "bordereau_vivant_uniq" ON "bordereau" USING btree ("order_id") WHERE "bordereau"."statut" in ('en_cours', 'achete');