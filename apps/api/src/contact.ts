/**
 * Le formulaire de contact du site.
 *
 * Jusqu'ici, une cliente qui voulait poser une question — « ma commande est
 * partie ? », « pouvez-vous changer le prénom ? » — n'avait aucun moyen
 * d'écrire à la boutique depuis le site. Il fallait connaître une adresse qui
 * n'était écrite nulle part.
 *
 * Ce fichier reçoit ce message et en fait DEUX courriers : un pour la
 * boutique, avec l'adresse de la personne en « répondre à » pour que la
 * réponse parte d'un simple bouton, et un accusé de réception pour la
 * personne, qui sait ainsi que son message est bien arrivé.
 *
 * Rien n'est écrit en base, et c'est voulu. Une table de messages serait une
 * deuxième boîte aux lettres à relever, en plus de la vraie, et le jour où
 * personne ne la relève les messages disparaissent en silence. Le courrier
 * suffit : il arrive là où la boutique regarde déjà.
 *
 * Contre les robots, deux garde-fous et pas de captcha — un captcha fait
 * renoncer de vraies clientes, ce qui coûte plus cher que le pourriel :
 *
 *   1. un champ piège, invisible à l'écran, que seul un robot remplit ;
 *   2. une limite par adresse d'appel, qui borne ce qu'une même machine peut
 *      envoyer en une heure.
 *
 * Les deux répondent « c'est envoyé » sans rien envoyer : un robot à qui l'on
 * dit qu'il a été repéré revient avec une autre méthode.
 */
import type { Context, Hono } from "hono";
import { envoyer, estConfigure, piedDeCourrier, type Courrier } from "./mail.js";
import {
  langueDuDestinataire,
  remplir,
  tc,
  type Langue,
} from "./courriels/index.js";
import { clientDeLaRequete } from "./comptes.js";

/* -------------------------------------------------------------------------- */
/*  Bornes de saisie                                                          */
/* -------------------------------------------------------------------------- */

const MAX_NOM = 100;
const MAX_EMAIL = 200;
const MAX_SUJET = 150;
const MAX_MESSAGE = 5_000;
const MAX_COMMANDE = 40;
/** En dessous, ce n'est pas un message : c'est un doigt qui a glissé. */
const MIN_MESSAGE = 10;

/**
 * Ce qu'une même adresse d'appel peut envoyer, et sur combien de temps.
 *
 * Cinq messages en une heure : personne n'écrit six fois à une boutique dans
 * l'après-midi, et un robot qui martèle le formulaire s'arrête au cinquième.
 * La fenêtre glisse par tranche, comme le compteur des connexions ratées du
 * back-office : c'est le même besoin, et deux mécanismes différents pour la
 * même chose finissent par diverger.
 */
const MESSAGES_MAX = 5;
const FENETRE_MS = 60 * 60 * 1000;

/**
 * L'adresse de la boutique, celle qui reçoit les messages.
 *
 * CONTACT_TO d'abord, puis les réglages de courrier déjà en place : la copie
 * de tous les envois, sinon l'expéditeur lui-même. Une boutique qui a réglé
 * son courrier n'a donc rien de plus à faire pour que le formulaire marche.
 */
function adresseBoutique(): string {
  const candidates = [
    process.env.CONTACT_TO,
    process.env.MAIL_BCC,
    process.env.MAIL_FROM,
  ];
  for (const brut of candidates) {
    const valeur = (brut ?? "").trim();
    if (!valeur) continue;
    // « Memory Line <a@b.fr> » → « a@b.fr » : Resend et la boîte d'essai
    // veulent une adresse seule dans le destinataire.
    const entreChevrons = valeur.match(/<([^>]+)>/);
    const adresse = (entreChevrons?.[1] ?? valeur).trim();
    if (adresse.includes("@")) return adresse;
  }
  // Mode d'essai sans aucun réglage : les courriers vont de toute façon dans
  // la boîte de test, où cette adresse ne sert qu'à s'y retrouver.
  return process.env.MAIL_TEST_URL ? "boutique@memoryline.test" : "";
}

/* -------------------------------------------------------------------------- */
/*  Limite par adresse d'appel                                                */
/* -------------------------------------------------------------------------- */

const envois = new Map<string, { compte: number; finFenetre: number }>();

