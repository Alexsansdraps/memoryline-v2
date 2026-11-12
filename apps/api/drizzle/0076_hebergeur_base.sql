-- La base de données n'est plus chez Neon (États-Unis) : elle vit sur le
-- serveur OVH de la boutique, en France, depuis son déménagement (voir
-- docker-compose.prod.yml, service « db »). Les mentions légales et la
-- politique de confidentialité le disaient encore (Alexandra, 12 novembre
-- 2026 : « la bdd est sur le vps non ? Supp alors »).
--
-- Seuls ces morceaux de texte changent. Rejouable : une seconde fois, il n'y
-- a plus rien à remplacer.
UPDATE "page"
SET "blocks" = regexp_replace(
      regexp_replace(
        "blocks"::text,
        '<p><strong>Hébergeur de la base de données</strong><br />Neon Inc\.[^<]*</p>',
        ''
      ),
      '<strong>Hébergeur du site</strong>',
      '<strong>Hébergeur du site et de sa base de données</strong>'
    )::jsonb
WHERE "slug" = 'mentions-legales'
  AND "blocks"::text ~ '<strong>Hébergeur de la base de données</strong><br />Neon';
--> statement-breakpoint
UPDATE "page"
SET "blocks" = regexp_replace(
      "blocks"::text,
      'qui héberge le site, et <strong>Neon</strong>[^<]*<strong>États-Unis</strong>[^<]*</li>',
      'qui héberge le site et sa base de données, en France.</li>'
    )::jsonb
WHERE "slug" = 'confidentialite'
  AND "blocks"::text ~ 'qui héberge le site, et <strong>Neon</strong>';
