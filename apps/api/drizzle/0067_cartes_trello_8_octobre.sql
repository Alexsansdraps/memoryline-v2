/*
 * Les cartes Trello du 8 octobre et les réponses de la boutique : une seule
 * migration pour toutes, faite avant les écrans qui s'en servent.
 *
 * Schéma seulement : aucune ligne existante n'est réécrite. Chaque colonne
 * nouvelle part d'une valeur qui redonne exactement le comportement
 * d'aujourd'hui, et le code retombe sur l'ancienne lecture quand elle est
 * vide.
 *
 * D2 — Ordre de « Toutes les affiches ». `product.ordre_catalogue` : la page
 * sans filtre mêle les deux genres, dont les rangs (`ordre_affichage`) se
 * marchaient dessus. 0 partout = rien n'est rangé, la page reste triée par
 * nouveautés tant que la boutique n'y a pas touché.
 *
 * D4 — Changer l'adresse d'une affiche pose une 301. `redirect.archived_at` :
 * une redirection remplacée s'archive au lieu d'être effacée, et l'unicité de
 * `from_path` ne porte plus que sur les redirections vivantes (sinon une
 * adresse ne pourrait plus jamais recevoir de nouvelle redirection). Les
 * redirections existantes restent toutes vivantes : même unicité qu'avant.
 *
 * D6 — Un vendeur ne voit que les ventes de ses stands.
 * `admin_user.stand_ids`, un tableau d'identifiants, vide par défaut. Vide =
 * aucune vente visible : le compte vendeur existant ne verra plus rien tant
 * qu'on ne lui aura pas confié son stand dans « Comptes ». C'est voulu (refus
 * par défaut). Ignoré pour la propriétaire.
 *
 * D7 — Lieux de retrait gérés au back-office. Nouvelle table `pickup_point`,
 * vide : le mode « retrait » quitte la caisse tant qu'aucun lieu n'est créé.
 * Sur la commande, `pickup_point_id` (le lieu choisi) et `pickup_point` (ce
 * que la cliente a lu, figé). Null pour les commandes d'avant, dont le
 * retrait se lit toujours dans `relay_point_label` (« stand:<id> »).
 *
 * D8 — Adresse et SIRET de la boutique sur les factures.
 * `order.invoice_issuer`, figé avec le numéro de facture, pour qu'un
 * changement d'adresse ne réécrive pas les factures émises. Null pour les
 * factures d'avant, qui prennent les réglages du moment, comme avant.
 *
 * D9 — Offre « 3 achetées = 1 A4 offerte, cadre non compris » et promotions
 * modifiables. `order_item.frame_cents` : la part du cadre dans le prix
 * unitaire, null pour les lignes d'avant (le serveur prend alors le prix
 * actuel du cadre, borné au prix unitaire). `promo_rule.archived_at` :
 * archiver une promotion plutôt que la supprimer, null partout. `order.promotions` :
 * les règles et la remise figées au passage en caisse, null pour les
 * commandes d'avant, qui suivent les règles en vigueur comme aujourd'hui.
 *
 * D10 — Le bandeau devient une liste de messages qui défilent, sans lien avec
 * les promotions. `announcement_banner.position` (0 : le bandeau existant
 * reste premier, l'ordre de création départage) et `archived_at` (null).
 * `promo_rule_id` reste, plus lu.
 *
 * Les commandes déjà passées ne bougent pas : montants, contenu et
 * impression sont figés ailleurs, et rien ici ne les réécrit.
 */
CREATE TABLE "pickup_point" (
	"id" serial PRIMARY KEY NOT NULL,
	"nom" text NOT NULL,
	"adresse" text,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"translations" jsonb,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "redirect_from_uniq";--> statement-breakpoint
ALTER TABLE "admin_user" ADD COLUMN "stand_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "announcement_banner" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "announcement_banner" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "frame_cents" integer;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "promotions" jsonb;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "pickup_point_id" integer;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "pickup_point" jsonb;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "invoice_issuer" jsonb;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "ordre_catalogue" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "promo_rule" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "redirect" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "pickup_point_active_idx" ON "pickup_point" USING btree ("active");--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_pickup_point_id_pickup_point_id_fk" FOREIGN KEY ("pickup_point_id") REFERENCES "public"."pickup_point"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "redirect_from_uniq" ON "redirect" USING btree ("from_path") WHERE "redirect"."archived_at" is null;