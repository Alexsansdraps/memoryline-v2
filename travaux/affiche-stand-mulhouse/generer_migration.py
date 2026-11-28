# -*- coding: utf-8 -*-
"""
Écrit la migration de l'affiche éphémère du stand de Mulhouse (PLAN.md § A3)
et range les fichiers qu'elle cite.

  python generer_migration.py
      -> apps/api/drizzle/0<idx>_affiche_stand_mulhouse.sql + entrée au journal,
         motifs et fonds copiés dans data/assets ET dans assets-prod/.
  python generer_migration.py --motifs-seulement --tag 0122_motifs_alsace_planches_3_5
      -> (PLAN.md § 13) une migration NEUVE qui n'insère que les motifs absents,
         dans les catégories déjà créées ; mêmes copies de fichiers.
  Options : --sans-motifs-3 (ignore motifs-3/ même complet),
            --essai (écrit le SQL sur la sortie, rien d'autre).

Ce que fait ce script, et lui seul : relire la FIN du journal de drizzle juste
avant d'écrire (le chantier garde-robe peut avoir ajouté sa migration), prendre
idx = dernier + 1 et when = plus grand + 10 000 000, et ajouter l'entrée EN
DERNIER, dans la mise en forme du fichier (fins de ligne comprises).

Les noms de fichiers ne sont JAMAIS réutilisés avec un autre contenu : /assets
est servi « immutable » et les vignettes ?l= sont gardées par nom
(data/assets/tailles). Un motif corrigé = un fichier -v2 et une migration
neuve (UPDATE de base_svg_url).
"""
import json
import os
import re
import shutil
import sys
import time
import xml.dom.minidom

ICI = os.path.dirname(os.path.abspath(__file__))
DEPOT = os.path.abspath(os.path.join(ICI, "..", ".."))
DRIZZLE = os.path.join(DEPOT, "apps", "api", "drizzle")
JOURNAL = os.path.join(DRIZZLE, "meta", "_journal.json")
ASSETS = os.path.join(DEPOT, "data", "assets")
ASSETS_PROD = os.path.join(ICI, "assets-prod")
MOTIFS = os.path.join(ICI, "motifs")
MOTIFS_3 = os.path.join(ICI, "motifs-3")
FONDS = os.path.join(ICI, "fonds")

LANGUES = ["fr", "en", "de", "it", "es", "ja", "zh"]
PRODUIT = "mulhouse-marche-de-noel-affiche-personnalisee"
MODELE = "mulhouse-hotel-de-ville-affiche-personnalisee"  # prix, poids, formats repris de lui
COLLECTION = "marche-de-noel-de-mulhouse"
VUE = "motifs-alsace"
CREME = "#FFF8EC"

# Rangement pour les clients (« tu les classes en plus pour les clients »),
# dans l'ordre des onglets. L'ordre des motifs de motifs-3 est celui du plan.
POSITION_CATEGORIE = {
    "mulhouse": 100,
    "textile-musees": 101,
    "strasbourg-colmar": 102,
    "maisons-alsace": 103,
    "noel": 104,
    "gourmandises": 105,
    "alsace": 106,
}
ORDRE_MOTIFS_3 = {
    "strasbourg-colmar": ["cathedrale-strasbourg", "petite-france", "ponts-couverts", "tram-strasbourg", "petite-venise"],
    "maisons-alsace": ["maison-tourelle", "maison-colombages", "maison-pignon-redents"],
    "noel": ["couronne-bougies", "coeur-vichy", "maison-enneigee", "boule-de-noel", "bougie-de-noel"],
    "gourmandises": ["bredele", "coeur-cigognes", "vin-chaud"],
    "alsace": ["cigogne-debout", "grappe-raisin", "noeud-alsacien"],
}

