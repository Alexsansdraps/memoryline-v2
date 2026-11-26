/**
 * Des personnages et un muret sur l'affiche « à partir de votre photo »
 * (20/11) : ce que le serveur laisse entrer au panier (ia-composition.ts).
 *
 *   npx tsx --test tests/ia-composition.test.ts
 *
 * La règle est une fonction pure (ligneIAControlee) : ces tests n'ont besoin
 * d'aucune base. La lecture en base (controlerLigneIA) est branchée ici sur
 * une base FACTICE, qui rend des lignes toutes prêtes — ou qui ne répond pas.
 *
 * Les derniers tests touchent la BASE LOCALE, et elle seule : ils vérifient
 * les requêtes elles-mêmes. Ils créent leurs lignes fictives (« TEST- … »),
 * puis les effacent. Hors de la base du conteneur local (`@db:5432`), ils ne
 * s'exécutent pas.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { posterConfigSchema, type PosterConfig } from "@memoryline/types";
import {
  MURET_OFFICIEL,
  TAILLE_GENERATION_PAYSAGE,
  TAILLES_GENERATION_PAYSAGE,
  controlerLigneIA,
  controlerLigneIAModifiee,
  ligneIAAvecPersonnages,
  ligneIAControlee,
  type ContexteLigneIA,
  type GenerationLue,
  type Lecteur,
} from "../src/ia-composition.js";
import * as schema from "../src/db/schema.js";

/* ------------------------------------------------------------------------ */
/*  Une ligne telle qu'AfficheIA l'envoie, et ce que la base en sait          */
/* ------------------------------------------------------------------------ */

const PUBLIC_ID = "3f0c2b1e-5a4d-4c3b-8a29-0d1e2f3a4b5c";
const MURET_DU_TYPE = "/assets/muret-pierre.svg";

const GEN: GenerationLue = {
  publicId: PUBLIC_ID,
  productId: 42,
  cartId: "panier-A",
  status: "prete",
  previewPath: `ia/${PUBLIC_ID}-apercu.jpg`,
  fullPath: `ia/${PUBLIC_ID}-pleine.png`,
  size: "1584x2240",
  paidAt: null,
};

function contexte(autres: Partial<ContexteLigneIA> = {}): ContexteLigneIA {
  return {
    cartId: "panier-A",
    productId: 42,
    generation: GEN,
    statutPanierOrigine: null,
    decorsAutorises: new Set([MURET_OFFICIEL, MURET_DU_TYPE]),
    vues: new Set(["front", "back"]),
    ...autres,
  };
}

/** Deux personnages, tels que configFromState les rend. */
const PERSONNAGES = [
  {
    typeId: 7,
    position: 0,
    x: 0.31,
    y: 0.816,
    scale: 0.29,
    assets: { hair: 12, clothes: "34" },
    colors: { "base:st1": "#aa3322", "hair:st2": "#221100" },
  },
  {
    typeId: 9,
    position: 1,
    x: 0.64,
    y: 0.816,
    scale: 0.27,
    placementManuel: true,
    assets: { pants: 5 },
    colors: {},
  },
];

/**
 * Une ligne « Assis sur le muret » : vue de dos, muret, textes déplacés.
 * Passée par JSON puis par le schéma, comme elle arrive à la route : une clé
 * `undefined` n'existe pas dans un corps de requête.
 */
function ligne(autres: Record<string, unknown> = {}): PosterConfig {
  return posterConfigSchema.parse(
    JSON.parse(
      JSON.stringify({
        schemaVersion: 1,
        productId: 42,
        format: "A3",
        view: "back",
        foregroundUrl: MURET_DU_TYPE,
        texts: {
          lines: [
            { value: "Léa & Tom", font: "Amatic SC", color: "#ffffff", x: 0.42, y: 0.12 },
            { value: "Mulhouse 2026", font: "Amatic SC", color: "#ffffff" },
          ],
        },
        characters: PERSONNAGES,
        aiPublicId: PUBLIC_ID,
        aiApercuUrl: `/ia/apercu/${PUBLIC_ID}`,
        ...autres,
      }),
    ),
  );
}

