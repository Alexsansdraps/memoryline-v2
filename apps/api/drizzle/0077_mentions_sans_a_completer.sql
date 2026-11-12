-- Mentions légales : le paragraphe « À COMPLÉTER : numéro d'inscription au
-- RCS ou au répertoire des métiers, s'il y en a un ; numéro de téléphone ;
-- nom de l'entrepreneur, qui est aussi le directeur de la publication. » est
-- retiré (Alexandra, 12 novembre 2026). Rejouable : une seconde fois, il n'y
-- a plus rien à retirer.
UPDATE "page"
SET "blocks" = regexp_replace(
      "blocks"::text,
      '<p><strong>À COMPL[ÉE]TER[^<]*répertoire des métiers, s''il y en a un[^<]*directeur de la publication\.</strong></p>',
      ''
    )::jsonb
WHERE "slug" = 'mentions-legales'
  AND "blocks"::text ~ '<p><strong>À COMPL[ÉE]TER[^<]*répertoire des métiers, s''il y en a un';
