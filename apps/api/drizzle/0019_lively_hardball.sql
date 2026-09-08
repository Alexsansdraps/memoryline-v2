CREATE TABLE "shipping_method" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'home' NOT NULL,
	"carrier" text,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_rate" (
	"id" serial PRIMARY KEY NOT NULL,
	"method_id" integer NOT NULL,
	"zone_id" integer NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"free_from_cents" integer,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_zone" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"countries" jsonb,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "shipping_method" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "shipping_label" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "shipping_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "shipping_name" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "shipping_line1" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "shipping_line2" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "shipping_postal_code" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "shipping_city" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "shipping_country" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "shipping_phone" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "relay_point_id" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "relay_point_label" text;--> statement-breakpoint
ALTER TABLE "shipping_rate" ADD CONSTRAINT "shipping_rate_method_id_shipping_method_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."shipping_method"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rate" ADD CONSTRAINT "shipping_rate_zone_id_shipping_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."shipping_zone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_method_slug_uniq" ON "shipping_method" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_rate_uniq" ON "shipping_rate" USING btree ("method_id","zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_zone_slug_uniq" ON "shipping_zone" USING btree ("slug");--> statement-breakpoint
-- Trois zones. « Reste du monde » a une liste de pays VIDE : c'est la zone
-- par défaut, celle qui ramasse tout ce que les deux autres ne réclament pas.
INSERT INTO "shipping_zone" ("slug", "name", "countries", "position") VALUES
  ('france', 'France', '["FR","MC"]'::jsonb, 0),
  ('europe', 'Europe', '["BE","LU","CH","DE","IT","ES","NL","PT","AT","IE","DK","SE","FI","PL","CZ","SK","HU","SI","HR","RO","BG","GR","EE","LV","LT","MT","CY","NO","IS","LI","GB","AD"]'::jsonb, 1),
  ('monde', 'Reste du monde', '[]'::jsonb, 2)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "shipping_method" ("slug", "name", "description", "kind", "carrier", "position") VALUES
  ('mondial_relay', 'Point relais', 'Mondial Relay — 3 à 5 jours ouvrés', 'relay', 'mondial_relay', 0),
  ('colissimo', 'À domicile', 'Colissimo — 2 à 3 jours ouvrés', 'home', 'colissimo', 1),
  ('retrait', 'Retrait sur place', 'Remise en main propre, sans frais', 'pickup', NULL, 2)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Tarifs de départ, tous modifiables au back-office.
INSERT INTO "shipping_rate" ("method_id", "zone_id", "price_cents", "free_from_cents", "active")
SELECT m."id", z."id", t."prix", t."franco", t."actif"
FROM (VALUES
  ('mondial_relay', 'france',  490,  6000, true),
  ('mondial_relay', 'europe',  790,  9000, true),
  ('mondial_relay', 'monde',     0,  NULL, false),
  ('colissimo',     'france',  690,  6000, true),
  ('colissimo',     'europe', 1290,  9000, true),
  ('colissimo',     'monde',  1990, 15000, true),
  ('retrait',       'france',    0,  NULL, true),
  ('retrait',       'europe',    0,  NULL, false),
  ('retrait',       'monde',     0,  NULL, false)
) AS t("mode", "zone", "prix", "franco", "actif")
JOIN "shipping_method" m ON m."slug" = t."mode"
JOIN "shipping_zone" z ON z."slug" = t."zone"
ON CONFLICT DO NOTHING;