function accepte(v: ReturnType<typeof ligneIAControlee>): PosterConfig {
  assert.equal(v.ok, true, `refusée : ${JSON.stringify(v)}`);
  return (v as { config: PosterConfig }).config;
}

function refus(v: ReturnType<typeof ligneIAControlee>): string {
  assert.equal(v.ok, false, "acceptée alors qu'elle devait être refusée");
  return (v as { code: string }).code;
}

/* ------------------------------------------------------------------------ */
/*  La règle                                                                 */
/* ------------------------------------------------------------------------ */

test("une ligne légitime passe telle qu'AfficheIA l'envoie, sans remarque", () => {
  const envoyee = ligne();
  const v = ligneIAControlee(envoyee, contexte());
  assert.deepEqual(accepte(v), envoyee);
  assert.equal((v as { remarques?: string[] }).remarques, undefined);
  // « Debout, de face » : vue de face, sans muret.
  const deFace = ligne({ view: "front", foregroundUrl: undefined });
  assert.deepEqual(accepte(ligneIAControlee(deFace, contexte())), deFace);
  // Le muret officiel, quand le type « de dos » n'en a plus.
  const officiel = ligne({ foregroundUrl: MURET_OFFICIEL });
  assert.deepEqual(accepte(ligneIAControlee(officiel, contexte())), officiel);
});

test("sans personnage, ou sans aiPublicId, la ligne revient TELLE QUELLE : le contrôle ne la regarde pas", () => {
  // Une affiche IA sans personnage : celle de la tablette, aujourd'hui. Même
  // un décor ou un fond n'y sont pas touchés (pas de nouveau refus, pas de
  // nettoyage) — le PDF ne pose de toute façon un décor qu'avec des
  // personnages (pdf.ts).
  const sansPerso = ligne({ characters: [], view: "front", foregroundUrl: "http://ailleurs/x.svg" });
  assert.equal(ligneIAAvecPersonnages(sansPerso), false);
  const v1 = ligneIAControlee(sansPerso, contexte({ generation: null }));
  assert.equal(v1.ok && v1.config, sansPerso, "le même objet, pas une copie");
  // Une affiche du catalogue, personnages compris.
  const classique = ligne({ aiPublicId: undefined, aiApercuUrl: undefined, backgroundId: 3 });
  assert.equal(ligneIAAvecPersonnages(classique), false);
  const v2 = ligneIAControlee(classique, contexte({ generation: null }));
  assert.equal(v2.ok && v2.config, classique);
  // Un aiPublicId vide ne fait pas une affiche IA (configAImprimer non plus).
  const vide = ligne({ aiPublicId: "" });
  assert.equal(ligneIAAvecPersonnages(vide), false);
  assert.equal(ligneIAControlee(vide, contexte({ generation: null })).ok, true);
  assert.equal(ligneIAAvecPersonnages(ligne()), true);
  assert.equal(ligneIAAvecPersonnages(null), false);
});

test("génération absente, pas prête ou purgée : ia_indisponible", () => {
  assert.equal(refus(ligneIAControlee(ligne(), contexte({ generation: null }))), "ia_indisponible");
  for (const status of ["en_cours", "echec"])
    assert.equal(
      refus(ligneIAControlee(ligne(), contexte({ generation: { ...GEN, status } }))),
      "ia_indisponible",
      status,
    );
  // Purgée (30 jours) : la purge vide les chemins ensemble.
  const purgee = { ...GEN, previewPath: null, fullPath: null };
  assert.equal(refus(ligneIAControlee(ligne(), contexte({ generation: purgee }))), "ia_indisponible");
  // Sans pleine définition, le PDF ne se ferait pas (configAImprimer).
  const sansPleine = { ...GEN, fullPath: null };
  assert.equal(refus(ligneIAControlee(ligne(), contexte({ generation: sansPleine }))), "ia_indisponible");
  // Une version d'un fond de la boutique (Créer un fond) : pas d'aperçu, ni
  // produit, ni panier — ce n'est pas l'affiche d'un client.
  const fond = { ...GEN, productId: null, cartId: null, previewPath: null, fullPath: `ia/fonds/${PUBLIC_ID}.png` };
  assert.equal(refus(ligneIAControlee(ligne(), contexte({ generation: fond }))), "ia_indisponible");
});

