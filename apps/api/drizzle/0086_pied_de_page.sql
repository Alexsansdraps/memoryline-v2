-- Le pied de page devient un second menu, réglé au BO (17/11) : Margaux doit
-- pouvoir y ajouter une page et choisir sa colonne sans nous. Ses liens
-- étaient écrits en dur dans le site (apps/web/src/layouts/Base.astro).
--
-- 1. Le menu de chaque entrée : « haut » (le bandeau, tout ce qui existe
--    déjà) ou « pied ».
ALTER TABLE "menu_item" ADD COLUMN IF NOT EXISTS "emplacement" text DEFAULT 'haut' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_emplacement_check"
    CHECK ("emplacement" in ('haut', 'pied'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- 2. Les deux colonnes d'aujourd'hui, « La boutique » et « Aide et
--    informations ». Une colonne est une entrée de premier niveau, sans
--    adresse : son libellé en est le titre. Ses liens sont ses sous-entrées,
--    avec les mêmes adresses et dans le même ordre que sur le site. Les
--    traductions sont celles du dictionnaire du site (apps/web/src/i18n/ui.ts).
--    Seulement si le pied de page est encore vide : rejouable sans doublon,
--    et sans rien écraser de ce que la boutique y aurait mis.
WITH colonnes AS (
  INSERT INTO "menu_item" ("emplacement", "label", "href", "position", "visible", "translations")
  SELECT 'pied', c."label", '', c."position", true, c."translations"::jsonb
  FROM (VALUES
    ('La boutique', 0,
     '{"en": {"label": "The shop"}, "de": {"label": "Der Shop"}, "it": {"label": "Il negozio"}, "es": {"label": "La tienda"}}'),
    ('Aide et informations', 1,
     '{"en": {"label": "Help and information"}, "de": {"label": "Hilfe und Informationen"}, "it": {"label": "Aiuto e informazioni"}, "es": {"label": "Ayuda e información"}}')
  ) AS c("label", "position", "translations")
  WHERE NOT EXISTS (SELECT 1 FROM "menu_item" WHERE "emplacement" = 'pied')
  RETURNING "id", "position"
)
INSERT INTO "menu_item" ("emplacement", "parent_id", "label", "href", "position", "visible", "translations")
SELECT 'pied', colonnes."id", l."label", l."href", l."position", true, l."translations"::jsonb
FROM colonnes
JOIN (VALUES
  (0, 'Affiches', '/affiches', 0,
   '{"en": {"label": "Posters"}, "de": {"label": "Poster"}, "it": {"label": "Poster"}, "es": {"label": "Láminas"}}'),
  (0, 'Affiches personnalisables', '/affiches?genre=personnalisable', 1,
   '{"en": {"label": "Customisable posters"}, "de": {"label": "Personalisierbare Poster"}, "it": {"label": "Poster personalizzabili"}, "es": {"label": "Láminas personalizables"}}'),
  (0, 'Affiches prêtes à imprimer', '/affiches?genre=prete_a_imprimer', 2,
   '{"en": {"label": "Ready-to-print posters"}, "de": {"label": "Druckfertige Poster"}, "it": {"label": "Poster pronti da stampare"}, "es": {"label": "Láminas listas para imprimir"}}'),
  (0, 'Rechercher', '/recherche', 3,
   '{"en": {"label": "Search"}, "de": {"label": "Suche"}, "it": {"label": "Cerca"}, "es": {"label": "Buscar"}}'),
  (1, 'Nous contacter', '/contact', 0,
   '{"en": {"label": "Contact us"}, "de": {"label": "Kontakt"}, "it": {"label": "Contattaci"}, "es": {"label": "Contacto"}}'),
  (1, 'Conditions générales de vente', '/pages/conditions-de-vente', 1,
   '{"en": {"label": "Terms and conditions of sale"}, "de": {"label": "Allgemeine Geschäftsbedingungen"}, "it": {"label": "Condizioni generali di vendita"}, "es": {"label": "Condiciones generales de venta"}}'),
  (1, 'Mentions légales', '/pages/mentions-legales', 2,
   '{"en": {"label": "Legal notice"}, "de": {"label": "Impressum"}, "it": {"label": "Note legali"}, "es": {"label": "Aviso legal"}}'),
  (1, 'Politique de confidentialité', '/pages/confidentialite', 3,
   '{"en": {"label": "Privacy policy"}, "de": {"label": "Datenschutzerklärung"}, "it": {"label": "Informativa sulla privacy"}, "es": {"label": "Política de privacidad"}}'),
  (1, 'Cookies', '/pages/cookies', 4,
   '{"en": {"label": "Cookies"}, "de": {"label": "Cookies"}, "it": {"label": "Cookie"}, "es": {"label": "Cookies"}}')
) AS l("colonne", "label", "href", "position", "translations")
  ON l."colonne" = colonnes."position";
