-- 0121_affiche_stand_mulhouse — l'affiche éphémère du stand de Mulhouse (28/11/2026).
--
-- Demandes d'Alexandra du 27/11 au soir : « des affiches temporaires pour un
-- stand, un produit par stand, on choisit l'image » ; « une collection éphémère
-- marché de Noël de Mulhouse, texte en bas ou en haut » ; « les maisons
-- colorées alsaciennes » ; « mettre les personnages comme d'hab » ; « le
-- produit doit disparaître quand le stand sera clôturé » ; « les fonds peuvent
-- être unis ou dégradé ou une image genre un motif » ; « tu les classes en plus
-- pour les clients ».
--
-- Ce qu'elle crée (chaque instruction est rejouable : deux passages = un seul
-- effet ; les lignes sont visées par leur slug, jamais par leur id) :
--   - product.vue_motifs (le jeu de motifs que la fiche propose) et
--     product.stand_id (le stand de rattachement : l'affiche n'est proposée que
--     tant que ce stand est en service, apps/api/src/affiches-de-stand.ts) ;
--   - le type d'affiche réservé « motifs-alsace » (décoché : proposé à aucun client
--     comme type d'affiche), ses 7 catégories (les onglets du choix, dans
--     l'ordre) et 47 motifs (19 motifs), rangés comme des
--     personnages : Margaux les renomme, les range, les masque dans
--     BO › Personnages ;
--   - la collection « Marché de Noël de Mulhouse », le produit (repris des prix,
--     poids et formats de l'affiche « Hôtel de ville »), ses 2 visuels, ses
--     19 fonds (unis, dégradés, motifs répétés), et un bloc en tête de la
--     page du stand (« mulhouse »).
--
-- AVANT de passer cette migration en production : copier les fichiers de
-- travaux/affiche-stand-mulhouse/assets-prod dans data/assets (hors git) —
-- l'affiche est en vente dès la migration (stand 1 en service).

ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "vue_motifs" text;
--> statement-breakpoint
-- Sans clé étrangère, exprès : un stand supprimé doit laisser l'affiche cachée
-- (la règle échoue fermée), pas la remettre en vente comme « on delete set null ».
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "stand_id" integer;
--> statement-breakpoint
INSERT INTO "poster_view" ("slug", "name", "foreground_url", "active", "position")
VALUES ('motifs-alsace', 'Motifs du stand (Alsace)', NULL, false, 90)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "character_category" ("slug", "name", "position", "translations") VALUES
  ('motifs-mulhouse', 'Mulhouse', 100, '{"en":{"name":"Mulhouse"},"de":{"name":"Mulhouse"},"it":{"name":"Mulhouse"},"es":{"name":"Mulhouse"},"ja":{"name":"ミュルーズ"},"zh":{"name":"米卢斯"}}'::jsonb),
  ('motifs-textile-musees', 'Textile et musées', 101, '{"en":{"name":"Textiles & Museums"},"de":{"name":"Textil & Museen"},"it":{"name":"Tessile e musei"},"es":{"name":"Textil y museos"},"ja":{"name":"織物と博物館"},"zh":{"name":"纺织与博物馆"}}'::jsonb),
  ('motifs-strasbourg-colmar', 'Strasbourg et Colmar', 102, '{"en":{"name":"Strasbourg & Colmar"},"de":{"name":"Straßburg & Colmar"},"it":{"name":"Strasburgo e Colmar"},"es":{"name":"Estrasburgo y Colmar"},"ja":{"name":"ストラスブールとコルマール"},"zh":{"name":"斯特拉斯堡与科尔马"}}'::jsonb),
  ('motifs-maisons-alsace', 'Maisons d''Alsace', 103, '{"en":{"name":"Alsatian Houses"},"de":{"name":"Elsässer Häuser"},"it":{"name":"Case d''Alsazia"},"es":{"name":"Casas de Alsacia"},"ja":{"name":"アルザスの家"},"zh":{"name":"阿尔萨斯民居"}}'::jsonb),
  ('motifs-noel', 'Noël', 104, '{"en":{"name":"Christmas"},"de":{"name":"Weihnachten"},"it":{"name":"Natale"},"es":{"name":"Navidad"},"ja":{"name":"クリスマス"},"zh":{"name":"圣诞"}}'::jsonb),
  ('motifs-gourmandises', 'Gourmandises', 105, '{"en":{"name":"Treats"},"de":{"name":"Leckereien"},"it":{"name":"Golosità"},"es":{"name":"Dulces"},"ja":{"name":"お菓子"},"zh":{"name":"美食"}}'::jsonb),
  ('motifs-alsace', 'Alsace', 106, '{"en":{"name":"Alsace"},"de":{"name":"Elsass"},"it":{"name":"Alsazia"},"es":{"name":"Alsacia"},"ja":{"name":"アルザス"},"zh":{"name":"阿尔萨斯"}}'::jsonb)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
-- base_groupes_couleurs, base_zones_proposees, slot_variants, default_assets : NULL.
INSERT INTO "character_type" ("slug", "name", "translations", "category_id", "orientation", "position",
  "base_svg_url", "base_color_zones", "bottom_pct", "facteur_taille", "decalage_x", "active")
SELECT v.slug, v.nom, v.trad::jsonb, cc."id", 'motifs-alsace', v.pos, v.url, v.zones::jsonb, 1, 1, 0, true
FROM (VALUES
  ('motif-hotel-de-ville', 'Hôtel de ville', '{"en":{"name":"Town Hall"},"de":{"name":"Rathaus"},"it":{"name":"Municipio"},"es":{"name":"Ayuntamiento"},"ja":{"name":"市庁舎"},"zh":{"name":"市政厅"}}', 'motifs-mulhouse', 0, '/assets/motif-alsace-hotel-de-ville-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-temple-saint-etienne', 'Temple Saint-Étienne', '{"en":{"name":"Temple Saint-Étienne"},"de":{"name":"Temple Saint-Étienne"},"it":{"name":"Temple Saint-Étienne"},"es":{"name":"Temple Saint-Étienne"},"ja":{"name":"Temple Saint-Étienne"},"zh":{"name":"Temple Saint-Étienne"}}', 'motifs-mulhouse', 1, '/assets/motif-alsace-temple-saint-etienne-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-tour-de-l-europe', 'Tour de l''Europe', '{"en":{"name":"Tour de l''Europe"},"de":{"name":"Tour de l''Europe"},"it":{"name":"Tour de l''Europe"},"es":{"name":"Tour de l''Europe"},"ja":{"name":"Tour de l''Europe"},"zh":{"name":"Tour de l''Europe"}}', 'motifs-mulhouse', 2, '/assets/motif-alsace-tour-de-l-europe-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-tour-bollwerk', 'Tour du Bollwerk', '{"en":{"name":"Tour du Bollwerk"},"de":{"name":"Tour du Bollwerk"},"it":{"name":"Tour du Bollwerk"},"es":{"name":"Tour du Bollwerk"},"ja":{"name":"Tour du Bollwerk"},"zh":{"name":"Tour du Bollwerk"}}', 'motifs-mulhouse', 3, '/assets/motif-alsace-tour-bollwerk-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-tour-ronde', 'Tour ronde', '{"en":{"name":"Round Tower"},"de":{"name":"Runder Turm"},"it":{"name":"Torre rotonda"},"es":{"name":"Torre redonda"},"ja":{"name":"円塔"},"zh":{"name":"圆塔"}}', 'motifs-mulhouse', 4, '/assets/motif-alsace-tour-ronde-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-klapperstein', 'Klapperstein', '{"en":{"name":"Klapperstein"},"de":{"name":"Klapperstein"},"it":{"name":"Klapperstein"},"es":{"name":"Klapperstein"},"ja":{"name":"Klapperstein"},"zh":{"name":"Klapperstein"}}', 'motifs-mulhouse', 5, '/assets/motif-alsace-klapperstein-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-chapelle', 'Chapelle', '{"en":{"name":"Chapel"},"de":{"name":"Kapelle"},"it":{"name":"Cappella"},"es":{"name":"Capilla"},"ja":{"name":"礼拝堂"},"zh":{"name":"小教堂"}}', 'motifs-mulhouse', 6, '/assets/motif-alsace-chapelle-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-maisons-ouvrieres', 'Cité ouvrière', '{"en":{"name":"Workers'' Houses"},"de":{"name":"Arbeitersiedlung"},"it":{"name":"Quartiere operaio"},"es":{"name":"Barrio obrero"},"ja":{"name":"労働者住宅"},"zh":{"name":"工人住宅"}}', 'motifs-mulhouse', 7, '/assets/motif-alsace-maisons-ouvrieres-v1.svg', '{"st0":"#2B2B2B","st1":"#E9C46A","st2":"#E8A598","st3":"#9CC3D5","st4":"#A9C5A0","st5":"#FFF8EC"}'),
  ('motif-usine-textile', 'Usine textile', '{"en":{"name":"Textile Mill"},"de":{"name":"Textilfabrik"},"it":{"name":"Fabbrica tessile"},"es":{"name":"Fábrica textil"},"ja":{"name":"織物工場"},"zh":{"name":"纺织厂"}}', 'motifs-textile-musees', 0, '/assets/motif-alsace-usine-textile-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-metier-a-tisser', 'Métier à tisser', '{"en":{"name":"Loom"},"de":{"name":"Webstuhl"},"it":{"name":"Telaio"},"es":{"name":"Telar"},"ja":{"name":"織機"},"zh":{"name":"织布机"}}', 'motifs-textile-musees', 1, '/assets/motif-alsace-metier-a-tisser-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-tampon-textile', 'Impression sur étoffes', '{"en":{"name":"Fabric Printing"},"de":{"name":"Stoffdruck"},"it":{"name":"Stampa su tessuto"},"es":{"name":"Estampado textil"},"ja":{"name":"布のプリント"},"zh":{"name":"织物印花"}}', 'motifs-textile-musees', 2, '/assets/motif-alsace-tampon-textile-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-bobine-et-tissu', 'Bobine et tissu', '{"en":{"name":"Spool and Fabric"},"de":{"name":"Garnrolle und Stoff"},"it":{"name":"Rocchetto e tessuto"},"es":{"name":"Carrete y tela"},"ja":{"name":"糸巻きと布"},"zh":{"name":"线轴与布料"}}', 'motifs-textile-musees', 3, '/assets/motif-alsace-bobine-et-tissu-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-tissu-fleuri', 'Tissu fleuri', '{"en":{"name":"Floral Fabric"},"de":{"name":"Blumenstoff"},"it":{"name":"Tessuto a fiori"},"es":{"name":"Tela floreada"},"ja":{"name":"花柄の布"},"zh":{"name":"花布"}}', 'motifs-textile-musees', 4, '/assets/motif-alsace-tissu-fleuri-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-locomotive', 'Locomotive', '{"en":{"name":"Locomotive"},"de":{"name":"Lokomotive"},"it":{"name":"Locomotiva"},"es":{"name":"Locomotora"},"ja":{"name":"蒸気機関車"},"zh":{"name":"蒸汽机车"}}', 'motifs-textile-musees', 5, '/assets/motif-alsace-locomotive-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-voiture-ancienne', 'Voiture ancienne', '{"en":{"name":"Vintage Car"},"de":{"name":"Oldtimer"},"it":{"name":"Auto d''epoca"},"es":{"name":"Coche antiguo"},"ja":{"name":"クラシックカー"},"zh":{"name":"老爷车"}}', 'motifs-textile-musees', 6, '/assets/motif-alsace-voiture-ancienne-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-cathedrale-strasbourg', 'Cathédrale de Strasbourg', '{"en":{"name":"Strasbourg Cathedral"},"de":{"name":"Straßburger Münster"},"it":{"name":"Cattedrale di Strasburgo"},"es":{"name":"Catedral de Estrasburgo"},"ja":{"name":"ストラスブール大聖堂"},"zh":{"name":"斯特拉斯堡大教堂"}}', 'motifs-strasbourg-colmar', 0, '/assets/motif-alsace-cathedrale-strasbourg-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-petite-france', 'La Petite France', '{"en":{"name":"La Petite France"},"de":{"name":"La Petite France"},"it":{"name":"La Petite France"},"es":{"name":"La Petite France"},"ja":{"name":"プティット・フランス"},"zh":{"name":"小法兰西"}}', 'motifs-strasbourg-colmar', 1, '/assets/motif-alsace-petite-france-v1.svg', '{"st0":"#2B2B2B","st1":"#E9C46A","st2":"#E8A598","st3":"#9CC3D5","st4":"#FFF8EC"}'),
  ('motif-ponts-couverts', 'Les Ponts couverts', '{"en":{"name":"Ponts Couverts"},"de":{"name":"Gedeckte Brücken"},"it":{"name":"Ponts Couverts"},"es":{"name":"Ponts Couverts"},"ja":{"name":"ポン・クヴェール"},"zh":{"name":"斯特拉斯堡廊桥"}}', 'motifs-strasbourg-colmar', 2, '/assets/motif-alsace-ponts-couverts-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-tram-strasbourg', 'Tram de Strasbourg', '{"en":{"name":"Strasbourg Tram"},"de":{"name":"Straßburger Straßenbahn"},"it":{"name":"Tram di Strasburgo"},"es":{"name":"Tranvía de Estrasburgo"},"ja":{"name":"ストラスブールのトラム"},"zh":{"name":"斯特拉斯堡有轨电车"}}', 'motifs-strasbourg-colmar', 3, '/assets/motif-alsace-tram-strasbourg-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-petite-venise', 'La Petite Venise', '{"en":{"name":"Little Venice"},"de":{"name":"Klein-Venedig"},"it":{"name":"Piccola Venezia"},"es":{"name":"Pequeña Venecia"},"ja":{"name":"プティット・ヴニーズ"},"zh":{"name":"小威尼斯"}}', 'motifs-strasbourg-colmar', 4, '/assets/motif-alsace-petite-venise-v1.svg', '{"st0":"#2B2B2B","st1":"#E8A598","st2":"#9CC3D5","st3":"#E9C46A","st4":"#E8A598","st5":"#9CC3D5","st6":"#E9C46A","st7":"#E8A598","st8":"#FFF8EC"}'),
  ('motif-maisons-alsaciennes', 'Maisons alsaciennes', '{"en":{"name":"Alsatian Houses"},"de":{"name":"Elsässer Fachwerkhäuser"},"it":{"name":"Case alsaziane"},"es":{"name":"Casas alsacianas"},"ja":{"name":"アルザスの家並み"},"zh":{"name":"阿尔萨斯民居"}}', 'motifs-maisons-alsace', 0, '/assets/motif-alsace-maisons-alsaciennes-v1.svg', '{"st0":"#2B2B2B","st1":"#E8A598","st2":"#E9C46A","st3":"#9CC3D5","st4":"#FFF8EC"}'),
  ('motif-maison-tourelle', 'Maison à tourelle', '{"en":{"name":"House with a Turret"},"de":{"name":"Haus mit Türmchen"},"it":{"name":"Casa con torretta"},"es":{"name":"Casa con torreta"},"ja":{"name":"小塔のある家"},"zh":{"name":"带小塔楼的房子"}}', 'motifs-maisons-alsace', 1, '/assets/motif-alsace-maison-tourelle-v1.svg', '{"st0":"#2B2B2B","st1":"#E9C46A"}'),
  ('motif-maison-colombages', 'Maison à colombages', '{"en":{"name":"Half-Timbered House"},"de":{"name":"Fachwerkhaus"},"it":{"name":"Casa a graticcio"},"es":{"name":"Casa de entramado"},"ja":{"name":"木骨造りの家"},"zh":{"name":"半木结构房屋"}}', 'motifs-maisons-alsace', 2, '/assets/motif-alsace-maison-colombages-v1.svg', '{"st0":"#2B2B2B","st1":"#E8A598"}'),
  ('motif-maison-pignon-redents', 'Maison à pignon à redents', '{"en":{"name":"House with a Stepped Gable"},"de":{"name":"Haus mit Treppengiebel"},"it":{"name":"Casa con frontone a gradoni"},"es":{"name":"Casa con hastial escalonado"},"ja":{"name":"階段状の破風の家"},"zh":{"name":"阶梯山墙房屋"}}', 'motifs-maisons-alsace', 3, '/assets/motif-alsace-maison-pignon-redents-v1.svg', '{"st0":"#2B2B2B","st1":"#9CC3D5","st2":"#E9C46A"}'),
  ('motif-chalet-de-noel', 'Chalet de Noël', '{"en":{"name":"Christmas Market Stall"},"de":{"name":"Weihnachtsmarktbude"},"it":{"name":"Casetta di Natale"},"es":{"name":"Caseta navideña"},"ja":{"name":"クリスマスマーケットの屋台"},"zh":{"name":"圣诞集市小屋"}}', 'motifs-noel', 0, '/assets/motif-alsace-chalet-de-noel-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-sapin', 'Sapin de Noël', '{"en":{"name":"Christmas Tree"},"de":{"name":"Weihnachtsbaum"},"it":{"name":"Albero di Natale"},"es":{"name":"Árbol de Navidad"},"ja":{"name":"クリスマスツリー"},"zh":{"name":"圣诞树"}}', 'motifs-noel', 1, '/assets/motif-alsace-sapin-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-etoile', 'Étoile', '{"en":{"name":"Star"},"de":{"name":"Stern"},"it":{"name":"Stella"},"es":{"name":"Estrella"},"ja":{"name":"星"},"zh":{"name":"星星"}}', 'motifs-noel', 2, '/assets/motif-alsace-etoile-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-lanterne', 'Lanterne', '{"en":{"name":"Lantern"},"de":{"name":"Laterne"},"it":{"name":"Lanterna"},"es":{"name":"Farol"},"ja":{"name":"ランタン"},"zh":{"name":"提灯"}}', 'motifs-noel', 3, '/assets/motif-alsace-lanterne-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-couronne-avent', 'Couronne de l''Avent', '{"en":{"name":"Advent Wreath"},"de":{"name":"Adventskranz"},"it":{"name":"Corona dell''Avvento"},"es":{"name":"Corona de Adviento"},"ja":{"name":"アドベントリース"},"zh":{"name":"将临期花环"}}', 'motifs-noel', 4, '/assets/motif-alsace-couronne-avent-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-poinsettia', 'Poinsettia', '{"en":{"name":"Poinsettia"},"de":{"name":"Weihnachtsstern"},"it":{"name":"Stella di Natale"},"es":{"name":"Flor de Pascua"},"ja":{"name":"ポインセチア"},"zh":{"name":"一品红"}}', 'motifs-noel', 5, '/assets/motif-alsace-poinsettia-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-couronne-bougies', 'Couronne aux bougies', '{"en":{"name":"Wreath with candles"},"de":{"name":"Kranz mit Kerzen"},"it":{"name":"Corona con candele"},"es":{"name":"Corona con velas"},"ja":{"name":"キャンドルのリース"},"zh":{"name":"蜡烛花环"}}', 'motifs-noel', 6, '/assets/motif-alsace-couronne-bougies-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-coeur-vichy', 'Cœur vichy', '{"en":{"name":"Gingham Heart"},"de":{"name":"Kariertes Herz"},"it":{"name":"Cuore a quadretti"},"es":{"name":"Corazón de cuadros"},"ja":{"name":"ギンガムチェックのハート"},"zh":{"name":"格纹爱心"}}', 'motifs-noel', 7, '/assets/motif-alsace-coeur-vichy-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC","st2":"#95918B"}'),
  ('motif-maison-enneigee', 'Maison enneigée', '{"en":{"name":"Snowy House"},"de":{"name":"Verschneites Haus"},"it":{"name":"Casa innevata"},"es":{"name":"Casa nevada"},"ja":{"name":"雪の積もった家"},"zh":{"name":"雪中的房子"}}', 'motifs-noel', 8, '/assets/motif-alsace-maison-enneigee-v1.svg', '{"st0":"#2B2B2B","st1":"#E8A598","st2":"#FFF8EC"}'),
  ('motif-boule-de-noel', 'Boule de Noël', '{"en":{"name":"Christmas Bauble"},"de":{"name":"Weihnachtskugel"},"it":{"name":"Pallina di Natale"},"es":{"name":"Bola de Navidad"},"ja":{"name":"クリスマスボール"},"zh":{"name":"圣诞球"}}', 'motifs-noel', 9, '/assets/motif-alsace-boule-de-noel-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-bougie-de-noel', 'Bougie de Noël', '{"en":{"name":"Christmas Candle"},"de":{"name":"Weihnachtskerze"},"it":{"name":"Candela di Natale"},"es":{"name":"Vela de Navidad"},"ja":{"name":"クリスマスキャンドル"},"zh":{"name":"圣诞蜡烛"}}', 'motifs-noel', 10, '/assets/motif-alsace-bougie-de-noel-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-bonhomme-pain-epice', 'Bonhomme en pain d''épices', '{"en":{"name":"Gingerbread Man"},"de":{"name":"Lebkuchenmann"},"it":{"name":"Omino di pan di zenzero"},"es":{"name":"Hombre de jengibre"},"ja":{"name":"ジンジャーブレッドマン"},"zh":{"name":"姜饼人"}}', 'motifs-gourmandises', 0, '/assets/motif-alsace-bonhomme-pain-epice-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-coeur-pain-epice', 'Cœur en pain d''épices', '{"en":{"name":"Gingerbread Heart"},"de":{"name":"Lebkuchenherz"},"it":{"name":"Cuore di pan di zenzero"},"es":{"name":"Corazón de jengibre"},"ja":{"name":"ハートのジンジャーブレッド"},"zh":{"name":"姜饼心"}}', 'motifs-gourmandises', 1, '/assets/motif-alsace-coeur-pain-epice-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-kougelhopf', 'Kougelhopf', '{"en":{"name":"Kougelhopf"},"de":{"name":"Gugelhupf"},"it":{"name":"Kougelhopf"},"es":{"name":"Kougelhopf"},"ja":{"name":"クグロフ"},"zh":{"name":"Kougelhopf"}}', 'motifs-gourmandises', 2, '/assets/motif-alsace-kougelhopf-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-bretzel', 'Bretzel', '{"en":{"name":"Pretzel"},"de":{"name":"Brezel"},"it":{"name":"Bretzel"},"es":{"name":"Pretzel"},"ja":{"name":"プレッツェル"},"zh":{"name":"椒盐卷饼"}}', 'motifs-gourmandises', 3, '/assets/motif-alsace-bretzel-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-bredele', 'Bredele', '{"en":{"name":"Bredele Cookies"},"de":{"name":"Bredele"},"it":{"name":"Biscotti bredele"},"es":{"name":"Galletas bredele"},"ja":{"name":"クリスマスクッキー"},"zh":{"name":"圣诞饼干"}}', 'motifs-gourmandises', 4, '/assets/motif-alsace-bredele-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-coeur-cigognes', 'Cœur aux cigognes', '{"en":{"name":"Heart with Storks"},"de":{"name":"Herz mit Störchen"},"it":{"name":"Cuore con cicogne"},"es":{"name":"Corazón con cigüeñas"},"ja":{"name":"コウノトリのハート"},"zh":{"name":"白鹳爱心"}}', 'motifs-gourmandises', 5, '/assets/motif-alsace-coeur-cigognes-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-vin-chaud', 'Vin chaud', '{"en":{"name":"Mulled Wine"},"de":{"name":"Glühwein"},"it":{"name":"Vin brulé"},"es":{"name":"Vino caliente"},"ja":{"name":"ホットワイン"},"zh":{"name":"热红酒"}}', 'motifs-gourmandises', 6, '/assets/motif-alsace-vin-chaud-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-cigogne', 'Cigogne sur son nid', '{"en":{"name":"Stork on its nest"},"de":{"name":"Storch im Nest"},"it":{"name":"Cicogna sul nido"},"es":{"name":"Cigüeña en su nido"},"ja":{"name":"巣の上のコウノトリ"},"zh":{"name":"巢中的白鹳"}}', 'motifs-alsace', 0, '/assets/motif-alsace-cigogne-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-vignoble', 'Vignoble', '{"en":{"name":"Vineyard"},"de":{"name":"Weinberg"},"it":{"name":"Vigneto"},"es":{"name":"Viñedo"},"ja":{"name":"ブドウ畑"},"zh":{"name":"葡萄园"}}', 'motifs-alsace', 1, '/assets/motif-alsace-vignoble-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-cigogne-debout', 'Cigogne', '{"en":{"name":"Stork"},"de":{"name":"Storch"},"it":{"name":"Cicogna"},"es":{"name":"Cigüeña"},"ja":{"name":"コウノトリ"},"zh":{"name":"白鹳"}}', 'motifs-alsace', 2, '/assets/motif-alsace-cigogne-debout-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-grappe-raisin', 'Grappe de raisin', '{"en":{"name":"Bunch of Grapes"},"de":{"name":"Weintraube"},"it":{"name":"Grappolo d''uva"},"es":{"name":"Racimo de uvas"},"ja":{"name":"ブドウの房"},"zh":{"name":"葡萄串"}}', 'motifs-alsace', 3, '/assets/motif-alsace-grappe-raisin-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}'),
  ('motif-noeud-alsacien', 'Nœud alsacien', '{"en":{"name":"Alsatian Bow"},"de":{"name":"Elsässer Schleife"},"it":{"name":"Fiocco alsaziano"},"es":{"name":"Lazo alsaciano"},"ja":{"name":"アルザスのリボン"},"zh":{"name":"阿尔萨斯蝴蝶结"}}', 'motifs-alsace', 4, '/assets/motif-alsace-noeud-alsacien-v1.svg', '{"st0":"#2B2B2B","st1":"#FFF8EC"}')
) AS v(slug, nom, trad, cat, pos, url, zones)
JOIN "character_category" cc ON cc."slug" = v.cat
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
-- (Pas de « INSERT … SELECT max() … WHERE NOT EXISTS » : un agrégat sans GROUP BY rend
--  une ligne même quand le WHERE écarte tout, et l'insertion se ferait quand même.)
INSERT INTO "collection" ("slug", "name", "description", "position", "active", "translations")
VALUES ('marche-de-noel-de-mulhouse', 'Marché de Noël de Mulhouse',
  'Les affiches du stand Memory Line au marché de Noël de Mulhouse, proposées le temps du marché.',
  (SELECT coalesce(max("position"), 0) + 1 FROM "collection"), true, '{"en":{"name":"Mulhouse Christmas Market","description":"The Memory Line stand posters at the Mulhouse Christmas market, available while the market lasts."},"de":{"name":"Weihnachtsmarkt Mulhouse","description":"Die Poster des Memory-Line-Stands auf dem Weihnachtsmarkt in Mulhouse, nur während des Marktes."},"it":{"name":"Mercatino di Natale di Mulhouse","description":"I poster dello stand Memory Line al mercatino di Natale di Mulhouse, disponibili per la durata del mercatino."},"es":{"name":"Mercado de Navidad de Mulhouse","description":"Los pósteres del puesto Memory Line en el mercado de Navidad de Mulhouse, disponibles mientras dure el mercado."},"ja":{"name":"ミュルーズのクリスマスマーケット","description":"ミュルーズのクリスマスマーケットに出店するMemory Lineのポスター。開催期間中のみ。"},"zh":{"name":"米卢斯圣诞市场","description":"Memory Line 在米卢斯圣诞市场摊位的海报，仅在市场期间提供。"}}'::jsonb)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
-- Le stand est trouvé par sa page (« mulhouse »), jamais par son code (il ouvre la
-- tablette, il n'a rien à faire dans le dépôt). Pas de stand trouvé : brouillon,
-- jamais une affiche en vente pour toujours.
INSERT INTO "product" ("slug", "name", "description", "kind", "default_view", "foreground_url",
  "default_title", "default_subtitle", "default_line3", "base_price_cents", "weight_grams",
  "vendor", "product_type", "status", "translations", "vue_motifs", "stand_id")
SELECT 'mulhouse-marche-de-noel-affiche-personnalisee',
  'MULHOUSE Marché de Noël - Affiche personnalisée',
  'Une affiche à composer au marché de Noël de Mulhouse : choisissez un motif d''Alsace (l''hôtel de ville, le temple Saint-Étienne, des maisons à colombages, un bredele…), un fond uni, en dégradé ou à motifs, placez votre texte en haut ou en bas, puis ajoutez vos personnages. Proposée le temps du marché seulement.',
  'personnalisable'::product_kind, 'front', NULL,
  NULL, 'Marché de Noël de Mulhouse', NULL,
  p."base_price_cents", p."weight_grams", p."vendor", p."product_type",
  CASE WHEN s."id" IS NULL THEN 'draft' ELSE 'active' END,
  '{"en":{"name":"MULHOUSE Christmas Market","description":"A poster to design at the Mulhouse Christmas market: choose an Alsatian design (the town hall, the Temple Saint-Étienne, half-timbered houses, bredele biscuits…), a plain, gradient or patterned background, put your text at the top or bottom, then add your characters. Available during the market only."},"de":{"name":"MULHOUSE Weihnachtsmarkt","description":"Ein Poster zum Gestalten auf dem Weihnachtsmarkt in Mulhouse: Wählen Sie ein elsässisches Motiv (das Rathaus, den Temple Saint-Étienne, Fachwerkhäuser, Bredele …), einen einfarbigen, verlaufenden oder gemusterten Hintergrund, setzen Sie Ihren Text oben oder unten und fügen Sie Ihre Figuren hinzu. Nur während des Marktes erhältlich."},"it":{"name":"MULHOUSE Mercatino di Natale","description":"Un poster da comporre al mercatino di Natale di Mulhouse: scelga un motivo alsaziano (il municipio, il Temple Saint-Étienne, case a graticcio, bredele…), uno sfondo a tinta unita, sfumato o a motivi, metta il testo in alto o in basso e aggiunga i suoi personaggi. Disponibile solo durante il mercatino."},"es":{"name":"MULHOUSE Mercado de Navidad","description":"Un póster para componer en el mercado de Navidad de Mulhouse: elija un motivo alsaciano (el ayuntamiento, el Temple Saint-Étienne, casas de entramado, bredele…), un fondo liso, degradado o estampado, coloque su texto arriba o abajo y añada sus personajes. Disponible solo durante el mercado."},"ja":{"name":"MULHOUSE クリスマスマーケット","description":"ミュルーズのクリスマスマーケットで作るポスターです。アルザスのモチーフ（市庁舎、サン・テティエンヌ教会、木骨造りの家、ブレデルなど）と、無地・グラデーション・柄の背景を選び、文字を上か下に配置して、キャラクターを加えてください。マーケット開催期間中のみの販売です。"},"zh":{"name":"MULHOUSE 圣诞市场","description":"在米卢斯圣诞市场定制的海报：选择一个阿尔萨斯图案（市政厅、圣艾蒂安教堂、半木结构房屋、圣诞小饼干等）、纯色、渐变或花纹背景，将文字放在上方或下方，再添加您的人物。仅在市场期间提供。"}}'::jsonb, 'motifs-alsace', s."id"
FROM "product" p
LEFT JOIN LATERAL (
  SELECT st."id" FROM "stand" st JOIN "page" pg ON pg."id" = st."page_id"
  WHERE pg."slug" = 'mulhouse' AND st."archived_at" IS NULL
  ORDER BY st."id" LIMIT 1
) s ON true
WHERE p."slug" = 'mulhouse-hotel-de-ville-affiche-personnalisee'
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "variant" ("product_id", "format", "price_cents", "width_mm", "height_mm", "weight_grams",
  "compare_at_cents", "cost_cents", "stock_qty", "stock_policy", "sku")
SELECT c."id", v."format", v."price_cents", v."width_mm", v."height_mm", v."weight_grams",
  v."compare_at_cents", v."cost_cents", v."stock_qty", v."stock_policy",
  'ML-MULHOUSE-MARCHE-DE-NOEL-' || v."format"
FROM "variant" v
JOIN "product" p ON p."id" = v."product_id" AND p."slug" = 'mulhouse-hotel-de-ville-affiche-personnalisee'
JOIN "product" c ON c."slug" = 'mulhouse-marche-de-noel-affiche-personnalisee'
WHERE NOT EXISTS (SELECT 1 FROM "variant" WHERE "product_id" = c."id");
--> statement-breakpoint
INSERT INTO "product_collection" ("product_id", "collection_id", "position")
SELECT p."id", c."id", 0 FROM "product" p, "collection" c
WHERE p."slug" = 'mulhouse-marche-de-noel-affiche-personnalisee' AND c."slug" = 'marche-de-noel-de-mulhouse'
ON CONFLICT ("product_id", "collection_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "product_image" ("product_id", "url", "alt", "position")
SELECT p."id", v.url, v.alt, v.pos FROM "product" p, (VALUES
  ('/assets/mulhouse-marche-de-noel-exemple-1-v1.jpg', 'Affiche du marché de Noël de Mulhouse : maisons alsaciennes colorées, texte en bas', 0),
  ('/assets/mulhouse-marche-de-noel-exemple-2-v1.jpg', 'Affiche du marché de Noël de Mulhouse : l''hôtel de ville sur un fond de nuit d''hiver', 1)
) AS v(url, alt, pos)
WHERE p."slug" = 'mulhouse-marche-de-noel-affiche-personnalisee'
  AND NOT EXISTS (SELECT 1 FROM "product_image" WHERE "product_id" = p."id");
--> statement-breakpoint
INSERT INTO "background" ("product_id", "url", "name", "position")
SELECT p."id", v.url, v.nom, v.pos FROM "product" p, (VALUES
  ('/assets/fond-noel-uni-rouge-noel-v1.svg', 'Rouge Noël (uni)', 0),
  ('/assets/fond-noel-uni-vert-sapin-v1.svg', 'Vert sapin (uni)', 1),
  ('/assets/fond-noel-uni-bleu-nuit-v1.svg', 'Bleu nuit (uni)', 2),
  ('/assets/fond-noel-uni-bordeaux-v1.svg', 'Bordeaux (uni)', 3),
  ('/assets/fond-noel-uni-creme-v1.svg', 'Crème (uni)', 4),
  ('/assets/fond-noel-uni-ocre-v1.svg', 'Ocre (uni)', 5),
  ('/assets/fond-noel-uni-rose-saumon-v1.svg', 'Rose saumon (uni)', 6),
  ('/assets/fond-noel-uni-bleu-ciel-v1.svg', 'Bleu ciel (uni)', 7),
  ('/assets/fond-noel-degrade-nuit-d-hiver-v1.svg', 'Nuit d''hiver (dégradé)', 8),
  ('/assets/fond-noel-degrade-braise-v1.svg', 'Braise (dégradé)', 9),
  ('/assets/fond-noel-degrade-foret-v1.svg', 'Forêt (dégradé)', 10),
  ('/assets/fond-noel-degrade-crepuscule-v1.svg', 'Crépuscule (dégradé)', 11),
  ('/assets/fond-noel-degrade-neige-v1.svg', 'Neige (dégradé)', 12),
  ('/assets/fond-noel-degrade-aube-v1.svg', 'Aube rosée (dégradé)', 13),
  ('/assets/fond-noel-repete-flocons-v1.svg', 'Flocons', 14),
  ('/assets/fond-noel-repete-vichy-rouge-v1.svg', 'Vichy rouge', 15),
  ('/assets/fond-noel-repete-etoiles-v1.svg', 'Étoiles dorées', 16),
  ('/assets/fond-noel-repete-coeurs-v1.svg', 'Cœurs alsaciens', 17),
  ('/assets/fond-noel-repete-pois-neige-v1.svg', 'Pois de neige', 18)
) AS v(url, nom, pos)
WHERE p."slug" = 'mulhouse-marche-de-noel-affiche-personnalisee'
  AND NOT EXISTS (SELECT 1 FROM "background" WHERE "product_id" = p."id");
--> statement-breakpoint
-- La page de la tablette : un bloc d'affiches EN TÊTE, avec cette seule affiche. Le
-- bloc existant porte déjà 200 références, le plafond de cms.ts
-- (LIMITE_PRODUITS_MAX) : y ajouter la nouvelle en ferait tomber une. Garde-fous :
-- une seule fois, et seulement si la page n'a pas de blocs traduits (fusionnerBlocs
-- les aligne par rang). Sinon, l'affiche s'ajoute au BO › Pages.
UPDATE "page" pg
SET "blocks" = jsonb_build_array(jsonb_build_object(
      'type', 'produits', 'source', 'affiches', 'reference', p."id"::text,
      'references', jsonb_build_array(p."id"::text), 'limite', 1)) || pg."blocks",
    "updated_at" = now()
FROM "product" p
WHERE pg."slug" = 'mulhouse'
  AND p."slug" = 'mulhouse-marche-de-noel-affiche-personnalisee'
  AND jsonb_typeof(pg."blocks") = 'array'
  AND NOT (pg."blocks" @> jsonb_build_array(jsonb_build_object('references', jsonb_build_array(p."id"::text))))
  AND NOT jsonb_path_exists(coalesce(pg."translations", '{}'::jsonb), '$.*.blocks');