test("génération d'une autre affiche : ia_autre_affiche — sauf si son produit a été effacé", () => {
  const autre = { ...GEN, productId: 43 };
  assert.equal(refus(ligneIAControlee(ligne(), contexte({ generation: autre }))), "ia_autre_affiche");
  // La ligne qui ne dit pas son produit ne désigne pas celui de la génération.
  assert.equal(refus(ligneIAControlee(ligne(), contexte({ productId: null }))), "ia_autre_affiche");
  assert.equal(refus(ligneIAControlee(ligne(), contexte({ productId: Number.NaN }))), "ia_autre_affiche");
  // Le produit de la génération a été effacé (product_id remis à nul) : on
  // ne refuse pas sur ce qu'on ne sait pas.
  const orpheline = { ...GEN, productId: null };
  assert.equal(ligneIAControlee(ligne(), contexte({ generation: orpheline })).ok, true);
});

test("génération d'un autre panier : acceptée, JOURNAL SEULEMENT — panier d'origine ouvert ou clos", () => {
  for (const statutPanierOrigine of ["draft", "paid", null]) {
    const v = ligneIAControlee(
      ligne(),
      contexte({ cartId: "panier-B", statutPanierOrigine }),
    );
    assert.deepEqual(accepte(v), ligne());
    const remarques = (v as { remarques?: string[] }).remarques ?? [];
    assert.equal(remarques.length, 1);
    assert.match(remarques[0]!, /autre panier \(panier-A, /);
    assert.match(remarques[0]!, statutPanierOrigine ? new RegExp(statutPanierOrigine) : /jamais né/);
    assert.match(remarques[0]!, /jamais vendue/);
  }
  const vendue = { ...GEN, paidAt: new Date("2026-11-19T10:00:00Z") };
  const v = ligneIAControlee(ligne(), contexte({ cartId: "panier-B", generation: vendue }));
  assert.match((v as { remarques: string[] }).remarques[0]!, /déjà vendue/);
  const sansPanier = ligneIAControlee(ligne(), contexte({ generation: { ...GEN, cartId: null } }));
  assert.match((sansPanier as { remarques: string[] }).remarques[0]!, /autre panier \(sans panier, jamais vendue\)/);
});

test("le journal ne reçoit ni retour à la ligne ni adresse sans fin venus de la page", () => {
  const forge = `/assets/x.svg\n[ia-composition] fausse ligne${"a".repeat(5000)}`;
  const v = ligneIAControlee(
    ligne({ foregroundUrl: forge }),
    contexte({ cartId: "panier-B", generation: { ...GEN, cartId: "panier\r\nA" } }),
  );
  const remarques = (v as { remarques: string[] }).remarques;
  assert.equal(remarques.length, 2);
  for (const r of remarques) {
    assert.doesNotMatch(r, /[\r\n]/);
    assert.ok(r.length < 300, `remarque trop longue : ${r.length}`);
  }
});

test("fond, identifiant de fond et cadre retirés ; produit et aperçu imposés", () => {
  const forgee = ligne({
    backgroundUrl: `ia/autre-pleine.png`,
    backgroundId: 0,
    frameId: 2,
    productId: 99,
    aiApercuUrl: "https://ailleurs.example/x.jpg",
  });
  const v = ligneIAControlee(forgee, contexte());
  const propre = accepte(v);
  assert.equal("backgroundUrl" in propre, false);
  assert.equal("backgroundId" in propre, false);
  assert.equal("frameId" in propre, false);
  assert.equal(propre.productId, 42, "le produit de la LIGNE, pas celui de la configuration");
  assert.equal(propre.aiApercuUrl, `/ia/apercu/${PUBLIC_ID}`);
  assert.equal(propre.aiPublicId, PUBLIC_ID);
  assert.match((v as { remarques: string[] }).remarques.join(" "), /fond, identifiant de fond, cadre/);
  // Un cadre « vide » n'est pas un cadre, mais il ne reste pas pour autant.
  const cadreNul = accepte(ligneIAControlee(ligne({ frameId: null }), contexte()));
  assert.equal("frameId" in cadreNul, false);
  // Une ligne au produit inconnu ne s'en invente pas un.
  const orpheline = { ...GEN, productId: null };
  const sansProduit = accepte(
    ligneIAControlee(ligne(), contexte({ productId: null, generation: orpheline })),
  );
  assert.equal("productId" in sansProduit, false);
});

test("décors : seuls ceux que la boutique a réglés passent, et seulement de dos", () => {
  for (const forge of [
    "http://169.254.169.254/latest/meta-data",
    "https://cdn.example.com/muret_officiel.svg",
    `ia/${PUBLIC_ID}-pleine.png`,
    "/assets/ia/autre-pleine.png",
    "../../.env",
    "/assets/../../.env",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "/assets/muret_officiel.svg?x=1",
    " /assets/muret_officiel.svg",
    "/assets/banc-d-un-autre-produit.svg",
  ]) {
    const v = ligneIAControlee(ligne({ foregroundUrl: forge }), contexte());
    const propre = accepte(v);
    assert.equal("foregroundUrl" in propre, false, forge);
    // De dos sans décor : le moteur repose le muret officiel (pdf.ts).
    assert.equal(propre.view, "back");
    assert.match((v as { remarques: string[] }).remarques.join(" "), /décor non autorisé/);
  }
  // Le muret officiel et celui du type de dos passent.
  assert.equal(accepte(ligneIAControlee(ligne({ foregroundUrl: MURET_OFFICIEL }), contexte())).foregroundUrl, MURET_OFFICIEL);
  assert.equal(accepte(ligneIAControlee(ligne(), contexte())).foregroundUrl, MURET_DU_TYPE);
  // Un décor sur une affiche de face s'en va : « Debout, de face » est sans muret.
  const deFace = accepte(ligneIAControlee(ligne({ view: "front", foregroundUrl: MURET_OFFICIEL }), contexte()));
  assert.equal("foregroundUrl" in deFace, false);
  assert.equal(deFace.view, "front");
});

test("un type d'affiche inconnu devient « front », et son décor part avec lui", () => {
  const v = accepte(ligneIAControlee(ligne({ view: "plage-inventee" }), contexte()));
  assert.equal(v.view, "front");
  assert.equal("foregroundUrl" in v, false);
  // Un type créé au back-office existe : il reste, sans décor (seul « back » en a un ici).
  const banc = accepte(
    ligneIAControlee(ligne({ view: "banc" }), contexte({ vues: new Set(["front", "back", "banc"]) })),
  );
  assert.equal(banc.view, "banc");
  assert.equal("foregroundUrl" in banc, false);
  // « back » absent de la base : retour au type par défaut.
  const sansDos = accepte(ligneIAControlee(ligne(), contexte({ vues: new Set(["front"]) })));
  assert.equal(sansDos.view, "front");
});

test("des personnages en paysage : ia_personnages_paysage — par la ligne ou par la génération", () => {
  assert.equal(
    refus(ligneIAControlee(ligne({ orientation: "paysage" }), contexte())),
    "ia_personnages_paysage",
  );
  // Une génération demandée en paysage, sur une ligne qui se dit en hauteur.
  const couchee = { ...GEN, size: TAILLE_GENERATION_PAYSAGE };
  assert.equal(refus(ligneIAControlee(ligne(), contexte({ generation: couchee }))), "ia_personnages_paysage");
  assert.equal(
    refus(ligneIAControlee(ligne({ orientation: "portrait" }), contexte({ generation: couchee }))),
    "ia_personnages_paysage",
  );
  // La taille maximale couchée (26/11) : une génération en paysage aussi.
  const coucheeMax = { ...GEN, size: "3424x2416" };
  assert.equal(refus(ligneIAControlee(ligne(), contexte({ generation: coucheeMax }))), "ia_personnages_paysage");
  // Les tailles que le back-office donne aux affiches demandées EN PORTRAIT,
  // « 1536 × 1024 — paysage » comprise, et la taille maximale (2416 × 3424,
  // 26/11) : la feuille reste en hauteur.
  for (const size of ["1584x2240", "2416x3424", "1024x1536", "1024x1024", "1536x1024", "auto", null])
    assert.equal(ligneIAControlee(ligne(), contexte({ generation: { ...GEN, size } })).ok, true, String(size));
  assert.equal(ligneIAControlee(ligne({ orientation: "portrait" }), contexte()).ok, true);
});

test("les tailles d'une génération en paysage sont bien celles d'ia.ts (TAILLE_PAYSAGE, TAILLE_PAYSAGE_MAX)", () => {
  const source = readFileSync(fileURLToPath(new URL("../src/ia.ts", import.meta.url)), "utf8");
  const lue = (nom: string) => new RegExp(`const ${nom} = "(\\d+x\\d+)"`).exec(source)?.[1];
  assert.equal(lue("TAILLE_PAYSAGE"), TAILLE_GENERATION_PAYSAGE);
  assert.deepEqual(
    new Set([lue("TAILLE_PAYSAGE"), lue("TAILLE_PAYSAGE_MAX")]),
    new Set(TAILLES_GENERATION_PAYSAGE),
  );
  // La taille maximale couchée est bien la taille maximale tournée.
  assert.equal(lue("TAILLE_PAYSAGE_MAX"), lue("TAILLE_MAX")!.split("x").reverse().join("x"));
  // Et ce sont les seules tailles qu'une demande en paysage reçoit, passées
  // par `tailleDuModele` (relecture du 26/11) : gpt-image-2 et ses suites
  // les gardent ; gpt-image-1.5 et 1-mini, qui ne font que les tailles
  // standard (2240 × 1584 les faisait échouer, 400), reçoivent 1536 × 1024 —
  // que la génération ne dit pas couchée : c'est alors l'orientation de la
  // ligne qui refuse les personnages.
  assert.match(
    source,
    /const tailleChoisie = paysage\s*\?\s*tailleDuModele\(\s*reg\["ia\.modele"\],\s*taillePortrait === TAILLE_MAX\s*\?\s*TAILLE_PAYSAGE_MAX\s*:\s*TAILLE_PAYSAGE,?\s*\)\s*:/,
  );
});

test("les textes (x/y compris) et les personnages ne bougent pas d'un chiffre", () => {
  const envoyee = ligne({ backgroundUrl: "x.png", frameId: 1, foregroundUrl: "http://x/y.svg" });
  const propre = accepte(ligneIAControlee(envoyee, contexte()));
  assert.deepEqual(propre.texts, envoyee.texts);
  assert.deepEqual(propre.texts.lines?.[0], {
    value: "Léa & Tom",
    font: "Amatic SC",
    color: "#ffffff",
    x: 0.42,
    y: 0.12,
  });
  assert.deepEqual(propre.characters, envoyee.characters);
  assert.equal(propre.format, "A3");
  assert.equal(propre.schemaVersion, 1);
});

test("idempotente : une ligne déjà contrôlée repasse à l'identique (un PUT de quantité)", () => {
  const premiere = accepte(
    ligneIAControlee(ligne({ backgroundId: 0, foregroundUrl: "ia/x.png", productId: "42" }), contexte()),
  );
  const seconde = ligneIAControlee(premiere, contexte());
  assert.deepEqual(accepte(seconde), premiere);
  assert.equal((seconde as { remarques?: string[] }).remarques, undefined);
});

test("ordre des refus : indisponible, puis autre affiche, puis paysage", () => {
  const purgeeAutre = { ...GEN, productId: 43, previewPath: null, fullPath: null };
  assert.equal(
    refus(ligneIAControlee(ligne({ orientation: "paysage" }), contexte({ generation: purgeeAutre }))),
    "ia_indisponible",
  );
  const autreCouchee = { ...GEN, productId: 43, size: TAILLE_GENERATION_PAYSAGE };
  assert.equal(
    refus(ligneIAControlee(ligne(), contexte({ generation: autreCouchee }))),
    "ia_autre_affiche",
  );
});

/* ------------------------------------------------------------------------ */
/*  La lecture en base, sur une base factice                                 */
/* ------------------------------------------------------------------------ */

/**
 * Une base qui rend, pour chaque table, les lignes données — sans regarder
 * les conditions : il n'y a qu'une génération, qu'un produit, qu'un panier.
 */
function baseFactice(tables: Map<unknown, unknown[]>, lues: unknown[] = []): Lecteur {
  return {
    select: () => ({
      from: (table: unknown) => {
        lues.push(table);
        const lignes = () => Promise.resolve(tables.get(table) ?? []);
        const fin = {
          where: () => lignes(),
          then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => lignes().then(ok, ko),
        };
        return { ...fin, innerJoin: () => fin };
      },
    }),
  } as unknown as Lecteur;
}

/** Une base qui ne répond pas : l'erreur part à la première lecture. */
const baseMuette = {
  select: () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
  },
} as unknown as Lecteur;

