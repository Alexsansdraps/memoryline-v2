BEGIN TRANSACTION READ ONLY;
\echo '== 1. personnages par vue, categorie, etat'
select orientation, coalesce(category,'-') cat, category_id, active, (archived_at is not null) archive, count(*) n from character_type group by 1,2,3,4,5 order by 1,2,4,5;
\echo '== 2. categories de personnages'
select id, slug, name, position, (archived_at is not null) archive from character_category order by position;
\echo '== 3. pieces par emplacement et vue'
select slot, coalesce(view,'-') vue, (archived_at is not null) archive, (character_type_id is not null) liee, count(*) n, min(position) pmin, max(position) pmax from asset group by 1,2,3,4 order by 1,2,3,4;
\echo '== 4. plus grand numero par emplacement (toutes vues, archives compris) + max id'
select slot, max(position) pmax, count(distinct position) ndistinct, count(*) n from asset group by 1 order by 1;
select 'max asset.id' k, max(id) v from asset union all select 'max character_type.id', max(id) from character_type union all select 'max character_category.id', max(id) from character_category union all select 'max piece_category.id', max(id) from piece_category;
\echo '== 5. numeros en doublon (meme emplacement, meme vue)'
select slot, view, position, count(*), string_agg(id::text, ',') from asset group by 1,2,3 having count(*)>1 order by 1,2,3;
\echo '== 6. tous les numeros par emplacement et vue'
select slot, coalesce(view,'-') vue, string_agg(position::text, ',' order by position) nums from asset group by 1,2 order by 1,2;
\echo '== 7. calages existants'
select id, slug, orientation, jsonb_object_keys(slot_adjust) k from character_type where slot_adjust is not null and slot_adjust <> '{}'::jsonb order by id;
select id, slug, slot_adjust::text from character_type where slot_adjust is not null and slot_adjust <> '{}'::jsonb order by id;
\echo '== 8. personnages de dos'
select id, slug, name, category, active, (archived_at is not null) arch, position, bottom_pct, facteur_taille, decalage_x, base_svg_url, slot_variants::text sv, default_assets::text da from character_type where orientation='back' order by category, id;
\echo '== 9. personnages de face'
select id, slug, category, active, base_svg_url from character_type where orientation<>'back' order by category, id;
\echo '== 10. categories de pieces'
select id, slug, name, slot, active, position, couleurs_proposees, colors::text from piece_category order by id;
\echo '== 11. slugs existants commencant par gabarit/senior/old/vieux/nouveau'
select id, slug from character_type where slug ~* '(gabarit|senior|old|vieux|unifi|nouv)' order by id;
\echo '== 12. types dont slot_variants est NULL (= toutes les pieces proposees)'
select id, slug, orientation, active from character_type where slot_variants is null order by id;
ROLLBACK;
