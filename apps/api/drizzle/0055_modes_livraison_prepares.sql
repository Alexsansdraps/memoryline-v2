ALTER TABLE "shipping_method" ADD COLUMN "note_preparation" text;
--> statement-breakpoint
/*
 * Les modes de livraison PRÉPARÉS d'avance.
 *
 * Alexandra n'a encore aucun contrat transporteur. Le jour où elle en signe
 * un, elle doit pouvoir ouvrir la livraison le soir même, sans développeur :
 * les modes existent donc déjà, DÉCOCHÉS et SANS PRIX, chacun avec la note
 * qui dit ce qu'il lui reste à faire.
 *
 * Sans prix, et non à zéro : un mode à 0 € offrirait le port sans que
 * personne l'ait voulu. Un mode sans la moindre tranche ne sort pas du
 * rangement — le site le laisse dehors, et l'écran « Livraison » écrit
 * pourquoi.
 *
 * Chaque insertion se garde d'écraser quoi que ce soit : « WHERE NOT EXISTS »
 * sur le slug. La migration peut donc être rejouée, et surtout elle ne touche
 * à AUCUN des modes déjà réglés par Alexandra — ni leur prix, ni leur état.
 */
INSERT INTO "shipping_method"
  (slug, name, description, kind, carrier, active, position, note_preparation)
SELECT 'lettre_suivie', 'Lettre suivie',
       'La Poste — 2 à 3 jours ouvrés, sans signature',
       'letter', 'la_poste', false,
       (SELECT coalesce(max(position), 0) + 1 FROM "shipping_method"),
       'Rien à ouvrir, rien à signer : une lettre suivie s''affranchit au bureau de poste ou en ligne. À réserver à UNE affiche roulée, sans cadre : posez une tranche de poids qui s''arrête là (250 g, par exemple), sinon ce tarif serait proposé pour des colis qu''une lettre ne peut pas porter. Il ne manque que le prix.'
WHERE NOT EXISTS (SELECT 1 FROM "shipping_method" WHERE slug = 'lettre_suivie');
--> statement-breakpoint
INSERT INTO "shipping_method"
  (slug, name, description, kind, carrier, active, position, note_preparation)
SELECT 'colissimo_signature', 'À domicile avec signature',
       'Colissimo — 2 à 3 jours ouvrés, remis contre signature',
       'home', 'colissimo', false,
       (SELECT coalesce(max(position), 0) + 1 FROM "shipping_method"),
       'Même contrat Colissimo que le mode « À domicile » : si vous l''avez déjà, il n''y a rien de plus à ouvrir. C''est l''option « remise contre signature », que La Poste facture un peu plus cher : reportez son tarif dans la grille, puis cochez « Proposé ».'
WHERE NOT EXISTS (SELECT 1 FROM "shipping_method" WHERE slug = 'colissimo_signature');
--> statement-breakpoint
INSERT INTO "shipping_method"
  (slug, name, description, kind, carrier, active, position, note_preparation)
SELECT 'colissimo_international', 'À domicile — international',
       'Colissimo — 5 à 10 jours ouvrés selon le pays',
       'home', 'colissimo', false,
       (SELECT coalesce(max(position), 0) + 1 FROM "shipping_method"),
       'Demande l''option international sur votre contrat Colissimo. Les prix se règlent zone par zone, plus bas. Attention : l''Outre-mer tombe aujourd''hui dans la zone « Reste du monde ». Pour lui donner un tarif à part, il lui faudra une zone à elle, avec ses codes pays (GP, MQ, GF, RE, YT…).'
WHERE NOT EXISTS (SELECT 1 FROM "shipping_method" WHERE slug = 'colissimo_international');
--> statement-breakpoint
INSERT INTO "shipping_method"
  (slug, name, description, kind, carrier, active, position, note_preparation)
SELECT 'mondial_relay_domicile', 'À domicile (Mondial Relay)',
       'Mondial Relay — 3 à 5 jours ouvrés',
       'home', 'mondial_relay', false,
       (SELECT coalesce(max(position), 0) + 1 FROM "shipping_method"),
       'Demande un compte marchand Mondial Relay, le même que celui du point relais. Rien d''autre à brancher : une livraison à domicile n''a pas de point à chercher. Il reste le contrat, puis le prix.'
WHERE NOT EXISTS (SELECT 1 FROM "shipping_method" WHERE slug = 'mondial_relay_domicile');
--> statement-breakpoint
INSERT INTO "shipping_method"
  (slug, name, description, kind, carrier, active, position, note_preparation)
SELECT 'relais_colis', 'Point relais Relais Colis',
       'Relais Colis — 3 à 5 jours ouvrés',
       'relay', 'relais_colis', false,
       (SELECT coalesce(max(position), 0) + 1 FROM "shipping_method"),
       'Demande un contrat Relais Colis, ET une intégration à écrire côté site : c''est elle qui donnera au client la liste des points où retirer. Tant qu''elle n''existe pas, ce mode reste masqué même coché — l''écran vous le redira.'
WHERE NOT EXISTS (SELECT 1 FROM "shipping_method" WHERE slug = 'relais_colis');
--> statement-breakpoint
INSERT INTO "shipping_method"
  (slug, name, description, kind, carrier, active, position, note_preparation)
SELECT 'chronopost_domicile', 'Express à domicile (Chronopost)',
       'Chronopost — livré le lendemain avant 13 h',
       'home', 'chronopost', false,
       (SELECT coalesce(max(position), 0) + 1 FROM "shipping_method"),
       'Demande un compte Chronopost. Rien à intégrer pour du domicile. Prévoyez un prix nettement plus élevé que Colissimo : l''express se paie.'
WHERE NOT EXISTS (SELECT 1 FROM "shipping_method" WHERE slug = 'chronopost_domicile');
--> statement-breakpoint
INSERT INTO "shipping_method"
  (slug, name, description, kind, carrier, active, position, note_preparation)
SELECT 'chronopost_relais', 'Point relais Chronopost',
       'Chronopost Pickup — 2 à 3 jours ouvrés',
       'relay', 'chronopost', false,
       (SELECT coalesce(max(position), 0) + 1 FROM "shipping_method"),
       'Demande un compte Chronopost ET une intégration à écrire côté site pour la liste des points Pickup. Masqué tant que les deux ne sont pas là.'
WHERE NOT EXISTS (SELECT 1 FROM "shipping_method" WHERE slug = 'chronopost_relais');
