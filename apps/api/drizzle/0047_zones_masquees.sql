-- Les zones de couleur d'une pièce que le client ne peut plus changer (ruban
-- du chapeau, élastique des cheveux…). Toutes les pièces existantes partent
-- d'une liste vide : chaque zone reste proposée, comme avant, tant que la
-- boutique ne la décoche pas au back-office.
ALTER TABLE "asset" ADD COLUMN "zones_masquees" jsonb DEFAULT '[]'::jsonb NOT NULL;