/** Une base dont la requête échoue en cours de route. */
const baseQuiEchoue = {
  select: () => ({
    from: () => ({
      where: () => Promise.reject(new Error("canceling statement due to statement timeout")),
    }),
  }),
} as unknown as Lecteur;

const TABLES = () =>
  new Map<unknown, unknown[]>([
    [schema.aiGenerations, [GEN]],
    [
      schema.posterViews,
      [
        { slug: "front", foregroundUrl: null },
        { slug: "back", foregroundUrl: MURET_DU_TYPE },
        { slug: "banc", foregroundUrl: "/assets/banc.svg" },
      ],
    ],
    [schema.products, [{ foregroundUrl: "/assets/muret-du-produit.svg" }]],
    [schema.orders, [{ status: "paid" }]],
  ]);

test("controlerLigneIA ne lit RIEN pour une ligne qui n'a pas de personnage", async () => {
  const sansPerso = ligne({ characters: [], foregroundUrl: undefined, view: "front" });
  const v = await controlerLigneIA("panier-A", 42, sansPerso, baseMuette);
  assert.equal(v.ok && v.config, sansPerso);
  const classique = ligne({ aiPublicId: undefined });
  const v2 = await controlerLigneIAModifiee("panier-A", 12, classique, baseMuette);
  assert.equal(v2 && v2.ok && v2.config, classique);
});

