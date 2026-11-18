/**
 * L'identité de la boutique sur ses factures : adresse, SIRET, et une
 * mention complémentaire facultative.
 *
 * L'adresse et le SIRET sont des mentions OBLIGATOIRES d'une facture (art.
 * 242 nonies A de l'annexe II au CGI). La facture savait déjà les imprimer —
 * elle lisait les réglages `facture.adresse` et `facture.siret` —, mais rien
 * ne permettait de les saisir : il fallait écrire dans la base. Ce module
 * leur donne un écran (BO › Factures) et des règles :
 *
 *   - l'adresse tient en 4 lignes de 50 caractères au plus — c'est la place
 *     du bloc « Émetteur », en haut à gauche de la page ;
 *   - le SIRET a 14 chiffres, on accepte les espaces de qui le recopie
 *     depuis un Kbis, et on prévient (sans bloquer) si la clé de contrôle ne
 *     tombe pas juste — une faute de frappe se voit avant d'être imprimée sur
 *     cent factures ;
 *   - la mention (« EI », « RCS Mulhouse … ») est libre : on n'en invente
 *     aucune. La TVA a déjà la sienne, en pied de page.
 *
 * Une facture se refabrique à chaque téléchargement. L'émetteur est donc
 * FIGÉ sur la commande avec le numéro de facture (`order.invoice_issuer`,
 * voir commandes.ts) : changer d'adresse plus tard ne réécrit pas les
 * factures déjà émises. Celles d'avant ce figeage prennent les réglages du
 * moment, comme elles l'ont toujours fait.
 */
import type { Context, Hono } from "hono";
import { inArray } from "drizzle-orm";
import { db, schema } from "./db/client.js";

export const CLES_FACTURE = {
  adresse: "facture.adresse",
  siret: "facture.siret",
  mention: "facture.mention",
} as const;

export const ADRESSE_LIGNES_MAX = 4;
export const ADRESSE_LIGNE_MAX = 50;
export const MENTION_MAX = 80;

/** Ce que le bloc « Émetteur » de la facture imprime sous le nom de la boutique. */
export interface Emetteur {
  adresse: string[];
  siret: string | null;
  mention: string | null;
}

/**
 * L'émetteur porte-t-il les deux mentions obligatoires, adresse ET SIRET ?
 *
 * C'est ce qui décide s'il peut être FIGÉ sur une facture (commandes.ts,
 * numeroterLaFacture). Figer un émetteur vide, c'était graver pour toujours
 * une facture sans adresse ni SIRET, émise avant que la boutique ne les
 * saisisse : elle ne les aurait jamais rattrapés. Incomplet, il ne se fige
 * pas, et la facture relit les réglages du moment à chaque téléchargement.
 */
export function emetteurComplet(e: Emetteur | null | undefined): e is Emetteur {
  return !!e && Array.isArray(e.adresse) && e.adresse.length > 0 && !!e.siret;
}

/* -------------------------------------------------------------------------- */
/*  Les règles, sans base : elles s'essaient seules (tests/facture.test.ts)   */
/* -------------------------------------------------------------------------- */

/**
 * L'adresse, découpée en lignes : espaces de bord retirés, lignes vides
 * ôtées. Refusée au-delà de 4 lignes ou de 50 caractères par ligne — la
 * facture la couperait, ou la ferait déborder sur « Facturé à ».
 */
