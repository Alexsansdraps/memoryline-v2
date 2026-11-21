/**
 * Le relais photo ouvert depuis le site, pas seulement au stand (21/11).
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/relais-photo.test.ts
 *
 * Alexandra : « tu peux mettre le module de qr code pour envoyer une image sur
 * le site classique aussi pas que en mode stand ». Un relais ouvert SANS code
 * de stand est un relais « site » (stand_id nul), sous ses garde-fous propres ;
 * un code présent, même vide ou faux, reste sur le chemin du stand, refusé
 * comme avant.
 *
 * Sans base : la règle qui choisit le chemin, le frein, et les refus du stand
 * qui tombent avant la première lecture (code vide). Sur la BASE LOCALE, et
 * elle seule : la vraie application, de l'ouverture à la confirmation, avec
 * un stand d'essai « TEST-RELAIS-… » et des relais dont tous les codes sont
 * notés, effacés à la fin avec leurs photos. Hors de la base du conteneur
 * local (`@db:5432`), cette partie ne s'exécute pas.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { Hono } from "hono";
import sharp from "sharp";
import { frein, mountRelaisPhotoRoutes, origineDeLOuverture } from "../src/ia-relais.js";

/**
 * Une adresse IP neuve à chaque requête : les freins vivent en mémoire, pour
 * tout le module, et ce ne sont pas eux qu'on éprouve ici (sauf exprès).
 */
let numeroIp = 0;
const marqueIp = randomBytes(1)[0]!;
function ipNeuve(): string {
  numeroIp++;
  return `10.${marqueIp}.${Math.floor(numeroIp / 250)}.${(numeroIp % 250) + 1}`;
}

/* ------------------------------------------------------------------------ */
/*  Sans base                                                                */
/* ------------------------------------------------------------------------ */

test("aucun code → site ; un code présent, même vide, → stand", () => {
  assert.equal(origineDeLOuverture(undefined, undefined), "site");
  assert.equal(origineDeLOuverture("", undefined), "stand");
  assert.equal(origineDeLOuverture(undefined, ""), "stand");
  assert.equal(origineDeLOuverture("  ", undefined), "stand");
  assert.equal(origineDeLOuverture("K7M2QX", undefined), "stand");
  assert.equal(origineDeLOuverture(undefined, "K7M2QX"), "stand");
  assert.equal(origineDeLOuverture("FAUX", "K7M2QX"), "stand");
});

test("le frein laisse passer `max` passages par clé, puis refuse", () => {
  const depasse = frein(2, 60_000);
  assert.equal(depasse("a"), false);
  assert.equal(depasse("a"), false);
  assert.equal(depasse("a"), true);
  // Une autre adresse n'en pâtit pas.
  assert.equal(depasse("b"), false);
});

test("un code de stand présent mais vide est refusé (403), sans glisser vers le site", async () => {
  // standDuCode("") répond sans lire la base : ces refus tournent partout.
  const app = new Hono();
  mountRelaisPhotoRoutes(app);
  const parEntete = await app.request("/ia/relais", {
    method: "POST",
    headers: { "X-Salon-Code": "", "X-Forwarded-For": ipNeuve() },
  });
  assert.equal(parEntete.status, 403);
  const parParametre = await app.request("/ia/relais?code=", {
    method: "POST",
    headers: { "X-Forwarded-For": ipNeuve() },
  });
  assert.equal(parParametre.status, 403);
  const blanc = await app.request("/ia/relais", {
    method: "POST",
    headers: { "X-Salon-Code": "   ", "X-Forwarded-For": ipNeuve() },
  });
  assert.equal(blanc.status, 403);
});

/* ------------------------------------------------------------------------ */
/*  Sur la base locale                                                       */
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

type Ouverture = {
  code: string;
  jeton: string;
  chemin: string;
  adresse: string;
  expireA: string;
  resteSecondes: number;
  origine: "stand" | "site";
};

