/**
 * Envoi d'e-mails transactionnels (Resend), ou boîte aux lettres de test.
 *
 * Réglages, dans le `.env` de la racine :
 *   RESEND_API_KEY  : la clé d'API (« re_… »)
 *   MAIL_FROM       : l'expéditeur, ex. « Memory Line <commandes@memoryline.fr> »
 *   MAIL_BCC        : facultatif — une copie de chaque envoi pour la boutique
 *   MAIL_TEST_URL   : facultatif — adresse d'une boîte de test (Mailpit).
 *                     Renseignée, elle prend TOUT : aucun courrier ne part
 *                     vers un vrai destinataire. C'est le mode d'essai.
 *
 * Sans clé, `estConfigure()` répond faux et `envoyer()` ne fait rien d'autre
 * que le noter dans le journal : une commande ne doit JAMAIS échouer parce
 * que l'e-mail n'a pas pu partir. Le paiement est encaissé, l'affiche est
 * commandée — le courrier est un service en plus, pas une condition.
 */

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

/** Vrai quand on sait où envoyer : la boîte d'essai, ou Resend. */
export function estConfigure(): boolean {
  if (BOITE_TEST) return true;
  return CLE.length > 0 && EXPEDITEUR.length > 0;
}

/** Vrai quand les courriers vont dans la boîte d'essai, pas chez le client. */
export function estEnEssai(): boolean {
  return BOITE_TEST.length > 0;
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
      Subject: courrier.subject,
      HTML: courrier.html,
      ...(courrier.text ? { Text: courrier.text } : {}),
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

export interface Courrier {
  to: string;
  subject: string;
  html: string;
  /** Version texte, pour les clients qui n'affichent pas le HTML. */
  text?: string;
}

/**
 * Envoie un e-mail. Ne lève jamais : l'appelant est un flux métier (paiement,
 * expédition) qui ne doit pas s'interrompre pour un problème de courrier.
 * Renvoie vrai si l'envoi est parti.
 */
export async function envoyer(courrier: Courrier): Promise<boolean> {
  if (!estConfigure()) {
    console.warn(
      "[mail] non configuré (RESEND_API_KEY / MAIL_FROM) — courrier non envoyé :",
      courrier.subject,
    );
    return false;
  }
  try {
    // En mode d'essai, rien ne part : le courrier va dans la boîte de test.
    if (BOITE_TEST) return await deposerDansLaBoite(courrier);
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
        subject: courrier.subject,
        html: courrier.html,
        ...(courrier.text ? { text: courrier.text } : {}),
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

/** Montant en centimes → « 23,00 € ». */
function prix(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

export interface LigneCourrier {
  titre: string;
  format?: string | null;
  cadre?: string | null;
  quantite: number;
  unitPriceCents: number;
}

/**
 * Gabarit commun : en-tête, contenu, pied. Volontairement sobre et en tableau
 * — les clients de messagerie ne savent toujours pas mettre en page autre
 * chose, et une mise en page qui casse fait plus de mal qu'une simple.
 */
function gabarit(titre: string, contenu: string): string {
  return `<!doctype html>
<html lang="fr"><body style="margin:0;background:#f3f3f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#121212">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f3;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">
        <tr><td style="padding:28px 32px 8px">
          <div style="font-size:20px;letter-spacing:.6px">Memory Line</div>
        </td></tr>
        <tr><td style="padding:0 32px 8px">
          <h1 style="font-size:22px;font-weight:400;letter-spacing:.6px;margin:12px 0">${h(titre)}</h1>
        </td></tr>
        <tr><td style="padding:0 32px 32px;font-size:15px;line-height:1.5">${contenu}</td></tr>
        <tr><td style="padding:16px 32px;background:#f3f3f3;font-size:12px;color:#5b5b54">
          Memory Line — affiches personnalisées.<br />
          TVA non applicable, article 293 B du CGI.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Tableau des articles commandés. */
function tableauLignes(lignes: LigneCourrier[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0">
    ${lignes
      .map(
        (l) => `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee">
        <strong style="font-weight:500">${h(l.titre)}</strong><br />
        <span style="color:#5b5b54;font-size:13px">Format ${h(l.format ?? "A4")}${
          l.cadre ? ` · ${h(l.cadre)}` : ""
        } · ×${l.quantite}</span>
      </td>
      <td align="right" style="padding:8px 0;border-bottom:1px solid #eee;white-space:nowrap">
        ${prix(l.unitPriceCents * l.quantite)}
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
}

/** Confirmation envoyée au client dès que le paiement est encaissé. */
export function courrierConfirmation(d: ConfirmationCommande): Courrier {
  const totaux = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 0;color:#5b5b54">Sous-total</td><td align="right">${prix(d.sousTotalCents)}</td></tr>
    ${
      d.remiseCents > 0
        ? `<tr><td style="padding:4px 0;color:#5b5b54">Réduction${d.codePromo ? ` — ${h(d.codePromo)}` : ""}</td><td align="right">− ${prix(d.remiseCents)}</td></tr>`
        : ""
    }
    <tr><td style="padding:4px 0;color:#5b5b54">Livraison${d.modeLivraison ? ` — ${h(d.modeLivraison)}` : ""}</td><td align="right">${prix(d.portCents)}</td></tr>
    <tr><td style="padding:10px 0 0;border-top:1px solid #eee"><strong style="font-weight:500">Total</strong></td><td align="right" style="padding:10px 0 0;border-top:1px solid #eee"><strong style="font-weight:500">${prix(d.totalCents)}</strong></td></tr>
  </table>`;

  const adresse =
    d.adresse && d.adresse.length
      ? `<p style="margin:20px 0 0;color:#5b5b54;font-size:14px">Livraison :<br />${d.adresse
          .filter(Boolean)
          .map(h)
          .join("<br />")}</p>`
      : "";

  return {
    to: "",
    subject: `Votre commande ${d.numero} est confirmée`,
    html: gabarit(
      `Merci ${d.prenomClient} !`,
      `<p style="margin:0 0 4px">Votre commande <strong style="font-weight:500">${h(d.numero)}</strong> est bien enregistrée et payée. Nous préparons votre affiche.</p>
       ${tableauLignes(d.lignes)}
       ${totaux}
       ${adresse}
       <p style="margin:24px 0 0;color:#5b5b54;font-size:14px">Une question ? Répondez simplement à cet e-mail.</p>`,
    ),
    text: `Merci ${d.prenomClient} !\n\nVotre commande ${d.numero} est confirmée. Total : ${prix(d.totalCents)}.\n\nMemory Line`,
  };
}

/** Avis interne : une commande vient d'arriver. */
export function courrierNouvelleCommande(d: {
  numero: string;
  client: string;
  totalCents: number;
  lignes: LigneCourrier[];
}): Courrier {
  return {
    to: "",
    subject: `Nouvelle commande ${d.numero} — ${prix(d.totalCents)}`,
    html: gabarit(
      `Commande ${d.numero}`,
      `<p style="margin:0">De ${h(d.client)}, pour ${prix(d.totalCents)}.</p>
       ${tableauLignes(d.lignes)}`,
    ),
  };
}

/** Relance d'un panier laissé en plan. */
export function courrierPanierAbandonne(d: {
  prenomClient: string;
  lien: string;
  lignes: LigneCourrier[];
  totalCents: number;
}): Courrier {
  return {
    to: "",
    subject: "Votre affiche vous attend",
    html: gabarit(
      `Bonjour ${d.prenomClient},`,
      `<p style="margin:0">Vous avez composé une affiche sans finir votre commande. Elle est toujours là, telle que vous l'avez laissée.</p>
       ${tableauLignes(d.lignes)}
       <p style="margin:20px 0"><a href="${h(d.lien)}" style="display:inline-block;background:#121212;color:#ffffff;padding:14px 28px;text-decoration:none">Reprendre ma commande</a></p>
       <p style="margin:0;color:#5b5b54;font-size:14px">Si vous avez changé d'avis, ignorez simplement ce message.</p>`,
    ),
    text: `Bonjour ${d.prenomClient},\n\nVotre affiche vous attend : ${d.lien}\n\nMemory Line`,
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
}): Courrier {
  const par = d.transporteur ? ` par ${h(d.transporteur)}` : "";
  const suivi = d.lienSuivi
    ? `<p style="margin:20px 0"><a href="${h(d.lienSuivi)}" style="display:inline-block;background:#121212;color:#ffffff;padding:14px 28px;text-decoration:none">Suivre mon colis</a></p>`
    : d.numeroSuivi
      ? `<p style="margin:20px 0;font-size:14px">Numéro de suivi : <strong style="font-weight:500">${h(d.numeroSuivi)}</strong></p>`
      : "";
  return {
    to: "",
    subject: `Votre commande ${d.numero} est en route`,
    html: gabarit(
      `Bonjour ${h(d.prenomClient)},`,
      `<p style="margin:0">Votre affiche est partie${par}. Elle arrive.</p>
       ${tableauLignes(d.lignes)}
       ${suivi}
       <p style="margin:0;color:#5b5b54;font-size:14px">Comptez quelques jours avant que le suivi ne s'anime : le transporteur met un moment à enregistrer le colis.</p>`,
    ),
    text:
      `Bonjour ${d.prenomClient},\n\nVotre commande ${d.numero} est partie${d.transporteur ? ` par ${d.transporteur}` : ""}.` +
      (d.lienSuivi
        ? `\nSuivi : ${d.lienSuivi}`
        : d.numeroSuivi
          ? `\nNuméro de suivi : ${d.numeroSuivi}`
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
}): Courrier {
  const ou = d.evenement ? ` sur ${h(d.evenement)}` : "";
  return {
    to: "",
    subject: "Votre affiche est prête",
    html: gabarit(
      `Bonjour ${h(d.prenomClient)},`,
      `<p style="margin:0">Votre affiche commandée${ou} est prête. Nous vous recontactons pour la remise, ou vous la recevez sous peu si elle doit voyager.</p>
       ${tableauLignesSansPrix(d.lignes)}
       <p style="margin:20px 0 0;color:#5b5b54;font-size:14px">Commande ${h(d.numero)}. Merci d'être passée nous voir.</p>`,
    ),
    text: `Bonjour ${d.prenomClient},\n\nVotre affiche commandée${d.evenement ? ` sur ${d.evenement}` : ""} est prête.\nCommande ${d.numero}.\n\nMemory Line`,
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
  lien: string;
}): Courrier {
  return {
    to: "",
    subject: "Réinitialiser votre mot de passe",
    html: gabarit(
      `Bonjour ${d.prenomClient},`,
      `<p style="margin:0">Vous avez demandé à changer le mot de passe de votre compte Memory Line. Ce lien est valable une heure et ne servira qu'une fois.</p>
       <p style="margin:20px 0"><a href="${h(d.lien)}" style="display:inline-block;background:#121212;color:#ffffff;padding:14px 28px;text-decoration:none">Choisir un nouveau mot de passe</a></p>
       <p style="margin:0;color:#5b5b54;font-size:14px">Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.</p>`,
    ),
    text: `Bonjour ${d.prenomClient},\n\nPour choisir un nouveau mot de passe (lien valable une heure) : ${d.lien}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\nMemory Line`,
  };
}
