/**
 * Le ciel étoilé (26/11) : le calcul astronomique et le fuseau. Sans base.
 *
 *   npx tsx --test tests/ciel.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://essai:essai@127.0.0.1:1/essai";
const { tempsSideralGreenwich, horizontales, instantLocal, surLaCarte } = await import("../src/ciel.ts");

test("temps sidéral de Greenwich : exemple 12.a de Meeus (10/04/1987 0 h TU → 197,6932°)", () => {
  assert.ok(Math.abs(tempsSideralGreenwich(new Date(Date.UTC(1987, 3, 10))) - 197.693195) < 0.001);
});

test("l'étoile Polaire est à la hauteur de la latitude, au nord, à toute heure", () => {
  for (const h of [0, 7, 15, 22]) {
    const p = horizontales(37.95, 89.26, 47.75, 7.34, new Date(Date.UTC(2026, 11, 24, h)));
    assert.ok(Math.abs(p.hauteur - 47.75) < 1, `hauteur ${p.hauteur}`);
    assert.ok(p.azimut < 2 || p.azimut > 358, `azimut ${p.azimut}`);
  }
});

test("Orion au sud vers minuit fin décembre à Mulhouse ; sous l'horizon un midi de juin", () => {
  // Bételgeuse : α 88,79°, δ +7,41°.
  const hiver = horizontales(88.79, 7.41, 47.75, 7.34, instantLocal("2026-12-25", "00:30", "Europe/Paris")!);
  assert.ok(hiver.hauteur > 40 && hiver.azimut > 150 && hiver.azimut < 210, JSON.stringify(hiver));
  const ete = horizontales(88.79, 7.41, 47.75, 7.34, instantLocal("2026-06-21", "23:00", "Europe/Paris")!);
  assert.ok(ete.hauteur < 0);
});

test("heure locale → temps universel, heure d'hiver et d'été", () => {
  assert.equal(instantLocal("2026-12-25", "21:30", "Europe/Paris")!.toISOString(), "2026-12-25T20:30:00.000Z");
  assert.equal(instantLocal("2026-07-14", "23:00", "Europe/Paris")!.toISOString(), "2026-07-14T21:00:00.000Z");
  assert.equal(instantLocal("2026-07-14", "23:00", "America/New_York")!.toISOString(), "2026-07-15T03:00:00.000Z");
  assert.equal(instantLocal("2026-13-01", "10:00", "Europe/Paris"), null);
  assert.equal(instantLocal("2026-01-01", "10:00", "Pas/Un_Fuseau"), null);
});

test("carte : zénith au centre, horizon au bord, nord en haut, est à gauche", () => {
  assert.deepEqual(surLaCarte(90, 0), { x: -0, y: -0 });
  const nord = surLaCarte(0, 0)!;
  assert.ok(Math.abs(nord.y + 1) < 1e-9 && Math.abs(nord.x) < 1e-9);
  const est = surLaCarte(0, 90)!;
  assert.ok(Math.abs(est.x + 1) < 1e-9);
  assert.equal(surLaCarte(-1, 0), null);
});

test("villes : on tape le nom, avec ou sans accents, en français ou non", async () => {
  const { chercherVilles } = await import("../src/ciel.ts");
  const mulh = chercherVilles("mulh");
  assert.equal(mulh[0]?.nom, "Mulhouse");
  assert.equal(mulh[0]?.fuseau, "Europe/Paris");
  assert.equal(chercherVilles("Bâle")[0]?.nom, "Basel");
  assert.equal(chercherVilles("londres")[0]?.nom, "London");
  assert.equal(chercherVilles("saint-louis").some((v) => v.pays === "FR"), true);
  assert.equal(chercherVilles("thann")[0]?.pays, "FR");
  assert.deepEqual(chercherVilles("m"), []);
});

test("villes : les villages aussi, avec leur département, et vite", async () => {
  const { chercherVilles } = await import("../src/ciel.ts");
  const r = chercherVilles("rimbach pres mase");
  assert.equal(r[0]?.nom, "Rimbach-près-Masevaux");
  assert.equal(r[0]?.region, "Haut-Rhin");
  const t0 = performance.now();
  for (const q of ["sa", "saint louis", "ungers", "lyon"]) chercherVilles(q);
  assert.ok(performance.now() - t0 < 1000);
});

test("thèmes : trois couleurs donnent tout le dégradé, « Nuit » retrouve les teintes d'origine", async () => {
  const { teintesDuTheme, themesDuReglage, THEMES_CIEL_DE_BASE, svgDuCiel } = await import("../src/ciel.ts");
  const nuit = teintesDuTheme(THEMES_CIEL_DE_BASE[0]!);
  // Le haut d'origine était #0b1424 : à deux unités près par canal.
  const proche = (a: string, b: string) =>
    [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 3);
  assert.ok(proche(nuit.haut, "#0b1424"), nuit.haut);
  assert.ok(proche(nuit.collinePres, "#0a111e"), nuit.collinePres);
  // Réglage illisible ou vide : les thèmes de base ; couleurs invalides corrigées.
  assert.equal(themesDuReglage(null).length, THEMES_CIEL_DE_BASE.length);
  const lus = themesDuReglage([{ id: "x", nom: "Lavande", fond: "#8877aa", etoiles: "pas une couleur", dorures: "#ffffff" }]);
  assert.equal(lus[0]?.etoiles, THEMES_CIEL_DE_BASE[0]!.etoiles);
  // Le rendu porte bien la couleur choisie.
  assert.ok(svgDuCiel(47.75, 7.34, new Date(), lus[0]).includes("#8877aa"));
});

test("garde-fou : 120 créations par minute et par adresse passent, la 121e non ; deux compteurs ne se gênent pas (27/11)", async () => {
  const { compteurParMinute, CIELS_PAR_MINUTE } = await import("../src/ciel.ts");
  assert.equal(CIELS_PAR_MINUTE, 120);
  const ciels = compteurParMinute(CIELS_PAR_MINUTE);
  const apercus = compteurParMinute(CIELS_PAR_MINUTE);
  for (let i = 0; i < 120; i++) assert.equal(ciels("203.0.113.9"), false, `appel ${i + 1}`);
  assert.equal(ciels("203.0.113.9"), true, "le 121e est refusé");
  // Un autre compteur, ou une autre adresse : rien de partagé.
  assert.equal(apercus("203.0.113.9"), false);
  assert.equal(ciels("203.0.113.10"), false);
});

/*
 * Les signes du zodiaque et les ombres chinoises (27/11, Alexandra : « fais
 * sur cette même page produit la possibilité de mettre la constellation d'un
 * signe astro ou de deux (pour un couple) » ; « les personnages tu mets
 * uniquement les ombres chinoises hein ! »).
 */
