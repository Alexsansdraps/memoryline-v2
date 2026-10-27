/*
 * Un personnage peut être MASQUÉ du site sans être archivé (demande
 * d'Alexandra, 27/10/2026) : la boutique en prépare un — dessiné nu, sans
 * tenue par défaut — sans que les clients le voient dans la galerie du
 * module. Il reste dans la liste du BO avec tous ses réglages, et une affiche
 * qui le porte déjà s'affiche et s'imprime toujours.
 *
 * Tous les personnages restent visibles : rien ne change sur le site tant
 * que la boutique ne clique pas sur « Visible ».
 */
ALTER TABLE "character_type" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;