# Deux noms en double à départager (sinon deux vignettes et deux lignes 1
# identiques). À faire valider par Alexandra (PLAN.md § 14).
NOMS_CORRIGES = {
    "cigogne": {
        "fr": "Cigogne sur son nid", "en": "Stork on its nest", "de": "Storch im Nest",
        "it": "Cicogna sul nido", "es": "Cigüeña en su nido", "ja": "巣の上のコウノトリ", "zh": "巢中的白鹳",
    },
    "couronne-bougies": {
        "fr": "Couronne aux bougies", "en": "Wreath with candles", "de": "Kranz mit Kerzen",
        "it": "Corona con candele", "es": "Corona con velas", "ja": "キャンドルのリース", "zh": "蜡烛花环",
    },
}
# « Mulhouse » s'écrit en japonais et en chinois comme sur la page 0101.
NOMS_CATEGORIE_CORRIGES = {"mulhouse": {"ja": "ミュルーズ", "zh": "米卢斯"}}

DESCRIPTION = {
    "fr": "Une affiche à composer au marché de Noël de Mulhouse : choisissez un motif d'Alsace (l'hôtel de ville, le temple Saint-Étienne, des maisons à colombages, un bredele…), un fond uni, en dégradé ou à motifs, placez votre texte en haut ou en bas, puis ajoutez vos personnages. Proposée le temps du marché seulement.",
    "en": "A poster to design at the Mulhouse Christmas market: choose an Alsatian design (the town hall, the Temple Saint-Étienne, half-timbered houses, bredele biscuits…), a plain, gradient or patterned background, put your text at the top or bottom, then add your characters. Available during the market only.",
    "de": "Ein Poster zum Gestalten auf dem Weihnachtsmarkt in Mulhouse: Wählen Sie ein elsässisches Motiv (das Rathaus, den Temple Saint-Étienne, Fachwerkhäuser, Bredele …), einen einfarbigen, verlaufenden oder gemusterten Hintergrund, setzen Sie Ihren Text oben oder unten und fügen Sie Ihre Figuren hinzu. Nur während des Marktes erhältlich.",
    "it": "Un poster da comporre al mercatino di Natale di Mulhouse: scelga un motivo alsaziano (il municipio, il Temple Saint-Étienne, case a graticcio, bredele…), uno sfondo a tinta unita, sfumato o a motivi, metta il testo in alto o in basso e aggiunga i suoi personaggi. Disponibile solo durante il mercatino.",
    "es": "Un póster para componer en el mercado de Navidad de Mulhouse: elija un motivo alsaciano (el ayuntamiento, el Temple Saint-Étienne, casas de entramado, bredele…), un fondo liso, degradado o estampado, coloque su texto arriba o abajo y añada sus personajes. Disponible solo durante el mercado.",
    "ja": "ミュルーズのクリスマスマーケットで作るポスターです。アルザスのモチーフ（市庁舎、サン・テティエンヌ教会、木骨造りの家、ブレデルなど）と、無地・グラデーション・柄の背景を選び、文字を上か下に配置して、キャラクターを加えてください。マーケット開催期間中のみの販売です。",
    "zh": "在米卢斯圣诞市场定制的海报：选择一个阿尔萨斯图案（市政厅、圣艾蒂安教堂、半木结构房屋、圣诞小饼干等）、纯色、渐变或花纹背景，将文字放在上方或下方，再添加您的人物。仅在市场期间提供。",
}
NOM_PRODUIT = {
    "fr": "MULHOUSE Marché de Noël - Affiche personnalisée",
    "en": "MULHOUSE Christmas Market",
    "de": "MULHOUSE Weihnachtsmarkt",
    "it": "MULHOUSE Mercatino di Natale",
    "es": "MULHOUSE Mercado de Navidad",
    "ja": "MULHOUSE クリスマスマーケット",
    "zh": "MULHOUSE 圣诞市场",
}
NOM_COLLECTION = {
    "fr": "Marché de Noël de Mulhouse",
    "en": "Mulhouse Christmas Market",
    "de": "Weihnachtsmarkt Mulhouse",
    "it": "Mercatino di Natale di Mulhouse",
    "es": "Mercado de Navidad de Mulhouse",
    "ja": "ミュルーズのクリスマスマーケット",
    "zh": "米卢斯圣诞市场",
}
DESCRIPTION_COLLECTION = {
    "fr": "Les affiches du stand Memory Line au marché de Noël de Mulhouse, proposées le temps du marché.",
    "en": "The Memory Line stand posters at the Mulhouse Christmas market, available while the market lasts.",
    "de": "Die Poster des Memory-Line-Stands auf dem Weihnachtsmarkt in Mulhouse, nur während des Marktes.",
    "it": "I poster dello stand Memory Line al mercatino di Natale di Mulhouse, disponibili per la durata del mercatino.",
    "es": "Los pósteres del puesto Memory Line en el mercado de Navidad de Mulhouse, disponibles mientras dure el mercado.",
    "ja": "ミュルーズのクリスマスマーケットに出店するMemory Lineのポスター。開催期間中のみ。",
    "zh": "Memory Line 在米卢斯圣诞市场摊位的海报，仅在市场期间提供。",
}
VISUELS = [
    ("/assets/mulhouse-marche-de-noel-exemple-1-v1.jpg", "Affiche du marché de Noël de Mulhouse : maisons alsaciennes colorées, texte en bas"),
    ("/assets/mulhouse-marche-de-noel-exemple-2-v1.jpg", "Affiche du marché de Noël de Mulhouse : l'hôtel de ville sur un fond de nuit d'hiver"),
]