/**
 * L'adresse d'où vient l'appel, telle qu'on peut la croire.
 *
 * Recopié de `clientIp` (apps/api/src/index.ts), où il n'est pas exporté.
 * Le raisonnement compte plus que le code : le proxy AJOUTE son entrée à
 * « X-Forwarded-For » sans effacer celle qui arrive, donc le PREMIER élément
 * est écrit par l'appelant et se change à chaque requête. Un compteur fondé
 * dessus ne se déclenche jamais. Le DERNIER, lui, a été posé par notre propre
 * proxy : c'est le seul qu'on ne puisse pas écrire soi-même.
 *
 * Si la lecture change là-bas, celle-ci doit suivre.
 */
function adresseAppelante(c: {
  req: { header: (k: string) => string | undefined };
}): string {
  const chaine = c.req.header("x-forwarded-for");
  if (chaine) {
    const morceaux = chaine
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    const dernier = morceaux[morceaux.length - 1];
    if (dernier) return dernier;
  }
  return c.req.header("x-real-ip") || "local";
}

/** Vrai quand cette adresse a déjà envoyé tout ce qu'elle pouvait. */
function tropDeMessages(cle: string): boolean {
  const compteur = envois.get(cle);
  return Boolean(
    compteur && compteur.finFenetre > Date.now() && compteur.compte >= MESSAGES_MAX,
  );
}

/** Compte un message de plus pour cette adresse. */
function noterEnvoi(cle: string): void {
  const maintenant = Date.now();
  // Ménage opportuniste : la table ne doit pas grossir indéfiniment sur un
  // serveur qui tourne des mois.
  if (envois.size > 500)
    for (const [k, v] of envois) if (v.finFenetre < maintenant) envois.delete(k);
  const compteur = envois.get(cle);
  if (!compteur || compteur.finFenetre < maintenant)
    envois.set(cle, { compte: 1, finFenetre: maintenant + FENETRE_MS });
  else compteur.compte += 1;
}

/* -------------------------------------------------------------------------- */
/*  Relecture de la saisie                                                    */
/* -------------------------------------------------------------------------- */

/** Une saisie refusée, avec la phrase à montrer à la personne. */
class SaisieRefusee extends Error {}

/** Texte nettoyé et borné. Les retours à la ligne survivent, le reste non. */
function texte(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/\r\n/g, "\n")
    // Les caractères de contrôle n'ont rien à faire dans un champ de
    // formulaire : ils servent à casser les en-têtes d'un courrier.
    .replace(/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

/** Le même, sur une seule ligne : un sujet ou un nom ne se plie pas. */
function ligne(v: unknown, max: number): string {
  return texte(v, max).replace(/\s*\n+\s*/g, " ");
}

/**
 * Une adresse électronique qui a une chance d'exister.
 *
 * Volontairement simple : la seule vérification qui vaille est l'accusé de
 * réception, qui n'arrivera pas si l'adresse est fausse. Ce qu'on refuse ici,
 * c'est une saisie qui n'est pas une adresse du tout, et surtout tout ce qui
 * ressemble à un retour à la ligne — de quoi ajouter un destinataire caché au
 * courrier de la boutique.
 */
function courriel(v: unknown): string {
  const brut = ligne(v, MAX_EMAIL);
  if (!brut)
    throw new SaisieRefusee(
      "Écrivez votre adresse électronique : sans elle, la boutique ne peut pas vous répondre.",
    );
  if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/i.test(brut))
    throw new SaisieRefusee(
      `« ${brut.slice(0, 60)} » ne ressemble pas à une adresse électronique. Vérifiez la frappe, par exemple prenom@exemple.fr.`,
    );
  return brut;
}

/** Le message reçu, une fois relu. */
interface MessageRecu {
  nom: string;
  email: string;
  sujet: string;
  message: string;
  commande: string;
  langue: string;
}

/** Les langues du site, pour dire à la boutique dans laquelle répondre. */
const NOM_LANGUE: Record<string, string> = {
  fr: "français",
  en: "anglais",
  de: "allemand",
  it: "italien",
  es: "espagnol",
};

