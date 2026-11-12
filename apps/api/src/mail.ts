/**
 * Envoi d'e-mails transactionnels (Resend), ou boîte aux lettres de test.
 *
 * Réglages, dans le `.env` de la racine :
 *   RESEND_API_KEY  : la clé d'API (« re_… »)
 *   MAIL_FROM       : l'expéditeur, ex. « Memory Line <commandes@memoryline.fr> »
 *   MAIL_BCC        : facultatif — une copie de chaque envoi pour la boutique
 *   MAIL_REPONSE    : facultatif — où arrivent les RÉPONSES des clients (voir
 *                     ADRESSE_DE_REPONSE) ; à défaut CONTACT_TO, puis
 *                     MAIL_BOUTIQUE
 *   MAIL_TEST_URL   : facultatif — adresse d'une boîte de test (Mailpit).
 *                     Renseignée, elle prend TOUT : aucun courrier ne part
 *                     vers un vrai destinataire. C'est le mode d'essai.
 *
 * Sans clé, `estConfigure()` répond faux et `envoyer()` ne fait rien d'autre
 * que le noter dans le journal : une commande ne doit JAMAIS échouer parce
 * que l'e-mail n'a pas pu partir. Le paiement est encaissé, l'affiche est
 * commandée — le courrier est un service en plus, pas une condition.
 */

import {
  mentionTva,
  prixDans,
  remplir,
  tc,
  type CleCourriel,
  type Langue,
} from "./courriels/index.js";

const CLE = (process.env.RESEND_API_KEY ?? "").trim();
const COPIE = (process.env.MAIL_BCC ?? "").trim();
/** Boîte d'essai : si elle est renseignée, elle remplace Resend. */
const BOITE_TEST = (process.env.MAIL_TEST_URL ?? "").trim().replace(/\/+$/, "");
/**
 * L'expéditeur. En mode d'essai il n'a pas à être un domaine vérifié : la
 * boîte de test accepte n'importe quelle adresse, et en afficher une parlante
 * aide à relire le courrier tel que le client le verra.
 */
const EXPEDITEUR =
  (process.env.MAIL_FROM ?? "").trim() ||
  (BOITE_TEST ? "Memory Line (essai) <boutique@memoryline.test>" : "");

/**
 * Où arrivent les réponses des clients (en-tête « Reply-To »).
 *
 * Question de la boutique (carte Trello du 8/11) : « si les gens répondent
 * au mail, ça arrive dans quelle boîte ? » Jusque-là, à l'expéditeur
 * (MAIL_FROM, une adresse « commandes@… » que personne ne relève
 * forcément). Désormais à la boîte de la boutique : MAIL_REPONSE si elle est
 * donnée, sinon celle qui reçoit déjà le formulaire de contact (CONTACT_TO),
 * sinon celle des avis de commande (MAIL_BOUTIQUE). Aucune des trois, ou la
 * même adresse que l'expéditeur : pas d'en-tête, comme avant.
 */
const ADRESSE_DE_REPONSE = (() => {
  for (const brut of [process.env.MAIL_REPONSE, process.env.CONTACT_TO, process.env.MAIL_BOUTIQUE]) {
    const v = (brut ?? "").trim();
    if (!v) continue;
    // Une liste « a@b.fr, c@d.fr » : la première suffit pour répondre.
    const adresse = adresseSeule(v.split(",")[0]!);
    if (adresse.includes("@"))
      return adresse.toLowerCase() === adresseSeule(EXPEDITEUR).toLowerCase() ? "" : adresse;
  }
  return "";
})();

/** L'adresse de réponse d'un courrier : la sienne, sinon celle de la boutique. */
function reponseA(courrier: Courrier): string {
  return (courrier.repondreA ?? "").trim() || ADRESSE_DE_REPONSE;
}

/*
 * UN SEUL INTERRUPTEUR POUR TOUTE LA BOUTIQUE (Alexandra, 9 novembre 2026 :
 * « tout renseigner, et que ça sache quand on est en test et en prod »).
 * L'interrupteur « La boutique encaisse » de BO › Réglages › Paiements décide
 * aussi des courriers : en essai, la boîte d'essai (Mailpit) les garde ; pour
 * de vrai, Resend les envoie. Le .env peut donc porter les deux à la fois —
 * MAIL_TEST_URL et RESEND_API_KEY + MAIL_FROM — sans qu'on ait à en retirer
 * une ligne le jour de l'ouverture. Tant que l'interrupteur n'a jamais été
 * touché, rien ne change : la boîte d'essai, si elle est là, passe devant.
 */

/** Ce que dit l'interrupteur : « reel », « essai », ou null (jamais touché, le .env décide). */
export type ModeBoutique = "reel" | "essai" | null;

/** Où part un courrier : la boîte d'essai, Resend, ou nulle part (rien de réglé). */
export type Aiguillage = "boite" | "resend" | "aucun";

/**
 * La décision, sans rien lire d'autre que ses arguments (tests/courriers-mode.test.ts).
 *
 * Pour de vrai, Resend d'abord ; s'il n'est pas prêt, la boîte d'essai garde
 * le courrier plutôt que de le perdre (le passage en réel est refusé tant que
 * Resend n'est pas prêt : cf. paiements-reglages.ts, bascule). En essai, ou
 * tant que l'interrupteur n'a jamais été touché : la boîte d'essai d'abord,
 * comme avant ; sans elle, Resend.
 */
export function aiguillageCourriers(o: {
  mode: ModeBoutique;
  boiteTest: boolean;
  resendPret: boolean;
}): Aiguillage {
  if (o.mode === "reel") return o.resendPret ? "resend" : o.boiteTest ? "boite" : "aucun";
  return o.boiteTest ? "boite" : o.resendPret ? "resend" : "aucun";
}

/** Resend peut-il envoyer pour de vrai : une clé ET un vrai expéditeur (MAIL_FROM) ? */
export function courriersReelsPrets(): boolean {
  return CLE.length > 0 && (process.env.MAIL_FROM ?? "").trim().length > 0;
}

/** Le dernier mode connu de l'interrupteur, et de quoi le relire. */
let modeConnu: ModeBoutique = null;
let lireMode: (() => Promise<ModeBoutique>) | null = null;

/**
 * Branché par paiements-reglages.ts : `noterModeBoutique` à chaque lecture de
 * la configuration (le mode est connu des fonctions synchrones ci-dessous),
 * `lire` pour qu'un envoi relise le mode juste avant de partir. Le module des
 * courriers ne dépend ainsi pas de celui des paiements.
 */
export function noterModeBoutique(mode: ModeBoutique, lire?: () => Promise<ModeBoutique>): void {
  modeConnu = mode;
  if (lire) lireMode = lire;
}

function aiguillage(): Aiguillage {
  return aiguillageCourriers({
    mode: modeConnu,
    boiteTest: BOITE_TEST.length > 0,
    resendPret: courriersReelsPrets(),
  });
}

/** Vrai quand on sait où envoyer : la boîte d'essai, ou Resend. */
export function estConfigure(): boolean {
  return aiguillage() !== "aucun";
}

/** Vrai quand les courriers vont dans la boîte d'essai, pas chez le client. */
export function estEnEssai(): boolean {
  return aiguillage() === "boite";
}

/**
 * Dépose un courrier dans la boîte d'essai. Mailpit expose la même chose
 * qu'un serveur d'envoi, mais en HTTP : on lui parle comme à Resend.
 */