test("controlerLigneIA : décors et types d'affiche lus en base, muret officiel toujours permis", async (t) => {
  const journal = t.mock.method(console, "warn", () => {});
  const lues: unknown[] = [];
  const base = baseFactice(TABLES(), lues);
  // Le muret du type de dos, celui du produit, le muret officiel : gardés.
  for (const decor of [MURET_DU_TYPE, "/assets/muret-du-produit.svg", MURET_OFFICIEL, "/assets/banc.svg"]) {
    const v = await controlerLigneIA("panier-A", 42, ligne({ foregroundUrl: decor }), base);
    assert.equal(v.ok && v.config.foregroundUrl, decor, decor);
  }
  // Un décor que personne n'a réglé : retiré, sans refus.
  const forge = await controlerLigneIA("panier-A", 42, ligne({ foregroundUrl: "ia/x-pleine.png" }), base);
  assert.equal(forge.ok, true);
  assert.equal(forge.ok && "foregroundUrl" in forge.config, false);
  // Un type d'affiche créé au back-office existe bien en base.
  const banc = await controlerLigneIA("panier-A", 42, ligne({ view: "banc" }), base);
  assert.equal(banc.ok && banc.config.view, "banc");
  // Le journal dit lequel des deux : un décor forgé, ou un décor hors du dos.
  const messages = journal.mock.calls.map((c) => String(c.arguments[0]));
  assert.equal(messages.length, 2);
  assert.match(messages[0]!, /décor non autorisé retiré \(ia\/x-pleine\.png\)/);
  assert.match(messages[1]!, /décor retiré : aucun sur une affiche « banc »/);
  // Le panier d'origine n'est lu que pour une génération d'un autre panier.
  assert.equal(lues.includes(schema.orders), false);
  // Une autre affiche : refusée.
  const autre = await controlerLigneIA("panier-A", 43, ligne(), base);
  assert.deepEqual(autre, { ok: false, code: "ia_autre_affiche" });
  // Une génération introuvable : indisponible.
  const vide = baseFactice(new Map([[schema.posterViews, []]]));
  assert.deepEqual(await controlerLigneIA("panier-A", 42, ligne(), vide), {
    ok: false,
    code: "ia_indisponible",
  });
});

