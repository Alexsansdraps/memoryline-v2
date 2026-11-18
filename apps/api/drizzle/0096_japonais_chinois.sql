-- Le japonais et le chinois simplifié (18/11, touristes du marché de Noël,
-- à la demande d'Alexandra) : les libellés que la base fournit à l'interface
-- — menu du haut et pied de page, rayons, onglets et personnages du module de
-- personnalisation, cadres, modes de livraison, lieu du marché de Noël,
-- promotion et bandeau. Les fiches produits et les pages légales n'ont pas
-- encore de version japonaise ou chinoise : elles retombent sur l'anglais
-- (traductionDe, traductions.ts). Rien n'est écrasé ; une ligne renommée
-- depuis le relevé est laissée telle quelle.
UPDATE "menu_item" x
SET "translations" = coalesce(x."translations", '{}'::jsonb) || (
    SELECT jsonb_object_agg(l.key, l.value || coalesce((
      SELECT jsonb_object_agg(e.key, e.value)
      FROM jsonb_each(CASE WHEN jsonb_typeof(x."translations" -> l.key) = 'object' THEN x."translations" -> l.key ELSE '{}'::jsonb END) e
      WHERE (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') <> '')
         OR (jsonb_typeof(e.value) = 'array' AND jsonb_array_length(e.value) > 0)
    ), '{}'::jsonb))
    FROM jsonb_each(t.trad) l
  )
FROM (VALUES
  (8, 'Affiches personnalisables', '{"ja":{"label":"パーソナライズポスター"},"zh":{"label":"个性化海报"}}'::jsonb),
  (15, 'TOUT VOIR', '{"ja":{"label":"すべて見る"},"zh":{"label":"查看全部"}}'::jsonb),
  (10, 'Villes', '{"ja":{"label":"街"},"zh":{"label":"城市"}}'::jsonb),
  (11, 'Thèmes et paysages', '{"ja":{"label":"テーマと風景"},"zh":{"label":"主题与风景"}}'::jsonb),
  (12, 'Affiches prêtes à imprimer', '{"ja":{"label":"すぐに飾れるデザインポスター"},"zh":{"label":"现成设计海报"}}'::jsonb),
  (17, 'TOUT VOIR', '{"ja":{"label":"すべて見る"},"zh":{"label":"查看全部"}}'::jsonb),
  (30, 'Carte cadeau', '{"ja":{"label":"ギフトカード"},"zh":{"label":"礼品卡"}}'::jsonb),
  (18, 'La boutique', '{"ja":{"label":"ショップ"},"zh":{"label":"商店"}}'::jsonb),
  (20, 'Affiches', '{"ja":{"label":"ポスター"},"zh":{"label":"海报"}}'::jsonb),
  (21, 'Affiches personnalisables', '{"ja":{"label":"パーソナライズポスター"},"zh":{"label":"个性化海报"}}'::jsonb),
  (22, 'Affiches prêtes à imprimer', '{"ja":{"label":"すぐに飾れるデザインポスター"},"zh":{"label":"现成设计海报"}}'::jsonb),
  (23, 'Rechercher', '{"ja":{"label":"検索"},"zh":{"label":"搜索"}}'::jsonb),
  (29, 'Carte cadeau', '{"ja":{"label":"ギフトカード"},"zh":{"label":"礼品卡"}}'::jsonb),
  (19, 'Aide et informations', '{"ja":{"label":"ヘルプとご案内"},"zh":{"label":"帮助与信息"}}'::jsonb),
  (24, 'Nous contacter', '{"ja":{"label":"お問い合わせ"},"zh":{"label":"联系我们"}}'::jsonb),
  (25, 'Conditions générales de vente', '{"ja":{"label":"販売条件"},"zh":{"label":"销售条款"}}'::jsonb),
  (26, 'Mentions légales', '{"ja":{"label":"運営者情報"},"zh":{"label":"法律声明"}}'::jsonb),
  (27, 'Politique de confidentialité', '{"ja":{"label":"プライバシーポリシー"},"zh":{"label":"隐私政策"}}'::jsonb),
  (28, 'Cookies', '{"ja":{"label":"Cookie について"},"zh":{"label":"Cookie 政策"}}'::jsonb)
) AS t(id, nom, trad)
WHERE x."id" = t.id AND x."label" = t.nom;
--> statement-breakpoint
UPDATE "collection" x
SET "translations" = coalesce(x."translations", '{}'::jsonb) || (
    SELECT jsonb_object_agg(l.key, l.value || coalesce((
      SELECT jsonb_object_agg(e.key, e.value)
      FROM jsonb_each(CASE WHEN jsonb_typeof(x."translations" -> l.key) = 'object' THEN x."translations" -> l.key ELSE '{}'::jsonb END) e
      WHERE (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') <> '')
         OR (jsonb_typeof(e.value) = 'array' AND jsonb_array_length(e.value) > 0)
    ), '{}'::jsonb))
    FROM jsonb_each(t.trad) l
  )
FROM (VALUES
  (1, 'accessoires', 'Accessoires', '{"ja":{"name":"アクセサリー"},"zh":{"name":"配饰"}}'::jsonb),
  (5, 'affiches-diverses', 'Affiches prêtes à imprimer', '{"ja":{"name":"すぐに飾れるデザインポスター"},"zh":{"name":"现成设计海报"}}'::jsonb),
  (6, 'collection-tout-voir', 'Collection TOUT VOIR', '{"ja":{"name":"すべて見る"},"zh":{"name":"查看全部"}}'::jsonb),
  (7, 'cuisine', 'Cuisine', '{"ja":{"name":"キッチン"},"zh":{"name":"厨房"}}'::jsonb),
  (11, 'frontpage', 'Page d''accueil / En vedette', '{"ja":{"name":"ホーム／おすすめ"},"zh":{"name":"首页／精选"}}'::jsonb),
  (13, 'personnages-de-face', 'Personnages de FACE', '{"ja":{"name":"正面向きのキャラクター"},"zh":{"name":"正面人物"}}'::jsonb),
  (12, 'personnages-de-dos', 'Personnages de dos', '{"ja":{"name":"後ろ向きのキャラクター"},"zh":{"name":"背面人物"}}'::jsonb),
  (16, 'balades-paysages', 'Thèmes & paysages', '{"ja":{"name":"テーマと風景"},"zh":{"name":"主题与风景"}}'::jsonb),
  (17, 'villes', 'Villes', '{"ja":{"name":"街"},"zh":{"name":"城市"}}'::jsonb),
  (19, 'a-partir-de-photos', 'À partir de photos', '{"ja":{"name":"写真から"},"zh":{"name":"照片定制"}}'::jsonb)
) AS t(id, slug, nom, trad)
WHERE x."id" = t.id AND x."slug" = t.slug AND x."name" = t.nom;
--> statement-breakpoint
UPDATE "character_category" x
SET "translations" = coalesce(x."translations", '{}'::jsonb) || (
    SELECT jsonb_object_agg(l.key, l.value || coalesce((
      SELECT jsonb_object_agg(e.key, e.value)
      FROM jsonb_each(CASE WHEN jsonb_typeof(x."translations" -> l.key) = 'object' THEN x."translations" -> l.key ELSE '{}'::jsonb END) e
      WHERE (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') <> '')
         OR (jsonb_typeof(e.value) = 'array' AND jsonb_array_length(e.value) > 0)
    ), '{}'::jsonb))
    FROM jsonb_each(t.trad) l
  )
FROM (VALUES
  (4, 'Femmes', '{"ja":{"name":"女性"},"zh":{"name":"女士"}}'::jsonb),
  (7, 'Hommes', '{"ja":{"name":"男性"},"zh":{"name":"男士"}}'::jsonb),
  (1, 'Ados', '{"ja":{"name":"ティーン"},"zh":{"name":"青少年"}}'::jsonb),
  (5, 'Filles', '{"ja":{"name":"女の子"},"zh":{"name":"女孩"}}'::jsonb),
  (6, 'Garçons', '{"ja":{"name":"男の子"},"zh":{"name":"男孩"}}'::jsonb),
  (3, 'Bébés', '{"ja":{"name":"赤ちゃん"},"zh":{"name":"婴儿"}}'::jsonb),
  (2, 'Animaux', '{"ja":{"name":"動物"},"zh":{"name":"动物"}}'::jsonb),
  (10, 'Fauteuil roulant', '{"ja":{"name":"車いす"},"zh":{"name":"轮椅"}}'::jsonb)
) AS t(id, nom, trad)
WHERE x."id" = t.id AND x."name" = t.nom;
--> statement-breakpoint
UPDATE "character_type" x
SET "translations" = coalesce(x."translations", '{}'::jsonb) || (
    SELECT jsonb_object_agg(l.key, l.value || coalesce((
      SELECT jsonb_object_agg(e.key, e.value)
      FROM jsonb_each(CASE WHEN jsonb_typeof(x."translations" -> l.key) = 'object' THEN x."translations" -> l.key ELSE '{}'::jsonb END) e
      WHERE (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') <> '')
         OR (jsonb_typeof(e.value) = 'array' AND jsonb_array_length(e.value) > 0)
    ), '{}'::jsonb))
    FROM jsonb_each(t.trad) l
  )
FROM (VALUES
  (74, 'Femme 6', '{"ja":{"name":"女性 6"},"zh":{"name":"女士 6"}}'::jsonb),
  (42, 'Femme 1 haut fleurs', '{"ja":{"name":"女性 1 花柄トップス"},"zh":{"name":"女士 1 碎花上衣"}}'::jsonb),
  (6, 'Femme 2', '{"ja":{"name":"女性 2"},"zh":{"name":"女士 2"}}'::jsonb),
  (44, 'Femme 2 (manches longues)', '{"ja":{"name":"女性 2（長袖）"},"zh":{"name":"女士 2（长袖）"}}'::jsonb),
  (45, 'Femme 4', '{"ja":{"name":"女性 4"},"zh":{"name":"女士 4"}}'::jsonb),
  (48, 'Femme 3 marin ', '{"ja":{"name":"女性 3 マリンボーダー"},"zh":{"name":"女士 3 海魂衫"}}'::jsonb),
  (8, 'Femme 4', '{"ja":{"name":"女性 4"},"zh":{"name":"女士 4"}}'::jsonb),
  (46, 'Femme âgée', '{"ja":{"name":"年配の女性"},"zh":{"name":"老年女士"}}'::jsonb),
  (5, 'Femme 1', '{"ja":{"name":"女性 1"},"zh":{"name":"女士 1"}}'::jsonb),
  (43, 'Femme 2', '{"ja":{"name":"女性 2"},"zh":{"name":"女士 2"}}'::jsonb),
  (7, 'Femme 3', '{"ja":{"name":"女性 3"},"zh":{"name":"女士 3"}}'::jsonb),
  (1, 'Homme 1', '{"ja":{"name":"男性 1"},"zh":{"name":"男士 1"}}'::jsonb),
  (37, 'Homme 1', '{"ja":{"name":"男性 1"},"zh":{"name":"男士 1"}}'::jsonb),
  (2, 'Homme 2', '{"ja":{"name":"男性 2"},"zh":{"name":"男士 2"}}'::jsonb),
  (38, 'Homme 2', '{"ja":{"name":"男性 2"},"zh":{"name":"男士 2"}}'::jsonb),
  (39, 'Homme 2 (manches longues)', '{"ja":{"name":"男性 2（長袖）"},"zh":{"name":"男士 2（长袖）"}}'::jsonb),
  (3, 'Homme 3', '{"ja":{"name":"男性 3"},"zh":{"name":"男士 3"}}'::jsonb),
  (40, 'Homme 3', '{"ja":{"name":"男性 3"},"zh":{"name":"男士 3"}}'::jsonb),
  (4, 'Homme 4', '{"ja":{"name":"男性 4"},"zh":{"name":"男士 4"}}'::jsonb),
  (41, 'Homme âgé', '{"ja":{"name":"年配の男性"},"zh":{"name":"老年男士"}}'::jsonb),
  (12, 'Ado fille 1', '{"ja":{"name":"ティーンの女の子 1"},"zh":{"name":"少女 1"}}'::jsonb),
  (13, 'Ado fille 1', '{"ja":{"name":"ティーンの女の子 1"},"zh":{"name":"少女 1"}}'::jsonb),
  (14, 'Ado fille 2', '{"ja":{"name":"ティーンの女の子 2"},"zh":{"name":"少女 2"}}'::jsonb),
  (54, 'Ado fille 2', '{"ja":{"name":"ティーンの女の子 2"},"zh":{"name":"少女 2"}}'::jsonb),
  (15, 'Ado garçon 1', '{"ja":{"name":"ティーンの男の子 1"},"zh":{"name":"少年 1"}}'::jsonb),
  (16, 'Ado garçon 1', '{"ja":{"name":"ティーンの男の子 1"},"zh":{"name":"少年 1"}}'::jsonb),
  (17, 'Ado garçon 2', '{"ja":{"name":"ティーンの男の子 2"},"zh":{"name":"少年 2"}}'::jsonb),
  (18, 'Ado garçon 2', '{"ja":{"name":"ティーンの男の子 2"},"zh":{"name":"少年 2"}}'::jsonb),
  (75, 'Fille 3', '{"ja":{"name":"女の子 3"},"zh":{"name":"女孩 3"}}'::jsonb),
  (11, 'Fille 1', '{"ja":{"name":"女の子 1"},"zh":{"name":"女孩 1"}}'::jsonb),
  (51, 'Fille 1', '{"ja":{"name":"女の子 1"},"zh":{"name":"女孩 1"}}'::jsonb),
  (53, 'Fille 2', '{"ja":{"name":"女の子 2"},"zh":{"name":"女孩 2"}}'::jsonb),
  (76, 'Garçon 2', '{"ja":{"name":"男の子 2"},"zh":{"name":"男孩 2"}}'::jsonb),
  (9, 'Garçon 1', '{"ja":{"name":"男の子 1"},"zh":{"name":"男孩 1"}}'::jsonb),
  (49, 'Garçon 1', '{"ja":{"name":"男の子 1"},"zh":{"name":"男孩 1"}}'::jsonb),
  (10, 'Garçon 2', '{"ja":{"name":"男の子 2"},"zh":{"name":"男孩 2"}}'::jsonb),
  (50, 'Garçon 2 (manches longues)', '{"ja":{"name":"男の子 2（長袖）"},"zh":{"name":"男孩 2（长袖）"}}'::jsonb),
  (52, 'Fille 1 (manches longues)', '{"ja":{"name":"女の子 1（長袖）"},"zh":{"name":"女孩 1（长袖）"}}'::jsonb),
  (19, 'Bébé fille', '{"ja":{"name":"赤ちゃん（女の子）"},"zh":{"name":"女婴"}}'::jsonb),
  (56, 'Bébé fille 1', '{"ja":{"name":"赤ちゃん（女の子） 1"},"zh":{"name":"女婴 1"}}'::jsonb),
  (20, 'Bébé garçon', '{"ja":{"name":"赤ちゃん（男の子）"},"zh":{"name":"男婴"}}'::jsonb),
  (57, 'Bébé garçon 1', '{"ja":{"name":"赤ちゃん（男の子） 1"},"zh":{"name":"男婴 1"}}'::jsonb),
  (32, 'Petit chien', '{"ja":{"name":"小型犬"},"zh":{"name":"小型犬"}}'::jsonb),
  (23, 'Chat 2', '{"ja":{"name":"猫 2"},"zh":{"name":"猫 2"}}'::jsonb),
  (28, 'Grand chien', '{"ja":{"name":"大型犬"},"zh":{"name":"大型犬"}}'::jsonb),
  (59, 'Berger australien', '{"ja":{"name":"オーストラリアン・シェパード"},"zh":{"name":"澳大利亚牧羊犬"}}'::jsonb),
  (77, 'Beagle', '{"ja":{"name":"ビーグル"},"zh":{"name":"比格犬"}}'::jsonb),
  (78, 'Teckel', '{"ja":{"name":"ダックスフンド"},"zh":{"name":"腊肠犬"}}'::jsonb),
  (81, 'Bouledogue', '{"ja":{"name":"ブルドッグ"},"zh":{"name":"斗牛犬"}}'::jsonb),
  (79, 'Epagnol', '{"ja":{"name":"スパニエル"},"zh":{"name":"西班牙猎犬"}}'::jsonb),
  (80, 'Chow-Chow', '{"ja":{"name":"チャウチャウ"},"zh":{"name":"松狮犬"}}'::jsonb),
  (82, 'Husky/malamute', '{"ja":{"name":"ハスキー／マラミュート"},"zh":{"name":"哈士奇／阿拉斯加雪橇犬"}}'::jsonb),
  (58, 'Berger allemand', '{"ja":{"name":"ジャーマン・シェパード"},"zh":{"name":"德国牧羊犬"}}'::jsonb),
  (21, 'Chat (dos)', '{"ja":{"name":"猫（後ろ姿）"},"zh":{"name":"猫（背面）"}}'::jsonb),
  (22, 'Chat 1', '{"ja":{"name":"猫 1"},"zh":{"name":"猫 1"}}'::jsonb),
  (24, 'Chat 2', '{"ja":{"name":"猫 2"},"zh":{"name":"猫 2"}}'::jsonb),
  (60, 'Chat gris', '{"ja":{"name":"グレーの猫"},"zh":{"name":"灰猫"}}'::jsonb),
  (61, 'Chat noir (face)', '{"ja":{"name":"黒猫（正面）"},"zh":{"name":"黑猫（正面）"}}'::jsonb),
  (62, 'Chat roux (face)', '{"ja":{"name":"茶トラ猫（正面）"},"zh":{"name":"橘猫（正面）"}}'::jsonb),
  (25, 'Cheval', '{"ja":{"name":"馬"},"zh":{"name":"马"}}'::jsonb),
  (26, 'Chien 1', '{"ja":{"name":"犬 1"},"zh":{"name":"狗 1"}}'::jsonb),
  (27, 'Chien 2', '{"ja":{"name":"犬 2"},"zh":{"name":"狗 2"}}'::jsonb),
  (63, 'Chien york', '{"ja":{"name":"ヨークシャー・テリア"},"zh":{"name":"约克夏梗"}}'::jsonb),
  (64, 'Chihuahua', '{"ja":{"name":"チワワ"},"zh":{"name":"吉娃娃"}}'::jsonb),
  (29, 'Grand chien (blanc)', '{"ja":{"name":"大型犬（白）"},"zh":{"name":"大型犬（白色）"}}'::jsonb),
  (30, 'Grand chien (gris)', '{"ja":{"name":"大型犬（グレー）"},"zh":{"name":"大型犬（灰色）"}}'::jsonb),
  (31, 'Grand chien (noir)', '{"ja":{"name":"大型犬（黒）"},"zh":{"name":"大型犬（黑色）"}}'::jsonb),
  (33, 'Poney', '{"ja":{"name":"ポニー"},"zh":{"name":"小马"}}'::jsonb),
  (65, 'Saint-bernard', '{"ja":{"name":"セント・バーナード"},"zh":{"name":"圣伯纳犬"}}'::jsonb),
  (47, 'Femme fauteuil roulant', '{"ja":{"name":"車いすの女性"},"zh":{"name":"坐轮椅的女士"}}'::jsonb)
) AS t(id, nom, trad)
WHERE x."id" = t.id AND x."name" = t.nom;
--> statement-breakpoint
UPDATE "frame" x
SET "translations" = coalesce(x."translations", '{}'::jsonb) || (
    SELECT jsonb_object_agg(l.key, l.value || coalesce((
      SELECT jsonb_object_agg(e.key, e.value)
      FROM jsonb_each(CASE WHEN jsonb_typeof(x."translations" -> l.key) = 'object' THEN x."translations" -> l.key ELSE '{}'::jsonb END) e
      WHERE (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') <> '')
         OR (jsonb_typeof(e.value) = 'array' AND jsonb_array_length(e.value) > 0)
    ), '{}'::jsonb))
    FROM jsonb_each(t.trad) l
  )
FROM (VALUES
  (4, 'Cadre noir', '{"ja":{"name":"黒のフレーム"},"zh":{"name":"黑色画框"}}'::jsonb),
  (3, 'Cadre blanc', '{"ja":{"name":"白のフレーム"},"zh":{"name":"白色画框"}}'::jsonb),
  (2, 'Cadre bois façon chêne', '{"ja":{"name":"オーク調の木製フレーム"},"zh":{"name":"橡木纹木框"}}'::jsonb)
) AS t(id, nom, trad)
WHERE x."id" = t.id AND x."name" = t.nom;
--> statement-breakpoint
UPDATE "shipping_method" x
SET "translations" = coalesce(x."translations", '{}'::jsonb) || (
    SELECT jsonb_object_agg(l.key, l.value || coalesce((
      SELECT jsonb_object_agg(e.key, e.value)
      FROM jsonb_each(CASE WHEN jsonb_typeof(x."translations" -> l.key) = 'object' THEN x."translations" -> l.key ELSE '{}'::jsonb END) e
      WHERE (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') <> '')
         OR (jsonb_typeof(e.value) = 'array' AND jsonb_array_length(e.value) > 0)
    ), '{}'::jsonb))
    FROM jsonb_each(t.trad) l
  )
FROM (VALUES
  ('mondial_relay', 'Point relais', '{"ja":{"name":"受取ポイント","description":"Mondial Relay — 3〜5営業日"},"zh":{"name":"自提点","description":"Mondial Relay — 3至5个工作日"}}'::jsonb),
  ('colissimo', 'À domicile', '{"ja":{"name":"自宅配送","description":"Colissimo — 2〜3営業日"},"zh":{"name":"送货上门","description":"Colissimo — 2至3个工作日"}}'::jsonb),
  ('colissimo_relais', 'Point de retrait', '{"ja":{"name":"受取窓口","description":"Colissimo — 郵便局、提携店舗、宅配ロッカー"},"zh":{"name":"取件点","description":"Colissimo — 邮局、合作商店或快递柜"}}'::jsonb),
  ('retrait-au-stand', 'Retrait au stand', '{"ja":{"name":"スタンドでの受け取り","description":"無料：当店のスタンドでポスターをお受け取りください。"},"zh":{"name":"摊位自取","description":"免费：请到我们的摊位领取您的海报。"}}'::jsonb)
) AS t(slug, nom, trad)
WHERE x."slug" = t.slug AND x."name" = t.nom;
--> statement-breakpoint
UPDATE "pickup_point" x
SET "translations" = coalesce(x."translations", '{}'::jsonb) || (
    SELECT jsonb_object_agg(l.key, l.value || coalesce((
      SELECT jsonb_object_agg(e.key, e.value)
      FROM jsonb_each(CASE WHEN jsonb_typeof(x."translations" -> l.key) = 'object' THEN x."translations" -> l.key ELSE '{}'::jsonb END) e
      WHERE (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') <> '')
         OR (jsonb_typeof(e.value) = 'array' AND jsonb_array_length(e.value) > 0)
    ), '{}'::jsonb))
    FROM jsonb_each(t.trad) l
  )
FROM (VALUES
  (1, 'Marché de Noël Mulhouse', '{"ja":{"nom":"ミュルーズのクリスマスマーケット"},"zh":{"nom":"米卢斯圣诞市场"}}'::jsonb)
) AS t(id, nom, trad)
WHERE x."id" = t.id AND x."nom" = t.nom;
--> statement-breakpoint
UPDATE "promo_rule" x
SET "translations" = coalesce(x."translations", '{}'::jsonb) || (
    SELECT jsonb_object_agg(l.key, l.value || coalesce((
      SELECT jsonb_object_agg(e.key, e.value)
      FROM jsonb_each(CASE WHEN jsonb_typeof(x."translations" -> l.key) = 'object' THEN x."translations" -> l.key ELSE '{}'::jsonb END) e
      WHERE (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') <> '')
         OR (jsonb_typeof(e.value) = 'array' AND jsonb_array_length(e.value) > 0)
    ), '{}'::jsonb))
    FROM jsonb_each(t.trad) l
  )
FROM (VALUES
  (1, '3 achetées = 1 A4 offerte', '{"ja":{"name":"3枚購入でA4を1枚プレゼント"},"zh":{"name":"买3张送1张A4"}}'::jsonb)
) AS t(id, nom, trad)
WHERE x."id" = t.id AND x."name" = t.nom;
--> statement-breakpoint
UPDATE "announcement_banner" x
SET "translations" = coalesce(x."translations", '{}'::jsonb) || (
    SELECT jsonb_object_agg(l.key, l.value || coalesce((
      SELECT jsonb_object_agg(e.key, e.value)
      FROM jsonb_each(CASE WHEN jsonb_typeof(x."translations" -> l.key) = 'object' THEN x."translations" -> l.key ELSE '{}'::jsonb END) e
      WHERE (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') <> '')
         OR (jsonb_typeof(e.value) = 'array' AND jsonb_array_length(e.value) > 0)
    ), '{}'::jsonb))
    FROM jsonb_each(t.trad) l
  )
FROM (VALUES
  (1, '✨ 3 AFFICHES ACHETÉES = 1 AFFICHE A4 OFFERTE (déduite au panier) ✨', '{"ja":{"message":"✨ ポスター3枚購入でA4ポスターを1枚プレゼント（カートで自動割引）✨","linkLabel":"今すぐチェック"},"zh":{"message":"✨ 买3张海报送1张A4海报（在购物车中自动扣除）✨","linkLabel":"立即参与"}}'::jsonb)
) AS t(id, nom, trad)
WHERE x."id" = t.id AND x."message" = t.nom;
