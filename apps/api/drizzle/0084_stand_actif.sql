-- « Activé / Désactivé » : le stand est-il proposé au retrait sur le site ?
-- À part d'ouvert/fermé, qui dit si la tablette vend (Alexandra, 17/11).
-- Activé par défaut, pour les stands déjà là comme pour les nouveaux.
ALTER TABLE "stand" ADD COLUMN IF NOT EXISTS "actif" boolean DEFAULT true NOT NULL;