async function deposerDansLaBoite(courrier: Courrier): Promise<boolean> {
  const res = await fetch(`${BOITE_TEST}/api/v1/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      From: { Email: adresseSeule(EXPEDITEUR), Name: nomSeul(EXPEDITEUR) },
      To: [{ Email: courrier.to }],
      ...(COPIE ? { Bcc: [COPIE] } : {}),
      // Un champ à part : la boîte d'essai refuse « Reply-To » parmi les
      // en-têtes libres (« cannot overwrite header »).
      ...(reponseA(courrier) ? { ReplyTo: [{ Email: reponseA(courrier) }] } : {}),
      Subject: courrier.subject,
      HTML: courrier.html,
      ...(courrier.text ? { Text: courrier.text } : {}),
      // Les en-têtes supplémentaires, une valeur par nom. Ils partaient
      // enveloppés dans un tableau, ce que la boîte d'essai refuse net
      // (« cannot unmarshal array into Go struct field ») : le courrier ne
      // partait pas du tout, et personne ne s'en était aperçu, faute d'envoi
      // qui s'en serve. Le premier — la relance de panier et son
      // « List-Unsubscribe » — l'a découvert.
      ...(courrier.entetes ? { Headers: courrier.entetes } : {}),
      ...(courrier.pieces?.length
        ? {
            Attachments: courrier.pieces.map((p) => ({
              Filename: p.nomFichier,
              Content: p.contenu,
              ...(p.type ? { ContentType: p.type } : {}),
            })),
          }
        : {}),
    }),
  });
  if (!res.ok) {
    console.error("[mail] boîte d'essai injoignable", res.status, await res.text());
    return false;
  }
  console.log("[mail] déposé dans la boîte d'essai :", courrier.subject);
  return true;
}

/** « Memory Line <a@b.fr> » → « a@b.fr ». */
function adresseSeule(v: string): string {
  const m = v.match(/<([^>]+)>/);
  return (m?.[1] ?? v).trim();
}

/** « Memory Line <a@b.fr> » → « Memory Line ». */
function nomSeul(v: string): string {
  const m = v.match(/^([^<]+)</);
  return m?.[1]?.trim() ?? "";
}

/**
 * Un fichier joint au courrier.
 *
 * `contenu` est le fichier lui-même, en base64 : c'est la seule forme que
 * Resend et la boîte d'essai acceptent l'un comme l'autre. On ne joint donc
 * jamais un chemin ni un lien — un lien vers la facture obligerait à ouvrir
 * une route publique, et la cliente doit pouvoir garder son document sans
 * dépendre de la boutique.
 */
export interface PieceJointe {
  nomFichier: string;
  /** Le fichier encodé en base64. */
  contenu: string;
  /** « application/pdf »… Facultatif : la messagerie devine sinon. */
  type?: string;
}

export interface Courrier {
  to: string;
  subject: string;
  html: string;
  /** Version texte, pour les clients qui n'affichent pas le HTML. */
  text?: string;
  /** Les fichiers joints. Seule la facture s'en sert aujourd'hui. */
  pieces?: PieceJointe[];
  /**
   * Où partira « Répondre » dans la messagerie du destinataire. Absente :
   * la boîte de la boutique (ADRESSE_DE_REPONSE). Le message d'un client
   * transmis à la boutique y met l'adresse du client.
   */
  repondreA?: string;
  /**
   * En-têtes supplémentaires. Sert au désabonnement en un clic de la lettre
   * d'information : Gmail et Outlook affichent alors un bouton
   * « Se désabonner » à côté de l'expéditeur, et s'en servent pour juger si
   * l'expéditeur est sérieux. Sans lui, la personne qui ne veut plus rien
   * recevoir n'a qu'un bouton sous la main, « courrier indésirable » — et
   * quelques clics de ceux-là font tomber l'adresse d'expédition entière.
   */
  entetes?: Record<string, string>;
}

/**
 * Envoie un e-mail. Ne lève jamais : l'appelant est un flux métier (paiement,
 * expédition) qui ne doit pas s'interrompre pour un problème de courrier.
 * Renvoie vrai si l'envoi est parti.
 */
export async function envoyer(courrier: Courrier): Promise<boolean> {
  // Le mode de l'instant : l'interrupteur a pu changer depuis la dernière lecture.
  if (lireMode) {
    try {
      modeConnu = await lireMode();
    } catch {
      // On garde le dernier connu.
    }
  }
  const voie = aiguillage();
  if (voie === "aucun") {
    console.warn(
      "[mail] non configuré (RESEND_API_KEY / MAIL_FROM) — courrier non envoyé :",
      courrier.subject,
    );
    return false;
  }
  try {
    // En mode d'essai, rien ne part : le courrier va dans la boîte de test.
    if (voie === "boite") return await deposerDansLaBoite(courrier);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EXPEDITEUR,
        to: [courrier.to],
        ...(COPIE ? { bcc: [COPIE] } : {}),
        ...(reponseA(courrier) ? { reply_to: reponseA(courrier) } : {}),
        subject: courrier.subject,
        html: courrier.html,
        ...(courrier.text ? { text: courrier.text } : {}),
        ...(courrier.entetes ? { headers: courrier.entetes } : {}),
        ...(courrier.pieces?.length
          ? {
              attachments: courrier.pieces.map((p) => ({
                filename: p.nomFichier,
                content: p.contenu,
                ...(p.type ? { content_type: p.type } : {}),
              })),
            }
          : {}),
      }),
    });
    if (!res.ok) {
      console.error("[mail] refus de Resend", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("[mail] envoi impossible", e);
    return false;
  }
}

/** Échappe le texte inséré dans le HTML d'un courrier. */
function h(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Montant en centimes → « 23,00 € », ou sa forme dans la langue du client
 * (« €23.00 »). Sans langue, le français : c'est celle des courriers à la
 * boutique.
 */
function prix(cents: number, langue: Langue = "fr"): string {
  return prixDans(langue, cents);
}

/**
 * Un texte du dictionnaire, prêt à poser dans le HTML du courrier.
 *
 * L'ordre compte, comme pour les textes de relance : on ÉCHAPPE d'abord la
 * phrase — une traduction peut contenir une esperluette ou des guillemets —,
 * et seulement ensuite on y place les valeurs, que l'appelant a déjà mises en
 * HTML (échappées, ou entourées de leur balise de gras).
 */
function texteHtml(
  langue: Langue,
  cle: CleCourriel,
  valeursHtml?: Record<string, string>,
): string {
  return remplir(h(tc(langue)(cle)), valeursHtml);
}

export interface LigneCourrier {
  titre: string;
  format?: string | null;
  cadre?: string | null;
  quantite: number;
  unitPriceCents: number;
  /**
   * L'image de l'affiche, en adresse ABSOLUE et publique.
   *
   * C'est l'aperçu RÉEL de la ligne — celui du compte client, rendu par le
   * moteur qui fabrique le fichier d'impression — et non le visuel de
   * catalogue : sur une affiche personnalisée, ce dernier montrerait la
   * boutique, sans le prénom ni les personnages choisis.
   *
   * Facultative : une messagerie qui ne peut pas la charger doit lire un
   * courrier complet quand même.
   */
  imageUrl?: string | null;
  /**
   * L'affiche est en paysage : sa vignette, à largeur égale, est deux fois
   * moins haute. Sert à la hauteur annoncée en attribut (relance de panier).
   */
  paysage?: boolean;
  /**
   * Vrai quand cet article ne peut plus être commandé : produit retiré de la
   * vente, ou stock épuisé. Le courrier le dit au lieu de faire cliquer vers
   * une impasse.
   */
  indisponible?: boolean;
}

/**
 * Gabarit commun : en-tête, contenu, pied. Volontairement sobre et en tableau
 * — les clients de messagerie ne savent toujours pas mettre en page autre
 * chose, et une mise en page qui casse fait plus de mal qu'une simple.
 */
/**
 * L'adresse publique du site (PUBLIC_ORIGIN), sans barre finale — ou null si
 * elle n'est pas réglée, ou pas sous la forme « https://… ».
 *
 * Sans elle, un courrier part SANS logo (le nom écrit à la place), sans les
 * vignettes des affiches, et avec des liens qui ne mènent pas au site. Rien
 * ne casse à l'écran : c'est exactement pourquoi ça peut durer des jours sans
 * que personne le voie. D'où l'alerte au démarrage ci-dessous, et le bandeau
 * de l'écran « Courriers » du back-office (courriers.ts).
 */
export function adressePublique(): string | null {
  const origine = (process.env.PUBLIC_ORIGIN ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(origine) ? origine : null;
}

if (!adressePublique()) {
  console.warn(
    "[courriers] PUBLIC_ORIGIN n'est pas définie : les courriers partent sans " +
      "logo ni vignettes, et leurs liens ne mènent pas au site. Renseignez " +
      "l'adresse publique du site (ex. https://memoryline.fr) dans .env.",
  );
}

/**
 * L'en-tête d'un courrier : le logo, ou le nom de la boutique à défaut.
 *
 * Une messagerie ne sait pas résoudre « /logo.png » ni joindre le réseau
 * interne de Docker : il faut une adresse absolue et publique. Sans
 * PUBLIC_ORIGIN, on écrit le nom plutôt que d'envoyer une image cassée.
 *
 * Le texte de remplacement porte le nom et sa mise en forme : une messagerie
 * qui bloque les images, ce qui est le cas par défaut chez beaucoup, affiche
 * alors « Memory Line » lisiblement au lieu d'un rectangle vide.
 */
function enteteMarque(): string {
  const origine = adressePublique();
  if (!origine)
    return `<div style="font-size:20px;letter-spacing:.6px">Memory Line</div>`;
  return `<img src="${origine}/logo-memory-line.png" width="150" height="67" alt="Memory Line" style="display:block;border:0;outline:none;text-decoration:none;height:auto;width:150px;max-width:150px;font-size:20px;letter-spacing:.6px;color:#121212" />`;
}

/**
 * Le pied de chaque courrier : la boutique, puis la mention de TVA.
 *
 * La mention reste écrite en français dans toutes les langues — c'est une
 * mention légale française —, et sa traduction vient dessous quand elle
 * existe (voir `mentionTva`). Exporté pour l'accusé de réception du formulaire
 * de contact, qui a son propre gabarit mais doit finir pareil.
 */
export function piedDeCourrier(langue: Langue = "fr"): string {
  const tva = mentionTva(langue);
  return `${h(tc(langue)("pied.signature"))}<br />
          ${h(tva.francaise)}${tva.traduction ? `<br />
          ${h(tva.traduction)}` : ""}`;
}

/**
 * `langue` pose l'attribut `lang` du document, qui suit celle du texte : un
 * lecteur d'écran lirait sinon une phrase allemande avec l'accent français.
 */
function gabarit(titre: string, contenu: string, langue: Langue = "fr"): string {
  return `<!doctype html>
<html lang="${langue}"><body style="margin:0;background:#f3f3f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#121212">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f3;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">
        <tr><td style="padding:28px 32px 8px">
          ${enteteMarque()}
        </td></tr>
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

/** Tableau des articles commandés. */
function tableauLignes(lignes: LigneCourrier[], langue: Langue = "fr"): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0">
    ${lignes
      .map(
        (l) => `<tr>
      ${
        // L'affiche, et pas seulement son titre : « CÔTE D'OPALE Plage FACE »
        // ne dit rien à qui a commandé trois affiches le même jour. Une
        // messagerie qui bloque les images laisse la cellule vide et le
        // courrier reste lisible — d'où l'`alt` vide et le fond gris.
        l.imageUrl
          ? `<td width="72" style="padding:10px 12px 10px 0;border-bottom:1px solid #eee;vertical-align:top">
        <img src="${h(l.imageUrl)}" width="64" height="90" alt="" style="display:block;border:0;width:64px;height:auto;max-width:64px;background:#f3f3f3" />
      </td>`
          : ""
      }
      <td style="padding:8px 0;border-bottom:1px solid #eee">
        <strong style="font-weight:500">${h(l.titre)}</strong><br />
        <span style="color:#5b5b54;font-size:13px">${texteHtml(langue, "lignes.format", { format: h(l.format ?? "A4") })}${
          l.cadre ? ` · ${h(l.cadre)}` : ""
        } · ×${l.quantite}</span>
      </td>
      <td align="right" style="padding:8px 0;border-bottom:1px solid #eee;white-space:nowrap">
        ${prix(l.unitPriceCents * l.quantite, langue)}
      </td>
    </tr>`,
      )
      .join("")}
  </table>`;
}

/**
 * Les articles, sans un seul montant.
 *
 * Le stand n'affiche aucun prix, du premier écran de la tablette jusqu'au
 * courrier : c'est la vendeuse qui les annonce, et un chiffre écrit ici la
 * contredirait après coup.
 */
function tableauLignesSansPrix(lignes: LigneCourrier[]): string {
  if (!lignes.length) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:20px 0;font-size:14px">
    ${lignes
      .map(
        (l) =>
          `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${h(l.titre)}${
            l.format ? ` — ${h(l.format)}` : ""
          }${l.cadre ? `, ${h(l.cadre)}` : ""}${
            l.quantite > 1 ? ` × ${l.quantite}` : ""
          }</td></tr>`,
      )
      .join("")}
  </table>`;
}

export interface ConfirmationCommande {
  numero: string;
  prenomClient: string;
  lignes: LigneCourrier[];
  sousTotalCents: number;
  remiseCents: number;
  codePromo?: string | null;
  portCents: number;
  totalCents: number;
  modeLivraison?: string | null;
  adresse?: string[] | null;
  /**
   * Pour un retrait sur place : le lieu où venir, tel que la cliente l'a lu
   * en commandant (lieux-retrait.ts). Il prend la place de l'adresse.
   */
  retrait?: LieuDuCourriel | null;
  /**
   * La langue du destinataire (voir `langueDuDestinataire`). Absente : le
   * français. Vaut pour tous les courriers destinés aux clients ci-dessous.
   */
  langue?: Langue;
}

/** Un lieu de retrait, découpé pour un courriel (voir `lignesDuLieu`). */
export interface LieuDuCourriel {
  nom: string;
  adresse: string[];
  description: string[];
}

/**
 * Le bloc « où retirer » d'un courriel : le nom en gras, l'adresse dessous,
 * puis le texte du lieu (horaires, accès) dans son propre paragraphe —
 * ligne à ligne, comme la boutique l'a écrit.
 */
function blocLieuHtml(langue: Langue, cle: CleCourriel, lieu: LieuDuCourriel): string {
  return `<p style="margin:20px 0 0;font-size:14px">${texteHtml(langue, cle)}<br /><strong style="font-weight:500">${h(lieu.nom)}</strong>${lieu.adresse
    .map((l) => `<br />${h(l)}`)
    .join("")}</p>${
    lieu.description.length
      ? `<p style="margin:8px 0 0;color:#5b5b54;font-size:14px">${lieu.description.map(h).join("<br />")}</p>`
      : ""
  }`;
}

/** Le même bloc, en texte brut. */
function blocLieuTexte(langue: Langue, cle: CleCourriel, lieu: LieuDuCourriel): string {
  return [
    tc(langue)(cle),
    lieu.nom,
    ...lieu.adresse,
    ...(lieu.description.length ? ["", ...lieu.description] : []),
  ].join("\n");
}

/** Confirmation envoyée au client dès que le paiement est encaissé. */
export function courrierConfirmation(d: ConfirmationCommande): Courrier {
  const langue = d.langue ?? "fr";
  const t = tc(langue);
  const totaux = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 0;color:#5b5b54">${texteHtml(langue, "confirmation.sousTotal")}</td><td align="right">${prix(d.sousTotalCents, langue)}</td></tr>
    ${
      d.remiseCents > 0
        ? `<tr><td style="padding:4px 0;color:#5b5b54">${texteHtml(langue, "confirmation.reduction")}${d.codePromo ? ` — ${h(d.codePromo)}` : ""}</td><td align="right">− ${prix(d.remiseCents, langue)}</td></tr>`
        : ""
    }
    <tr><td style="padding:4px 0;color:#5b5b54">${texteHtml(langue, "confirmation.livraison")}${d.modeLivraison ? ` — ${h(d.modeLivraison)}` : ""}</td><td align="right">${prix(d.portCents, langue)}</td></tr>
    <tr><td style="padding:10px 0 0;border-top:1px solid #eee"><strong style="font-weight:500">${texteHtml(langue, "confirmation.total")}</strong></td><td align="right" style="padding:10px 0 0;border-top:1px solid #eee"><strong style="font-weight:500">${prix(d.totalCents, langue)}</strong></td></tr>
  </table>`;

  const adresse =
    d.adresse && d.adresse.length
      ? `<p style="margin:20px 0 0;color:#5b5b54;font-size:14px">${texteHtml(langue, "confirmation.adresseLivraison")}<br />${d.adresse
          .filter(Boolean)
          .map(h)
          .join("<br />")}</p>`
      : "";
  const retrait = d.retrait ? blocLieuHtml(langue, "confirmation.retrait", d.retrait) : "";

  return {
    to: "",
    subject: t("confirmation.objet", { numero: d.numero }),
    html: gabarit(
      t("confirmation.titre", { prenom: d.prenomClient }),
      `<p style="margin:0 0 4px">${texteHtml(langue, "confirmation.intro", { numero: `<strong style="font-weight:500">${h(d.numero)}</strong>` })}</p>
       ${tableauLignes(d.lignes, langue)}
       ${totaux}
       ${adresse}
       ${retrait}
       <p style="margin:24px 0 0;color:#5b5b54;font-size:14px">${texteHtml(langue, "confirmation.question")}</p>`,
      langue,
    ),
    text: `${t("confirmation.titre", { prenom: d.prenomClient })}\n\n${t("confirmation.texte", { numero: d.numero, total: prix(d.totalCents, langue) })}${
      d.retrait ? `\n\n${blocLieuTexte(langue, "confirmation.retrait", d.retrait)}` : ""
    }\n\nMemory Line`,
  };
}

/** Avis interne : une commande vient d'arriver. */
export function courrierNouvelleCommande(d: {
  numero: string;
  client: string;
  totalCents: number;
  lignes: LigneCourrier[];
  /**
   * Pour un retrait sur place : le lieu choisi, en français. La boutique
   * sait ainsi d'un coup d'œil qu'il n'y a pas de colis à faire, et à quel
   * chalet préparer l'affiche.
   */
  retrait?: LieuDuCourriel | null;
}): Courrier {
  return {
    to: "",
    subject: `Nouvelle commande ${d.numero} — ${prix(d.totalCents)}`,
    html: gabarit(
      `Commande ${d.numero}`,
      `<p style="margin:0">De ${h(d.client)}, pour ${prix(d.totalCents)}.</p>
       ${tableauLignes(d.lignes)}
       ${d.retrait ? blocLieuHtml("fr", "confirmation.retrait", d.retrait) : ""}`,
    ),
  };
}

/**
 * Avis interne : quelqu'un vient de changer le mode des paiements
 * (BO › Réglages › Paiements).
 *
 * Passer en réel, ou en revenir, change ce que les clientes paient : la
 * boutique doit le savoir même si elle n'a pas fait le geste elle-même.
 */
export function courrierModePaiement(d: {
  /** « reel », « essai » ou « env » (les réglages du serveur décident). */
  mode: string;
  /** Le mode d'avant, dans les mêmes mots. */
  avant: string;
  /** L'adresse du compte qui a fait le changement, si on la connaît. */
  par: string | null;
  /** Le moment du changement. */
  le: Date;
}): Courrier {
  const nom = (m: string) =>
    m === "reel"
      ? "paiements réels"
      : m === "essai"
        ? "mode essai"
        : "réglages du serveur";
  const titre =
    d.mode === "reel"
      ? "La boutique est maintenant en production"
      : d.mode === "essai"
        ? "La boutique est passée en mode essai"
        : "Les réglages du serveur décident du mode des paiements";
  const effet =
    d.mode === "reel"
      ? "Les cartes et PayPal sont réellement débités. L'encadré « Boutique en mode essai » a disparu de la caisse."
      : d.mode === "essai"
        ? "Aucun paiement réel n'est possible : les clientes paient avec les clés d'essai. Les paiements réels déjà ouverts aboutiront quand même."
        : "Chaque prestataire suit de nouveau les réglages du serveur, comme avant l'écran Paiements.";
  const quand = d.le.toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "full",
    timeStyle: "short",
  });
  const qui = d.par ?? "un compte du back-office";
  const origine = adressePublique();
  const lien = origine ? `${origine}/bo/paiements` : null;
  const pasMoi =
    "Si ce changement ne vient pas de vous, ouvrez le back-office, Réglages › Paiements, et remettez le bon mode.";
  return {
    to: "",
    subject: `Paiements : ${nom(d.mode)} (avant : ${nom(d.avant)})`,
    html: gabarit(
      titre,
      `<p style="margin:0 0 12px">${h(effet)}</p>
       <p style="margin:0 0 12px">Changé par ${h(qui)}, le ${h(quand)}.<br />Avant : ${h(nom(d.avant))}. Maintenant : ${h(nom(d.mode))}.</p>
       <p style="margin:0">${h(pasMoi)}${lien ? `<br /><a href="${h(lien)}" style="color:#121212">${h(lien)}</a>` : ""}</p>`,
    ),
    text: `${titre}\n\n${effet}\n\nChangé par ${qui}, le ${quand}.\nAvant : ${nom(d.avant)}. Maintenant : ${nom(d.mode)}.\n\n${pasMoi}${lien ? `\n${lien}` : ""}\n\nMemory Line`,
  };
}

/**
 * Les articles du panier, avec leur vignette quand on en a une.
 *
 * Une image par ligne plutôt qu'une seule en tête du courrier : le panier
 * peut contenir deux affiches très différentes, et n'en montrer qu'une
 * laisserait croire que l'autre a disparu. La vignette a une taille FIXE en
 * attributs HTML et pas seulement en CSS — les vieilles messageries ignorent
 * le style et affichent alors l'image en pleine largeur, qui pousse le prix
 * hors de l'écran.
 *
 * 110 px de large, et non 64 comme sur les autres courriers : c'est l'aperçu
 * de l'affiche que la cliente a composée (relance-panier.ts), et c'est lui
 * qui donne envie de revenir. À 64 px, on ne lisait ni le prénom ni les
 * personnages (retour de Margaux du 22/10). L'aperçu fait 600 px de large :
 * il reste net sur un écran à haute densité. La hauteur suit l'affiche, A4
 * en portrait (110 × 156) ou en paysage (110 × 78) : une messagerie qui lit
 * les attributs sans le style déformerait sinon l'image.
 */
function tableauLignesAvecImage(lignes: LigneCourrier[], langue: Langue): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0">
    ${lignes
      .map(
        (l) => `<tr>
      ${
        l.imageUrl
          ? `<td width="122" style="padding:10px 12px 10px 0;border-bottom:1px solid #eee;vertical-align:top">
        <img src="${h(l.imageUrl)}" width="110" height="${l.paysage ? 78 : 156}" alt="" style="display:block;border:0;width:110px;height:auto;max-width:110px;background:#f3f3f3" />
      </td>`
          : ""
      }
      <td style="padding:10px 0;border-bottom:1px solid #eee;vertical-align:top">
        <strong style="font-weight:500">${h(l.titre)}</strong><br />
        <span style="color:#5b5b54;font-size:13px">${texteHtml(langue, "lignes.format", { format: h(l.format ?? "A4") })}${
          l.cadre ? ` · ${h(l.cadre)}` : ""
        } · ×${l.quantite}</span>${
          l.indisponible
            ? `<br /><span style="color:#8a5a2b;font-size:13px">${texteHtml(langue, "lignes.indisponible")}</span>`
            : ""
        }
      </td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid #eee;white-space:nowrap;vertical-align:top">
        ${prix(l.unitPriceCents * l.quantite, langue)}
      </td>
    </tr>`,
      )
      .join("")}
  </table>`;
}

/**
 * Relance d'un panier laissé en plan.
 *
 * Le lien de récupération porte un jeton propre à ce panier : il remet les
 * articles dans le navigateur, reprend le code de réduction déjà saisi et
 * emmène au tunnel. On ne renvoie donc PAS vers « /panier », qui, sur un
 * autre appareil ou après un vidage du navigateur, serait vide.
 *
 * `lienDesinscription` n'est renseigné que lorsque la boutique s'appuie sur
 * l'intérêt légitime plutôt que sur un consentement recueilli. Le RGPD
 * l'exige alors, et il ne suffit pas de l'écrire dans le pied de page : les
 * en-têtes `List-Unsubscribe` posent le bouton « Se désabonner » de Gmail et
 * d'Outlook, seul geste que la personne trouvera du premier coup. Sans lui,
 * elle a l'autre bouton sous la main — « courrier indésirable » — et quelques
 * clics de ceux-là suffisent à faire tomber l'adresse d'expédition entière.
 */
export function courrierPanierAbandonne(d: {
  prenomClient: string;
  lien: string;
  lignes: LigneCourrier[];
  totalCents: number;
  /** Code de réduction déjà saisi, repris par le lien de récupération. */
  codePromo?: string | null;
  /** Adresse de la page de désinscription. Absente = base légale du consentement. */
  lienDesinscription?: string | null;
  /**
   * Les textes réécrits par la boutique (voir `TextesRelance`). Absents, le
   * courrier est celui d'origine, à l'octet près : tant que la boutique n'a
   * rien changé, rien ne doit changer chez ses clientes.
   */
  textes?: TextesRelance | null;
  langue?: Langue;
}): Courrier {
  const langue = d.langue ?? "fr";
  const t = tc(langue);
  const manquants = d.lignes.filter((l) => l.indisponible);
  const avertissement = manquants.length
    ? `<p style="margin:0 0 4px;color:#8a5a2b;font-size:14px">${texteHtml(
        langue,
        manquants.length > 1 ? "panier.indispoPlusieurs" : "panier.indispoUne",
      )}</p>`
    : "";
  const promo = d.codePromo
    ? `<p style="margin:0 0 4px;color:#5b5b54;font-size:14px">${texteHtml(langue, "panier.promo", { code: `<strong style="font-weight:500">${h(d.codePromo)}</strong>` })}</p>`
    : "";
  const desinscription = d.lienDesinscription
    ? `<p style="margin:24px 0 0;color:#5b5b54;font-size:12px">${texteHtml(langue, "panier.desinscriptionRaison")}
        <a href="${h(d.lienDesinscription)}" style="color:#5b5b54">${texteHtml(langue, "panier.desinscriptionLien")}</a>.</p>`
    : "";

  /*
   * Ce que le code fabrique seul, quel que soit le texte : le panier (vignettes,
   * prix, total, articles manquants, code repris) et le bouton. Les mettre à
   * part sert les deux versions du courrier sans les dupliquer — et garantit
   * qu'un texte réécrit ne peut ni les retirer, ni les déformer.
   */
  const panier = `${tableauLignesAvecImage(d.lignes, langue)}
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
         <tr><td style="padding:4px 0"><strong style="font-weight:500">${texteHtml(langue, "panier.votrePanier")}</strong></td><td align="right"><strong style="font-weight:500">${prix(d.totalCents, langue)}</strong></td></tr>
       </table>
       ${avertissement}
       ${promo}`;
  const bouton = (libelle: string) =>
    `<p style="margin:20px 0"><a href="${h(d.lien)}" style="display:inline-block;background:#121212;color:#ffffff;padding:14px 28px;text-decoration:none">${h(libelle)}</a></p>`;
  // Le bouton « Se désabonner » des messageries. Les deux en-têtes vont
  // ensemble : sans le second, Gmail affiche un lien, pas le bouton.
  const entetes = d.lienDesinscription
    ? {
        entetes: {
          "List-Unsubscribe": `<${d.lienDesinscription}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }
    : {};

  if (d.textes) return courrierRelanceReecrit(d, d.textes, { panier, bouton, desinscription, entetes });

  // Le courrier d'origine dit les mots de la 1re relance par défaut : ce sont
  // les mêmes, et une seule clé par phrase évite de les traduire deux fois.
  return {
    to: "",
    subject: t("relance.1.objet"),
    html: gabarit(
      t("relance.1.accroche", { prenom: h(d.prenomClient) }),
      `<p style="margin:0">${texteHtml(langue, "relance.1.message")}</p>
       ${panier}
       ${bouton(t("relance.1.bouton"))}
       <p style="margin:0;color:#5b5b54;font-size:14px">${texteHtml(langue, "relance.1.conclusion")}</p>
       ${desinscription}`,
      langue,
    ),
    text:
      `${t("relance.1.accroche", { prenom: d.prenomClient })}\n\n` +
      `${t("panier.texteIntro")}\n` +
      lignesEnTexte(d.lignes, langue) +
      `\n${t("panier.texteTotal", { montant: prix(d.totalCents, langue) })}\n` +
      (d.codePromo ? `${t("panier.promo", { code: d.codePromo })}\n` : "") +
      `\n${t("commun.texteLien", { libelle: t("relance.1.bouton"), lien: d.lien })}\n` +
      (d.lienDesinscription
        ? `\n${t("commun.texteLien", { libelle: t("panier.desinscriptionLien"), lien: d.lienDesinscription })}\n`
        : "") +
      `\nMemory Line`,
    ...entetes,
  };
}

/** Les articles du panier, une ligne chacun, pour la version texte du courrier. */
function lignesEnTexte(lignes: LigneCourrier[], langue: Langue): string {
  const t = tc(langue);
  return lignes
    .map(
      (l) =>
        `- ${l.titre} (${l.format ?? "A4"}) × ${l.quantite} — ${prix(l.unitPriceCents * l.quantite, langue)}` +
        (l.indisponible ? ` — ${t("panier.textePlusDisponible")}` : ""),
    )
    .join("\n");
}

/* -------------------------------------------------------------------------- */
/*  Le courrier de relance, réécrit par la boutique                           */
/* -------------------------------------------------------------------------- */

/**
 * Les cinq morceaux du courrier de relance que la boutique peut réécrire
 * elle-même, depuis l'écran « Paniers abandonnés ».
 *
 * Le reste ne se réécrit pas, et c'est voulu : le tableau du panier
 * (vignettes, prix, total), l'avertissement d'affiche indisponible, le code de
 * réduction repris, le BOUTON et le lien de désinscription sont fabriqués par
 * le code. Ce sont eux qui font qu'un courrier marche, ou qu'il est en règle ;
 * aucun texte saisi ne doit pouvoir les retirer.
 *
 * Et pas de HTML : la boutique écrit du texte, avec des retours à la ligne et
 * du **gras**, rien d'autre. Un courrier mis en page à la main casse dans la
 * moitié des messageries, et un HTML collé depuis ailleurs peut emporter
 * n'importe quoi avec lui.
 */
export interface TextesRelance {
  /** L'objet, tel qu'il s'affiche dans la boîte de réception. */
  objet: string;
  /** La grande ligne du haut : « Bonjour {prenom}, ». */
  accroche: string;
  /** Le texte avant le panier. */
  message: string;
  /** Le libellé du bouton qui rouvre le panier. */
  bouton: string;
  /** Le petit texte sous le bouton. */
  conclusion: string;
}

/** La 1re, la 2e ou la 3e relance d'un même panier. */
export type EtapeRelance = 1 | 2 | 3;

/**
 * Les textes d'origine de chaque relance.
 *
 * Celui de la 1re est le courrier d'avant cet écran, mot pour mot : c'est ce
 * qui s'affiche dans les champs tant que la boutique n'a rien changé. (Le
 * courrier lui-même, dans ce cas, ne passe même pas par ces textes : voir
 * `courrierPanierAbandonne`.) Les deux suivants disent qu'on insiste, sans
 * insister lourdement — la 3e annonce qu'elle est la dernière, et c'est vrai.
 *
 * Ils vivent dans le dictionnaire des courriels (« relance.1.objet »…), dans
 * chaque langue : c'est avec eux que part la relance d'une cliente, tant que
 * la boutique n'a pas écrit son propre texte dans la langue de celle-ci (voir
 * `textesDeLaRelance` dans relance-panier.ts).
 */
export function textesRelanceParDefaut(
  langue: Langue = "fr",
): Record<EtapeRelance, TextesRelance> {
  // Lus BRUTS, variables comprises : « {prenom} » est une variable de la
  // relance, que le courrier remplit lui-même au moment de l'envoi.
  const t = tc(langue);
  const etape = (n: EtapeRelance): TextesRelance => ({
    objet: t(`relance.${n}.objet`),
    accroche: t(`relance.${n}.accroche`),
    message: t(`relance.${n}.message`),
    bouton: t(`relance.${n}.bouton`),
    conclusion: t(`relance.${n}.conclusion`),
  });
  return { 1: etape(1), 2: etape(2), 3: etape(3) };
}

/**
 * Ceux du français, gardés sous la main : ce sont les plus demandés — l'écran
 * du courriel de relance s'ouvre sur le français, et la traduction proposée
 * dans les autres langues part du texte français, d'origine ou réécrit.
 */
export const TEXTES_RELANCE_DEFAUT: Record<EtapeRelance, TextesRelance> =
  textesRelanceParDefaut("fr");

/**
 * Les variables que la boutique peut glisser dans ses textes, et ce qu'elles
 * deviennent. La liste est courte exprès : chacune doit avoir un sens dans
 * TOUS les courriers, sans quoi un « {code} » vide partirait chez une cliente
 * qui n'a jamais saisi de code.
 */
export const VARIABLES_RELANCE = [
  { nom: "prenom", sens: "le prénom de la cliente (« vous » si on ne le connaît pas)" },
  { nom: "articles", sens: "le nom des affiches du panier, entre guillemets" },
  { nom: "montant", sens: "le total du panier, par exemple 49,00 €" },
  {
    nom: "lien",
    sens: "l'adresse qui rouvre le panier, en lien cliquable — le bouton est déjà là, ce lien est en plus",
  },
] as const;

type NomVariable = (typeof VARIABLES_RELANCE)[number]["nom"];

/** Les plafonds de chaque champ. Au-delà, ce n'est plus un courrier de relance. */
const LONGUEURS_RELANCE: Record<keyof TextesRelance, number> = {
  objet: 150,
  accroche: 150,
  message: 3000,
  bouton: 60,
  conclusion: 1000,
};

const NOMS_CHAMPS_RELANCE: Record<keyof TextesRelance, string> = {
  objet: "L'objet",
  accroche: "L'accroche",
  message: "Le message",
  bouton: "Le libellé du bouton",
  conclusion: "Le mot de la fin",
};

/** « Prénom », « PRENOM » → « prenom » : la variable telle que le code la connaît. */
function nomCanonique(brut: string): string {
  return brut
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function estVariable(nom: string): nom is NomVariable {
  return VARIABLES_RELANCE.some((v) => v.nom === nom);
}

/**
 * Met au propre ce que la boutique a saisi, ou dit en une phrase ce qui ne va
 * pas.
 *
 * Trois règles. Les champs d'une ligne (objet, accroche, bouton) restent sur
 * une ligne, et l'objet surtout : un retour à la ligne dans un objet de
 * courrier est une faille connue des en-têtes. Les variables s'écrivent comme
 * on les pense — « {Prénom} » vaut « {prenom} » — mais une variable inconnue
 * est REFUSÉE plutôt que laissée telle quelle : sinon « {nom} » partirait
 * entre ses accolades chez toutes les clientes. Et « {lien} » n'a sa place
 * que dans le texte : dans un objet ou sur le bouton, il afficherait une
 * adresse de cent caractères.
 */
export function normaliserTextesRelance(
  brut: unknown,
): { ok: true; textes: TextesRelance } | { ok: false; erreur: string } {
  const source = (brut && typeof brut === "object" ? brut : {}) as Record<string, unknown>;
  const textes = {} as TextesRelance;
  for (const champ of Object.keys(LONGUEURS_RELANCE) as (keyof TextesRelance)[]) {
    const uneLigne = champ === "objet" || champ === "accroche" || champ === "bouton";
    let v = String(source[champ] ?? "")
      .replace(/\r\n?/g, "\n")
      // Les caractères de contrôle n'ont rien à faire dans un courrier, et
      // certains cassent les en-têtes ou l'affichage de la messagerie.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
    v = uneLigne ? v.replace(/\s*\n\s*/g, " ").trim() : v.replace(/\n{3,}/g, "\n\n").trim();

    if (!v && champ !== "message" && champ !== "conclusion")
      return { ok: false, erreur: `${NOMS_CHAMPS_RELANCE[champ]} ne peut pas rester vide.` };
    if (v.length > LONGUEURS_RELANCE[champ])
      return {
        ok: false,
        erreur: `${NOMS_CHAMPS_RELANCE[champ]} est trop long : ${v.length} caractères pour ${LONGUEURS_RELANCE[champ]} au plus.`,
      };

    let erreur: string | null = null;
    v = v.replace(/\{([^{}\n]{1,30})\}/g, (tel, nom: string) => {
      const canonique = nomCanonique(nom.trim());
      if (!estVariable(canonique)) {
        erreur ??= `« ${tel} » n'est pas une variable connue. Celles qui existent : ${VARIABLES_RELANCE.map((x) => `{${x.nom}}`).join(", ")}.`;
        return tel;
      }
      if (canonique === "lien" && uneLigne)
        erreur ??= `{lien} ne peut servir que dans le message ou le mot de la fin : ${NOMS_CHAMPS_RELANCE[champ].toLowerCase()} afficherait une adresse entière.`;
      return `{${canonique}}`;
    });
    if (erreur) return { ok: false, erreur };
    textes[champ] = v;
  }
  return { ok: true, textes };
}

