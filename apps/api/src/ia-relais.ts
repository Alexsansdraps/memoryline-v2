/**
 * Le relais de photo du stand : du téléphone du client à la tablette.
 *
 * Au marché de Noël, l'affiche tirée d'une photo se vend sur la tablette du
 * stand — mais la photo, elle, est dans le téléphone du client. La tablette
 * affiche donc un code (un QR et une adresse courte, /photo/K7M2QX), le client
 * y envoie sa photo depuis son téléphone, et la tablette la récupère toute
 * seule, comme si elle avait été choisie sur place.
 *
 * TROIS ACTEURS, TROIS DROITS DIFFÉRENTS :
 *
 *   - OUVRIR un relais demande le code d'un stand OUVERT, le même que celui
 *     qui enregistre les ventes (salon.ts). Sans lui, n'importe quel visiteur
 *     du site pourrait se fabriquer des boîtes de dépôt sur notre disque.
 *   - DÉPOSER une photo se fait avec le seul code court : c'est tout l'intérêt,
 *     le client le scanne ou le tape. Ce code ne permet QUE d'envoyer, jamais
 *     de voir ce qui a été envoyé. D'où les freins par adresse IP, le poids
 *     borné et la photo ré-encodée, exactement comme sur la boutique.
 *   - RÉCUPÉRER la photo exige le jeton long remis à la tablette à
 *     l'ouverture, qui ne s'affiche nulle part. Un code court deviné ou
 *     aperçu par-dessus l'épaule ne donne accès au visage de personne.
 *
 * La photo d'un client est une donnée personnelle, et c'est souvent un
 * visage : elle quitte le serveur dès que la tablette a CONFIRMÉ l'avoir
 * reçue, et au plus tard à l'expiration du code. Pas au moment où elle part :
 * une coupure du wifi pendant le transfert la perdait alors sans que personne
 * le sache. Le ménage passe toutes les minutes, et la purge des photos de
 * visiteurs (ia.ts, toutes les heures) rattrape ce qui aurait pu lui
 * échapper.
 *
 * Les sessions vivent EN BASE (table ia_relais_photo) : l'API redémarre à
 * chaque mise en ligne, et un relais tenu en mémoire se perdrait entre le
 * moment où la tablette montre le code et celui où le client envoie sa photo.
 * Les freins par IP, eux, restent en mémoire, comme ceux de /ia/generer : les
 * perdre à un redémarrage ne coûte rien.
 */
import type { Context, Hono, Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, asc, eq, gt, isNotNull, lt, lte, sql as raw } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, schema } from "./db/client.js";
import {
  IA_DIR,
  PHOTO_MAX_OCTETS,
  PREFIXE_RELAIS,
  balayerPhotosRelayees,
  cheminDisque,
  ipDeLaRequete,
  normaliserPhoto,
} from "./ia.js";
import { ALPHABET, codeFourni, nouveauCode, standDuCode } from "./salon.js";

const relais = schema.aiPhotoRelays;

/**
 * Un quart d'heure : le temps de sortir son téléphone, de retrouver la photo
 * dans ses albums et de l'envoyer, même sur le réseau saturé d'un marché.
 * Au-delà, le code affiché sur une tablette oubliée resterait une porte ouverte.
 */
const DUREE_MS = 15 * 60_000;

/**
 * Une heure après son expiration, la ligne disparaît. Jusque-là, elle permet
 * de dire au téléphone « ce code a expiré, demandez-en un autre » plutôt que
 * « code inconnu », qui laisse croire à une faute de frappe.
 */
const GARDE_APRES_EXPIRATION_MS = 60 * 60_000;

/**
 * Relais ouverts en même temps par un même stand. Deux tablettes, une
 * vendeuse qui redemande un code : cinq suffisent. Au-delà, les plus anciens
 * sont fermés — un code de stand qui aurait fuité ne sert pas à remplir le
 * disque.
 */
const RELAIS_PAR_STAND = 5;

/**
 * Photos acceptées sur un même code. Se tromper de photo, puis d'une autre
 * encore, arrive ; en envoyer dix de suite, non.
 */