test("controlerLigneIA : une génération d'un autre panier passe, et le journal le dit", async (t) => {
  const journal = t.mock.method(console, "warn", () => {});
  const lues: unknown[] = [];
  const v = await controlerLigneIA("panier-B", 42, ligne(), baseFactice(TABLES(), lues));
  assert.equal(v.ok, true);
  assert.equal(lues.includes(schema.orders), true, "le statut du panier d'origine est lu");
  assert.equal(journal.mock.callCount(), 1);
  const message = String(journal.mock.calls[0]!.arguments[0]);
  assert.match(message, /\[ia-composition\]/);
  assert.match(message, new RegExp(PUBLIC_ID));
  assert.match(message, /autre panier \(panier-A, paid, jamais vendue\)/);
});

test("base injoignable : la ligne avec personnages est refusée (ia_indisponible), au journal, sans exception", async (t) => {
  const journal = t.mock.method(console, "error", () => {});
  assert.deepEqual(await controlerLigneIA("panier-A", 42, ligne(), baseMuette), {
    ok: false,
    code: "ia_indisponible",
  });
  assert.deepEqual(await controlerLigneIA("panier-A", 42, ligne(), baseQuiEchoue), {
    ok: false,
    code: "ia_indisponible",
  });
  assert.deepEqual(await controlerLigneIAModifiee("panier-A", 12, ligne(), baseMuette), {
    ok: false,
    code: "ia_indisponible",
  });
  assert.equal(journal.mock.callCount(), 3);
  assert.match(String(journal.mock.calls[0]!.arguments[0]), /\[ia-composition\] lecture impossible/);
});