/** Deux jeux de textes disent-ils exactement la même chose ? */
export function memesTextesRelance(a: TextesRelance, b: TextesRelance): boolean {
  return (Object.keys(LONGUEURS_RELANCE) as (keyof TextesRelance)[]).every(
    (k) => a[k] === b[k],
  );
}

/** Ce que valent les variables pour CE courrier. */
type ValeursRelance = Record<NomVariable, string>;

/** « A », « A » et « B », « A », « B » et « C ». */
function listeDesTitres(lignes: LigneCourrier[], langue: Langue): string {
  const t = tc(langue);
  const titres = lignes.map((l) => t("relance.articleCite", { titre: l.titre }));
  if (titres.length <= 1) return titres[0] ?? t("relance.articleParDefaut");
  return t("relance.articlesEt", {
    debut: titres.slice(0, -1).join(", "),
    dernier: titres[titres.length - 1]!,
  });
}

/** Un champ d'une ligne, variables remplies, en TEXTE (échappé plus tard). */
function remplirLigne(t: string, v: ValeursRelance): string {
  return t.replace(/\{([a-z_]+)\}/g, (tel, nom: string) => (estVariable(nom) ? v[nom] : tel));
}

/**
 * Un texte de plusieurs lignes, en HTML de courrier.
 *
 * L'ordre des opérations est ce qui rend la chose sûre : on ÉCHAPPE d'abord
 * tout ce que la boutique a écrit, et seulement ensuite on pose nos balises —
 * le gras, les retours à la ligne, les variables (elles-mêmes échappées). Rien
 * de ce qui a été saisi ne peut donc devenir une balise.
 *
 * Une ligne vide sépare deux paragraphes ; un simple retour à la ligne reste
 * un retour à la ligne. Le premier paragraphe garde le style du courrier
 * d'origine, les suivants prennent l'espace qui les sépare.
 */