const ENVOIS_PAR_RELAIS = 10;

/** L'adresse publique du site, comme dans les courriers (courriers.ts). */
const ORIGINE =
  (process.env.PUBLIC_ORIGIN ?? "").replace(/\/+$/, "") || "http://localhost:8080";

/* -------------------------------------------------------------------------- */
/*  Freins par adresse IP                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Un frein simple : au plus `max` passages par `fenetreMs` pour une même
 * clé, en mémoire (un seul process API, comme l'anti-bruteforce du login).
 *
 * Les seuils sont larges pour une personne — un client envoie une photo, deux
 * s'il s'est trompé — et étroits pour un script. Au marché, plusieurs
 * téléphones peuvent partager la même adresse IP chez leur opérateur : c'est
 * pour eux que les seuils ne descendent pas plus bas.
 */
function frein(max: number, fenetreMs: number) {
  const passages = new Map<string, number[]>();
  return (cle: string): boolean => {
    const maintenant = Date.now();
    const recents = (passages.get(cle) ?? []).filter((t) => maintenant - t < fenetreMs);
    recents.push(maintenant);
    passages.set(cle, recents);
    // La Map ne doit pas grandir sans fin : on la vide des clés inactives.
    if (passages.size > 5000)
      for (const [k, v] of passages)
        if (!v.some((t) => maintenant - t < fenetreMs)) passages.delete(k);
    return recents.length > max;
  };
}

/** Ouvertures de relais : une tablette en demande une par client. */
const ouverturesDepassees = frein(20, 10 * 60_000);
/**
 * Consultations d'un code par le téléphone. C'est aussi ce qui rend vaine
 * toute tentative de deviner un code : trente essais sur un milliard de codes
 * possibles, toutes les cinq minutes.
 */
const consultationsDepassees = frein(30, 5 * 60_000);
/** Envois de photo : le plus coûteux (décodage, ré-encodage), le plus serré. */
const envoisDepasses = frein(10, 10 * 60_000);

/* -------------------------------------------------------------------------- */
/*  Outils                                                                    */
/* -------------------------------------------------------------------------- */

/** Empreinte du jeton de la tablette : la base ne garde jamais le jeton. */
function empreinte(jeton: string): string {
  return createHash("sha256").update(jeton).digest("hex");
}

/**
 * Le code court tel qu'il a été tapé, remis au propre — ou null s'il ne peut
 * pas en être un. Majuscules : « k7m2qx » tapé sur un téléphone est le même
 * code. Un code impossible (lettre ambiguë, mauvaise longueur) ne coûte
 * aucune requête en base.
 */
function codePropre(brut: string | undefined): string | null {
  const code = String(brut ?? "").trim().toUpperCase();
  return code.length === 6 && [...code].every((ch) => ALPHABET.includes(ch))
    ? code
    : null;
}

/** Secondes restantes avant l'expiration, jamais négatives. */
function resteSecondes(expireA: Date): number {
  return Math.max(0, Math.round((expireA.getTime() - Date.now()) / 1000));
}

async function effacerFichier(relatif: string | null | undefined): Promise<void> {
  const chemin = cheminDisque(relatif);
  if (!chemin) return;
  try {
    await rm(chemin, { force: true });
  } catch (e) {
    console.error("[relais photo] suppression impossible de " + relatif + " :", e);
  }
}

/** Le relais de la tablette qui présente ce jeton. */
async function relaisDuJeton(c: Context) {
  const jeton = String(c.req.header("x-relais-jeton") ?? "").trim();
  if (!jeton) return undefined;
  const [ligne] = await db
    .select()
    .from(relais)
    .where(eq(relais.jetonHash, empreinte(jeton)));
  return ligne;
}

/**
 * Ferme un relais : la photo en attente est effacée, et le code expire tout
 * de suite. La ligne reste jusqu'au ménage, pour que le téléphone lise
 * « code expiré » et non « code inconnu ».
 */
