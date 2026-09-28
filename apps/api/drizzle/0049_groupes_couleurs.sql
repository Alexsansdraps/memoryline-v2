-- Groupes de couleurs : les nuances d'une même couleur (ombres, reflets d'un
-- dessin vectorisé par IA ou exporté de Canva) réunies sous une seule couleur
-- au choix du client, avec un nom lisible (« pelage », « robe »).
-- Tout part à NULL : sans groupes, chaque zone reste son propre groupe, et un
-- personnage ne propose toujours que sa première zone (la peau). Rien ne
-- change pour les dessins, les paniers ni les commandes existants tant que la
-- boutique ne lance pas « Détecter les couleurs » au back-office.
ALTER TABLE "asset" ADD COLUMN "groupes_couleurs" jsonb;--> statement-breakpoint
ALTER TABLE "character_type" ADD COLUMN "base_groupes_couleurs" jsonb;--> statement-breakpoint
ALTER TABLE "character_type" ADD COLUMN "base_zones_proposees" jsonb;