function paragraphesHtml(
  t: string,
  v: ValeursRelance,
  styles: { premier: string; suivant: string },
): string {
  return t
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, i) => {
      const corps = h(p)
        .replace(/\*\*([^*]+?)\*\*/g, '<strong style="font-weight:600">$1</strong>')
        .replace(/\{([a-z_]+)\}/g, (tel, nom: string) => {
          if (!estVariable(nom)) return tel;
          if (nom === "lien")
            return `<a href="${h(v.lien)}" style="color:#121212;word-break:break-all">${h(v.lien)}</a>`;
          return h(v[nom]);
        })
        .replace(/\n/g, "<br />");
      return `<p style="${i === 0 ? styles.premier : styles.suivant}">${corps}</p>`;
    })
    .join("\n       ");
}

/** Le même texte, pour la version sans mise en page du courrier. */
function paragraphesTexte(t: string, v: ValeursRelance): string {
  return remplirLigne(t, v).replace(/\*\*([^*]+?)\*\*/g, "$1").trim();
}

/**
 * Le courrier de relance avec les textes de la boutique.
 *
 * Même gabarit, même panier, même bouton que le courrier d'origine : seuls les
 * mots changent. C'est ce qui permet à l'aperçu de l'écran d'être fidèle — il
 * passe par ici, exactement comme l'envoi.
 */
