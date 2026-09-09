CREATE TABLE "lettre_envoi" (
	"id" serial PRIMARY KEY NOT NULL,
	"lettre_id" integer NOT NULL,
	"email" text NOT NULL,
	"resultat" text DEFAULT 'en_attente' NOT NULL,
	"envoye_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lettre_jeton" (
	"jeton" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"desabonne_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lettre" (
	"id" serial PRIMARY KEY NOT NULL,
	"titre" text NOT NULL,
	"objet" text NOT NULL,
	"contenu_html" text DEFAULT '' NOT NULL,
	"etat" text DEFAULT 'brouillon' NOT NULL,
	"envoyee_le" timestamp with time zone,
	"destinataires_prevus" integer DEFAULT 0 NOT NULL,
	"envois_reussis" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lettre_envoi" ADD CONSTRAINT "lettre_envoi_lettre_id_lettre_id_fk" FOREIGN KEY ("lettre_id") REFERENCES "public"."lettre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lettre_envoi_lettre_email_uniq" ON "lettre_envoi" USING btree ("lettre_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "lettre_jeton_email_uniq" ON "lettre_jeton" USING btree ("email");