test("ciel de cette nuit sans rien de nouveau : le SVG d'avant, au caractère près (27/11)", async () => {
  const { createHash } = await import("node:crypto");
  const { svgDuCiel, THEMES_CIEL_DE_BASE } = await import("../src/ciel.ts");
  const h = (s: string) => createHash("sha256").update(s).digest("hex");
  const t = new Date(Date.UTC(2025, 5, 14, 21, 10));
  // Empreintes relevées AVANT les signes et les silhouettes.
  assert.equal(h(svgDuCiel(47.75, 7.34, t)), "3acabcd1abb6e93c4e5afa5ed1b653602fd215eaa091bec2b435c13071b53b15");
  assert.equal(
    h(svgDuCiel(48.85, 2.35, new Date("2024-12-24T22:59:00Z"), THEMES_CIEL_DE_BASE[4], { ville: "Paris" })),
    "a35509d85e5b691c524d773cc075a98e59afe69ffb80c2b7b55d02c158429ae0",
  );
  // Les champs nouveaux à leur valeur par défaut ne changent rien non plus.
  assert.equal(svgDuCiel(47.75, 7.34, t, undefined, { texte: "haut", silhouettes: [] }), svgDuCiel(47.75, 7.34, t));
});

test("réglages du ciel : par défaut comme avant ; un champ faux est refusé (27/11)", async () => {
  const { lireReglagesCiel } = await import("../src/ciel.ts");
  const ok = (b: Record<string, unknown>) => {
    const r = lireReglagesCiel(b);
    assert.ok(r.ok, JSON.stringify(r));
    return r.reglages;
  };
  const refus = (b: Record<string, unknown>) => assert.equal(lireReglagesCiel(b).ok, false, JSON.stringify(b));
  assert.deepEqual(ok({}), { style: "nuit", texte: "haut", signes: [], dates: [], silhouettes: [], langue: "fr" });
  // Un signe : le texte va en bas ; le signe se déduit de la date, ou se choisit.
  const un = ok({ style: "signe", dates: ["2019-09-05"], langue: "de" });
  assert.deepEqual([un.texte, un.signes, un.dates, un.langue], ["bas", ["Vir"], ["2019-09-05"], "de"]);
  assert.deepEqual(ok({ style: "signe", signes: ["Leo"], dates: ["2019-09-05"] }).signes, ["Leo"]);
  assert.deepEqual(ok({ style: "signe", signes: ["Sco"] }).dates, [null]);
  assert.deepEqual(ok({ style: "couple", dates: ["1995-02-26", "1998-09-11"], texte: "haut" }).signes, ["Psc", "Vir"]);
  refus({ style: "galaxie" });
  refus({ texte: "milieu" });
  refus({ style: "signe" }); // ni date ni signe
  refus({ style: "signe", signes: ["Oph"] });
  refus({ style: "signe", dates: ["2019-02-30"] });
  refus({ style: "signe", dates: ["1850-01-01"] });
  refus({ style: "couple", dates: ["1995-02-26"] }); // le second manque
  refus({ style: "signe", signes: ["Ari", "Tau"] });
  // Les personnages : identifiants connus, quatre au plus.
  assert.deepEqual(ok({ silhouettes: ["couple", "chien"] }).silhouettes, ["couple", "chien"]);
  // Un id inconnu mais bien formé (« montre-le-ciel », retiré le 27/11) est ignoré ; une chaîne invalide reste refusée.
  assert.deepEqual(ok({ silhouettes: ["montre-le-ciel", "chien:m", "licorne"] }).silhouettes, ["chien:m"]);
  refus({ silhouettes: ["Licorne !"] });
  refus({ silhouettes: [42] });
  refus({ silhouettes: "couple" });
  refus({ silhouettes: ["enfant", "enfant", "chien", "couple", "homme-manteau", "chat", "enfant", "chien", "couple"] }); // 9 > 8
});