function courrierRelanceReecrit(
  d: Parameters<typeof courrierPanierAbandonne>[0],
  t: TextesRelance,
  morceaux: {
    panier: string;
    bouton: (libelle: string) => string;
    desinscription: string;
    entetes: { entetes?: Record<string, string> };
  },
): Courrier {
  const langue = d.langue ?? "fr";
  const tx = tc(langue);
  const v: ValeursRelance = {
    prenom: d.prenomClient,
    articles: listeDesTitres(d.lignes, langue),
    montant: prix(d.totalCents, langue),
    lien: d.lien,
  };
  const message = paragraphesHtml(t.message, v, {
    premier: "margin:0",
    suivant: "margin:12px 0 0",
  });
  const conclusion = paragraphesHtml(t.conclusion, v, {
    premier: "margin:0;color:#5b5b54;font-size:14px",
    suivant: "margin:10px 0 0;color:#5b5b54;font-size:14px",
  });
  const libelleBouton = remplirLigne(t.bouton, v);

  return {
    to: "",
    // Une ligne, toujours : les variables pourraient en théorie apporter un
    // retour à la ligne (un titre d'affiche mal saisi), et l'objet est un
    // en-tête.
    subject: remplirLigne(t.objet, v).replace(/\s+/g, " ").trim(),
    html: gabarit(
      remplirLigne(t.accroche, v),
      [message, morceaux.panier, morceaux.bouton(libelleBouton), conclusion, morceaux.desinscription]
        .filter(Boolean)
        .join("\n       "),
      langue,
    ),
    text:
      [
        remplirLigne(t.accroche, v),
        paragraphesTexte(t.message, v),
        lignesEnTexte(d.lignes, langue) +
          `\n${tx("panier.texteTotal", { montant: prix(d.totalCents, langue) })}` +
          (d.codePromo ? `\n${tx("panier.promo", { code: d.codePromo })}` : ""),
        tx("commun.texteLien", { libelle: libelleBouton, lien: d.lien }),
        paragraphesTexte(t.conclusion, v),
        d.lienDesinscription
          ? tx("commun.texteLien", {
              libelle: tx("panier.desinscriptionLien"),
              lien: d.lienDesinscription,
            })
          : "",
        "Memory Line",
      ]
        .filter(Boolean)
        .join("\n\n"),
    ...morceaux.entetes,
  };
}