test(
  "site et stand : ouverture, origine, refus, plafond du site, dépôt, relève et confirmation",
  { skip: !baseLocale && "hors de la base locale du conteneur" },
  async () => {
    const { db, schema } = await import("../src/db/client.js");
    const { and, eq, gt, inArray, isNull, sql: raw } = await import("drizzle-orm");
    const { cheminDisque } = await import("../src/ia.js");
    const { ALPHABET } = await import("../src/salon.js");
    const relais = schema.aiPhotoRelays;

    const marque = `TEST-RELAIS-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
    // Un code de stand tiré au sort, et un autre qui n'existe sûrement pas.
    const tirer = () =>
      Array.from({ length: 6 }, () => ALPHABET[randomBytes(1)[0]! % ALPHABET.length]).join("");
    const codeStand = tirer();
    const codeFaux = tirer();
    const codesOuverts: string[] = [];
    let standId: number | null = null;
    let standFermeId: number | null = null;

    // Le plafond du site, réglé juste au-dessus de ce qui est déjà ouvert sur
    // cette base : trois relais « site » le remplissent.
    const [deja] = await db
      .select({ n: raw<number>`count(*)::int` })
      .from(relais)
      .where(and(isNull(relais.standId), gt(relais.expiresAt, new Date())));
    const plafondSite = (deja?.n ?? 0) + 3;
    const app = new Hono();
    mountRelaisPhotoRoutes(app, { plafondSite });

    const ouvrir = (entetes: Record<string, string> = {}, chemin = "/ia/relais") =>
      app.request(chemin, {
        method: "POST",
        headers: { "X-Forwarded-For": ipNeuve(), ...entetes },
      });
    const lu = async (res: Response) => {
      const corps = (await res.json()) as Ouverture;
      if (res.status === 201) codesOuverts.push(corps.code);
      return corps;
    };
    const ligneDu = async (code: string) =>
      (await db.select().from(relais).where(eq(relais.code, code)))[0];

    try {
      const [stand] = await db
        .insert(schema.stands)
        .values({ code: codeStand, nom: marque, ouvert: true, actif: false })
        .returning({ id: schema.stands.id });
      standId = stand!.id;
      const [ferme] = await db
        .insert(schema.stands)
        .values({ code: tirer(), nom: `${marque}-ferme`, ouvert: false, actif: false })
        .returning({ id: schema.stands.id, code: schema.stands.code });
      standFermeId = ferme!.id;

      // 1. Le site, sans code : 201, origine « site », stand_id nul.
      const resSite = await ouvrir();
      assert.equal(resSite.status, 201);
      const site = await lu(resSite);
      assert.equal(site.origine, "site");
      assert.match(site.code, /^[A-Z2-9]{6}$/);
      assert.equal(site.chemin, `/photo/${site.code}`);
      assert.ok(site.adresse.endsWith(site.chemin));
      assert.ok(site.jeton.length >= 40);
      assert.ok(site.resteSecondes > 14 * 60 && site.resteSecondes <= 15 * 60);
      assert.equal((await ligneDu(site.code))?.standId, null);

      // 2. La tablette, avec le code d'un stand ouvert (en-tête, ou ?code=) :
      //    201, origine « stand », rattaché au stand.
      const resStand = await ouvrir({ "X-Salon-Code": codeStand.toLowerCase() });
      assert.equal(resStand.status, 201);
      const tablette = await lu(resStand);
      assert.equal(tablette.origine, "stand");
      assert.equal((await ligneDu(tablette.code))?.standId, standId);
      const resParam = await ouvrir({}, `/ia/relais?code=${codeStand}`);
      assert.equal(resParam.status, 201);
      assert.equal((await lu(resParam)).origine, "stand");

      // 3. Un code faux, ou celui d'un stand fermé : 403, comme avant — et
      //    rien d'inscrit.
      const avant = await db.select({ n: raw<number>`count(*)::int` }).from(relais);
      assert.equal((await ouvrir({ "X-Salon-Code": codeFaux })).status, 403);
      assert.equal((await ouvrir({}, `/ia/relais?code=${codeFaux}`)).status, 403);
      assert.equal((await ouvrir({ "X-Salon-Code": ferme!.code })).status, 403);
      const apres = await db.select({ n: raw<number>`count(*)::int` }).from(relais);
      assert.equal(apres[0]!.n, avant[0]!.n);

      // 4. Le téléphone lit l'origine du code.
      const consulter = (code: string) =>
        app.request(`/ia/relais/${code.toLowerCase()}`, {
          headers: { "X-Forwarded-For": ipNeuve() },
        });
      const vuSite = await consulter(site.code);
      assert.equal(vuSite.status, 200);
      assert.deepEqual(
        { ...((await vuSite.json()) as Record<string, unknown>), resteSecondes: 0 },
        { resteSecondes: 0, envois: 0, origine: "site" },
      );
      const vuStand = await consulter(tablette.code);
      assert.equal(vuStand.status, 200);
      assert.equal(((await vuStand.json()) as { origine: string }).origine, "stand");

      // 5. Le dépôt d'une photo sur le relais du site, puis la relève par le
      //    jeton et la confirmation : comme au stand.
      const image = await sharp({
        create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 40, b: 60 } },
      })
        .png()
        .toBuffer();
      const formulaire = new FormData();
      formulaire.append("photo", new File([new Uint8Array(image)], "essai.png", { type: "image/png" }));
      const depot = await app.request(`/ia/relais/${site.code}/photo`, {
        method: "POST",
        body: formulaire,
        headers: { "X-Forwarded-For": ipNeuve() },
      });
      assert.equal(depot.status, 200, await depot.clone().text());
      assert.deepEqual(await depot.json(), { ok: true, envois: 1 });
      const deposee = (await ligneDu(site.code))!.photoPath;
      assert.ok(deposee?.startsWith("ia/relais-"));
      const fichier = cheminDisque(deposee)!;
      assert.ok(existsSync(fichier));

      const releve = await app.request("/ia/relais", {
        headers: { "X-Relais-Jeton": site.jeton, "X-Relais-Confirmation": "1" },
      });
      assert.equal(releve.status, 200);
      assert.equal(releve.headers.get("content-type"), "image/jpeg");
      assert.equal(releve.headers.get("x-relais-envoi"), "1");
      const recue = await sharp(Buffer.from(await releve.arrayBuffer())).metadata();
      assert.equal(recue.format, "jpeg");
      // Confirmée : la photo quitte le serveur, le code reste ouvert.
      const confirmation = await app.request("/ia/relais/recue", {
        method: "POST",
        headers: { "X-Relais-Jeton": site.jeton, "Content-Type": "application/json" },
        body: JSON.stringify({ envoi: 1 }),
      });
      assert.equal(confirmation.status, 200);
      assert.deepEqual(await confirmation.json(), { ok: true, autre: false });
      assert.equal((await ligneDu(site.code))!.photoPath, null);
      assert.equal(existsSync(fichier), false);
      const vide = await app.request("/ia/relais", { headers: { "X-Relais-Jeton": site.jeton } });
      assert.equal(vide.status, 204);

      // 6. Le plafond global du site : il reste deux places, la troisième
      //    demande est refusée (429, au format des autres freins). La
      //    tablette, elle, n'y est pas soumise.
      for (let i = 0; i < 2; i++) {
        const res = await ouvrir();
        assert.equal(res.status, 201);
        assert.equal((await lu(res)).origine, "site");
      }
      const refus = await ouvrir();
      assert.equal(refus.status, 429);
      const corpsRefus = (await refus.json()) as Record<string, unknown>;
      assert.deepEqual(Object.keys(corpsRefus), ["error"]);
      assert.equal(typeof corpsRefus.error, "string");
      const tabletteMalgre = await ouvrir({ "X-Salon-Code": codeStand });
      assert.equal(tabletteMalgre.status, 201);
      assert.equal((await lu(tabletteMalgre)).origine, "stand");
      // Un relais fermé libère sa place.
      const fermeture = await app.request("/ia/relais", {
        method: "DELETE",
        headers: { "X-Relais-Jeton": site.jeton },
      });
      assert.equal(fermeture.status, 200);
      const libere = await ouvrir();
      assert.equal(libere.status, 201);
      assert.equal((await lu(libere)).origine, "site");

      // 7. Un code expiré dit encore son origine (410).
      const expire = await consulter(site.code);
      assert.equal(expire.status, 410);
      assert.equal(((await expire.json()) as { origine: string }).origine, "site");

      // 8. Le frein du site, plus serré que celui des tablettes : une même
      //    adresse IP est arrêtée au septième code du site en dix minutes.
      //    Le plafond global est rendu large ici pour ne pas le confondre.
      const appFrein = new Hono();
      mountRelaisPhotoRoutes(appFrein, { plafondSite: 1_000_000 });
      const memeIp = ipNeuve();
      const statuts: number[] = [];
      for (let i = 0; i < 7; i++) {
        const res = await appFrein.request("/ia/relais", {
          method: "POST",
          headers: { "X-Forwarded-For": memeIp },
        });
        statuts.push(res.status);
        if (res.status === 201) await lu(res);
      }
      assert.deepEqual(statuts, [201, 201, 201, 201, 201, 201, 429]);
      // Chaque chemin n'use que son frein (relecture du 21/11) : la tablette
      // qui sort par la MÊME adresse ouvre toujours le sien.
      const tabletteMemeIp = await appFrein.request("/ia/relais", {
        method: "POST",
        headers: { "X-Forwarded-For": memeIp, "X-Salon-Code": codeStand },
      });
      assert.equal(tabletteMemeIp.status, 201);
      assert.equal((await lu(tabletteMemeIp)).origine, "stand");

      // 9. Une page d'un autre site ne peut pas ouvrir de relais « site ».
      const croise = await appFrein.request("/ia/relais", {
        method: "POST",
        headers: { "X-Forwarded-For": ipNeuve(), "Sec-Fetch-Site": "cross-site" },
      });
      assert.equal(croise.status, 403);
    } finally {
      // Tout ce que l'essai a créé : relais (et leurs photos), puis stands.
      if (codesOuverts.length) {
        const lignes = await db
          .select({ photoPath: relais.photoPath })
          .from(relais)
          .where(inArray(relais.code, codesOuverts));
        for (const l of lignes) {
          const chemin = cheminDisque(l.photoPath);
          if (chemin) await rm(chemin, { force: true });
        }
        await db.delete(relais).where(inArray(relais.code, codesOuverts));
      }
      for (const id of [standId, standFermeId])
        if (id !== null) await db.delete(schema.stands).where(eq(schema.stands.id, id));
      const restes = await db
        .select({ id: schema.stands.id })
        .from(schema.stands)
        .where(eq(schema.stands.nom, marque));
      assert.equal(restes.length, 0);
    }
  },
);
