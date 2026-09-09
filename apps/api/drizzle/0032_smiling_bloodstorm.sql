-- Le menu recopié par la migration 0031 n'a que ses libellés français, alors
-- que la boutique sait déjà les dire en quatre langues : les cinq clés « nav.* »
-- d'apps/web/src/i18n/ui.ts portent exactement les mêmes phrases en anglais, en
-- allemand, en italien et en espagnol. Tant qu'elles ne sont pas ici, le jour où
-- le bandeau du site lira sa navigation en base, une visiteuse anglaise lira
-- « Affiches personnalisables » au milieu d'une page en anglais.
--
-- Chaque entrée est reconnue à son adresse ET à son libellé d'origine : deux
-- d'entre elles partagent la même adresse, et un libellé déjà réécrit depuis le
-- back-office n'est plus une entrée semée — la retraduire écraserait un choix
-- de la propriétaire. La garde « translations is null » rend cette migration
-- rejouable sans rien abîmer : rejouée, elle ne touche plus rien.
UPDATE "menu_item"
SET "translations" = '{"en":{"label":"Customisable posters"},"de":{"label":"Personalisierbare Poster"},"it":{"label":"Poster personalizzabili"},"es":{"label":"Láminas personalizables"}}'::jsonb
WHERE "href" = '/affiches?genre=personnalisable'
  AND "label" = 'Affiches personnalisables'
  AND "translations" IS NULL;--> statement-breakpoint
UPDATE "menu_item"
SET "translations" = '{"en":{"label":"See all"},"de":{"label":"Alle ansehen"},"it":{"label":"Vedi tutto"},"es":{"label":"Ver todo"}}'::jsonb
WHERE "href" = '/affiches?genre=personnalisable'
  AND "label" = 'Tout voir'
  AND "translations" IS NULL;--> statement-breakpoint
UPDATE "menu_item"
SET "translations" = '{"en":{"label":"Towns and cities"},"de":{"label":"Städte"},"it":{"label":"Città"},"es":{"label":"Ciudades"}}'::jsonb
WHERE "href" = '/affiches?genre=personnalisable&collection=villes'
  AND "label" = 'Villes'
  AND "translations" IS NULL;--> statement-breakpoint
UPDATE "menu_item"
SET "translations" = '{"en":{"label":"Themes and landscapes"},"de":{"label":"Themen und Landschaften"},"it":{"label":"Temi e paesaggi"},"es":{"label":"Temas y paisajes"}}'::jsonb
WHERE "href" = '/affiches?genre=personnalisable&collection=balades-paysages'
  AND "label" = 'Thèmes et paysages'
  AND "translations" IS NULL;--> statement-breakpoint
UPDATE "menu_item"
SET "translations" = '{"en":{"label":"Ready-to-print posters"},"de":{"label":"Druckfertige Poster"},"it":{"label":"Poster pronti da stampare"},"es":{"label":"Láminas listas para imprimir"}}'::jsonb
WHERE "href" = '/affiches?genre=prete_a_imprimer'
  AND "label" = 'Affiches prêtes à imprimer'
  AND "translations" IS NULL;