/**
 * Le colis est parti.
 *
 * C'est le courrier le plus attendu de tous, et le seul que la boutique
 * n'envoyait pas : un numéro de suivi saisi au back-office n'allait nulle
 * part. Le lien de suivi n'est pas toujours connu (transporteur saisi à la
 * main, numéro d'un service qu'on ne sait pas construire) : on donne alors le
 * numéro en clair, ce qui vaut mieux que rien.
 */
export function courrierExpediee(d: {
  prenomClient: string;
  numero: string;
  transporteur: string | null;
  numeroSuivi: string | null;
  lienSuivi: string | null;
  lignes: LigneCourrier[];
  langue?: Langue;
}): Courrier {
  const langue = d.langue ?? "fr";
  const t = tc(langue);
  const intro = d.transporteur
    ? texteHtml(langue, "expediee.introPar", { transporteur: h(d.transporteur) })
    : texteHtml(langue, "expediee.intro");
  const suivi = d.lienSuivi
    ? `<p style="margin:20px 0"><a href="${h(d.lienSuivi)}" style="display:inline-block;background:#121212;color:#ffffff;padding:14px 28px;text-decoration:none">${texteHtml(langue, "expediee.bouton")}</a></p>`
    : d.numeroSuivi
      ? `<p style="margin:20px 0;font-size:14px">${texteHtml(langue, "expediee.numeroSuivi", { numero: `<strong style="font-weight:500">${h(d.numeroSuivi)}</strong>` })}</p>`
      : "";
  return {
    to: "",
    subject: t("expediee.objet", { numero: d.numero }),
    html: gabarit(
      t("commun.bonjour", { prenom: h(d.prenomClient) }),
      `<p style="margin:0">${intro}</p>
       ${tableauLignes(d.lignes, langue)}
       ${suivi}
       <p style="margin:0;color:#5b5b54;font-size:14px">${texteHtml(langue, "expediee.delai")}</p>`,
      langue,
    ),
    text:
      `${t("commun.bonjour", { prenom: d.prenomClient })}\n\n` +
      (d.transporteur
        ? t("expediee.textePar", { numero: d.numero, transporteur: d.transporteur })
        : t("expediee.texte", { numero: d.numero })) +
      (d.lienSuivi
        ? `\n${t("expediee.texteSuivi", { lien: d.lienSuivi })}`
        : d.numeroSuivi
          ? `\n${t("expediee.numeroSuivi", { numero: d.numeroSuivi })}`
          : "") +
      `\n\nMemory Line`,
  };
}

