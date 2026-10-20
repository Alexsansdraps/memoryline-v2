/*
 * Les clés de paiement saisies au back-office (BO › Réglages › Paiements),
 * pour passer la boutique de l'essai au réel sans toucher au .env du serveur.
 * SCHÉMA SEULEMENT : aucune donnée n'est écrite, rien n'est supprimé.
 *
 * 1. « cle_paiement » : une ligne par valeur saisie, CHIFFRÉE (AES-256-GCM,
 *    clé dérivée d'APP_SECRET : voir apps/api/src/paiements-cles.ts). Une
 *    seule valeur vivante par case (index unique partiel) ; remplacer ou
 *    effacer archive la précédente.
 * 2. « journal_paiement » : qui a fait quoi et quand (clé enregistrée ou
 *    effacée, vérification, bascule essai ou réel, vraies étiquettes), sans
 *    jamais une valeur. L'état se lit dans sa dernière ligne.
 * 3. « payment.mode » (test ou live), vide pour les paiements d'avant : ils
 *    ont tous été ouverts avec les clés du .env, dont le mode se déduit.
 *
 * Tant que rien n'est saisi à l'écran, la boutique marche exactement comme
 * avant, avec le .env.
 */
CREATE TABLE "cle_paiement" (
	"id" serial PRIMARY KEY NOT NULL,
	"prestataire" text NOT NULL,
	"mode" text NOT NULL,
	"champ" text NOT NULL,
	"valeur_chiffree" text NOT NULL,
	"fin" text NOT NULL,
	"empreinte" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"cree_par" text,
	"archive_le" timestamp with time zone,
	"archive_par" text,
	CONSTRAINT "cle_paiement_prestataire_check" CHECK ("cle_paiement"."prestataire" in ('stripe', 'paypal')),
	CONSTRAINT "cle_paiement_mode_check" CHECK ("cle_paiement"."mode" in ('test', 'live')),
	CONSTRAINT "cle_paiement_champ_check" CHECK (("cle_paiement"."prestataire" = 'stripe' and "cle_paiement"."champ" in ('cle_publique', 'cle_secrete', 'secret_webhook')) or ("cle_paiement"."prestataire" = 'paypal' and "cle_paiement"."champ" in ('client_id', 'secret')))
);
--> statement-breakpoint
CREATE TABLE "journal_paiement" (
	"id" serial PRIMARY KEY NOT NULL,
	"le" timestamp with time zone DEFAULT now() NOT NULL,
	"par" text,
	"action" text NOT NULL,
	"prestataire" text,
	"mode" text,
	"champ" text,
	"valeur" text,
	"detail" jsonb,
	CONSTRAINT "journal_paiement_action_check" CHECK ("journal_paiement"."action" in ('cle_enregistree', 'cle_archivee', 'verification', 'mode', 'etiquettes'))
);
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "mode" text;--> statement-breakpoint
CREATE UNIQUE INDEX "cle_paiement_vivante_uniq" ON "cle_paiement" USING btree ("prestataire","mode","champ") WHERE "cle_paiement"."archive_le" is null;--> statement-breakpoint
CREATE INDEX "journal_paiement_sujet_idx" ON "journal_paiement" USING btree ("action","prestataire","mode","id");