async function fermerRelais(ligne: { id: number; photoPath: string | null }): Promise<void> {
  await db
    .update(relais)
    .set({ photoPath: null, expiresAt: raw`least(${relais.expiresAt}, now())` })
    .where(eq(relais.id, ligne.id));
  await effacerFichier(ligne.photoPath);
}

/**
 * Le ménage : photos des codes expirés effacées, lignes anciennes
 * supprimées, puis tout fichier « relais-* » plus vieux qu'une session —
 * qu'un arrêt de l'API au mauvais moment aurait laissé derrière lui. C'est
 * aussi le filet d'une confirmation de la tablette perdue en route : la photo
 * ne survit pas à son code.
 *
 * Ne lève jamais : c'est un travailleur de fond, une erreur ici ne doit pas
 * emporter sa minuterie.
 */
export async function menageDuRelais(): Promise<void> {
  try {
    const echus = await db
      .select({ id: relais.id, photoPath: relais.photoPath })
      .from(relais)
      .where(and(lte(relais.expiresAt, new Date()), isNotNull(relais.photoPath)));
    for (const ligne of echus) {
      await db
        .update(relais)
        .set({ photoPath: null })
        .where(and(eq(relais.id, ligne.id), eq(relais.photoPath, ligne.photoPath!)));
      await effacerFichier(ligne.photoPath);
    }
    await db
      .delete(relais)
      .where(lt(relais.expiresAt, new Date(Date.now() - GARDE_APRES_EXPIRATION_MS)));
    // Cinq minutes de marge au-delà d'une session : une photo déposée à la
    // dernière seconde d'un code n'est pas effacée sous le nez de la tablette.
    await balayerPhotosRelayees(DUREE_MS + 5 * 60_000);
  } catch (e) {
    console.error("[relais photo] ménage interrompu :", e);
  }
}

let minuterie: ReturnType<typeof setInterval> | null = null;

/**
 * Le ménage tourne une fois au démarrage — ce qu'un arrêt a pu laisser —,
 * puis toutes les minutes : une photo ne survit donc guère plus d'une minute
 * à son code. `unref()` évite que la minuterie retienne le processus au
 * moment de l'arrêter.
 */
