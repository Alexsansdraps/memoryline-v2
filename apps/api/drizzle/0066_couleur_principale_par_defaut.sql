/*
 * « Ne pas proposer de modifier la couleur des détails (ex : le ruban du
 * chapeau) » — carte Trello de la cliente, pour TOUTES les pièces des
 * personnages.
 *
 * 0065 avait posé le réglage par catégorie, mais sur « toutes » partout :
 * rien n'avait changé pour le client, le chapeau proposait toujours trois
 * rangées de pastilles. Chaque catégorie passe donc à « principale » (la
 * couleur principale seule, ses ombres de même teinte la suivant, cf.
 * principaleDeLaPiece), et une catégorie créée demain aussi. Le back-office
 * permet de revenir à « toutes », catégorie par catégorie.
 *
 * Une pièce qui a son propre réglage (asset.zones_masquees non nul) garde le
 * dernier mot, comme avant. Les paniers et les commandes déjà passés gardent
 * exactement leurs couleurs : elles sont enregistrées dans leur configuration.
 */
ALTER TABLE "piece_category" ALTER COLUMN "couleurs_proposees" SET DEFAULT 'principale';--> statement-breakpoint
UPDATE "piece_category" SET "couleurs_proposees" = 'principale' WHERE "couleurs_proposees" = 'toutes';
