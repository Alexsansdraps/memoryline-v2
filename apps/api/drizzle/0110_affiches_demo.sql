-- Les affiches de démonstration (20/11, Alexandra : « un menu dans le bo où
-- on peut générer des affiches de test […] qu'elle peut imprimer en HQ […]
-- pour présenter au marché de noel de mulhouse. Mais ça doit servir dans le
-- futur pour d'autres »). Voir apps/api/src/affiches-demo.ts.
--
-- SCHÉMA SEULEMENT : deux tables neuves, aucune donnée écrite, rien d'autre
-- ne bouge. Des tables à elles plutôt que de fausses commandes : une commande
-- fausserait les numéros WEB-/SAL-, les ventes, les Finances et les
-- Statistiques, et retiendrait fonds et personnages contre la suppression.
--
-- 1. « lot_affiches_demo » : un lot, sa demande (affiches et exemplaires,
--    noms d'exemple, couleur du texte) et son interrupteur « arrêté ».
-- 2. « affiche_demo » : chaque affiche tirée, avec sa configuration (celle
--    d'une ligne de commande, de quoi la refaire à l'identique), et, une fois
--    son PDF rangé sur le disque, sa taille et son CRC-32 (le .zip du lot
--    s'écrit en flux grâce à eux). « product_id » n'a PAS de clé étrangère :
--    une affiche de démonstration ne retient aucun produit.
CREATE TABLE "lot_affiches_demo" (
	"id" serial PRIMARY KEY NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"cree_par" text,
	"format" text NOT NULL,
	"scene" text NOT NULL,
	"demande" jsonb NOT NULL,
	"arrete" boolean DEFAULT false NOT NULL,
	CONSTRAINT "lot_affiches_demo_format_check" CHECK ("lot_affiches_demo"."format" in ('A4', 'A3'))
);
--> statement-breakpoint
CREATE TABLE "affiche_demo" (
	"id" serial PRIMARY KEY NOT NULL,
	"lot_id" integer NOT NULL,
	"rang" integer NOT NULL,
	"product_id" integer,
	"titre" text NOT NULL,
	"scene" text NOT NULL,
	"tirage" integer DEFAULT 0 NOT NULL,
	"resume" jsonb,
	"config" jsonb NOT NULL,
	"nom_fichier" text NOT NULL,
	"taille" integer,
	"crc32" bigint,
	"duree_ms" integer,
	"erreur" text,
	"fait_le" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "affiche_demo" ADD CONSTRAINT "affiche_demo_lot_id_lot_affiches_demo_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lot_affiches_demo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "affiche_demo_lot_idx" ON "affiche_demo" USING btree ("lot_id","rang");