test("controlerLigneIAModifiee : le produit de la ligne ENREGISTRÉE fait foi", async () => {
  const tables = TABLES();
  tables.set(schema.orderItems, [{ productId: 42, giftCard: null }]);
  // La requête annonce un autre produit dans la configuration : sans effet.
  const v = await controlerLigneIAModifiee("panier-A", 12, ligne({ productId: 7 }), baseFactice(tables));
  assert.equal(v?.ok && v.config.productId, 42);
  // La ligne enregistrée est d'une autre affiche : refus.
  tables.set(schema.orderItems, [{ productId: 43, giftCard: null }]);
  assert.deepEqual(await controlerLigneIAModifiee("panier-A", 12, ligne(), baseFactice(tables)), {
    ok: false,
    code: "ia_autre_affiche",
  });
  // Pas de telle ligne dans un panier modifiable : 404, comme la transaction.
  tables.set(schema.orderItems, []);
  assert.equal(await controlerLigneIAModifiee("panier-A", 12, ligne(), baseFactice(tables)), null);
  assert.equal(await controlerLigneIAModifiee("panier-A", Number.NaN, ligne(), baseFactice(tables)), null);
  // Une carte cadeau : la transaction la refuse elle-même (409).
  const carte = ligne();
  tables.set(schema.orderItems, [{ productId: null, giftCard: { montantCents: 3000 } }]);
  const v2 = await controlerLigneIAModifiee("panier-A", 12, carte, baseFactice(tables));
  assert.equal(v2?.ok && v2.config, carte);
});

/* ------------------------------------------------------------------------ */
/*  Contre la base locale : les requêtes elles-mêmes                         */
/* ------------------------------------------------------------------------ */