/**
 * L'affiche prise au stand est prête.
 *
 * AUCUN PRIX, comme tout ce qui vient du stand : le tarif y est annoncé de
 * vive voix par la vendeuse, et un montant écrit ici la contredirait après
 * coup. On demande une adresse e-mail au stand exactement pour envoyer ce
 * message-là, et personne ne l'envoyait.
 */
export function courrierPreteAuStand(d: {
  prenomClient: string;
  numero: string;
  evenement: string | null;
  lignes: LigneCourrier[];
  langue?: Langue;
}): Courrier {
  const langue = d.langue ?? "fr";
  const t = tc(langue);
  const intro = d.evenement
    ? texteHtml(langue, "stand.introSur", { evenement: h(d.evenement) })
    : texteHtml(langue, "stand.intro");
  return {
    to: "",
    subject: t("stand.objet"),
    html: gabarit(
      t("commun.bonjour", { prenom: h(d.prenomClient) }),
      `<p style="margin:0">${intro}</p>
       ${tableauLignesSansPrix(d.lignes)}
       <p style="margin:20px 0 0;color:#5b5b54;font-size:14px">${texteHtml(langue, "stand.merci", { numero: h(d.numero) })}</p>`,
      langue,
    ),
    text: `${t("commun.bonjour", { prenom: d.prenomClient })}\n\n${
      d.evenement ? t("stand.texteSur", { evenement: d.evenement }) : t("stand.texte")
    }\n${t("stand.texteCommande", { numero: d.numero })}\n\nMemory Line`,
  };
}

/**
 * Une commande « retrait sur place » est prête : elle attend la cliente au
 * lieu qu'elle a choisi.
 *
 * Avant, la commande traitée recevait « Votre commande est en route » — de
 * quoi guetter le facteur pour une affiche qui attendait au chalet. Ici, le
 * lieu en toutes lettres (nom, adresse, texte de la boutique) et la liste
 * des affiches. AUCUN PRIX : elle a déjà sa confirmation, ce courrier-ci ne
 * dit que où et quoi.
 */
export function courrierPreteAuRetrait(d: {
  prenomClient: string;
  numero: string;
  lieu: LieuDuCourriel;
  lignes: LigneCourrier[];
  langue?: Langue;
}): Courrier {
  const langue = d.langue ?? "fr";
  const t = tc(langue);
  return {
    to: "",
    subject: t("retrait.objet", { numero: d.numero }),
    html: gabarit(
      t("commun.bonjour", { prenom: h(d.prenomClient) }),
      `<p style="margin:0">${texteHtml(langue, "retrait.intro")}</p>
       ${blocLieuHtml(langue, "retrait.ou", d.lieu)}
       ${tableauLignesSansPrix(d.lignes)}
       <p style="margin:20px 0 0;color:#5b5b54;font-size:14px">${texteHtml(langue, "retrait.merci", { numero: h(d.numero) })}</p>`,
      langue,
    ),
    text:
      `${t("commun.bonjour", { prenom: d.prenomClient })}\n\n` +
      `${t("retrait.texte", { numero: d.numero })}\n\n` +
      `${blocLieuTexte(langue, "retrait.ou", d.lieu)}\n\nMemory Line`,
  };
}

/**
 * Bienvenue, à la création d'un compte.
 *
 * AUCUN MOT DE PASSE, ni en clair ni en rappel, jamais. Un courrier se
 * transfère, se retrouve dans une boîte partagée, et reste lisible des années
 * après : ce qu'on y écrit une fois, on ne le reprend plus.
 *
 * Il dit à quoi le compte sert, et rien d'autre : c'est la seule chose que la
 * personne ne sait pas encore, elle vient justement de choisir le reste.
 */
export function courrierBienvenue(d: {
  prenomClient: string;
  /** L'espace client, déjà dans la langue du client (« /en/compte »). */
  lien: string | null;
  langue?: Langue;
}): Courrier {
  const langue = d.langue ?? "fr";
  const t = tc(langue);
  const bouton = d.lien
    ? `<p style="margin:20px 0"><a href="${h(d.lien)}" style="display:inline-block;background:#121212;color:#ffffff;padding:14px 28px;text-decoration:none">${texteHtml(langue, "bienvenue.bouton")}</a></p>`
    : "";
  return {
    to: "",
    subject: t("bienvenue.objet"),
    html: gabarit(
      t("commun.bonjour", { prenom: d.prenomClient }),
      `<p style="margin:0">${texteHtml(langue, "bienvenue.intro")}</p>
       ${bouton}
       <p style="margin:20px 0 0;color:#5b5b54;font-size:14px">${texteHtml(langue, "bienvenue.securite")}</p>`,
      langue,
    ),
    text:
      `${t("commun.bonjour", { prenom: d.prenomClient })}\n\n${t("bienvenue.texte")}` +
      (d.lien ? `\n${d.lien}` : "") +
      `\n\nMemory Line`,
  };
}

/**
 * Avis de sécurité : le mot de passe vient de changer.
 *
 * Il part APRÈS le changement, et sans lien qui reposerait un mot de passe :
 * son seul rôle est de prévenir quelqu'un dont le compte serait en train de
 * lui échapper, assez tôt pour qu'il reprenne la main. Le chemin qu'on lui
 * indique est donc le chemin public, celui qui exige sa boîte mail.
 */
export function courrierMotDePasseModifie(d: {
  prenomClient: string;
  /** Vrai quand le changement vient d'un lien de réinitialisation. */
  parReinitialisation: boolean;
  /** La page « mot de passe oublié », déjà dans la langue du client. */
  lien: string | null;
  langue?: Langue;
}): Courrier {
  const langue = d.langue ?? "fr";
  const t = tc(langue);
  const origine = `<p style="margin:0">${texteHtml(
    langue,
    d.parReinitialisation ? "mdpModifie.parReinit" : "mdpModifie.parCompte",
  )}</p>`;
  const bouton = d.lien
    ? `<p style="margin:20px 0"><a href="${h(d.lien)}" style="display:inline-block;background:#121212;color:#ffffff;padding:14px 28px;text-decoration:none">${texteHtml(langue, "mdpModifie.bouton")}</a></p>`
    : "";
  return {
    to: "",
    subject: t("mdpModifie.objet"),
    html: gabarit(
      t("commun.bonjour", { prenom: d.prenomClient }),
      `${origine}
       <p style="margin:16px 0 0">${texteHtml(langue, "mdpModifie.alerte")}</p>
       ${bouton}
       <p style="margin:20px 0 0;color:#5b5b54;font-size:14px">${texteHtml(langue, "mdpModifie.avis")}</p>`,
      langue,
    ),
    text:
      `${t("commun.bonjour", { prenom: d.prenomClient })}\n\n` +
      t(d.parReinitialisation ? "mdpModifie.texteParReinit" : "mdpModifie.parCompte") +
      `\n\n` +
      (d.lien
        ? t("mdpModifie.texteAlerteLien", { lien: d.lien })
        : t("mdpModifie.texteAlerte")) +
      `\n\nMemory Line`,
  };
}

export interface RemboursementCourrier {
  prenomClient: string;
  numero: string;
  /** Ce que CE remboursement rend, frais de port compris. */
  montantCents: number;
  /** Part des frais de port dans ce montant. Zéro le plus souvent. */
  portCents: number;
  /** Les articles rendus, avec les quantités de ce remboursement seulement. */
  articles: LigneCourrier[];
  /** Somme rendue sur la commande, celui-ci et les précédents réunis. */
  totalRembourseCents: number;
  /** Ce que la commande avait coûté. Sert à dire si le compte est soldé. */
  totalCommandeCents: number;
  /** L'argent repart-il par le moyen de paiement d'origine ? */
  viaPaiementEnLigne: boolean;
  langue?: Langue;
}

/**
 * Un remboursement vient d'être enregistré.
 *
 * Trois questions, dans l'ordre où elles se posent : combien, sur quoi, et
 * quand est-ce que ça se voit. La troisième est celle qui fait écrire à la
 * boutique, parce que la banque met des jours et que le silence, lui, est
 * immédiat.
 *
 * Un remboursement PARTIEL le dit en toutes lettres : le montant seul laisse
 * croire à une erreur de la boutique quand il ne correspond pas au total payé.
 */
