CREATE TABLE "poster_view" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"foreground_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "poster_view_slug_uniq" ON "poster_view" USING btree ("slug");--> statement-breakpoint
-- Les deux types qui existaient en dur dans le code. Le muret n'était posé
-- qu'en vue de dos : la règle devient une donnée du type.
INSERT INTO "poster_view" ("slug", "name", "foreground_url", "position") VALUES
  ('front', 'De face', NULL, 0),
  ('back', 'De dos', '/assets/muret_officiel.svg', 1)
ON CONFLICT DO NOTHING;