function lireMessage(corps: Record<string, unknown>): MessageRecu {
  const nom = ligne(corps.nom, MAX_NOM);
  if (nom.length < 2)
    throw new SaisieRefusee(
      "Écrivez votre nom, pour que la boutique sache à qui elle répond.",
    );

  const email = courriel(corps.email);

  const sujet = ligne(corps.sujet, MAX_SUJET);
  if (sujet.length < 2)
    throw new SaisieRefusee(
      "Donnez un sujet à votre message, par exemple « Question sur ma commande ».",
    );

  const message = texte(corps.message, MAX_MESSAGE);
  if (message.length < MIN_MESSAGE)
    throw new SaisieRefusee(
      "Écrivez votre message : quelques mots de plus aideront la boutique à vous répondre utilement.",
    );

  const langueBrute = String(corps.langue ?? "fr").toLowerCase();

  return {
    nom,
    email,
    sujet,
    message,
    commande: ligne(corps.commande, MAX_COMMANDE),
    // Ses PROPRES clés seulement : « in » laissait passer « constructor » ou
    // « toString », hérités de tout objet, et la boutique aurait lu le code
    // d'une fonction à la place du nom d'une langue.
    langue: Object.prototype.hasOwnProperty.call(NOM_LANGUE, langueBrute)
      ? langueBrute
      : "fr",
  };
}

/* -------------------------------------------------------------------------- */
/*  Les deux courriers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Échappe ce qui part dans le HTML d'un courrier.
 *
 * Écrit ici plutôt qu'importé de mail.js, qui ne l'expose pas. Le message
 * vient d'un formulaire ouvert à tout internet : sans cela, une balise
 * recopiée dans le champ « message » s'exécuterait dans la messagerie de la
 * boutique.
 */
