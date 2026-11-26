/**
 * L'appel au modèle d'images (editerImages, ia.ts) contre un FAUX OpenAI
 * local : jamais un appel réel, aucune base (26/11, Alexandra : « il faut que
 * les affiches soient haute qualité ! au moins à l'impression tu vois » ;
 * Margaux : « qualité affiches IA pas top »).
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/ia-openai-replis.test.ts
 *
 * Ce qui est vérifié, requête par requête, sur ce que le faux serveur REÇOIT :
 *  - gpt-image-2 : UNE requête, quality=high, pas d'input_fidelity (OpenAI :
 *    « For gpt-image-2, omit this parameter »), à la taille demandée ;
 *  - les autres modèles reçoivent la fidélité ; s'ils la refusent, la
 *    qualité reste ; s'ils refusent la qualité, l'affiche part sans option ;
 *  - le filet de la taille : 2416 × 3424 refusée, UN nouvel essai à la
 *    taille sûre du même sens, avec la qualité, écrit au journal.
 * Et le coût attendu par taille, d'après la règle des jetons d'OpenAI.
 */
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";

/** Ce que le faux OpenAI a reçu : les champs de chaque requête (images à part). */
type Recue = Record<string, string> & { images: string };
const recues: Recue[] = [];
/** Sa réponse à une requête : null = l'image. */
let refuser: (r: Recue) => { statut: number; corps: unknown } | null = () => null;
/** Vrai : le faux OpenAI répond 200, envoie le début de l'image, puis coupe la connexion. */
let couperLeCorps = false;

const IMAGE = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#c33" } })
  .png()
  .toBuffer();

async function lire(req: IncomingMessage): Promise<Recue> {
  const morceaux: Buffer[] = [];
  for await (const m of req) morceaux.push(m as Buffer);
  const form = await new Response(Buffer.concat(morceaux), {
    headers: { "content-type": String(req.headers["content-type"]) },
  }).formData();
  const recue = { images: "" } as Recue;
  for (const [cle, valeur] of form.entries()) {
    if (typeof valeur === "string") recue[cle] = valeur;
    else recue.images += `${cle}:${valeur.name} `;
  }
  return recue;
}

const serveur = createServer(async (req, res) => {
  const recue = await lire(req);
  recues.push(recue);
  const refus = refuser(recue);
  if (couperLeCorps) {
    // Les en-têtes 200, le début du JSON, puis plus rien : la connexion
    // tombe pendant que l'image arrive (relecture finale du 26/11).
    res.writeHead(200, { "content-type": "application/json", "content-length": "100000" });
    res.write(`{"data":[{"b64_json":"${IMAGE.toString("base64").slice(0, 40)}`);
    setTimeout(() => res.socket?.destroy(), 50);
    return;
  }
  res.writeHead(refus?.statut ?? 200, { "content-type": "application/json" });
  res.end(
    JSON.stringify(
      refus?.corps ?? {
        data: [{ b64_json: IMAGE.toString("base64") }],
        usage: {
          input_tokens: 2500,
          output_tokens: 9055,
          input_tokens_details: { text_tokens: 1000, image_tokens: 1500 },
        },
      },
    ),
  );
});
await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
after(() => serveur.close());