def sql_texte(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def sql_json(o) -> str:
    return sql_texte(json.dumps(o, ensure_ascii=False, separators=(",", ":")))


def lire(chemin: str):
    with open(chemin, encoding="utf-8") as f:
        return json.load(f)


def svg_valide(chemin: str) -> bool:
    try:
        doc = xml.dom.minidom.parse(chemin)
    except Exception:
        return False
    racine = doc.documentElement
    return racine.tagName == "svg" and bool(racine.getAttribute("viewBox"))


def categories_connues() -> list:
    cats = lire(os.path.join(MOTIFS, "categories.json"))
    for c in cats:
        for langue, nom in NOMS_CATEGORIE_CORRIGES.get(c["id"], {}).items():
            c["noms"][langue] = nom
    return cats


def motifs_3_complets(ids_existants: set, ids_categories: set) -> tuple[bool, str]:
    """Les critères du plan (§ A1) : tout est là, lisible, et l'autre agent a fini."""
    index = os.path.join(MOTIFS_3, "index.json")
    if not os.path.exists(index):
        return False, "pas d'index.json"
    maintenant = time.time()
    recents = [
        f for f in os.listdir(MOTIFS_3)
        if maintenant - os.path.getmtime(os.path.join(MOTIFS_3, f)) < 600
    ]
    if recents:
        return False, f"{len(recents)} fichier(s) modifié(s) il y a moins de 10 minutes"
    try:
        entrees = lire(index)
    except Exception as e:
        return False, f"index illisible ({e})"
    vus = set()
    for e in entrees:
        ident = e.get("id")
        if not ident or ident in vus or ident in ids_existants:
            return False, f"id manquant ou en double : {ident}"
        vus.add(ident)
        if e.get("categorie") not in ids_categories:
            return False, f"{ident} : catégorie inconnue {e.get('categorie')}"
        noms = e.get("noms") or {}
        if any(not str(noms.get(l, "")).strip() for l in LANGUES):
            return False, f"{ident} : noms incomplets"
        if "st0" not in (e.get("zones") or {}):
            return False, f"{ident} : pas de zone st0"
        fichier = os.path.join(MOTIFS_3, e.get("fichier") or "")
        if not os.path.isfile(fichier) or not svg_valide(fichier):
            return False, f"{ident} : fichier absent ou illisible"
    return True, f"{len(entrees)} motifs"


def motifs_a_ranger(avec_motifs_3: bool) -> tuple[list, list, str]:
    """Les motifs, dans l'ordre des onglets puis de chaque onglet."""
    cats = categories_connues()
    ids_cats = {c["id"] for c in cats}
    base = {e["id"]: {**e, "dossier": MOTIFS} for e in lire(os.path.join(MOTIFS, "index.json"))}
    trois: dict = {}
    etat = "motifs-3 non demandé"
    if avec_motifs_3:
        complet, etat = motifs_3_complets(set(base), ids_cats)
        if complet:
            trois = {e["id"]: {**e, "dossier": MOTIFS_3} for e in lire(os.path.join(MOTIFS_3, "index.json"))}
    motifs = []
    for c in cats:
        ordre = [i for i in c["motifs"] if i in base]
        # Un motif de motifs/ rangé dans cette catégorie mais absent de la liste.
        ordre += [i for i, e in base.items() if e["categorie"] == c["id"] and i not in ordre]
        plan3 = ORDRE_MOTIFS_3.get(c["id"], [])
        ordre += [i for i in plan3 if i in trois]
        ordre += [i for i, e in trois.items() if e["categorie"] == c["id"] and i not in ordre]
        for rang, ident in enumerate(ordre):
            e = base.get(ident) or trois[ident]
            noms = dict(e["noms"])
            noms.update(NOMS_CORRIGES.get(ident, {}))
            motifs.append({
                "id": ident,
                "categorie": c["id"],
                "position": rang,
                "noms": noms,
                "zones": e["zones"],
                "source": os.path.join(e["dossier"], e["fichier"]),
                "fichier": f"motif-alsace-{ident}-v1.svg",
            })
    return cats, motifs, etat


def fonds_a_ranger() -> list:
    return lire(os.path.join(FONDS, "index.json"))


def copier(source: str, nom: str) -> None:
    """Copie vers data/assets et assets-prod — jamais par-dessus un autre contenu."""
    for dossier in (ASSETS, ASSETS_PROD):
        os.makedirs(dossier, exist_ok=True)
        cible = os.path.join(dossier, nom)
        if os.path.exists(cible):
            with open(cible, "rb") as a, open(source, "rb") as b:
                if a.read() != b.read():
                    raise SystemExit(
                        f"ARRÊT : {cible} existe avec un autre contenu. Un fichier servi ne change "
                        "jamais sous le même nom : passez à -v2."
                    )
            continue
        shutil.copyfile(source, cible)


def instruction_categories(cats: list) -> str:
    lignes = []
    for c in cats:
        trad = {l: {"name": c["noms"][l]} for l in LANGUES if l != "fr"}
        lignes.append(
            f"  ({sql_texte('motifs-' + c['id'])}, {sql_texte(c['noms']['fr'])}, "
            f"{POSITION_CATEGORIE[c['id']]}, {sql_json(trad)}::jsonb)"
        )
    return (
        'INSERT INTO "character_category" ("slug", "name", "position", "translations") VALUES\n'
        + ",\n".join(lignes)
        + '\nON CONFLICT ("slug") DO NOTHING;'
    )


def instruction_motifs(motifs: list) -> str:
    lignes = []
    for m in motifs:
        trad = {l: {"name": m["noms"][l]} for l in LANGUES if l != "fr"}
        lignes.append(
            f"  ({sql_texte('motif-' + m['id'])}, {sql_texte(m['noms']['fr'])}, {sql_json(trad)}, "
            f"{sql_texte('motifs-' + m['categorie'])}, {m['position']}, "
            f"{sql_texte('/assets/' + m['fichier'])}, {sql_json(m['zones'])})"
        )
    return (
        'INSERT INTO "character_type" ("slug", "name", "translations", "category_id", "orientation", "position",\n'
        '  "base_svg_url", "base_color_zones", "bottom_pct", "facteur_taille", "decalage_x", "active")\n'
        f'SELECT v.slug, v.nom, v.trad::jsonb, cc."id", {sql_texte(VUE)}, v.pos, v.url, v.zones::jsonb, 1, 1, 0, true\n'
        "FROM (VALUES\n"
        + ",\n".join(lignes)
        + "\n) AS v(slug, nom, trad, cat, pos, url, zones)\n"
        'JOIN "character_category" cc ON cc."slug" = v.cat\n'
        'ON CONFLICT ("slug") DO NOTHING;'
    )


def migration_complete(cats: list, motifs: list, fonds: list, etat_motifs_3: str, tag: str) -> str:
    trad_produit = {
        l: {"name": NOM_PRODUIT[l], "description": DESCRIPTION[l]} for l in LANGUES if l != "fr"
    }
    trad_collection = {
        l: {"name": NOM_COLLECTION[l], "description": DESCRIPTION_COLLECTION[l]} for l in LANGUES if l != "fr"
    }
    fonds_values = ",\n".join(
        f"  ({sql_texte('/assets/' + f['fichier'])}, {sql_texte(f['nom'])}, {f['position']})" for f in fonds
    )
    visuels_values = ",\n".join(
        f"  ({sql_texte(url)}, {sql_texte(alt)}, {i})" for i, (url, alt) in enumerate(VISUELS)
    )
    en_tete = f"""-- {tag} — l'affiche éphémère du stand de Mulhouse (28/11/2026).
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
--   - le type d'affiche réservé « {VUE} » (décoché : proposé à aucun client
--     comme type d'affiche), ses 7 catégories (les onglets du choix, dans
--     l'ordre) et {len(motifs)} motifs ({etat_motifs_3}), rangés comme des
--     personnages : Margaux les renomme, les range, les masque dans
--     BO › Personnages ;
--   - la collection « Marché de Noël de Mulhouse », le produit (repris des prix,
--     poids et formats de l'affiche « Hôtel de ville »), ses 2 visuels, ses
--     {len(fonds)} fonds (unis, dégradés, motifs répétés), et un bloc en tête de la
--     page du stand (« mulhouse »).
--
-- AVANT de passer cette migration en production : copier les fichiers de
-- travaux/affiche-stand-mulhouse/assets-prod dans data/assets (hors git) —
-- l'affiche est en vente dès la migration (stand 1 en service).
"""
    instructions = [
        'ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "vue_motifs" text;',
        "-- Sans clé étrangère, exprès : un stand supprimé doit laisser l'affiche cachée\n"
        "-- (la règle échoue fermée), pas la remettre en vente comme « on delete set null ».\n"
        'ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "stand_id" integer;',
        'INSERT INTO "poster_view" ("slug", "name", "foreground_url", "active", "position")\n'
        f"VALUES ({sql_texte(VUE)}, 'Motifs du stand (Alsace)', NULL, false, 90)\n"
        'ON CONFLICT ("slug") DO NOTHING;',
        instruction_categories(cats),
        "-- base_groupes_couleurs, base_zones_proposees, slot_variants, default_assets : NULL.\n"
        + instruction_motifs(motifs),
        "-- (Pas de « INSERT … SELECT max() … WHERE NOT EXISTS » : un agrégat sans GROUP BY rend\n"
        "--  une ligne même quand le WHERE écarte tout, et l'insertion se ferait quand même.)\n"
        'INSERT INTO "collection" ("slug", "name", "description", "position", "active", "translations")\n'
        f"VALUES ({sql_texte(COLLECTION)}, {sql_texte(NOM_COLLECTION['fr'])},\n"
        f"  {sql_texte(DESCRIPTION_COLLECTION['fr'])},\n"
        f'  (SELECT coalesce(max("position"), 0) + 1 FROM "collection"), true, {sql_json(trad_collection)}::jsonb)\n'
        'ON CONFLICT ("slug") DO NOTHING;',
        "-- Le stand est trouvé par sa page (« mulhouse »), jamais par son code (il ouvre la\n"
        "-- tablette, il n'a rien à faire dans le dépôt). Pas de stand trouvé : brouillon,\n"
        "-- jamais une affiche en vente pour toujours.\n"
        'INSERT INTO "product" ("slug", "name", "description", "kind", "default_view", "foreground_url",\n'
        '  "default_title", "default_subtitle", "default_line3", "base_price_cents", "weight_grams",\n'
        '  "vendor", "product_type", "status", "translations", "vue_motifs", "stand_id")\n'
        f"SELECT {sql_texte(PRODUIT)},\n"
        f"  {sql_texte(NOM_PRODUIT['fr'])},\n"
        f"  {sql_texte(DESCRIPTION['fr'])},\n"
        "  'personnalisable'::product_kind, 'front', NULL,\n"
        "  NULL, 'Marché de Noël de Mulhouse', NULL,\n"
        '  p."base_price_cents", p."weight_grams", p."vendor", p."product_type",\n'
        "  CASE WHEN s.\"id\" IS NULL THEN 'draft' ELSE 'active' END,\n"
        f"  {sql_json(trad_produit)}::jsonb, {sql_texte(VUE)}, s.\"id\"\n"
        'FROM "product" p\n'
        "LEFT JOIN LATERAL (\n"
        '  SELECT st."id" FROM "stand" st JOIN "page" pg ON pg."id" = st."page_id"\n'
        "  WHERE pg.\"slug\" = 'mulhouse' AND st.\"archived_at\" IS NULL\n"
        '  ORDER BY st."id" LIMIT 1\n'
        ") s ON true\n"
        f'WHERE p."slug" = {sql_texte(MODELE)}\n'
        'ON CONFLICT ("slug") DO NOTHING;',
        'INSERT INTO "variant" ("product_id", "format", "price_cents", "width_mm", "height_mm", "weight_grams",\n'
        '  "compare_at_cents", "cost_cents", "stock_qty", "stock_policy", "sku")\n'
        'SELECT c."id", v."format", v."price_cents", v."width_mm", v."height_mm", v."weight_grams",\n'
        '  v."compare_at_cents", v."cost_cents", v."stock_qty", v."stock_policy",\n'
        "  'ML-MULHOUSE-MARCHE-DE-NOEL-' || v.\"format\"\n"
        'FROM "variant" v\n'
        f'JOIN "product" p ON p."id" = v."product_id" AND p."slug" = {sql_texte(MODELE)}\n'
        f'JOIN "product" c ON c."slug" = {sql_texte(PRODUIT)}\n'
        'WHERE NOT EXISTS (SELECT 1 FROM "variant" WHERE "product_id" = c."id");',
        'INSERT INTO "product_collection" ("product_id", "collection_id", "position")\n'
        'SELECT p."id", c."id", 0 FROM "product" p, "collection" c\n'
        f'WHERE p."slug" = {sql_texte(PRODUIT)} AND c."slug" = {sql_texte(COLLECTION)}\n'
        'ON CONFLICT ("product_id", "collection_id") DO NOTHING;',
        'INSERT INTO "product_image" ("product_id", "url", "alt", "position")\n'
        'SELECT p."id", v.url, v.alt, v.pos FROM "product" p, (VALUES\n'
        + visuels_values
        + "\n) AS v(url, alt, pos)\n"
        f'WHERE p."slug" = {sql_texte(PRODUIT)}\n'
        '  AND NOT EXISTS (SELECT 1 FROM "product_image" WHERE "product_id" = p."id");',
        'INSERT INTO "background" ("product_id", "url", "name", "position")\n'
        'SELECT p."id", v.url, v.nom, v.pos FROM "product" p, (VALUES\n'
        + fonds_values
        + "\n) AS v(url, nom, pos)\n"
        f'WHERE p."slug" = {sql_texte(PRODUIT)}\n'
        '  AND NOT EXISTS (SELECT 1 FROM "background" WHERE "product_id" = p."id");',
        "-- La page de la tablette : un bloc d'affiches EN TÊTE, avec cette seule affiche. Le\n"
        "-- bloc existant porte déjà 200 références, le plafond de cms.ts\n"
        "-- (LIMITE_PRODUITS_MAX) : y ajouter la nouvelle en ferait tomber une. Garde-fous :\n"
        "-- une seule fois, et seulement si la page n'a pas de blocs traduits (fusionnerBlocs\n"
        "-- les aligne par rang). Sinon, l'affiche s'ajoute au BO › Pages.\n"
        'UPDATE "page" pg\n'
        'SET "blocks" = jsonb_build_array(jsonb_build_object(\n'
        "      'type', 'produits', 'source', 'affiches', 'reference', p.\"id\"::text,\n"
        "      'references', jsonb_build_array(p.\"id\"::text), 'limite', 1)) || pg.\"blocks\",\n"
        '    "updated_at" = now()\n'
        'FROM "product" p\n'
        "WHERE pg.\"slug\" = 'mulhouse'\n"
        f'  AND p."slug" = {sql_texte(PRODUIT)}\n'
        "  AND jsonb_typeof(pg.\"blocks\") = 'array'\n"
        "  AND NOT (pg.\"blocks\" @> jsonb_build_array(jsonb_build_object('references', jsonb_build_array(p.\"id\"::text))))\n"
        "  AND NOT jsonb_path_exists(coalesce(pg.\"translations\", '{}'::jsonb), '$.*.blocks');",
    ]
    return en_tete + "\n" + "--> statement-breakpoint\n".join(i + "\n" for i in instructions)


def migration_motifs_seulement(motifs: list, etat_motifs_3: str, tag: str) -> str:
    en_tete = f"""-- {tag} — les motifs des planches 3 à 5 pour l'affiche du stand de Mulhouse
-- (PLAN.md § 13). N'insère que les motifs absents, dans les catégories déjà
-- créées par 0121_affiche_stand_mulhouse ({etat_motifs_3}). Rejouable.
-- AVANT la production : copier travaux/affiche-stand-mulhouse/assets-prod dans data/assets.
"""
    return en_tete + "\n" + instruction_motifs(motifs) + "\n"


def ajouter_au_journal(tag_voulu: str | None, suffixe: str) -> tuple[str, int, int, str]:
    """Relit la FIN du journal et prépare l'entrée, en dernier, mise en forme comprise
    (le texte du journal complété ; il n'est écrit qu'avec la migration)."""
    with open(JOURNAL, encoding="utf-8", newline="") as f:
        texte = f.read()
    nl = "\r\n" if "\r\n" in texte else "\n"
    journal = json.loads(texte)
    entrees = journal["entries"]
    idx = max(e["idx"] for e in entrees) + 1
    when = max(e["when"] for e in entrees) + 10_000_000
    tag = tag_voulu or f"{idx:04d}_{suffixe}"
    if any(e["tag"] == tag for e in entrees):
        raise SystemExit(f"ARRÊT : le journal porte déjà {tag}.")
    if not tag.startswith(f"{idx:04d}_"):
        raise SystemExit(f"ARRÊT : le tag {tag} ne commence pas par {idx:04d}_ (prochain idx libre).")
    entree = (
        f"    {{{nl}"
        f'      "idx": {idx},{nl}'
        f'      "version": "7",{nl}'
        f'      "when": {when},{nl}'
        f'      "tag": "{tag}",{nl}'
        f'      "breakpoints": true{nl}'
        f"    }}"
    )
    fin = re.search(r"\}\s*\]\s*\}\s*$", texte)
    if not fin:
        raise SystemExit("ARRÊT : fin du journal inattendue.")
    nouveau = texte[: fin.start()] + "}," + nl + entree + nl + "  ]" + nl + "}" + nl
    json.loads(nouveau)  # garde-fou : toujours du JSON valide
    return tag, idx, when, nouveau


def main() -> None:
    args = sys.argv[1:]
    seulement = "--motifs-seulement" in args
    essai = "--essai" in args
    tag_voulu = args[args.index("--tag") + 1] if "--tag" in args else None
    if seulement and not tag_voulu:
        raise SystemExit("--motifs-seulement demande --tag <0idx_nom>")

    cats, motifs, etat = motifs_a_ranger(avec_motifs_3="--sans-motifs-3" not in args)
    fonds = fonds_a_ranger()
    print(f"motifs-3 : {etat}", file=sys.stderr)
    print(f"{len(motifs)} motifs, {len(fonds)} fonds, {len(cats)} catégories", file=sys.stderr)

    tag, idx, when, journal = ajouter_au_journal(tag_voulu, "affiche_stand_mulhouse")
    sql = (
        migration_motifs_seulement(motifs, etat, tag)
        if seulement
        else migration_complete(cats, motifs, fonds, etat, tag)
    )
    if essai:
        sys.stdout.write(sql)
        return
    chemin_sql = os.path.join(DRIZZLE, f"{tag}.sql")
    if os.path.exists(chemin_sql):
        raise SystemExit(f"ARRÊT : {chemin_sql} existe déjà.")
    for m in motifs:
        copier(m["source"], m["fichier"])
    if not seulement:
        for f in fonds:
            copier(os.path.join(FONDS, f["fichier"]), f["fichier"])
    with open(chemin_sql, "w", encoding="utf-8", newline="\n") as f:
        f.write(sql)
    with open(JOURNAL, "w", encoding="utf-8", newline="") as f:
        f.write(journal)
    print(f"migration {tag} (idx {idx}, when {when}) écrite ; fichiers copiés dans data/assets et assets-prod")


if __name__ == "__main__":
    main()