export function lignesDAdresse(brut: unknown): {
  lignes: string[];
  erreur: string | null;
} {
  const lignes = String(brut ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (lignes.length > ADRESSE_LIGNES_MAX)
    return {
      lignes,
      erreur: `L'adresse tient en ${ADRESSE_LIGNES_MAX} lignes au plus (vous en avez ${lignes.length}).`,
    };
  const longue = lignes.findIndex((l) => l.length > ADRESSE_LIGNE_MAX);
  if (longue >= 0)
    return {
      lignes,
      erreur: `Ligne ${longue + 1} de l'adresse trop longue : ${ADRESSE_LIGNE_MAX} caractères au plus. Passez à la ligne.`,
    };
  return { lignes, erreur: null };
}

/**
 * La clé de contrôle d'un SIRET (algorithme de Luhn).
 *
 * Une exception connue : les établissements de La Poste (SIREN 356 000 000),
 * dont la somme des chiffres doit être un multiple de 5. Un faux positif ici
 * ne bloque rien — c'est un avertissement —, mais autant ne pas le donner.
 */
export function cleSiretValide(chiffres: string): boolean {
  if (!/^\d{14}$/.test(chiffres)) return false;
  if (chiffres.startsWith("356000000")) {
    const somme = [...chiffres].reduce((s, c) => s + Number(c), 0);
    return somme % 5 === 0;
  }
  let somme = 0;
  for (let i = 0; i < 14; i++) {
    let n = Number(chiffres[13 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    somme += n;
  }
  return somme % 10 === 0;
}

/**
 * Le SIRET nettoyé : 14 chiffres, ou rien. Espaces, points et tirets de
 * recopie retirés. Vide = pas de SIRET (la facture sortira sans, et l'écran
 * le dit).
 */
export function siretNettoye(brut: unknown): {
  siret: string | null;
  erreur: string | null;
  avertissement: string | null;
} {
  const saisi = String(brut ?? "").trim();
  if (!saisi) return { siret: null, erreur: null, avertissement: null };
  const chiffres = saisi.replace(/[\s.\-]/g, "");
  if (!/^\d{14}$/.test(chiffres))
    return {
      siret: null,
      erreur: `Le SIRET compte 14 chiffres (vous en avez saisi ${chiffres.replace(/\D/g, "").length}${/\D/.test(chiffres) ? ", avec d'autres caractères" : ""}).`,
      avertissement: null,
    };
  return {
    siret: chiffres,
    erreur: null,
    avertissement: cleSiretValide(chiffres)
      ? null
      : "Ce SIRET ne passe pas le contrôle de sa clé : vérifiez-le sur votre Kbis ou l'avis de situation INSEE. Il est enregistré tel quel.",
  };
}

/** « 123 456 789 00012 » : groupé comme sur un Kbis, plus lisible imprimé. */
export function siretGroupe(siret: string | null | undefined): string | null {
  if (!siret) return null;
  const c = siret.replace(/\s/g, "");
  if (!/^\d{14}$/.test(c)) return siret;
  return `${c.slice(0, 3)} ${c.slice(3, 6)} ${c.slice(6, 9)} ${c.slice(9)}`;
}

/** La mention complémentaire : une ligne, 80 caractères au plus. */
export function mentionNettoyee(brut: unknown): {
  mention: string | null;
  erreur: string | null;
} {
  const m = String(brut ?? "").replace(/\s+/g, " ").trim();
  if (!m) return { mention: null, erreur: null };
  if (m.length > MENTION_MAX)
    return {
      mention: null,
      erreur: `La mention complémentaire tient en ${MENTION_MAX} caractères au plus.`,
    };
  return { mention: m, erreur: null };
}

/**
 * Une valeur de réglage, telle qu'on l'imprime.
 *
 * Le réglage a pu être écrit avant cet écran, par la route générale des
 * réglages, qui range une valeur traduite en dictionnaire `{ fr: … }` :
 * imprimée telle quelle, elle donnait « [object Object] » sur la facture.
 * On prend le français, puis la première chaîne venue.
 */
function texteDuReglage(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => String(x ?? "")).join("\n");
  if (typeof v === "object") {
    const dico = v as Record<string, unknown>;
    if (typeof dico.fr === "string") return dico.fr;
    const premiere = Object.values(dico).find((x) => typeof x === "string");
    return typeof premiere === "string" ? premiere : "";
  }
  return String(v);
}

/**
 * L'émetteur tel que les réglages le disent, nettoyé avec les mêmes règles
 * que la saisie — mais sans refuser : une adresse posée à la main avant cet
 * écran s'imprime comme avant, coupée à 4 lignes.
 */
export function emetteurDepuisReglages(
  lignes: { key: string; value: unknown }[],
): Emetteur {
  const v = (cle: string) =>
    texteDuReglage(lignes.find((l) => l.key === cle)?.value).trim();
  const adresse = lignesDAdresse(v(CLES_FACTURE.adresse)).lignes.slice(
    0,
    ADRESSE_LIGNES_MAX,
  );
  const siret = siretNettoye(v(CLES_FACTURE.siret));
  return {
    adresse,
    // Un SIRET qui n'a pas 14 chiffres s'imprime quand même tel qu'il a été
    // posé : le taire ferait une facture sans SIRET, ce qui est pire.
    siret: siret.siret ?? (v(CLES_FACTURE.siret) || null),
    mention: v(CLES_FACTURE.mention).replace(/\s+/g, " ").slice(0, MENTION_MAX) || null,
  };
}

/* -------------------------------------------------------------------------- */
/*  Lecture et écriture                                                       */
/* -------------------------------------------------------------------------- */

/** Ce qui sait lire la table des réglages : la base, ou une transaction. */
type Lecteur = Pick<typeof db, "select">;

/** L'émetteur d'aujourd'hui, lu dans les réglages. */
export async function emetteurDuMoment(lecteur: Lecteur = db): Promise<Emetteur> {
  const lignes = await lecteur
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(inArray(schema.settings.key, Object.values(CLES_FACTURE)));
  return emetteurDepuisReglages(lignes);
}

/** Écrit un réglage de facture, créé au besoin. Une valeur simple, sans langue. */
async function ecrire(key: string, value: string, label: string): Promise<void> {
  await db
    .insert(schema.settings)
    .values({ key, value, label, group: "facture", updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value, label, group: "facture", updatedAt: new Date() },
    });
}

/** Les trois champs, vérifiés ensemble : la première erreur l'emporte. */
function verifier(b: Record<string, unknown>): {
  emetteur: Emetteur;
  erreur: string | null;
  avertissement: string | null;
} {
  const adresse = lignesDAdresse(b.adresse);
  const siret = siretNettoye(b.siret);
  const mention = mentionNettoyee(b.mention);
  return {
    emetteur: {
      adresse: adresse.lignes,
      siret: siret.siret,
      mention: mention.mention,
    },
    erreur: adresse.erreur ?? siret.erreur ?? mention.erreur,
    avertissement: siret.avertissement,
  };
}

/** Le corps d'une requête, qu'il vienne d'un fetch (JSON) ou d'un formulaire. */
async function corps(c: Context): Promise<Record<string, unknown>> {
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/json"))
    return ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const f = await c.req.parseBody().catch(() => ({}));
  return f as Record<string, unknown>;
}

export function mountFacturation(app: Hono): void {
  /** Ce qui est réglé aujourd'hui. Réservé à la propriétaire (garde de /admin/*). */
  app.get("/admin/facturation", async (c) => {
    const e = await emetteurDuMoment();
    return c.json({
      adresse: e.adresse.join("\n"),
      siret: e.siret,
      siretGroupe: siretGroupe(e.siret),
      mention: e.mention,
    });
  });

  /**
   * Enregistre les trois réglages. Un champ vide s'enregistre vide : la
   * facture sort alors sans lui, et l'écran le dit en rouge.
   */
  app.post("/admin/facturation", async (c) => {
    const b = await corps(c);
    const { emetteur, erreur, avertissement } = verifier(b);
    if (erreur) return c.json({ error: erreur }, 400);
    await ecrire(CLES_FACTURE.adresse, emetteur.adresse.join("\n"), "Adresse de la boutique (factures)");
    await ecrire(CLES_FACTURE.siret, emetteur.siret ?? "", "SIRET (factures)");
    await ecrire(CLES_FACTURE.mention, emetteur.mention ?? "", "Mention complémentaire (factures)");
    return c.json({
      ok: true,
      adresse: emetteur.adresse.join("\n"),
      siret: emetteur.siret,
      siretGroupe: siretGroupe(emetteur.siret),
      mention: emetteur.mention,
      avertissement,
    });
  });

  /**
   * Une facture d'EXEMPLE avec les valeurs saisies, avant de les
   * enregistrer : on voit où tombe l'adresse, si une ligne est trop longue,
   * comment le SIRET se lit.
   *
   * Rien n'est enregistré ni numéroté : les données sont fictives, la
   * facture porte « APERÇU » en travers, et son numéro n'est pas pris dans
   * la suite des vraies factures. Accepte un formulaire : le bouton de
   * l'écran l'ouvre dans un nouvel onglet, sans script.
   */
  app.post("/admin/facturation/apercu.pdf", async (c) => {
    const b = await corps(c);
    const { emetteur, erreur } = verifier(b);
    if (erreur)
      return c.text(
        `${erreur}\n\nCorrigez le champ dans le back-office, puis relancez l'aperçu.`,
        400,
      );
    const { renderInvoicePdf } = await import("./pdf.js");
    const maintenant = new Date();
    const pdf = await renderInvoicePdf({
      langue: "fr",
      numeroFacture: "F0000-0000",
      dateFacture: maintenant,
      numeroCommande: "WEB-0000",
      dateCommande: maintenant,
      clientNom: "Client d'exemple",
      clientEmail: "client@exemple.fr",
      clientAdresse: ["1 rue de l'Exemple", "00000 Ville d'exemple", "FR"],
      lignes: [
        {
          designation: "Affiche personnalisée (exemple)",
          precision: "Format A4",
          lignesAffiche: ["Texte d'exemple"],
          quantite: 1,
          unitPriceCents: 3490,
        },
      ],
      remiseCents: 0,
      portCents: 590,
      modeLivraison: "Colissimo",
      totalCents: 4080,
      rembourseCents: 0,
      mentionReglement: "Exemple : aucune commande n'est facturée.",
      adresseBoutique: emetteur.adresse,
      siret: siretGroupe(emetteur.siret),
      mention: emetteur.mention,
      filigrane: "Aperçu",
    });
    return c.body(new Uint8Array(pdf), 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="facture-exemple.pdf"',
      "Cache-Control": "private, no-store",
    });
  });
}