export function demarrerMenageRelais(): void {
  if (minuterie) return;
  void menageDuRelais();
  minuterie = setInterval(() => void menageDuRelais(), 60_000);
  minuterie.unref?.();
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                    */
/* -------------------------------------------------------------------------- */

export function mountRelaisPhotoRoutes(app: Hono): void {
  /* ------------------------------ tablette ------------------------------ */

  /**
   * Ouvre un relais. En-tête X-Salon-Code : le code d'un stand ouvert.
   *
   * Renvoie le code court, l'adresse à ouvrir sur le téléphone, le jeton de
   * la tablette et la durée de validité. `resteSecondes` plutôt qu'une heure
   * d'expiration seule : l'horloge d'une tablette n'est pas toujours à
   * l'heure, un compte à rebours ne dépend pas d'elle.
   */
  app.post("/ia/relais", async (c) => {
    if (ouverturesDepassees(ipDeLaRequete(c)))
      return c.json({ error: "Trop de codes demandés d'affilée. Patientez quelques minutes." }, 429);

    const stand = await standDuCode(codeFourni(c));
    if (!stand) return c.json({ error: "Code du stand incorrect." }, 403);
    if (!stand.ouvert) return c.json({ error: "Le stand est fermé." }, 403);

    // Les plus anciens relais encore valables de ce stand sont fermés au-delà
    // du plafond : c'est le plus récent que la vendeuse montre au client.
    const ouverts = await db
      .select({ id: relais.id, photoPath: relais.photoPath })
      .from(relais)
      .where(and(eq(relais.standId, stand.id), gt(relais.expiresAt, new Date())))
      .orderBy(asc(relais.createdAt));
    for (const vieux of ouverts.slice(0, Math.max(0, ouverts.length - (RELAIS_PAR_STAND - 1))))
      await fermerRelais(vieux);

    const jeton = randomBytes(32).toString("base64url");
    const expireA = new Date(Date.now() + DUREE_MS);
    // Un code déjà pris est retiré au sort : un milliard de possibilités pour
    // quelques codes en vie, la boucle ne fait jamais qu'un tour.
    for (let essai = 0; essai < 12; essai++) {
      const code = nouveauCode();
      const [ligne] = await db
        .insert(relais)
        .values({
          code,
          jetonHash: empreinte(jeton),
          standId: stand.id,
          expiresAt: expireA,
        })
        .onConflictDoNothing()
        .returning({ id: relais.id });
      if (!ligne) continue;
      const chemin = `/photo/${code}`;
      return c.json(
        {
          code,
          jeton,
          chemin,
          // L'adresse telle que l'API la connaît. La tablette lui préfère la
          // sienne (le site qu'elle affiche) : c'est celle que le téléphone
          // est sûr de joindre, tunnel de test compris.
          adresse: `${ORIGINE}${chemin}`,
          expireA: expireA.toISOString(),
          resteSecondes: resteSecondes(expireA),
        },
        201,
      );
    }
    return c.json({ error: "Impossible de tirer un code libre. Réessayez." }, 500);
  });

  /**
   * La tablette vient chercher la photo. En-tête X-Relais-Jeton.
   *
   * 204 tant que rien n'est arrivé, la photo en JPEG quand elle est là, 410
   * quand le code a expiré. La photo RESTE sur le serveur après être partie :
   * elle n'en est effacée que lorsque la tablette confirme l'avoir reçue
   * entière (POST /ia/relais/recue). Une réponse perdue en route — le wifi
   * d'un marché coupe sans prévenir — est ainsi resservie au passage suivant,
   * au lieu d'emporter la photo avec elle.
   *
   * X-Relais-Envoi numérote la photo servie : c'est ce numéro que la tablette
   * confirme, pour qu'une confirmation n'efface jamais une photo plus récente
   * que celle qu'elle a reçue. Le temps restant voyage dans X-Relais-Reste,
   * pour que le compte à rebours de la tablette ne dérive pas.
   *
   * Seule une tablette qui ANNONCE sa confirmation (X-Relais-Confirmation: 1)
   * voit la photo rester après l'envoi. Les autres la reçoivent à l'ancienne,
   * effacée au moment où elle part : une page ouverte avant la mise en ligne
   * de la confirmation garde son ancien code tant qu'on ne la recharge pas.
   * Resservie à chaque passage, un quart d'heure durant, la même photo y
   * repartait chaque fois vers /ia/photo — autant de copies du visage sur le
   * disque — et l'aperçu repartait de zéro toutes les secondes et demie.
   */
  app.get("/ia/relais", async (c) => {
    const ligne = await relaisDuJeton(c);
    if (!ligne) return c.json({ error: "Relais inconnu." }, 404);
    if (ligne.expiresAt.getTime() <= Date.now()) {
      await fermerRelais(ligne);
      return c.json({ error: "Ce code a expiré." }, 410);
    }
    const entetes = {
      "Cache-Control": "private, no-store",
      "X-Relais-Reste": String(resteSecondes(ligne.expiresAt)),
    };
    const chemin = cheminDisque(ligne.photoPath);
    if (!chemin) return c.body(null, 204, entetes);

    let donnees: Buffer;
    try {
      donnees = await readFile(chemin);
    } catch {
      // Remplacée par une photo plus récente pendant qu'on la lisait : la
      // suivante sera servie au prochain passage de la tablette.
      return c.body(null, 204, entetes);
    }
    if (c.req.header("X-Relais-Confirmation") !== "1") {
      // La condition sur le chemin compte : si le téléphone a déposé une
      // autre photo entre-temps, c'est elle qui reste en attente, pas un vide.
      await db
        .update(relais)
        .set({ photoPath: null })
        .where(and(eq(relais.id, ligne.id), eq(relais.photoPath, ligne.photoPath!)));
      await effacerFichier(ligne.photoPath);
    }
    return c.body(new Uint8Array(donnees), 200, {
      ...entetes,
      "Content-Type": "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      "X-Relais-Envoi": String(ligne.envois),
    });
  });

  /**
   * La tablette confirme avoir reçu la photo n° `envoi` (corps JSON).
   * En-tête X-Relais-Jeton.
   *
   * La photo est alors effacée du serveur — seulement si c'est TOUJOURS
   * celle-là qui attend : si le téléphone en a déposé une autre entre-temps,
   * c'est elle qui compte, et la réponse le dit (`autre: true`) pour que la
   * tablette repasse la chercher au lieu de s'arrêter là.
   *
   * Le code, lui, reste ouvert jusqu'à son échéance : le client qui s'est
   * trompé de photo en renvoie une autre depuis la même page, et la tablette
   * la reçoit quand la vendeuse le lui demande.
   */
  app.post("/ia/relais/recue", async (c) => {
    const ligne = await relaisDuJeton(c);
    if (!ligne) return c.json({ error: "Relais inconnu." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const envoi = Number(b.envoi);
    if (!Number.isInteger(envoi) || envoi < 1)
      return c.json({ error: "Numéro de photo invalide." }, 400);

    // Sous le verrou de la ligne, comme le dépôt : une photo qui arriverait à
    // cet instant attend que la confirmation soit tranchée, et ne peut pas
    // être effacée à la place de celle-ci.
    const { effacee, autre } = await db.transaction(async (tx) => {
      const [verrou] = await tx
        .select({ envois: relais.envois, photoPath: relais.photoPath })
        .from(relais)
        .where(eq(relais.id, ligne.id))
        .for("update");
      if (!verrou?.photoPath) return { effacee: null, autre: false };
      if (verrou.envois !== envoi) return { effacee: null, autre: true };
      await tx.update(relais).set({ photoPath: null }).where(eq(relais.id, ligne.id));
      return { effacee: verrou.photoPath, autre: false };
    });
    await effacerFichier(effacee);
    return c.json({ ok: true, autre });
  });

  /** La tablette renonce (Annuler, Nouveau code, création lancée). */
  app.delete("/ia/relais", async (c) => {
    const ligne = await relaisDuJeton(c);
    if (ligne) await fermerRelais(ligne);
    // Même réponse sans relais : fermer ce qui l'est déjà n'est pas une erreur.
    return c.json({ ok: true });
  });

  /* ------------------------------ téléphone ----------------------------- */

  /**
   * Le téléphone vérifie le code avant de proposer l'envoi : un code expiré
   * doit se dire AVANT que le client ait cherché sa photo, pas après.
   */
  app.get("/ia/relais/:code", async (c) => {
    if (consultationsDepassees(ipDeLaRequete(c)))
      return c.json({ error: "Trop d'essais d'affilée. Patientez quelques minutes." }, 429);
    const code = codePropre(c.req.param("code"));
    if (!code) return c.json({ error: "Code inconnu." }, 404);
    const [ligne] = await db.select().from(relais).where(eq(relais.code, code));
    if (!ligne) return c.json({ error: "Code inconnu." }, 404);
    if (ligne.expiresAt.getTime() <= Date.now())
      return c.json({ error: "Ce code a expiré." }, 410);
    return c.json(
      { resteSecondes: resteSecondes(ligne.expiresAt), envois: ligne.envois },
      200,
      { "Cache-Control": "no-store" },
    );
  });

  /**
   * Le téléphone dépose sa photo (multipart, champ « photo »).
   *
   * Aucun compte, aucun jeton : le code court suffit, c'est la promesse faite
   * au client. En échange, tout ce qui peut l'être est borné — le rythme par
   * IP AVANT de lire le corps, le poids pendant qu'on le lit, le nombre de
   * photos par code — et la photo est décodée puis ré-encodée par sharp comme
   * sur la boutique : ce qui arrive sur le disque est un JPEG propre, sans
   * rien de ce que portait le fichier d'origine, position GPS comprise.
   *
   * Une nouvelle photo REMPLACE celle que la tablette n'aurait pas encore
   * reçue : le client qui s'est trompé renvoie la bonne, c'est elle qui compte.
   */
  app.post(
    "/ia/relais/:code/photo",
    async (c: Context, next: Next) => {
      if (envoisDepasses(ipDeLaRequete(c)))
        return c.json({ error: "Trop d'envois d'affilée. Patientez quelques minutes." }, 429);
      await next();
    },
    // Le poids est tenu PENDANT la lecture : une annonce mensongère, ou pas
    // d'annonce du tout, ne fait pas entrer 200 Mo en mémoire.
    bodyLimit({
      maxSize: PHOTO_MAX_OCTETS + 64 * 1024,
      onError: (c) => c.json({ error: "Photo trop lourde (12 Mo maximum)" }, 413),
    }),
    async (c) => {
      const code = codePropre(c.req.param("code"));
      if (!code) return c.json({ error: "Code inconnu." }, 404);
      const [ligne] = await db.select().from(relais).where(eq(relais.code, code));
      if (!ligne) return c.json({ error: "Code inconnu." }, 404);
      if (ligne.expiresAt.getTime() <= Date.now())
        return c.json({ error: "Ce code a expiré." }, 410);
      if (ligne.envois >= ENVOIS_PAR_RELAIS)
        return c.json(
          { error: "Trop de photos sur ce code : demandez-en un nouveau sur la tablette." },
          429,
        );

      const form = await c.req.formData().catch(() => null);
      const fichier = form?.get("photo") ?? form?.get("file");
      if (!(fichier instanceof File) || !fichier.size)
        return c.json({ error: "Aucune photo reçue (champ « photo »)" }, 400);
      if (fichier.size > PHOTO_MAX_OCTETS)
        return c.json({ error: "Photo trop lourde (12 Mo maximum)" }, 413);

      const photo = await normaliserPhoto(Buffer.from(await fichier.arrayBuffer()));
      if (!photo.ok) return c.json({ error: photo.erreur }, 415);

      const nom = `${PREFIXE_RELAIS}${randomUUID()}.jpg`;
      await writeFile(resolve(IA_DIR, nom), photo.donnees);
      // Le remplacement se fait SOUS LE VERROU de la ligne : la photo qu'on
      // remplace est lue au même instant que l'on écrit la nouvelle. Lue plus
      // haut, avant l'envoi, elle était la même pour deux envois simultanés
      // — et la photo du premier, écrasée par le second sans être effacée,
      // restait sur le disque sans que rien ne la désigne plus. Tout est
      // revérifié ici : la tablette a pu annuler, le code expirer, ou le
      // plafond d'envois être atteint pendant que la photo montait.
      const issue = await db.transaction(async (tx) => {
        const [verrou] = await tx
          .select({
            envois: relais.envois,
            photoPath: relais.photoPath,
            expiresAt: relais.expiresAt,
          })
          .from(relais)
          .where(eq(relais.id, ligne.id))
          .for("update");
        if (!verrou || verrou.expiresAt.getTime() <= Date.now())
          return { refus: "expire" as const };
        if (verrou.envois >= ENVOIS_PAR_RELAIS) return { refus: "trop" as const };
        const [pris] = await tx
          .update(relais)
          .set({
            photoPath: `ia/${nom}`,
            envois: raw`${relais.envois} + 1`,
            recueAt: new Date(),
          })
          .where(eq(relais.id, ligne.id))
          .returning({ envois: relais.envois });
        return { envois: pris!.envois, precedente: verrou.photoPath };
      });
      if ("refus" in issue) {
        await effacerFichier(`ia/${nom}`);
        return issue.refus === "expire"
          ? c.json({ error: "Ce code a expiré." }, 410)
          : c.json(
              { error: "Trop de photos sur ce code : demandez-en un nouveau sur la tablette." },
              429,
            );
      }
      // La photo remplacée, si la tablette ne l'avait pas encore reçue.
      await effacerFichier(issue.precedente);
      return c.json({ ok: true, envois: issue.envois });
    },
  );
}
