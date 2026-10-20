/*
 * « Le client peut changer toutes les couleurs en fait, il peut mettre à
 * zéro s'il veut » — la cliente, le 19 octobre, revenant sur sa carte Trello
 * « ne pas proposer la couleur des détails ».
 *
 * 0066 avait mis toutes les catégories sur « principale » d'office, et une
 * catégorie créée depuis naissait sur « principale ». D'où une reprise
 * d'office en sens inverse : chaque catégorie repasse sur « toutes » (une
 * rangée de pastilles par famille de teinte, les ombres suivant la couleur
 * choisie, cf. famillesDeLaPiece), et une catégorie créée demain aussi. Le
 * back-office permet de rechoisir « principale », catégorie par catégorie.
 *
 * Une pièce qui a son propre réglage (asset.zones_masquees non nul) ne bouge
 * pas et garde le dernier mot, comme avant. Les paniers et les commandes déjà
 * passés gardent exactement leurs couleurs : elles sont écrites zone par zone
 * dans leur configuration. Rien n'est supprimé.
 */
ALTER TABLE "piece_category" ALTER COLUMN "couleurs_proposees" SET DEFAULT 'toutes';--> statement-breakpoint
UPDATE "piece_category" SET "couleurs_proposees" = 'toutes' WHERE "couleurs_proposees" = 'principale';
