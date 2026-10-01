/*
 * Colissimo, Chronopost et Shop2Shop passent désormais par SendCloud.
 *
 * Le compte SendCloud de la boutique donne accès à tout Colissimo (domicile,
 * signature, point retrait, international) et tout Chronopost (express,
 * Chrono Relais, Shop2Shop), à ses tarifs négociés : plus aucun contrat à
 * signer chez La Poste. Les notes des modes préparés en 0055 disaient
 * l'inverse (« demande un compte Chronopost ET une intégration à écrire »).
 *
 * Chaque note n'est remplacée QUE si elle est restée mot pour mot celle de
 * 0055 : une note qu'Alexandra ou Margaux a réécrite, ou vidée, n'est pas
 * touchée. Ni les prix ni l'état « Proposé » ne bougent.
 */
UPDATE "shipping_method"
SET note_preparation = 'Inclus dans votre compte SendCloud : rien à ouvrir chez La Poste. La remise contre signature coûte un peu plus cher que le domicile simple : reportez son tarif dans la grille, puis cochez « Proposé ». Au bordereau, le service avec signature est proposé en premier.'
WHERE slug = 'colissimo_signature'
  AND note_preparation = 'Même contrat Colissimo que le mode « À domicile » : si vous l''avez déjà, il n''y a rien de plus à ouvrir. C''est l''option « remise contre signature », que La Poste facture un peu plus cher : reportez son tarif dans la grille, puis cochez « Proposé ».';
--> statement-breakpoint
UPDATE "shipping_method"
SET note_preparation = 'Inclus dans votre compte SendCloud, Europe comme Outre-mer : rien à ouvrir chez La Poste. Les prix se règlent zone par zone, plus bas. Vers certains pays (l''Allemagne, par exemple), SendCloud n''a Colissimo qu''avec signature, un peu plus cher : comptez-le dans le prix. Attention : l''Outre-mer tombe aujourd''hui dans la zone « Reste du monde ». Pour lui donner un tarif à part, il lui faudra une zone à elle, avec ses codes pays (GP, MQ, GF, RE, YT…).'
WHERE slug = 'colissimo_international'
  AND note_preparation = 'Demande l''option international sur votre contrat Colissimo. Les prix se règlent zone par zone, plus bas. Attention : l''Outre-mer tombe aujourd''hui dans la zone « Reste du monde ». Pour lui donner un tarif à part, il lui faudra une zone à elle, avec ses codes pays (GP, MQ, GF, RE, YT…).';
--> statement-breakpoint
UPDATE "shipping_method"
SET note_preparation = 'Inclus dans votre compte SendCloud : rien à ouvrir chez Mondial Relay. Une livraison à domicile n''a pas de point à chercher : il ne reste que le prix.'
WHERE slug = 'mondial_relay_domicile'
  AND note_preparation = 'Demande un compte marchand Mondial Relay, le même que celui du point relais. Rien d''autre à brancher : une livraison à domicile n''a pas de point à chercher. Il reste le contrat, puis le prix.';
--> statement-breakpoint
UPDATE "shipping_method"
SET note_preparation = 'Inclus dans votre compte SendCloud : rien à ouvrir chez Chronopost. Prévoyez un prix nettement plus élevé que Colissimo : l''express se paie. Le bordereau suit la promesse écrite dans le nom ou la description du mode : « avant 13 h » donne Chrono 13 ; sans heure, c''est Chrono 18, le moins cher.'
WHERE slug = 'chronopost_domicile'
  AND note_preparation = 'Demande un compte Chronopost. Rien à intégrer pour du domicile. Prévoyez un prix nettement plus élevé que Colissimo : l''express se paie.';
--> statement-breakpoint
UPDATE "shipping_method"
SET note_preparation = 'Inclus dans votre compte SendCloud : la carte des points Pickup Chronopost fonctionne déjà. Il ne reste que le prix, puis la case « Proposé ».'
WHERE slug = 'chronopost_relais'
  AND note_preparation = 'Demande un compte Chronopost ET une intégration à écrire côté site pour la liste des points Pickup. Masqué tant que les deux ne sont pas là.';
--> statement-breakpoint
UPDATE "shipping_method"
SET note_preparation = 'Inclus dans votre compte SendCloud : ce sont les mêmes points Pickup que Chronopost, et leur carte fonctionne déjà. C''est le moins cher des points relais, mais les délais sont les plus longs. Il ne reste que le prix, puis la case « Proposé ».'
WHERE slug = 'shop2shop'
  AND note_preparation = 'Demande un compte professionnel Shop2Shop (le réseau de Cdiscount, aujourd''hui chez Chronopost), ET une intégration à écrire côté site pour la liste des points. C''est le moins cher des points relais, mais les délais sont les plus longs. Masqué tant que les deux ne sont pas là.';
