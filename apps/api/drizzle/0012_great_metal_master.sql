CREATE TABLE "frame" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"preview_color" text,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "frame_slug_uniq" ON "frame" USING btree ("slug");
--> statement-breakpoint
-- Les deux cadres demandés, avec un prix de départ à ajuster au back-office.
INSERT INTO "frame" ("slug", "name", "price_cents", "preview_color", "position")
VALUES
  ('blanc', 'Cadre blanc', 1500, '#f4f2ee', 0),
  ('bois', 'Cadre bois', 1900, '#b07d42', 1)
ON CONFLICT ("slug") DO NOTHING;

