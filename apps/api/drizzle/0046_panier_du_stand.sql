-- Les paniers remplis sur la tablette du stand, pour ne plus les compter parmi
-- les paniers abandonnés du site. Les paniers existants restent à « faux » : on
-- ne sait plus lesquels venaient du stand, et les compter côté site est ce
-- qu'on faisait jusqu'ici.
ALTER TABLE "order" ADD COLUMN "panier_du_stand" boolean DEFAULT false NOT NULL;