function h(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Le même, avec les retours à la ligne rendus visibles. */
function hLignes(v: unknown): string {
  return h(v).replace(/\n/g, "<br />");
}

/**
 * Le gabarit de ces deux courriers.
 *
 * Recopié de mail.ts, qui garde le sien pour lui : les deux se ressemblent
 * volontairement, pour qu'un accusé de réception ait l'air de venir de la même
 * boutique qu'une confirmation de commande. Si l'habillage change là-bas,
 * celui-ci ne suivra pas tout seul — c'est le prix de ne pas ouvrir un fichier
 * qu'un autre chantier tient. Le pied, lui, vient de mail.ts : il porte la
 * mention de TVA et sa traduction, qui ne doivent pas diverger d'un courrier à
 * l'autre.
 */
function gabarit(titre: string, contenu: string, langue: Langue = "fr"): string {
  const origine = (process.env.PUBLIC_ORIGIN ?? "").trim().replace(/\/+$/, "");
  const entete = /^https?:\/\//i.test(origine)
    ? `<img src="${origine}/logo-memory-line.png" width="150" height="67" alt="Memory Line" style="display:block;border:0;outline:none;text-decoration:none;height:auto;width:150px;max-width:150px;font-size:20px;letter-spacing:.6px;color:#121212" />`
    : `<div style="font-size:20px;letter-spacing:.6px">Memory Line</div>`;
  return `<!doctype html>
<html lang="${langue}"><body style="margin:0;background:#f3f3f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#121212">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f3;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">
        <tr><td style="padding:28px 32px 8px">${entete}</td></tr>
        <tr><td style="padding:0 32px 8px">
          <h1 style="font-size:22px;font-weight:400;letter-spacing:.6px;margin:12px 0">${h(titre)}</h1>
        </td></tr>
        <tr><td style="padding:0 32px 32px;font-size:15px;line-height:1.5">${contenu}</td></tr>
        <tr><td style="padding:16px 32px;background:#f3f3f3;font-size:12px;color:#5b5b54">
          ${piedDeCourrier(langue)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Une ligne « intitulé : valeur » du récapitulatif. */
function ligneInfo(intitule: string, valeur: string): string {
  return `<tr>
      <td style="padding:6px 12px 6px 0;color:#5b5b54;white-space:nowrap;vertical-align:top">${h(intitule)}</td>
      <td style="padding:6px 0;vertical-align:top">${hLignes(valeur)}</td>
    </tr>`;
}

/**
 * Le courrier que reçoit la boutique.
 *
 * `langueDuCompte` : la langue que la personne, connectée, a choisie pour ses
 * e-mails. Quand elle diffère de la page d'où elle écrit, c'est elle que la
 * boutique doit lire en premier : l'accusé de réception est déjà parti dans
 * cette langue-là, et une réponse dans celle de la page contredirait le choix
 * de la cliente. Sinon, rien ne change : la langue du site, comme avant.
 */
function courrierPourLaBoutique(
  m: MessageRecu,
  destinataire: string,
  langueDuCompte: Langue | null = null,
): Courrier {
  const autreLangue = langueDuCompte && langueDuCompte !== m.langue ? langueDuCompte : null;
  const infos = [
    ligneInfo("De", `${m.nom} <${m.email}>`),
    m.commande ? ligneInfo("Commande", m.commande) : "",
    autreLangue
      ? ligneInfo(
          "Langue de réponse",
          `${NOM_LANGUE[autreLangue]} — celle que la personne a choisie dans son compte pour ses e-mails ; elle écrivait depuis le site en ${NOM_LANGUE[m.langue]}`,
        )
      : m.langue === "fr"
        ? ""
        : ligneInfo(
            "Langue du site",
            `${NOM_LANGUE[m.langue]} — la personne lit le site dans cette langue`,
          ),
  ]
    .filter(Boolean)
    .join("\n");

  /**
   * Le bouton « Répondre à … ».
   *
   * Depuis le 8/11, mail.ts pose aussi l'en-tête « Reply-To » (repondreA,
   * plus bas) : « Répondre » part droit à la cliente. Le lien reste, pour
   * une messagerie qui l'ignorerait.
   */
  const sujetReponse = encodeURIComponent(`Re : ${m.sujet}`);
  const lienReponse = `mailto:${encodeURIComponent(m.email)}?subject=${sujetReponse}`;

  const contenu = `
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 20px;font-size:14px">${infos}</table>
    <div style="border-left:3px solid #e0ded8;padding-left:16px;white-space:pre-wrap">${hLignes(m.message)}</div>
    <p style="margin:24px 0 0;font-size:14px">
      <a href="${h(lienReponse)}" style="display:inline-block;background:#121212;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:999px">Répondre à ${h(m.nom)}</a>
    </p>
    <p style="margin:12px 0 0;font-size:13px;color:#5b5b54">
      Ce bouton écrit à ${h(m.email)}, comme le bouton « Répondre » de
      votre messagerie.
    </p>`;

  const enTete = [
    `De : ${m.nom} <${m.email}>`,
    m.commande ? `Commande : ${m.commande}` : "",
    autreLangue
      ? `Langue de réponse : ${NOM_LANGUE[autreLangue]} (choisie dans son compte ; site lu en ${NOM_LANGUE[m.langue]})`
      : m.langue === "fr"
        ? ""
        : `Langue du site : ${NOM_LANGUE[m.langue]}`,
  ].filter(Boolean);
  const texteSimple =
    `${enTete.join("\n")}\n\n${m.message}\n\n` +
    `— Répondez à ${m.email}, et non à ce courrier.\n`;

  return {
    to: destinataire,
    // « Répondre » part droit à la personne qui a écrit.
    repondreA: m.email,
    subject: `Message du site — ${m.sujet}`,
    html: gabarit(m.sujet, contenu),
    text: texteSimple,
  };
}

/**
 * Une phrase du dictionnaire, posée en HTML à l'intérieur d'un paragraphe
 * indenté : échappée, puis ses retours à la ligne rendus à l'indentation du
 * code (le dictionnaire les marque, voir courriels/fr.ts). Le navigateur les
 * lit comme des espaces ; ils ne servent qu'à ce que le courrier français
 * reste exactement celui d'avant.
 */
function phraseIndentee(texte: string, valeursHtml?: Record<string, string>): string {
  return remplir(h(texte), valeursHtml).replace(/\n/g, "\n      ");
}

/**
 * L'accusé de réception que reçoit la personne, dans `langue` : celle de son
 * compte si elle est connectée, sinon celle de la page d'où elle a écrit.
 */
function courrierAccuse(m: MessageRecu, langue: Langue = m.langue as Langue): Courrier {
  const t = tc(langue);
  const contenu = `
    <p style="margin:0 0 16px">${phraseIndentee(t("commun.bonjour"), { prenom: h(m.nom) })}</p>
    <p style="margin:0 0 16px">
      ${phraseIndentee(t("contact.recu"))}
    </p>
    <p style="margin:0 0 8px;color:#5b5b54;font-size:13px">${phraseIndentee(t("contact.rappel"))}</p>
    <div style="border-left:3px solid #e0ded8;padding-left:16px;white-space:pre-wrap">${hLignes(m.message)}</div>
    <p style="margin:24px 0 0;font-size:13px;color:#5b5b54">
      ${phraseIndentee(t("contact.inutile"))}
    </p>`;

  return {
    to: m.email,
    subject: t("contact.objet", { sujet: m.sujet }),
    html: gabarit(t("contact.titre"), contenu, langue),
    text:
      `${t("commun.bonjour", { prenom: m.nom })}\n\n` +
      `${t("contact.recu").replace(/\s*\n\s*/g, " ")}\n\n` +
      `${t("contact.rappel")}\n\n${m.message}\n`,
  };
}

/* -------------------------------------------------------------------------- */
/*  La route                                                                  */
/* -------------------------------------------------------------------------- */

export function mountContact(app: Hono): void {
  /**
   * Reçoit un message du formulaire de contact.
   *
   * Répond toujours en français : c'est la langue du back-office et du
   * courrier de la boutique (l'accusé de réception, lui, part dans la langue
   * de la personne). La page de contact, elle, est traduite — les
   * refus de saisie qu'elle sait prévoir (champ vide, adresse mal écrite) sont
   * écrits dans la langue du visiteur AVANT d'arriver ici, et cette route ne
   * répond plus que sur ce que le navigateur ne pouvait pas voir.
   */
  app.post("/contact", async (c: Context) => {
    const corps = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    // 1. Le champ piège. Rempli, c'est un robot : on le remercie chaleureusement
    //    et on ne fait rien. Lui dire qu'il a été repéré lui apprendrait à ne
    //    plus remplir ce champ la prochaine fois.
    if (String(corps.societe ?? "").trim()) {
      console.warn("[contact] champ piège rempli — message ignoré");
      return c.json({ ok: true });
    }

    const adresse = adresseAppelante(c);

    // 2. La limite par adresse d'appel, AVANT la relecture : un robot qui
    //    martèle le formulaire ne doit rien coûter de plus qu'une lecture de
    //    table.
    if (tropDeMessages(adresse))
      return c.json(
        {
          error:
            "Vous avez déjà envoyé plusieurs messages. Laissez-nous le temps d'y répondre, puis réessayez dans une heure.",
        },
        429,
      );

    let message: MessageRecu;
    try {
      message = lireMessage(corps);
    } catch (erreur) {
      if (erreur instanceof SaisieRefusee)
        return c.json({ error: erreur.message }, 400);
      console.error("[contact] saisie illisible", erreur);
      return c.json(
        { error: "Votre message n'a pas pu être lu. Réessayez." },
        400,
      );
    }

    const destinataire = adresseBoutique();
    if (!estConfigure() || !destinataire) {
      // Rien n'est perdu du côté de la cliente : elle voit un refus et non un
      // faux « c'est envoyé » qui lui ferait attendre une réponse pour rien.
      console.error(
        "[contact] envoi impossible : courrier non configuré (RESEND_API_KEY / MAIL_FROM / CONTACT_TO)",
      );
      return c.json(
        {
          error:
            "Le formulaire ne peut pas envoyer de message pour le moment. Réessayez plus tard.",
        },
        503,
      );
    }

    // 3. Compté AVANT l'envoi : un envoi qui échoue a quand même occupé le
    //    serveur, et le compteur n'est pas une punition, c'est un frein.
    noterEnvoi(adresse);

    // La langue dans laquelle écrire à la personne : celle de son compte quand
    // elle est connectée — le site recopie son cookie de session —, sinon
    // celle de la page. Une session illisible ne doit rien empêcher : on
    // retombe alors sur la page. Lue AVANT le courrier de la boutique, qui la
    // signale : sa réponse doit partir dans la même langue que l'accusé.
    const connecte = await clientDeLaRequete(c).catch(() => null);
    const langueAccuse = langueDuDestinataire({
      compte: connecte?.langue,
      commande: message.langue,
    });

    const partiPourLaBoutique = await envoyer(
      courrierPourLaBoutique(message, destinataire, langueAccuse),
    );
    if (!partiPourLaBoutique)
      return c.json(
        {
          error:
            "Votre message n'a pas pu être transmis. Réessayez dans quelques minutes.",
        },
        502,
      );

    // L'accusé de réception vient en second, et son échec ne fait pas échouer
    // la demande : le message EST arrivé à la boutique, dire le contraire
    // ferait recommencer la personne pour rien.
    const partiEnAccuse = await envoyer(courrierAccuse(message, langueAccuse));
    if (!partiEnAccuse)
      console.warn(
        "[contact] accusé de réception non parti vers",
        message.email,
      );

    return c.json({ ok: true, accuse: partiEnAccuse });
  });
}
