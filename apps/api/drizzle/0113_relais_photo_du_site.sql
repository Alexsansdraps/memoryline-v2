-- Le relais photo s'ouvre aussi depuis le site, pas seulement au stand (21/11,
-- Alexandra : « tu peux mettre le module de qr code pour envoyer une image sur
-- le site classique aussi pas que en mode stand »). Voir apps/api/src/ia-relais.ts.
--
-- SCHÉMA SEULEMENT : « ia_relais_photo.stand_id » accepte NULL. Une ligne sans
-- stand est un relais ouvert depuis le site, sans code de stand. Les relais
-- déjà ouverts gardent leur stand ; la clé étrangère (suppression en cascade
-- avec le stand) et l'index ne changent pas.
ALTER TABLE "ia_relais_photo" ALTER COLUMN "stand_id" DROP NOT NULL;