test("signe de la date : les bornes habituelles du zodiaque", async () => {
  const { signeDeLaDate } = await import("../src/ciel-signes.ts");
  const cas: [string, string][] = [
    ["2000-01-01", "Cap"], ["2000-01-19", "Cap"], ["2000-01-20", "Aqr"], ["2000-02-19", "Psc"], ["2000-03-20", "Psc"],
    ["2000-03-21", "Ari"], ["2000-04-20", "Tau"], ["2000-05-21", "Gem"], ["2000-06-21", "Cnc"], ["2000-07-23", "Leo"],
    ["2000-08-23", "Vir"], ["2000-09-22", "Vir"], ["2000-09-23", "Lib"], ["2000-10-23", "Sco"], ["2000-11-22", "Sgr"],
    ["2000-12-21", "Sgr"], ["2000-12-22", "Cap"], ["2000-12-31", "Cap"],
  ];
  for (const [d, s] of cas) assert.equal(signeDeLaDate(d), s, d);
  assert.equal(signeDeLaDate("pas une date"), null);
});

test("chaque signe prend bien SES tracés dans le catalogue (rangs relevés à la main)", async () => {
  const { IDS_SIGNES, SIGNES, centreDesTraces } = await import("../src/ciel-signes.ts");
  for (const id of IDS_SIGNES) {
    const { ra, de } = centreDesTraces(id);
    const [ra0, de0] = SIGNES[id].region;
    const ecartRa = Math.abs(((ra - ra0 + 540) % 360) - 180);
    assert.ok(ecartRa < 15 && Math.abs(de - de0) < 15, `${id} : ${ra.toFixed(1)}, ${de.toFixed(1)}`);
  }
});

