/*
 * Le BORDEREAU transporteur : l'étiquette A6 qui se colle SUR le colis.
 *
 * Ce n'est PAS le bon de livraison — le récapitulatif A4 qui voyage DANS le
 * colis, et qui ne bouge pas d'une ligne. Deux documents, deux formats.
 *
 * Ce qui manquait à la boutique n'était pas l'achat : c'était le CONTENANT.
 * « Expédier » écrivait trois champs de texte libre, et aucune colonne, aucun
 * dossier, aucune route ne savait recevoir le PDF d'une étiquette. Alexandra
 * achetait son étiquette chez le transporteur, l'imprimait, et le fichier ne
 * revenait jamais : pour la réimprimer, il fallait rouvrir leur site.
 *
 * POURQUOI UNE TABLE ET PAS TROIS COLONNES SUR « fulfillment » :
 *
 *   - la ligne doit naître AVANT l'appel au transporteur, pour qu'une dépense
 *     laisse toujours une trace même si la réponse se perd. Elle ne peut donc
 *     pas être une colonne d'une expédition qui n'existe pas encore ;
 *   - une expédition vit très bien sans bordereau — remise en main propre au
 *     stand, action groupée, suivi saisi à la main —, et ces trois chemins-là
 *     ne doivent rien apprendre de neuf ;
 *   - un bordereau a une vie à lui (déposé, acheté, puis annulé chez le
 *     transporteur) qui n'est pas la vie comptable du colis.
 *
 * CE QUE CETTE MIGRATION NE FAIT PAS. Elle ne touche NI à « order » NI à
 * « fulfillment » : carrier, tracking_number et tracking_url restent le seul
 * endroit où les courriers, l'espace client et le bon de livraison lisent le
 * suivi. Le bordereau les alimente, il ne les remplace pas — c'est ce qui
 * fait que rien en aval ne change.
 *
 * Les colonnes de l'ACHAT DIRECT (cle_demande, reference, parcel_id, les
 * prix…) sont créées maintenant, nullables, alors que l'achat n'est pas
 * encore écrit. Elles ne coûtent rien vides, et évitent une seconde migration
 * sur une table déjà pleine le jour où il arrivera.
 *
 * Un bordereau ne se supprime pas : le retirer pose « retire_at », et le PDF
 * reste sur le disque — c'est la preuve d'une dépense.
 */
CREATE TABLE "bordereau" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"fulfillment_id" integer,
	"source" text NOT NULL,
	"statut" text DEFAULT 'depose' NOT NULL,
	"transporteur" text NOT NULL,
	"transporteur_nom" text NOT NULL,
	"tracking_number" text NOT NULL,
	"tracking_url" text,
	"poids_grammes" integer NOT NULL,
	"fichier" text,
	"fichier_octets" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"retire_at" timestamp with time zone,
	"cle_demande" text,
	"reference" text,
	"fournisseur" text,
	"essai" boolean DEFAULT false NOT NULL,
	"option_code" text,
	"contract_id" integer,
	"shipment_id" text,
	"parcel_id" text,
	"charging_type" text,
	"prix_annonce_cents" integer,
	"prix_constate_cents" integer,
	"devise" text DEFAULT 'EUR',
	"point_relais_sendcloud_id" text,
	"achete_at" timestamp with time zone,
	"annule_at" timestamp with time zone,
	"erreur" text
);
--> statement-breakpoint
ALTER TABLE "bordereau" ADD CONSTRAINT "bordereau_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bordereau" ADD CONSTRAINT "bordereau_fulfillment_id_fulfillment_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "public"."fulfillment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bordereau_order_idx" ON "bordereau" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bordereau_cle_demande_uniq" ON "bordereau" USING btree ("cle_demande");--> statement-breakpoint
CREATE UNIQUE INDEX "bordereau_reference_uniq" ON "bordereau" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "bordereau_parcel_uniq" ON "bordereau" USING btree ("parcel_id") WHERE "bordereau"."parcel_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "bordereau_actif_uniq" ON "bordereau" USING btree ("order_id") WHERE "bordereau"."retire_at" is null and "bordereau"."statut" <> 'annule';
--> statement-breakpoint
/*
 * Les trois réglages de l'expédition, posés avec leurs valeurs prudentes.
 *
 * Ils ne sont PAS secrets — ce sont des garde-fous, et ils ont donc leur place
 * dans « setting », que le back-office sait déjà éditer. Les clés d'API du
 * transporteur, elles, n'y entreront jamais : cette table part en entier dans
 * chaque sauvegarde de la base, en clair, quatorze jours de suite.
 *
 * « mode_essai » à VRAI, et pas à faux : tant qu'il est allumé, le serveur
 * fabrique des étiquettes que le transporteur ne facture pas. Une boutique
 * qui découvre un bouton d'achat doit pouvoir tout essayer avant que le
 * premier euro parte ; en sortir demandera un geste délibéré, avec une
 * confirmation écrite.
 *
 * « plafond_cents » à 2000 : un colis mal pesé se tarife à soixante euros
 * sans prévenir. Le plafond refuse et nomme son montant, plutôt que de
 * laisser passer.
 *
 * « poids_defaut_grammes » à 500 : le poids enregistré sur les anciennes
 * commandes vaut souvent zéro, et une étiquette à 0 g serait refusée ou mal
 * tarifée. C'est une valeur PROPOSÉE, toujours corrigeable avant l'achat.
 *
 * « expedition.expediteur » n'est volontairement PAS posé. Une adresse
 * inventée s'imprimerait sur de vraies étiquettes et enverrait les colis
 * refusés nulle part : le vide, lui, se voit à l'écran par un bandeau qui
 * demande de la renseigner.
 *
 * Chaque insertion se garde d'écraser quoi que ce soit (« WHERE NOT EXISTS »
 * sur la clé, comme 0055) : la migration peut être rejouée, et ne touche pas
 * à un réglage déjà modifié par Alexandra.
 */
INSERT INTO "setting" (key, value, label, "group")
SELECT 'expedition.mode_essai', 'true'::jsonb,
       'Mode essai (aucun bordereau n''est facturé)', 'expedition'
WHERE NOT EXISTS (SELECT 1 FROM "setting" WHERE key = 'expedition.mode_essai');
--> statement-breakpoint
INSERT INTO "setting" (key, value, label, "group")
SELECT 'expedition.plafond_cents', '2000'::jsonb,
       'Prix maximum d''un bordereau, en centimes', 'expedition'
WHERE NOT EXISTS (SELECT 1 FROM "setting" WHERE key = 'expedition.plafond_cents');
--> statement-breakpoint
INSERT INTO "setting" (key, value, label, "group")
SELECT 'expedition.poids_defaut_grammes', '500'::jsonb,
       'Poids proposé par défaut pour un colis, en grammes', 'expedition'
WHERE NOT EXISTS (SELECT 1 FROM "setting" WHERE key = 'expedition.poids_defaut_grammes');