// Le service de base s'appelle « db » en production aussi, et l'image de
// production contient les tests : NODE_ENV=production les en écarte.
const baseLocale =
  /@db:5432\//.test(process.env.DATABASE_URL ?? "") && process.env.NODE_ENV !== "production";

after(async () => {
  if (!baseLocale) return;
  const { sql } = await import("../src/db/client.js");
  await sql.end({ timeout: 5 });
});

test(
  "base locale : une ligne avec personnages contrôlée à l'ajout, puis à la modification",
  { skip: !baseLocale && "hors de la base locale du conteneur" },
  async (t) => {
    t.mock.method(console, "warn", () => {});
    const { db } = await import("../src/db/client.js");
    const { eq } = await import("drizzle-orm");
    const suffixe = `${Date.now()}`;
    const cartId = `TEST-IA-COMPO-${suffixe}`;
    const publicId = randomUUID();
    let genId: number | undefined;
    let commandeId: number | undefined;
    try {
      // Sans produit : la génération et la ligne n'en désignent aucun, et
      // rien du catalogue n'est touché.
      const [gen] = await db
        .insert(schema.aiGenerations)
        .values({
          publicId,
          productId: null,
          cartId,
          status: "prete",
          previewPath: `ia/${publicId}-apercu.jpg`,
          fullPath: `ia/${publicId}-pleine.png`,
          size: "1584x2240",
          ip: "test",
        })
        .returning({ id: schema.aiGenerations.id });
      genId = gen?.id;
      const [commande] = await db
        .insert(schema.orders)
        .values({
          channel: "web",
          number: `DRAFT-${cartId}`,
          clientOrderId: cartId,
          status: "draft",
          totalCents: 0,
        })
        .returning({ id: schema.orders.id });
      commandeId = commande?.id;
      assert.ok(genId && commandeId);

      const envoyee = ligne({
        productId: undefined,
        aiPublicId: publicId,
        aiApercuUrl: `/ia/apercu/${publicId}`,
      });
      // À l'ajout : le muret officiel passe (le type « de dos » le porte
      // depuis la migration 0013), un décor forgé est retiré sans refus.
      const officiel = await controlerLigneIA(cartId, null, { ...envoyee, foregroundUrl: MURET_OFFICIEL });
      assert.equal(officiel.ok && officiel.config.foregroundUrl, MURET_OFFICIEL);
      const forge = await controlerLigneIA(cartId, null, {
        ...envoyee,
        foregroundUrl: `ia/${publicId}-pleine.png`,
      });
      assert.equal(forge.ok, true);
      assert.equal(forge.ok && "foregroundUrl" in forge.config, false);
      // Une génération d'un autre panier : acceptée (journal seulement).
      assert.equal((await controlerLigneIA(`${cartId}-autre`, null, envoyee)).ok, true);
      // Une génération inconnue : indisponible.
      assert.deepEqual(
        await controlerLigneIA(cartId, null, { ...envoyee, aiPublicId: randomUUID() }),
        { ok: false, code: "ia_indisponible" },
      );

      // À la modification (PUT de quantité) : la configuration enregistrée
      // repasse à l'identique.
      const enregistree = officiel.ok ? officiel.config : envoyee;
      const [item] = await db
        .insert(schema.orderItems)
        .values({ orderId: commandeId, productId: null, config: enregistree, unitPriceCents: 0, quantity: 1 })
        .returning({ id: schema.orderItems.id });
      assert.ok(item);
      const modifiee = await controlerLigneIAModifiee(cartId, item.id, enregistree);
      assert.deepEqual(modifiee, { ok: true, config: enregistree });
      // La même ligne, demandée depuis un autre panier : introuvable.
      assert.equal(await controlerLigneIAModifiee(`${cartId}-autre`, item.id, enregistree), null);
    } finally {
      // La commande emporte sa ligne (on delete cascade).
      if (commandeId) await db.delete(schema.orders).where(eq(schema.orders.id, commandeId));
      if (genId) await db.delete(schema.aiGenerations).where(eq(schema.aiGenerations.id, genId));
    }
  },
);