// AVANT d'importer ia.ts, qui lit l'adresse et la clé à l'import : le faux
// serveur, une clé factice. Affectés, pas « ??= » : rien ne doit partir chez
// OpenAI, même si l'environnement en connaît une.
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/v1`;
process.env.OPENAI_API_KEY = "cle-factice-des-essais";
process.env.DATABASE_URL ??= "postgres://essai:essai@127.0.0.1:1/essai";
const {
  editerImages,
  optionRefusee,
  tailleDeRepli,
  jetonsDeSortie,
  coutAttenduCents,
  coutAttenduDuModele,
  coutDeLImage,
  coutDUnEchec,
  delaiDepasse,
  erreurFacturee,
} = await import("../src/ia.ts");

/** Les lignes que l'appel écrit au journal. */
const journal: string[] = [];
const avertir = console.warn;
console.warn = (...a: unknown[]) => {
  journal.push(a.map(String).join(" "));
};
after(() => {
  console.warn = avertir;
});

beforeEach(() => {
  recues.length = 0;
  journal.length = 0;
  refuser = () => null;
  couperLeCorps = false;
});

const PHOTO = [{ nom: "photo.jpg", donnees: IMAGE, type: "image/jpeg" }];

/**
 * Un appel, avec ce qu'il rend : l'image, la taille rendue, la qualité
 * réellement envoyée au dernier essai (null : aucune), la consommation.
 */
async function appeler(modele: string, taille: string, qualite = "high", fidelite = "high") {
  let tailleRendue: string | null = null;
  let qualiteEnvoyee: string | null | undefined;
  let usage: unknown = null;
  const image = await editerImages(
    PHOTO,
    "consigne d'essai",
    modele,
    taille,
    qualite,
    fidelite,
    (u: unknown) => {
      usage = u;
    },
    (e: { taille: string; qualite: string | null }) => {
      tailleRendue = e.taille;
      qualiteEnvoyee = e.qualite;
    },
  );
  return { image, tailleRendue, qualiteEnvoyee, usage };
}

const erreur400 = (message: string, param: string | null) => ({
  statut: 400,
  corps: { error: { message, type: "invalid_request_error", param, code: null } },
});

test("gpt-image-2 : UNE requête, quality=high, pas d'input_fidelity, size=1584x2240", async () => {
  // Le faux serveur fait comme gpt-image-2 d'après la doc : il refuserait
  // « input_fidelity ».
  refuser = (r) => ("input_fidelity" in r ? erreur400("Unknown parameter: 'input_fidelity'.", "input_fidelity") : null);
  const { image, tailleRendue, usage } = await appeler("gpt-image-2", "1584x2240");
  assert.equal(recues.length, 1);
  const r = recues[0]!;
  assert.equal(r.model, "gpt-image-2");
  assert.equal(r.size, "1584x2240");
  assert.equal(r.quality, "high");
  assert.equal(r.n, "1");
  assert.equal(r.prompt, "consigne d'essai");
  assert.equal("input_fidelity" in r, false);
  assert.match(r.images, /^image:photo\.jpg $/);
  assert.equal(tailleRendue, "1584x2240");
  assert.equal((usage as { output_tokens: number }).output_tokens, 9055);
  assert.equal((await sharp(image).metadata()).width, 16);
  assert.deepEqual(journal, [], "aucun repli, rien au journal");
});

test("gpt-image-2 daté (gpt-image-2-2026-04-21) : pas d'input_fidelity non plus", async () => {
  await appeler("gpt-image-2-2026-04-21", "2416x3424");
  assert.equal(recues.length, 1);
  assert.equal("input_fidelity" in recues[0]!, false);
  assert.equal(recues[0]!.quality, "high");
  assert.equal(recues[0]!.size, "2416x3424");
});

test("un autre modèle reçoit la fidélité ; s'il la refuse, la qualité RESTE (2 requêtes)", async () => {
  refuser = (r) => ("input_fidelity" in r ? erreur400("Unknown parameter: 'input_fidelity'.", "input_fidelity") : null);
  await appeler("gpt-image-2.5-sunburst", "1584x2240");
  assert.equal(recues.length, 2);
  assert.equal(recues[0]!.input_fidelity, "high");
  assert.equal(recues[0]!.quality, "high");
  assert.equal("input_fidelity" in recues[1]!, false);
  assert.equal(recues[1]!.quality, "high", "la qualité ne part plus avec la fidélité");
  assert.equal(journal.length, 1);
  assert.match(journal[0]!, /refuse la fidélité « high » : nouvel essai avec la qualité « high », sans la fidélité/);
});

test("la qualité refusée : nouvel essai sans qualité ni fidélité (le repli d'avant)", async () => {
  refuser = (r) =>
    r.quality === "xhigh"
      ? erreur400("Invalid value: 'xhigh'. Supported values are: 'low', 'medium', 'high', and 'auto'.", "quality")
      : null;
  const { qualiteEnvoyee } = await appeler("gpt-image-1.5", "1024x1536", "xhigh");
  assert.equal(recues.length, 2);
  assert.equal(recues[1]!.quality, undefined);
  assert.equal(recues[1]!.input_fidelity, undefined);
  assert.match(journal[0]!, /SANS qualité ni fidélité/);
  // Relecture du 26/11 : l'appelant sait que la qualité n'est PAS partie —
  // le journal de la route ne doit plus écrire « high » pour une image en
  // « auto ».
  assert.equal(qualiteEnvoyee, null);
});

test("ce qui part est annoncé avant chaque essai : la qualité réglée tant qu'elle part", async () => {
  const { qualiteEnvoyee, tailleRendue } = await appeler("gpt-image-2", "1584x2240", "medium");
  assert.equal(qualiteEnvoyee, "medium");
  assert.equal(tailleRendue, "1584x2240");
});

test("la fidélité refusée, puis la qualité : trois requêtes, la dernière sans option", async () => {
  refuser = (r) =>
    "input_fidelity" in r
      ? erreur400("Unknown parameter: 'input_fidelity'.", "input_fidelity")
      : "quality" in r
        ? erreur400("Unknown parameter: 'quality'.", "quality")
        : null;
  await appeler("gpt-image-1.5", "1024x1536");
  assert.deepEqual(
    recues.map((r) => [r.quality ?? "-", r.input_fidelity ?? "-"]),
    [
      ["high", "high"],
      ["high", "-"],
      ["-", "-"],
    ],
  );
  assert.equal(journal.length, 2);
});

test("la TAILLE refusée (2416x3424) : UN nouvel essai en 1584x2240, avec la qualité, écrit au journal", async () => {
  refuser = (r) =>
    r.size === "2416x3424"
      ? erreur400("Invalid size '2416x3424'. Requested resolution is not supported for this model.", "size")
      : null;
  const { tailleRendue } = await appeler("gpt-image-2", "2416x3424");
  assert.deepEqual(
    recues.map((r) => [r.size, r.quality, r.input_fidelity ?? "-"]),
    [
      ["2416x3424", "high", "-"],
      ["1584x2240", "high", "-"],
    ],
  );
  assert.equal(tailleRendue, "1584x2240", "l'appelant sait quelle taille il a eue");
  assert.equal(journal.length, 1);
  assert.match(journal[0]!, /gpt-image-2 refuse la taille 2416x3424 : nouvel essai en 1584x2240/);
});

test("en paysage, la taille maximale refusée repart en 2240x1584", async () => {
  refuser = (r) => (r.size === "3424x2416" ? erreur400("Invalid 'size': above the maximum.", "size") : null);
  const { tailleRendue } = await appeler("gpt-image-2", "3424x2416");
  assert.deepEqual(
    recues.map((r) => r.size),
    ["3424x2416", "2240x1584"],
  );
  assert.equal(tailleRendue, "2240x1584");
});

test("une taille refusée sans « param » (le message seul) : même repli", async () => {
  refuser = (r) =>
    r.size === "2416x3424"
      ? { statut: 400, corps: { error: { message: "The requested resolution exceeds the supported dimensions." } } }
      : null;
  await appeler("gpt-image-2.5-sunburst", "2416x3424");
  assert.deepEqual(
    recues.map((r) => [r.size, r.quality]),
    [
      ["2416x3424", "high"],
      ["1584x2240", "high"],
    ],
  );
});

test("la taille ET la fidélité refusées : trois requêtes, la qualité garde « high » jusqu'au bout", async () => {
  refuser = (r) =>
    r.size === "2416x3424"
      ? erreur400("Unsupported size.", "size")
      : "input_fidelity" in r
        ? erreur400("Unknown parameter: 'input_fidelity'.", "input_fidelity")
        : null;
  const { tailleRendue } = await appeler("gpt-image-2.5-flare", "2416x3424");
  assert.deepEqual(
    recues.map((r) => [r.size, r.quality, r.input_fidelity ?? "-"]),
    [
      ["2416x3424", "high", "high"],
      ["1584x2240", "high", "high"],
      ["1584x2240", "high", "-"],
    ],
  );
  assert.equal(tailleRendue, "1584x2240");
});

test("UN seul repli de taille : la taille sûre refusée aussi, l'erreur remonte", async () => {
  refuser = () => erreur400("Invalid size.", "size");
  await assert.rejects(appeler("gpt-image-2", "2416x3424"), /OpenAI HTTP 400/);
  assert.deepEqual(
    recues.map((r) => r.size),
    ["2416x3424", "1584x2240"],
  );
});

test("la taille sûre, ou plus petite, refusée : pas de nouvel essai", async () => {
  refuser = () => erreur400("Invalid size.", "size");
  await assert.rejects(appeler("gpt-image-2", "1584x2240"), /OpenAI HTTP 400/);
  assert.equal(recues.length, 1);
  recues.length = 0;
  // 1024 × 1536, la taille des fonds : jamais « réparée » en plus grand.
  await assert.rejects(appeler("gpt-image-2", "1024x1536"), /OpenAI HTTP 400/);
  assert.equal(recues.length, 1);
});

test("ni la modération, ni une panne, ni le crédit épuisé ne déclenchent de nouvel essai", async () => {
  refuser = () => erreur400("Your request was rejected as a result of our safety system.", null);
  await assert.rejects(appeler("gpt-image-2", "2416x3424"), /safety system/);
  assert.equal(recues.length, 1);

  recues.length = 0;
  refuser = () => ({ statut: 500, corps: { error: { message: "The server had an error" } } });
  await assert.rejects(appeler("gpt-image-2", "2416x3424"), /OpenAI HTTP 500/);
  assert.equal(recues.length, 1);

  recues.length = 0;
  refuser = () => ({
    statut: 429,
    corps: { error: { message: "You exceeded your current quota.", code: "insufficient_quota", param: null } },
  });
  await assert.rejects(appeler("gpt-image-2", "1584x2240"), /insufficient_quota/);
  assert.equal(recues.length, 1);
  assert.deepEqual(journal, []);
});

test("optionRefusee : le champ « param » d'abord, sinon les mots du message", () => {
  const json = (message: string, param?: string | null) => JSON.stringify({ error: { message, param } });
  assert.equal(optionRefusee(json("x", "size")), "taille");
  assert.equal(optionRefusee(json("x", "input_fidelity")), "fidelite");
  assert.equal(optionRefusee(json("x", "quality")), "qualite");
  // Une erreur sur un autre champ : aucun repli ne la répare.
  assert.equal(optionRefusee(json("Invalid image: the file size exceeds 50MB.", "image")), null);
  assert.equal(optionRefusee(json("Unsupported size 9999x9999.")), "taille");
  assert.equal(optionRefusee(json("Unknown parameter: 'input_fidelity'.")), "fidelite");
  assert.equal(optionRefusee(json("quality must be low, medium or high")), "qualite");
  assert.equal(optionRefusee(json("Unsupported parameter.")), "qualite");
  assert.equal(optionRefusee(json("Your request was rejected by the safety system.", null)), null);
  assert.equal(optionRefusee("pas du json : Invalid resolution"), "taille");
});

test("tailleDeRepli : la taille sûre du même sens, en descendant seulement", () => {
  assert.equal(tailleDeRepli("gpt-image-2", "2416x3424"), "1584x2240");
  assert.equal(tailleDeRepli("gpt-image-2.5-sunburst", "3424x2416"), "2240x1584");
  assert.equal(tailleDeRepli("gpt-image-2", "1584x2240"), null);
  assert.equal(tailleDeRepli("gpt-image-2", "2240x1584"), null);
  assert.equal(tailleDeRepli("gpt-image-2", "1024x1536"), null);
  assert.equal(tailleDeRepli("gpt-image-2", "2048x2048"), null);
  assert.equal(tailleDeRepli("gpt-image-2", "auto"), null);
  assert.equal(tailleDeRepli("gpt-image-1.5", "2416x3424"), null);
});

test("la règle des jetons d'OpenAI retrouve les six prix publiés de gpt-image-2", () => {
  // OpenAI, guide « Image generation », gpt-image-2 : 1024 × 1024 / 1024 × 1536.
  const publies: [string, string, number][] = [
    ["low", "1024x1024", 0.006],
    ["low", "1024x1536", 0.005],
    ["medium", "1024x1024", 0.053],
    ["medium", "1024x1536", 0.041],
    ["high", "1024x1024", 0.211],
    ["high", "1024x1536", 0.165],
  ];
  for (const [qualite, taille, dollars] of publies) {
    const calcule = (jetonsDeSortie(taille, qualite)! * 30) / 1_000_000;
    assert.ok(Math.abs(calcule - dollars) < 0.0006, `${qualite} ${taille} : ${calcule.toFixed(4)} $ pour ${dollars} $`);
  }
  // Le paysage coûte comme le portrait.
  assert.equal(jetonsDeSortie("1536x1024", "high"), jetonsDeSortie("1024x1536", "high"));
  assert.equal(jetonsDeSortie("1584x2240", "high"), 9055);
  assert.equal(jetonsDeSortie("2416x3424", "high"), 16765);
  assert.equal(jetonsDeSortie("auto", "high"), null);
  assert.equal(jetonsDeSortie("1584x2240", "xhigh"), null);
});

test("le coût attendu d'une affiche en haute qualité : 17, 26 et 47 c ; inconnu hors gpt-image-2", () => {
  assert.equal(coutAttenduCents("gpt-image-2", "1024x1536", "high"), 17);
  assert.equal(coutAttenduCents("gpt-image-2", "1584x2240", "high"), 26);
  assert.equal(coutAttenduCents("gpt-image-2", "2240x1584", "high"), 26);
  assert.equal(coutAttenduCents("gpt-image-2", "2416x3424", "high"), 47);
  assert.equal(coutAttenduCents("gpt-image-2-2026-04-21", "2416x3424", "high"), 47);
  assert.equal(coutAttenduCents("gpt-image-2.5-sunburst", "1584x2240", "high"), null);
  assert.equal(coutAttenduCents("gpt-image-2", "auto", "high"), null);
});

test("les suites de gpt-image-2 sans tarif comptent au moins comme gpt-image-2 (relecture du 26/11)", () => {
  assert.deepEqual(coutAttenduDuModele("gpt-image-2", "2416x3424", "high"), { cents: 47, estime: false });
  assert.deepEqual(coutAttenduDuModele("gpt-image-2.5-sunburst", "2416x3424", "high"), { cents: 47, estime: true });
  assert.deepEqual(coutAttenduDuModele("gpt-image-2.5-flare", "3424x2416", "high"), { cents: 47, estime: true });
  // Qualité pas envoyée (« auto ») : comptée comme « high », la plus chère.
  assert.deepEqual(coutAttenduDuModele("gpt-image-2", "1584x2240", null), { cents: 26, estime: false });
  assert.equal(coutAttenduDuModele("gpt-image-1.5", "1024x1536", "high"), null);
  // « auto » (le modèle décide) : comptée comme 1024 × 1536, marquée
  // « estimé » (relecture finale du 26/11 ; avant : null, donc 8 c).
  assert.deepEqual(coutAttenduDuModele("gpt-image-2", "auto", "high"), { cents: 17, estime: true });
  assert.deepEqual(coutAttenduDuModele("gpt-image-2.5-sunburst", "auto", "high"), { cents: 17, estime: true });
  assert.deepEqual(coutAttenduDuModele("gpt-image-2.5-flare", "auto", null), { cents: 17, estime: true });
  assert.equal(coutAttenduDuModele("gpt-image-1.5", "auto", "high"), null);

  const usage = { input_tokens: 2500, output_tokens: 16765, input_tokens_details: { text_tokens: 1000, image_tokens: 1500 } };
  const envoi = { taille: "2416x3424", qualite: "high" };
  // gpt-image-2 : le vrai coût, d'après la consommation.
  assert.equal(coutDeLImage("gpt-image-2", usage, envoi, 8), 47);
  // gpt-image-2.5 : plus jamais 8 c en 2416 × 3424.
  assert.equal(coutDeLImage("gpt-image-2.5-sunburst", usage, envoi, 8), 47);
  assert.equal(coutDeLImage("gpt-image-2.5-sunburst", null, { taille: "1584x2240", qualite: "high" }, 8), 26);
  // Un réglage plus haut que l'attendu l'emporte (on compte large).
  assert.equal(coutDeLImage("gpt-image-2.5-sunburst", null, envoi, 60), 60);
  // Les modèles sans règle gardent le réglage, comme avant.
  assert.equal(coutDeLImage("gpt-image-1.5", null, { taille: "1024x1536", qualite: "high" }, 8), 8);
  // Relecture finale du 26/11 : « auto » avec une suite de gpt-image-2.
  // L'affiche portrait rendue en 1024 × 1536 (5 488 jetons) comptait 8 c ;
  // gpt-image-2, pour la même image, 16 c.
  const usageAuto = { input_tokens: 2500, output_tokens: 5488, input_tokens_details: { text_tokens: 1000, image_tokens: 1500 } };
  const auto = { taille: "auto", qualite: "high" };
  assert.equal(coutDeLImage("gpt-image-2", usageAuto, auto, 8), 16);
  assert.equal(coutDeLImage("gpt-image-2.5-sunburst", usageAuto, auto, 8), 17);
  assert.equal(coutDeLImage("gpt-image-2.5-flare", usageAuto, auto, 8), 17);
  // Sans consommation (coupée au délai) : le coût attendu d'« auto ».
  assert.equal(coutDeLImage("gpt-image-2.5-sunburst", null, auto, 8), 17);
  // Une image plus grande que prévu, d'après sa consommation : le tarif de
  // gpt-image-2 sert de plancher (9 055 jetons : 26 c, pour 17 attendus).
  assert.equal(coutDeLImage("gpt-image-2.5-sunburst", usage, auto, 8), 47);
  const usage1584 = { input_tokens: 2500, output_tokens: 9055, input_tokens_details: { text_tokens: 1000, image_tokens: 1500 } };
  assert.equal(coutDeLImage("gpt-image-2.5-sunburst", usage1584, { taille: "1024x1536", qualite: "high" }, 8), 26);
  // gpt-image-1.5 et 1-mini gardent l'estimation fixe du réglage (voulu :
  // l'aide du BO le dit), consommation connue ou non.
  assert.equal(coutDeLImage("gpt-image-1.5", usageAuto, auto, 8), 8);
  assert.equal(coutDeLImage("gpt-image-1-mini", usage1584, { taille: "1024x1536", qualite: "high" }, 8), 8);
});

test("une création coupée au délai compte au plafond ; un refus d'OpenAI, non (relecture du 26/11)", () => {
  const delai = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  assert.equal(delaiDepasse(delai), true);
  const nodeDelai = Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } });
  assert.equal(delaiDepasse(nodeDelai), true);
  assert.equal(delaiDepasse(new Error("OpenAI HTTP 400 {…}")), false);
  assert.equal(delaiDepasse(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })), false);

  const o = { modele: "gpt-image-2", envoi: { taille: "2416x3424", qualite: "high" }, usage: null, coutParImageCents: 8 };
  assert.equal(coutDUnEchec(delai, o), 47);
  // Coupée après un repli de la taille : c'est la taille sûre qui était en cours.
  assert.equal(coutDUnEchec(delai, { ...o, envoi: { taille: "1584x2240", qualite: "high" } }), 26);
  assert.equal(coutDUnEchec(new Error("OpenAI HTTP 400 Your request was rejected"), o), 0);
  assert.equal(coutDUnEchec(new Error("OpenAI HTTP 429 insufficient_quota"), o), 0);
  // L'image reçue, puis perdue plus loin (disque plein…) : son vrai coût.
  const usage = { input_tokens: 2500, output_tokens: 9055, input_tokens_details: { text_tokens: 1000, image_tokens: 1500 } };
  assert.equal(coutDUnEchec(new Error("ENOSPC"), { ...o, usage }), 26);
});

test("une réponse 200 coupée en route compte au plafond, comme une création coupée au délai (relecture finale du 26/11)", async () => {
  // Le faux OpenAI envoie ses en-têtes 200 et le début de l'image, puis la
  // connexion tombe : l'image est dessinée, donc facturée.
  couperLeCorps = true;
  const erreur = await appeler("gpt-image-2", "1584x2240").then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(erreur, "l'appel échoue");
  assert.equal(recues.length, 1, "aucun nouvel essai");
  assert.equal(erreurFacturee(erreur), true);
  assert.equal(delaiDepasse(erreur), false);
  const o = { modele: "gpt-image-2", envoi: { taille: "1584x2240", qualite: "high" }, usage: null, coutParImageCents: 8 };
  assert.equal(coutDUnEchec(erreur, o), 26);
  assert.equal(coutDUnEchec(erreur, { ...o, modele: "gpt-image-2.5-sunburst", envoi: { taille: "2416x3424", qualite: "high" } }), 47);

  // Un refus d'OpenAI n'est pas marqué : 0, comme avant.
  couperLeCorps = false;
  refuser = () => erreur400("Your request was rejected by the safety system.", null);
  const refus = await appeler("gpt-image-2", "1584x2240").then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(refus);
  assert.equal(erreurFacturee(refus), false);
  assert.equal(coutDUnEchec(refus, o), 0);
  // Une connexion perdue AVANT toute réponse non plus.
  assert.equal(coutDUnEchec(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }), o), 0);
});
