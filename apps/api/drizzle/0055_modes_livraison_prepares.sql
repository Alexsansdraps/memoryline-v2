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
 * La liste est celle des transporteurs qu'une petite boutique d'affiches peut
 * réellement ouvrir en France, plus l'express international. Il n'y a PAS de
 * lettre suivie : une affiche part roulée dans un tube ou sous pli rigide,
 * « c'est pas possible c'est un colis ». Un affranchissement de lettre ne
 * couvrirait ni l'épaisseur, ni le cadre, ni la casse.
 *
 * Aucun TARIF n'est écrit ici, et il n'y en aura jamais : les transporteurs ne
 * publient pas de grille interrogeable, et un prix deviné se retrouverait
 * facturé au client. Les prix se recopient depuis le contrat signé.
 *
 * Chaque insertion se garde d'écraser quoi que ce soit : « WHERE NOT EXISTS »
 * sur le slug. La migration peut donc être rejouée, et surtout elle ne touche
 * à AUCUN des modes déjà réglés par Alexandra — ni leur prix, ni leur état.
 */
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
--> statement-breakpoint
INSERT INTO "shipping_method"
  (slug, name, description, kind, carrier, active, position, note_preparation)
SELECT 'colis_prive_domicile', 'À domicile (Colis Privé)',
       'Colis Privé — 2 à 4 jours ouvrés',
       'home', 'colis_prive', false,
       (SELECT coalesce(max(position), 0) + 1 FROM "shipping_method"),
       'Demande un compte Colis Privé, auprès de leur service commercial. Ils livrent à domicile en France seulement, souvent moins cher que La Poste. Rien à brancher côté site : c''est du domicile, il n''y a pas de point à chercher. Il reste le contrat, puis le prix.'
WHERE NOT EXISTS (SELECT 1 FROM "shipping_method" WHERE slug = 'colis_prive_domicile');
--> statement-breakpoint
INSERT INTO "shipping_method"
  (slug, name, description, kind, carrier, active, position, note_preparation)
SELECT 'dpd_domicile', 'À domicile (DPD)',
       'DPD — 1 à 2 jours ouvrés',
       'home', 'dpd', false,
       (SELECT coalesce(max(position), 0) + 1 FROM "shipping_method"),
       'Demande un contrat DPD France, à l''agence de votre secteur. Rien à brancher côté site pour du domicile. Il reste le contrat, puis le prix.'
WHERE NOT EXISTS (SELECT 1 FROM "shipping_method" WHERE slug = 'dpd_domicile');
--> statement-breakpoint
INSERT INTO "shipping_method"
  (slug, name, description, kind, carrier, active, position, note_preparation)
SELECT 'dpd_relais', 'Point relais DPD (Pickup)',
       'DPD Pickup — 2 à 3 jours ouvrés',
       'relay', 'dpd', false,
       (SELECT coalesce(max(position), 0) + 1 FROM "shipping_method"),
       'Demande le même contrat DPD France que le domicile, ET une intégration à écrire côté site pour la liste des points Pickup. Masqué tant que les deux ne sont pas là.'
WHERE NOT EXISTS (SELECT 1 FROM "shipping_method" WHERE slug = 'dpd_relais');
--> statement-breakpoint
INSERT INTO "shipping_method"
  (slug, name, description, kind, carrier, active, position, note_preparation)
SELECT 'gls_domicile', 'À domicile (GLS)',
       'GLS — 1 à 2 jours ouvrés',
       'home', 'gls', false,
       (SELECT coalesce(max(position), 0) + 1 FROM "shipping_method"),
       'Demande un contrat GLS France, à l''agence de votre secteur. Rien à brancher côté site pour du domicile. Il reste le contrat, puis le prix.'
WHERE NOT EXISTS (SELECT 1 FROM "shipping_method" WHERE slug = 'gls_domicile');
--> statement-breakpoint
INSERT INTO "shipping_method"
  (slug, name, description, kind, carrier, active, position, note_preparation)
SELECT 'gls_relais', 'Point relais GLS',
       'GLS ParcelShop — 2 à 3 jours ouvrés',
       'relay', 'gls', false,
       (SELECT coalesce(max(position), 0) + 1 FROM "shipping_method"),
       'Demande le même contrat GLS France que le domicile, ET une intégration à écrire côté site pour la liste des ParcelShop. Masqué tant que les deux ne sont pas là.'
WHERE NOT EXISTS (SELECT 1 FROM "shipping_method" WHERE slug = 'gls_relais');
--> statement-breakpoint
INSERT INTO "shipping_method"
  (slug, name, description, kind, carrier, active, position, note_preparation)
SELECT 'shop2shop', 'Point relais Shop2Shop',
       'Shop2Shop — 3 à 5 jours ouvrés',
       'relay', 'shop2shop', false,
       (SELECT coalesce(max(position), 0) + 1 FROM "shipping_method"),
       'Demande un compte professionnel Shop2Shop (le réseau de Cdiscount, aujourd''hui chez Chronopost), ET une intégration à écrire côté site pour la liste des points. C''est le moins cher des points relais, mais les délais sont les plus longs. Masqué tant que les deux ne sont pas là.'
WHERE NOT EXISTS (SELECT 1 FROM "shipping_method" WHERE slug = 'shop2shop');
--> statement-breakpoint
INSERT INTO "shipping_method"
  (slug, name, description, kind, carrier, active, position, note_preparation)
SELECT 'ups_express', 'Express international (UPS)',
       'UPS Express — 2 à 5 jours ouvrés selon le pays',
       'home', 'ups', false,
       (SELECT coalesce(max(position), 0) + 1 FROM "shipping_method"),
       'Demande un compte UPS professionnel, au service clients entreprises. À réserver aux pays lointains : en France, Colissimo ou un point relais coûtent bien moins cher. Hors Union européenne, une facture douanière voyage avec le colis — UPS explique comment la fournir. Il reste le contrat, puis le prix, zone par zone.'
WHERE NOT EXISTS (SELECT 1 FROM "shipping_method" WHERE slug = 'ups_express');
--> statement-breakpoint
INSERT INTO "shipping_method"
  (slug, name, description, kind, carrier, active, position, note_preparation)
SELECT 'dhl_express', 'Express international (DHL)',
       'DHL Express — 2 à 5 jours ouvrés selon le pays',
       'home', 'dhl', false,
       (SELECT coalesce(max(position), 0) + 1 FROM "shipping_method"),
       'Demande un compte DHL Express, au service clients entreprises. Même usage qu''UPS : les pays lointains. Prenez les deux devis avant de choisir, ils se disputent ces envois. Hors Union européenne, une facture douanière voyage avec le colis. Il reste le contrat, puis le prix, zone par zone.'
WHERE NOT EXISTS (SELECT 1 FROM "shipping_method" WHERE slug = 'dhl_express');
