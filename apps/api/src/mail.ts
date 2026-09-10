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
  /**
   * L'image de l'affiche, en adresse ABSOLUE et publique.
   *
   * Facultative : une messagerie qui ne peut pas la charger doit lire un
   * courrier complet quand même. Seule la relance de panier s'en sert — on y
   * rappelle à quelqu'un une affiche qu'il a composée, et une vignette la lui
   * remet en tête bien mieux qu'un titre.
   */
  imageUrl?: string | null;
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
  const origine = (process.env.PUBLIC_ORIGIN ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(origine))
    return `<div style="font-size:20px;letter-spacing:.6px">Memory Line</div>`;
  return `<img src="${origine}/logo-memory-line.png" width="150" height="67" alt="Memory Line" style="display:block;border:0;outline:none;text-decoration:none;height:auto;width:150px;max-width:150px;font-size:20px;letter-spacing:.6px;color:#121212" />`;
}

function gabarit(titre: string, contenu: string): string {
  return `<!doctype html>
<html lang="fr"><body style="margin:0;background:#f3f3f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#121212">
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
          Memory Line, affiches personnalisées.<br />
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

/**
 * Les articles du panier, avec leur vignette quand on en a une.
 *
 * Une image par ligne plutôt qu'une seule en tête du courrier : le panier
 * peut contenir deux affiches très différentes, et n'en montrer qu'une
 * laisserait croire que l'autre a disparu. La vignette a une taille FIXE en
 * attributs HTML et pas seulement en CSS — les vieilles messageries ignorent
 * le style et affichent alors l'image en pleine largeur, qui pousse le prix
 * hors de l'écran.
 */
function tableauLignesAvecImage(lignes: LigneCourrier[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0">
    ${lignes
      .map(
        (l) => `<tr>
      ${
        l.imageUrl
          ? `<td width="72" style="padding:10px 12px 10px 0;border-bottom:1px solid #eee;vertical-align:top">
        <img src="${h(l.imageUrl)}" width="64" height="90" alt="" style="display:block;border:0;width:64px;height:auto;max-width:64px;background:#f3f3f3" />
      </td>`
          : ""
      }
      <td style="padding:10px 0;border-bottom:1px solid #eee;vertical-align:top">
        <strong style="font-weight:500">${h(l.titre)}</strong><br />
        <span style="color:#5b5b54;font-size:13px">Format ${h(l.format ?? "A4")}${
          l.cadre ? ` · ${h(l.cadre)}` : ""
        } · ×${l.quantite}</span>${
          l.indisponible
            ? `<br /><span style="color:#8a5a2b;font-size:13px">Cette affiche n'est plus disponible.</span>`
            : ""
        }
      </td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid #eee;white-space:nowrap;vertical-align:top">
        ${prix(l.unitPriceCents * l.quantite)}
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
}): Courrier {
  const manquants = d.lignes.filter((l) => l.indisponible);
  const avertissement = manquants.length
    ? `<p style="margin:0 0 4px;color:#8a5a2b;font-size:14px">${
        manquants.length > 1
          ? "Certaines de ces affiches ne sont plus disponibles"
          : "Une de ces affiches n'est plus disponible"
      } : le reste de votre panier vous attend toujours.</p>`
    : "";
  const promo = d.codePromo
    ? `<p style="margin:0 0 4px;color:#5b5b54;font-size:14px">Votre code de réduction <strong style="font-weight:500">${h(d.codePromo)}</strong> est déjà appliqué.</p>`
    : "";
  const desinscription = d.lienDesinscription
    ? `<p style="margin:24px 0 0;color:#5b5b54;font-size:12px">Vous recevez ce message parce que vous avez laissé une commande en cours chez nous.
        <a href="${h(d.lienDesinscription)}" style="color:#5b5b54">Ne plus recevoir de rappel de panier</a>.</p>`
    : "";

  return {
    to: "",
    subject: "Votre affiche vous attend",
    html: gabarit(
      `Bonjour ${h(d.prenomClient)},`,
      `<p style="margin:0">Vous avez composé une affiche sans finir votre commande. Elle est toujours là, telle que vous l'avez laissée.</p>
       ${tableauLignesAvecImage(d.lignes)}
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
         <tr><td style="padding:4px 0"><strong style="font-weight:500">Votre panier</strong></td><td align="right"><strong style="font-weight:500">${prix(d.totalCents)}</strong></td></tr>
       </table>
       ${avertissement}
       ${promo}
       <p style="margin:20px 0"><a href="${h(d.lien)}" style="display:inline-block;background:#121212;color:#ffffff;padding:14px 28px;text-decoration:none">Reprendre ma commande</a></p>
       <p style="margin:0;color:#5b5b54;font-size:14px">Si vous avez changé d'avis, ignorez simplement ce message.</p>
       ${desinscription}`,
    ),
    text:
      `Bonjour ${d.prenomClient},\n\n` +
      `Vous avez composé une affiche sans finir votre commande. Elle vous attend :\n` +
      d.lignes
        .map(
          (l) =>
            `- ${l.titre} (${l.format ?? "A4"}) × ${l.quantite} — ${prix(l.unitPriceCents * l.quantite)}` +
            (l.indisponible ? " — plus disponible" : ""),
        )
        .join("\n") +
      `\nTotal : ${prix(d.totalCents)}\n` +
      (d.codePromo ? `Votre code de réduction ${d.codePromo} est déjà appliqué.\n` : "") +
      `\nReprendre ma commande : ${d.lien}\n` +
      (d.lienDesinscription
        ? `\nNe plus recevoir de rappel de panier : ${d.lienDesinscription}\n`
        : "") +
      `\nMemory Line`,
    // Le bouton « Se désabonner » des messageries. Les deux en-têtes vont
    // ensemble : sans le second, Gmail affiche un lien, pas le bouton.
    ...(d.lienDesinscription
      ? {
          entetes: {
            "List-Unsubscribe": `<${d.lienDesinscription}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
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
  lien: string | null;
}): Courrier {
  const bouton = d.lien
    ? `<p style="margin:20px 0"><a href="${h(d.lien)}" style="display:inline-block;background:#121212;color:#ffffff;padding:14px 28px;text-decoration:none">Ouvrir mon compte</a></p>`
    : "";
  return {
    to: "",
    subject: "Bienvenue chez Memory Line",
    html: gabarit(
      `Bonjour ${d.prenomClient},`,
      `<p style="margin:0">Votre compte est créé. Vous y retrouvez vos commandes et leur suivi, les affiches que vous avez composées, et les adresses de livraison que vous enregistrez une fois pour toutes.</p>
       ${bouton}
       <p style="margin:20px 0 0;color:#5b5b54;font-size:14px">Nous ne vous demanderons jamais votre mot de passe par e-mail. Une question ? Répondez simplement à ce message.</p>`,
    ),
    text:
      `Bonjour ${d.prenomClient},\n\nVotre compte Memory Line est créé. Vous y retrouvez vos commandes et leur suivi, vos affiches et vos adresses de livraison.` +
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
  lien: string | null;
}): Courrier {
  const origine = d.parReinitialisation
    ? `<p style="margin:0">Le mot de passe de votre compte Memory Line vient d'être changé, à partir du lien de réinitialisation demandé depuis la page de connexion. Toutes les sessions ouvertes ont été fermées : il faut vous reconnecter sur chaque appareil.</p>`
    : `<p style="margin:0">Le mot de passe de votre compte Memory Line vient d'être changé depuis votre compte.</p>`;
  const bouton = d.lien
    ? `<p style="margin:20px 0"><a href="${h(d.lien)}" style="display:inline-block;background:#121212;color:#ffffff;padding:14px 28px;text-decoration:none">Reprendre la main sur mon compte</a></p>`
    : "";
  return {
    to: "",
    subject: "Le mot de passe de votre compte a été modifié",
    html: gabarit(
      `Bonjour ${d.prenomClient},`,
      `${origine}
       <p style="margin:16px 0 0">Si vous n'êtes pas à l'origine de ce changement, votre compte vous échappe. Demandez tout de suite un nouveau mot de passe depuis la page de connexion, puis prévenez-nous en répondant à ce message.</p>
       ${bouton}
       <p style="margin:20px 0 0;color:#5b5b54;font-size:14px">Ce message est un avis de sécurité. Il ne contient aucun mot de passe, et nous ne vous demanderons jamais le vôtre.</p>`,
    ),
    text:
      `Bonjour ${d.prenomClient},\n\nLe mot de passe de votre compte Memory Line vient d'être changé` +
      (d.parReinitialisation
        ? `, à partir du lien de réinitialisation que vous aviez demandé. Toutes les sessions ouvertes ont été fermées.`
        : ` depuis votre compte.`) +
      `\n\nSi ce n'est pas vous, demandez tout de suite un nouveau mot de passe depuis la page de connexion` +
      (d.lien ? ` : ${d.lien}` : ".") +
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
  const partiel = d.totalRembourseCents < d.totalCommandeCents;

  const mention = partiel
    ? `<p style="margin:16px 0 0">Il s'agit d'un remboursement partiel : le reste de votre commande n'est pas concerné.</p>`
    : "";

  const port = d.portCents
    ? `<p style="margin:16px 0 0;font-size:14px;color:#5b5b54">Dont frais de port : ${prix(d.portCents)}.</p>`
    : "";

  // Le cumul n'a de sens qu'à partir du deuxième remboursement : sinon il
  // répète le montant qu'on vient de lire, deux lignes plus haut.
  const cumul =
    d.totalRembourseCents > d.montantCents
      ? `<p style="margin:16px 0 0;font-size:14px;color:#5b5b54">Au total, ${prix(d.totalRembourseCents)} vous ont été rendus sur cette commande de ${prix(d.totalCommandeCents)}.</p>`
      : "";

  const delai = d.viaPaiementEnLigne
    ? `<p style="margin:20px 0 0">Le montant repart vers le moyen de paiement utilisé pour la commande. Comptez quelques jours ouvrés avant de le voir sur votre relevé : ce délai est celui de votre banque, il ne dépend pas de nous.</p>`
    : `<p style="margin:20px 0 0">Ce remboursement se fait en dehors du paiement en ligne. Nous revenons vers vous si une information nous manque pour vous le verser.</p>`;

  return {
    to: "",
    subject: partiel
      ? `Remboursement partiel de votre commande ${d.numero}`
      : `Remboursement de votre commande ${d.numero}`,
    html: gabarit(
      `Bonjour ${d.prenomClient},`,
      `<p style="margin:0">Nous avons enregistré un remboursement de <strong style="font-weight:500">${prix(d.montantCents)}</strong> sur votre commande ${h(d.numero)}.</p>
       ${mention}
       ${d.articles.length ? tableauLignes(d.articles) : ""}
       ${port}
       ${cumul}
       ${delai}
       <p style="margin:24px 0 0;color:#5b5b54;font-size:14px">Une question sur ce remboursement ? Répondez simplement à cet e-mail.</p>`,
    ),
    text:
      `Bonjour ${d.prenomClient},\n\nUn remboursement de ${prix(d.montantCents)} a été enregistré sur votre commande ${d.numero}.` +
      (partiel
        ? `\nIl s'agit d'un remboursement partiel : le reste de la commande n'est pas concerné.`
        : "") +
      (d.viaPaiementEnLigne
        ? `\nComptez quelques jours ouvrés avant de le voir sur votre relevé.`
        : `\nCe remboursement se fait en dehors du paiement en ligne.`) +
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
}): Courrier {
  const motif = d.motif
    ? `<p style="margin:16px 0 0">Motif : ${h(d.motif)}</p>`
    : "";
  const argent = d.dejaPayee
    ? `<p style="margin:16px 0 0">Le montant réglé vous est rendu. Vous recevrez un message dédié dès que le remboursement est enregistré, avec le détail et le délai.</p>`
    : "";
  return {
    to: "",
    subject: `Votre commande ${d.numero} est annulée`,
    html: gabarit(
      `Bonjour ${d.prenomClient},`,
      `<p style="margin:0">Votre commande ${h(d.numero)} est annulée. Rien ne sera fabriqué ni expédié.</p>
       ${motif}
       ${tableauLignesSansPrix(d.articles)}
       ${argent}
       <p style="margin:20px 0 0;color:#5b5b54;font-size:14px">Si cette annulation vous surprend, répondez à ce message : nous reprendrons la commande avec vous.</p>`,
    ),
    text:
      `Bonjour ${d.prenomClient},\n\nVotre commande ${d.numero} est annulée. Rien ne sera fabriqué ni expédié.` +
      (d.motif ? `\nMotif : ${d.motif}` : "") +
      (d.dejaPayee
        ? `\nLe montant réglé vous est rendu ; un message dédié suivra dès que le remboursement est enregistré.`
        : "") +
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
}): Courrier {
  const reglement = d.dejaPayee
    ? `<p style="margin:16px 0 0">Cette commande est réglée : la facture est acquittée, vous n'avez rien à faire.</p>`
    : `<p style="margin:16px 0 0">Cette commande n'est pas encore réglée. Nous revenons vers vous si un règlement nous manque.</p>`;
  return {
    to: "",
    subject: `Votre facture ${d.numeroFacture} — commande ${d.numero}`,
    html: gabarit(
      `Bonjour ${h(d.prenomClient)},`,
      `<p style="margin:0">Voici la facture de votre commande ${h(d.numero)}, en pièce jointe.</p>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;font-size:14px">
         <tr><td style="padding:4px 0;color:#5b5b54">Facture n°</td><td align="right"><strong style="font-weight:500">${h(d.numeroFacture)}</strong></td></tr>
         <tr><td style="padding:4px 0;color:#5b5b54">Commande</td><td align="right">${h(d.numero)}</td></tr>
         <tr><td style="padding:4px 0;color:#5b5b54">Montant</td><td align="right"><strong style="font-weight:500">${prix(d.totalCents)}</strong></td></tr>
       </table>
       ${reglement}
       <p style="margin:24px 0 0;color:#5b5b54;font-size:14px">Une question sur cette facture ? Répondez simplement à cet e-mail.</p>`,
    ),
    text:
      `Bonjour ${d.prenomClient},\n\nVoici la facture de votre commande ${d.numero}, en pièce jointe.\n` +
      `Facture n° ${d.numeroFacture} — ${prix(d.totalCents)}.\n` +
      (d.dejaPayee
        ? `Cette commande est réglée : la facture est acquittée.\n`
        : `Cette commande n'est pas encore réglée.\n`) +
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