export function courrierRemboursee(d: RemboursementCourrier): Courrier {
  const langue = d.langue ?? "fr";
  const t = tc(langue);
  const partiel = d.totalRembourseCents < d.totalCommandeCents;

  const mention = partiel
    ? `<p style="margin:16px 0 0">${texteHtml(langue, "remboursee.partiel")}</p>`
    : "";

  const port = d.portCents
    ? `<p style="margin:16px 0 0;font-size:14px;color:#5b5b54">${texteHtml(langue, "remboursee.port", { montant: prix(d.portCents, langue) })}</p>`
    : "";

  // Le cumul n'a de sens qu'à partir du deuxième remboursement : sinon il
  // répète le montant qu'on vient de lire, deux lignes plus haut.
  const cumul =
    d.totalRembourseCents > d.montantCents
      ? `<p style="margin:16px 0 0;font-size:14px;color:#5b5b54">${texteHtml(langue, "remboursee.cumul", { total: prix(d.totalRembourseCents, langue), commande: prix(d.totalCommandeCents, langue) })}</p>`
      : "";

  const delai = `<p style="margin:20px 0 0">${texteHtml(
    langue,
    d.viaPaiementEnLigne ? "remboursee.delaiEnLigne" : "remboursee.horsLigne",
  )}</p>`;

  return {
    to: "",
    subject: t(partiel ? "remboursee.objetPartiel" : "remboursee.objet", {
      numero: d.numero,
    }),
    html: gabarit(
      t("commun.bonjour", { prenom: d.prenomClient }),
      `<p style="margin:0">${texteHtml(langue, "remboursee.intro", { montant: `<strong style="font-weight:500">${prix(d.montantCents, langue)}</strong>`, numero: h(d.numero) })}</p>
       ${mention}
       ${d.articles.length ? tableauLignes(d.articles, langue) : ""}
       ${port}
       ${cumul}
       ${delai}
       <p style="margin:24px 0 0;color:#5b5b54;font-size:14px">${texteHtml(langue, "remboursee.question")}</p>`,
      langue,
    ),
    text:
      `${t("commun.bonjour", { prenom: d.prenomClient })}\n\n${t("remboursee.texte", { montant: prix(d.montantCents, langue), numero: d.numero })}` +
      (partiel ? `\n${t("remboursee.textePartiel")}` : "") +
      `\n${t(d.viaPaiementEnLigne ? "remboursee.texteDelai" : "remboursee.texteHorsLigne")}` +
      `\n\nMemory Line`,
  };
}

/**
 * Une commande est annulée.
 *
 * AUCUN MONTANT, comme le courrier du stand : l'annulation n'est pas le moment
 * de réafficher un prix, et ce même texte doit pouvoir partir vers une
 * commande prise au stand, dont les tarifs ne s'écrivent nulle part.
 *
 * L'argent, quand il y en a eu, se règle par le courrier de remboursement, qui
 * part au moment où le remboursement est réellement enregistré. Annoncer ici
 * une somme rendue avant qu'elle le soit serait une promesse.
 */
export function courrierAnnulee(d: {
  prenomClient: string;
  numero: string;
  /** Ce que la boutique dit de l'annulation. Rien plutôt qu'une formule creuse. */
  motif: string | null;
  articles: LigneCourrier[];
  /** La commande avait-elle été payée avant d'être annulée ? */
  dejaPayee: boolean;
  langue?: Langue;
}): Courrier {
  const langue = d.langue ?? "fr";
  const t = tc(langue);
  const motif = d.motif
    ? `<p style="margin:16px 0 0">${texteHtml(langue, "annulee.motif", { motif: h(d.motif) })}</p>`
    : "";
  const argent = d.dejaPayee
    ? `<p style="margin:16px 0 0">${texteHtml(langue, "annulee.argent")}</p>`
    : "";
  return {
    to: "",
    subject: t("annulee.objet", { numero: d.numero }),
    html: gabarit(
      t("commun.bonjour", { prenom: d.prenomClient }),
      `<p style="margin:0">${texteHtml(langue, "annulee.intro", { numero: h(d.numero) })}</p>
       ${motif}
       ${tableauLignesSansPrix(d.articles)}
       ${argent}
       <p style="margin:20px 0 0;color:#5b5b54;font-size:14px">${texteHtml(langue, "annulee.surprise")}</p>`,
      langue,
    ),
    text:
      `${t("commun.bonjour", { prenom: d.prenomClient })}\n\n${t("annulee.intro", { numero: d.numero })}` +
      (d.motif ? `\n${t("annulee.motif", { motif: d.motif })}` : "") +
      (d.dejaPayee ? `\n${t("annulee.texteArgent")}` : "") +
      `\n\nMemory Line`,
  };
}

/**
 * La facture de la commande, en pièce jointe.
 *
 * Elle part quand la boutique l'envoie, jamais toute seule : une facture n'a
 * pas de moment évident — certaines clientes la demandent, la plupart ne la
 * réclament jamais — et l'envoyer d'office ferait un courrier de plus après la
 * confirmation, qui dit déjà ce qui a été acheté et pour combien.
 *
 * Le courrier lui-même est COURT et ne répète pas le détail : il est dans la
 * pièce jointe, et une facture qu'on lit deux fois, une fois dans le message et
 * une fois dans le PDF, invite justement à comparer les deux. Le numéro de
 * facture est écrit ici parce que c'est ce qu'une comptable cite quand elle
 * nous écrit à propos de ce document.
 */
export function courrierFacture(d: {
  prenomClient: string;
  numero: string;
  numeroFacture: string;
  totalCents: number;
  /** Vrai quand la commande a déjà été réglée. Change la phrase, pas le PDF. */
  dejaPayee: boolean;
  langue?: Langue;
}): Courrier {
  const langue = d.langue ?? "fr";
  const t = tc(langue);
  const reglement = `<p style="margin:16px 0 0">${texteHtml(
    langue,
    d.dejaPayee ? "facture.reglee" : "facture.nonReglee",
  )}</p>`;
  return {
    to: "",
    subject: t("facture.objet", { facture: d.numeroFacture, numero: d.numero }),
    html: gabarit(
      t("commun.bonjour", { prenom: h(d.prenomClient) }),
      `<p style="margin:0">${texteHtml(langue, "facture.intro", { numero: h(d.numero) })}</p>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;font-size:14px">
         <tr><td style="padding:4px 0;color:#5b5b54">${texteHtml(langue, "facture.numeroFacture")}</td><td align="right"><strong style="font-weight:500">${h(d.numeroFacture)}</strong></td></tr>
         <tr><td style="padding:4px 0;color:#5b5b54">${texteHtml(langue, "facture.commande")}</td><td align="right">${h(d.numero)}</td></tr>
         <tr><td style="padding:4px 0;color:#5b5b54">${texteHtml(langue, "facture.montant")}</td><td align="right"><strong style="font-weight:500">${prix(d.totalCents, langue)}</strong></td></tr>
       </table>
       ${reglement}
       <p style="margin:24px 0 0;color:#5b5b54;font-size:14px">${texteHtml(langue, "facture.question")}</p>`,
      langue,
    ),
    text:
      `${t("commun.bonjour", { prenom: d.prenomClient })}\n\n${t("facture.intro", { numero: d.numero })}\n` +
      `${t("facture.texteNumero", { facture: d.numeroFacture, montant: prix(d.totalCents, langue) })}\n` +
      `${t(d.dejaPayee ? "facture.texteReglee" : "facture.texteNonReglee")}\n` +
      `\nMemory Line`,
  };
}

/**
 * Lien de réinitialisation du mot de passe.
 *
 * Le courrier rappelle que la demande peut être ignorée : il part aussi bien
 * vers quelqu'un qui a oublié son mot de passe que vers quelqu'un dont
 * l'adresse a été saisie par erreur — ou par curiosité.
 */
export function courrierReinitialisation(d: {
  prenomClient: string;
  /** Le lien, déjà vers la page dans la langue du client. */
  lien: string;
  langue?: Langue;
}): Courrier {
  const langue = d.langue ?? "fr";
  const t = tc(langue);
  return {
    to: "",
    subject: t("reinit.objet"),
    html: gabarit(
      t("commun.bonjour", { prenom: d.prenomClient }),
      `<p style="margin:0">${texteHtml(langue, "reinit.intro")}</p>
       <p style="margin:20px 0"><a href="${h(d.lien)}" style="display:inline-block;background:#121212;color:#ffffff;padding:14px 28px;text-decoration:none">${texteHtml(langue, "reinit.bouton")}</a></p>
       <p style="margin:0;color:#5b5b54;font-size:14px">${texteHtml(langue, "reinit.ignorer")}</p>`,
      langue,
    ),
    text: `${t("commun.bonjour", { prenom: d.prenomClient })}\n\n${t("reinit.texteLien", { lien: d.lien })}\n\n${t("reinit.texteIgnorer")}\n\nMemory Line`,
  };
}