test("un signe, un couple : leurs constellations dans le SVG, sans coordonnées ni points cardinaux", async () => {
  const { svgDuSigne, lireReglagesCiel } = await import("../src/ciel.ts");
  const regl = (b: Record<string, unknown>) => {
    const r = lireReglagesCiel(b);
    assert.ok(r.ok);
    return r.reglages;
  };
  const un = svgDuSigne(regl({ style: "signe", dates: ["2019-09-05"] }));
  assert.match(un, /Vierge/);
  assert.match(un, /5 SEPTEMBRE 2019/);
  assert.match(un, /stroke-dasharray/); // les tracés en pointillés
  assert.doesNotMatch(un, /° N|>N<|>S</);
  assert.equal((un.match(/r="\d+(\.\d+)?" fill="url\(#dome\)"/g) ?? []).length, 1);
  const deux = svgDuSigne(regl({ style: "couple", dates: ["1995-02-26", "1998-09-11"], langue: "en" }));
  assert.match(deux, /Pisces/);
  assert.match(deux, /Virgo/);
  assert.equal((deux.match(/fill="url\(#dome\)"/g) ?? []).length, 2);
  assert.doesNotMatch(deux, /° N/);
  // Sans cercle : pas de dôme. En japonais, le nom latin (aucune police ne sait l'écrire).
  const libre = svgDuSigne(regl({ style: "libre", signes: ["Sco"], langue: "ja" }));
  assert.doesNotMatch(libre, /url\(#dome\)/);
  assert.match(libre, /Scorpius/);
});

test("silhouettes posées : 0, 1, 4 ; sur le ciel de cette nuit comme sur un signe", async () => {
  const { svgDuCiel, svgDuSigne, lireReglagesCiel, teintesDuTheme, THEMES_CIEL_DE_BASE } = await import("../src/ciel.ts");
  const t = new Date(Date.UTC(2025, 5, 14, 21, 10));
  // Seulement le groupe des silhouettes : le plaid et le pique-nique autour (27/11) ont aussi des translate.
  const groupe = (svg: string) => svg.match(/<g fill="[^"]*" data-silhouettes="1">(.*?)<\/g>/)?.[1] ?? "";
  const nb = (svg: string) => (groupe(svg).match(/<path transform="translate\(/g) ?? []).length;
  assert.equal(nb(svgDuCiel(47.75, 7.34, t)), 0);
  const un = svgDuCiel(47.75, 7.34, t, undefined, { silhouettes: ["chien"] });
  assert.equal(nb(un), 1);
  // La couleur de la colline (27/11, Alexandra : « supp ça » pour la teinte automatique).
  assert.ok(un.includes(`<g fill="${teintesDuTheme(THEMES_CIEL_DE_BASE[0]!).collinePres}" data-silhouettes`));
  assert.equal(nb(svgDuCiel(47.75, 7.34, t, undefined, { texte: "bas", silhouettes: ["couple", "enfant", "chien", "chat"] })), 4);
  const r = lireReglagesCiel({ style: "couple", dates: ["1995-02-26", "1998-09-11"], silhouettes: ["couple", "enfant"] });
  assert.ok(r.ok);
  assert.equal(nb(svgDuSigne(r.reglages)), 2);
});

/*
 * Jamais une tête sur un texte (27/11, relecture : « les têtes du couple
 * passent sur 2 NOVEMBRE 1990 », « les silhouettes coupent Passion •
 * Détermination • Magnétisme »). Le sommet de chaque silhouette se relit dans
 * le SVG : translate(x y) scale(s), et son `haut` en centimètres.
 */
test("silhouettes : sous la date du signe (texte en haut), sous la place des lignes (texte en bas)", async () => {
  const { svgDuSigne, svgDuCiel, lireReglagesCiel, dispositionDuCiel, plafondDesSilhouettes, HAUTEUR_CIEL, LARGEUR_CIEL } =
    await import("../src/ciel.ts");
  // Assises depuis le 27/11 (Alexandra : « je les veux assis les personnages !!! »).
  const { SILHOUETTES_ASSISES_PAR_ID: SILHOUETTES_PAR_ID } = await import("../src/ciel-silhouettes-assises.ts");
  const quatre = ["couple", "enfant-sur-epaules", "chien", "femme-cheveux-longs"];
  const sommets = (svg: string, ids: string[]) =>
    [...(svg.match(/<g fill="[^"]*" data-silhouettes="1">(.*?)<\/g>/)?.[1] ?? "").matchAll(/<path transform="translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)"/g)].map((m, i) => {
      const s = SILHOUETTES_PAR_ID.get(ids[i]!)!;
      const [x, y, k] = [Number(m[1]), Number(m[2]), Number(m[3])];
      return { g: x + s.gauche * k, d: x + s.droite * k, haut: y + s.haut * k };
    });
  const regl = (b: Record<string, unknown>) => {
    const r = lireReglagesCiel(b);
    assert.ok(r.ok);
    return r.reglages;
  };
  // Texte en haut : sous la date, pour ce qui se tient sous elle.
  for (const style of ["signe", "libre"] as const) {
    const { cy, R } = dispositionDuCiel(style, "haut");
    const yDate = cy + (style === "libre" ? 0.94 : 0.8) * R;
    const svg = svgDuSigne(regl({ style, texte: "haut", dates: ["1990-11-02"], silhouettes: quatre }));
    const tetes = sommets(svg, quatre);
    assert.equal(tetes.length, 4);
    for (const t of tetes)
      if (t.d > LARGEUR_CIEL / 2 - 0.6 * R && t.g < LARGEUR_CIEL / 2 + 0.6 * R)
        assert.ok(t.haut > yDate + 0.04 * R, `${style} : sommet ${t.haut.toFixed(0)} sur la date ${yDate.toFixed(0)}`);
  }
  // Texte en bas : sous la place gardée aux lignes, pour tous les styles.
  for (const style of ["signe", "libre", "couple"] as const) {
    const svg = svgDuSigne(regl({ style, texte: "bas", dates: ["1990-11-02", "1988-04-25"].slice(0, style === "couple" ? 2 : 1), silhouettes: quatre }));
    // Le couple est en paysage depuis le 27/11 au soir : sa feuille fait LARGEUR_CIEL de haut.
    const hauteur = style === "couple" ? LARGEUR_CIEL : HAUTEUR_CIEL;
    for (const t of sommets(svg, quatre)) assert.ok(t.haut >= plafondDesSilhouettes(style) * hauteur - 0.5, style);
  }
  const nuit = svgDuCiel(47.75, 7.34, new Date(Date.UTC(2025, 5, 14, 21, 10)), undefined, { texte: "bas", ville: "Mulhouse", silhouettes: quatre });
  for (const t of sommets(nuit, quatre)) assert.ok(t.haut >= plafondDesSilhouettes("nuit", true) * HAUTEUR_CIEL - 0.5);
  // La même taille partout, texte en haut ou en bas (27/11, Alexandra : « les persos doivent pas changer de taille ») :
  // 0,22 de la hauteur pour 175 cm depuis le 27/11 au soir (« les personnages ombres sont trop petits »).
  const signe = svgDuSigne(regl({ style: "signe", texte: "haut", dates: ["1990-11-02"], silhouettes: ["femme-ondulee"] }));
  assert.match(signe, new RegExp(`scale\\(${((HAUTEUR_CIEL * 0.22) / 175).toFixed(4)}\\)`));
});
