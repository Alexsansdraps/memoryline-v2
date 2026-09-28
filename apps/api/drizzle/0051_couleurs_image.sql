-- Couleurs des dessins en PIXELS : les sept animaux téléversés ne sont pas des
-- dessins vectoriels mais des images posées dans un SVG. Sans zone « .stN » à
-- recolorer, le client ne pouvait rien changer à la robe d'un chien. On range
-- ici leurs FAMILLES de teintes (couleurs-image.ts) : la teinte de référence
-- de chacune, celles qui la suivent, sa part du dessin, son nom, et si elle
-- est proposée au client.
-- Tout part à NULL : rien n'est détecté, rien n'est proposé, et les dessins,
-- les paniers et les commandes existants s'affichent exactement comme avant,
-- tant que la boutique n'a pas lancé « Détecter les couleurs » au back-office.
ALTER TABLE "asset" ADD COLUMN "couleurs_image" jsonb;--> statement-breakpoint
ALTER TABLE "character_type" ADD COLUMN "base_couleurs_image" jsonb;
