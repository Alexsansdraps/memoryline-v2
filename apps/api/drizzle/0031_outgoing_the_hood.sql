CREATE TABLE "menu_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"label" text NOT NULL,
	"href" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"translations" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"translations" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_parent_id_menu_item_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."menu_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_item_parent_idx" ON "menu_item" USING btree ("parent_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "page_slug_uniq" ON "page" USING btree ("slug");--> statement-breakpoint
-- Le menu du site tel qu'il était écrit en dur dans la boutique, recopié ici
-- pour que la navigation ne disparaisse pas le jour où elle sera lue en base.
-- La garde « table vide » évite de doubler les entrées si cette migration est
-- rejouée sur une base déjà pourvue.
WITH parent AS (
	INSERT INTO "menu_item" ("label", "href", "position", "visible")
	SELECT 'Affiches personnalisables', '/affiches?genre=personnalisable', 0, true
	WHERE NOT EXISTS (SELECT 1 FROM "menu_item")
	RETURNING "id"
), enfants AS (
	INSERT INTO "menu_item" ("parent_id", "label", "href", "position", "visible")
	SELECT parent."id", e."label", e."href", e."position", true
	FROM parent
	CROSS JOIN (VALUES
		('Tout voir', '/affiches?genre=personnalisable', 0),
		('Villes', '/affiches?genre=personnalisable&collection=villes', 1),
		('Thèmes et paysages', '/affiches?genre=personnalisable&collection=balades-paysages', 2)
	) AS e("label", "href", "position")
	RETURNING "id"
)
INSERT INTO "menu_item" ("label", "href", "position", "visible")
SELECT 'Affiches prêtes à imprimer', '/affiches?genre=prete_a_imprimer', 1, true
WHERE EXISTS (SELECT 1 FROM parent);
