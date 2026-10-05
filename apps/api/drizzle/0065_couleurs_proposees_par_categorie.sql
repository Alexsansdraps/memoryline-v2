/*
 * Les couleurs proposées au client, réglées par CATÉGORIE de pièces.
 *
 * La boutique ne veut pas qu'on propose de changer la couleur des détails
 * (le ruban d'un chapeau) : il fallait jusqu'ici décocher le ruban pièce par
 * pièce. Chaque catégorie dit désormais « toutes les couleurs » ou
 * « seulement la couleur principale », et une pièce qui a ses propres cases
 * garde le dernier mot.
 *
 *  - piece_category.couleurs_proposees : « toutes » pour toutes les
 *    catégories. C'était la règle d'avant : rien ne change chez le client tant
 *    que la boutique ne touche pas au réglage.
 *
 *  - asset.zones_masquees devient facultative : NULL veut dire « la pièce suit
 *    sa catégorie ». Les listes VIDES deviennent NULL — personne n'y avait rien
 *    décoché, elles proposaient tout, comme le fait aujourd'hui leur catégorie
 *    réglée sur « toutes ». Les listes non vides restent telles quelles : ce
 *    sont des réglages de la boutique, ils gardent le dernier mot.
 *    L'impression n'en dépend pas : une liste vide et NULL ne forcent rien.
 *
 *  - asset.parts_des_zones : la part du dessin peinte par chaque zone, qui
 *    désigne la couleur principale. Vide ici ; l'API mesure les pièces au
 *    démarrage, puis à chaque dessin changé (couleur-principale.ts).
 */
ALTER TABLE "asset" ALTER COLUMN "zones_masquees" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "asset" ALTER COLUMN "zones_masquees" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "parts_des_zones" jsonb;--> statement-breakpoint
ALTER TABLE "piece_category" ADD COLUMN "couleurs_proposees" text DEFAULT 'toutes' NOT NULL;--> statement-breakpoint
UPDATE "asset" SET "zones_masquees" = NULL WHERE "zones_masquees" = '[]'::jsonb;
