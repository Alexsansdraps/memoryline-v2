import type { APIRoute } from "astro";
import {
  DELAI_PREPARATION,
  NB_LIGNES_AFFICHE,
  POSTER_FORMATS,
  delaiDuMode,
  libelleFormat,
  normaliserPays,
  politiqueDeRetour,
  type CatalogueLivraison,
} from "@memoryline/types";
import type { CadreDTO } from "@memoryline/configurator";
import { LANGUES, LANGUE_DEFAUT, NOM_LANGUE, lien, t } from "../i18n/utils.ts";
import { RAYONS_FUSIONNES } from "../lib/anciennes-adresses.ts";
import { apiInterne } from "../lib/api-interne.ts";
import {
  api,
  cadresSurLeSite,
  formatPrice,
  instagramDeLaBoutique,
  livraisonDuSite,
  prixDesCadresSurLeSite,
  type Product,
} from "../lib/api.ts";
import { GENRES, adresseDuRayon, planDuSite } from "../lib/referencement.ts";
import { descriptionMeta, nomCourtDeFiche } from "../lib/textes-seo.ts";

/**
 * /llms.txt : la boutique décrite aux IA (format proposé par llmstxt.org —
 * un titre, un résumé en citation, puis des sections de liens Markdown).
 *
 * Rendu À LA DEMANDE, comme le plan du site, à partir de ce que la boutique
 * publie au moment même : rayons ouverts, pages publiées, affiches en vente,
 * prix des variantes, cadres, tarifs et délais de BO › Livraison, moyens de
 * paiement actifs. Rien n'y est écrit en dur qui doublerait un réglage : un
 * tarif changé au back-office change ici aussi. Ce que les données ne disent
 * pas n'est pas dit — la page renvoie alors aux conditions de vente.
 *
 * En français seulement : c'est la langue de référence du catalogue, et une
 * IA lit le français. Les autres langues sont signalées, sans plus.
 *
 * Pas de ligne dans robots.txt : llms.txt n'est pas un standard, aucun robot
 * ne l'y cherche, et Google signale toute directive qu'il ne connaît pas
 * comme une erreur dans son rapport robots.txt. Il se trouve à sa place
 * convenue, à la racine, comme robots.txt lui-même. Pas de /llms-full.txt
 * non plus : les pages publiées (CGV comprises) portent encore des « À
 * COMPLÉTER », et la liste des affiches tient déjà dans la section
 * « Optional » ci-dessous, que la spécification réserve à ce qu'une IA
 * pressée peut sauter.
 */
export const prerender = false;

/**
 * Le texte, gardé cinq minutes — la durée du plan du site, dont il dépend.
 * Il coûte une dizaine d'appels à l'API ; vingt robots à la suite ne les
 * paient qu'une fois. API muette : on sert le texte qu'on avait, même vieux.
 */
const CACHE_MS = 5 * 60 * 1000;
let cache: { a: number; texte: string } | null = null;
let enCours: Promise<string> | null = null;

const tr = t(LANGUE_DEFAUT);

/** « 23 € » avec des espaces ordinaires : Intl en met d'insécables, invisibles dans un .txt. */
const prix = (cents: number) => formatPrice(cents).replace(/[  ]/g, " ");

/** Le nom d'un pays en français (« BE » → « Belgique »), le code à défaut. */
const nomsPays = new Intl.DisplayNames(["fr"], { type: "region" });
const nomPays = (code: string) => {
  try {
    return nomsPays.of(code) ?? code;
  } catch {
    return code;
  }
};

/** Un texte sur une ligne, sans crochet qui casserait un lien Markdown. */
const ligne = (s: string) => s.replace(/\s+/g, " ").replace(/[[\]]/g, "").trim();

/** Une lecture de l'API qui n'est pas indispensable : null en cas de panne. */
async function facultatif<T>(lecture: () => Promise<T>): Promise<T | null> {
  try {
    return await lecture();
  } catch {
    return null;
  }
}

/** Lu directement : lib/api.ts n'a ces deux lectures que côté navigateur. */
async function lireApi<T>(chemin: string): Promise<T> {
  const res = await fetch(`${apiInterne()}${chemin}`);
  if (!res.ok) throw new Error(`API ${chemin} -> ${res.status}`);
  return res.json() as Promise<T>;
}

/** « A4 dès 23 €, A3 dès 29 € » — « dès » seulement quand les prix varient. */
function prixParFormat(affiches: readonly Product[]): string {
  return POSTER_FORMATS.flatMap((f) => {
    const p = affiches.flatMap((a) =>
      a.variants.filter((v) => v.format === f).map((v) => v.priceCents),
    );
    if (!p.length) return [];
    const mini = Math.min(...p);
    return [`${libelleFormat(f)} ${mini === Math.max(...p) ? "" : "dès "}${prix(mini)}`];
  }).join(", ");
}

/**
 * La livraison, zone par zone, telle que la caisse la calcule : chaque mode
 * actif qui a un tarif actif dans la zone, son prix, son seuil de gratuité,
 * le délai écrit dans sa description. Plusieurs tranches de poids : le prix
 * de la première, précédé de « dès ».
 */
function lignesLivraison(catalogue: CatalogueLivraison): string[] {
  const zones = [...catalogue.zones].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const modes = catalogue.modes
    .filter((m) => m.active !== false)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const lignes: string[] = [];
  for (const zone of zones) {
    const pays = [...new Set((zone.countries ?? []).map(normaliserPays).filter(Boolean))];
    const offres = modes.flatMap((mode) => {
      const tarifs = catalogue.tarifs
        .filter((x) => x.methodId === mode.id && x.zoneId === zone.id && x.active !== false)
        .sort((a, b) => (a.minWeightGrams ?? 0) - (b.minWeightGrams ?? 0));
      const premier = tarifs[0];
      if (!premier) return [];
      const montant =
        premier.priceCents > 0
          ? `${tarifs.length > 1 ? "dès " : ""}${prix(premier.priceCents)}`
          : "sans frais";
      const franchise =
        typeof premier.freeFromCents === "number" && premier.freeFromCents >= 0 && premier.priceCents > 0
          ? `, offert dès ${prix(premier.freeFromCents)} d'achat`
          : "";
      const description = mode.description?.trim() ? ` (${ligne(mode.description)})` : "";
      return [`${ligne(mode.name)}${description} : ${montant}${franchise}`];
    });
    if (!offres.length) continue;
    // Une zone sans pays est celle qui ramasse le reste : elle ne se détaille pas.
    const ou = pays.length ? ` (${pays.map(nomPays).join(", ")})` : "";
    lignes.push(`- ${ligne(zone.name)}${ou} : ${offres.join(" ; ")}.`);
  }
  const lieux = catalogue.lieuxRetrait ?? [];
  if (lieux.length && modes.some((m) => m.kind === "pickup"))
    lignes.push(
      `- Retrait sur place : ${lieux.map((l) => ligne(l.nom + (l.adresse ? `, ${l.adresse}` : ""))).join(" ; ")}.`,
    );
  return lignes;
}

async function composer(base: string): Promise<string> {
  // Le plan est indispensable : sans lui, ni rayons ni pages. Le reste
  // enrichit le texte, et son absence retire une ligne, jamais le fichier.
  const plan = await planDuSite();
  const [rayons, catalogue, pages, livraison, cadres, cadresSite, prixCadres, paiement, instagram] =
    await Promise.all([
      facultatif(() => api.collections()),
      facultatif(() => api.catalogue({ tri: "alpha", limite: 1000 })),
      Promise.all(plan.pages.map((p) => facultatif(() => api.page(p.slug)))),
      livraisonDuSite(),
      facultatif(() => lireApi<(CadreDTO & { active?: boolean; archivedAt?: string | null })[]>("/frames")),
      cadresSurLeSite(),
      prixDesCadresSurLeSite(),
      facultatif(() =>
        lireApi<{ stripe: unknown; paypal: unknown }>("/payments/config"),
      ),
      instagramDeLaBoutique(),
    ]);

  const url = (chemin: string) => base + lien(LANGUE_DEFAUT, chemin);
  const affiches = catalogue?.items ?? [];
  const duGenre = (g: string) => affiches.filter((a) => a.kind === g);
  const nature = (g: string, n = 1) =>
    g === "personnalisable" ? `personnalisable${n > 1 ? "s" : ""}` : `prête${n > 1 ? "s" : ""} à imprimer`;
  const nomDuRayon = new Map((rayons ?? []).map((r) => [r.slug, ligne(r.name)]));

  const out: string[] = [
    "# Memory Line",
    "",
    `> ${tr("meta.description")}`,
    "",
    "Boutique en ligne française d'affiches imprimées : des lieux (villes, plages, paysages, thèmes) dessinés, que l'on complète en ligne de ses propres textes et personnages avant impression.",
    `Le site est en français à la racine ; il existe aussi en ${LANGUES.filter((l) => l !== LANGUE_DEFAUT)
      .map((l) => `${NOM_LANGUE[l]} (${base}/${l})`)
      .join(", ")}, où le catalogue peut rester rédigé en français.`,
    "",
    "## Ce que vend Memory Line",
    "",
  ];

  // Les deux genres, avec leur nombre d'affiches et leurs prix réels.
  const presentation: Record<(typeof GENRES)[number], string> = {
    personnalisable:
      "un lieu dessiné, à composer en ligne (fond, textes, personnages). Chaque affiche est imprimée pour la personne qui l'a composée",
    prete_a_imprimer: "vendues telles qu'elles sont présentées, sans personnalisation",
  };
  for (const g of GENRES) {
    if (!plan.genres[g]) continue;
    const tarifs = prixParFormat(duGenre(g));
    out.push(
      `- ${tr(g === "personnalisable" ? "nav.personnalisables" : "nav.pretes")} (${plan.genres[g]} affiches) : ${presentation[g]}.${tarifs ? ` Prix : ${tarifs}.` : ""}`,
    );
  }
  out.push(`- Formats : ${POSTER_FORMATS.map((f) => libelleFormat(f)).join(", ")}, en portrait.`);
  const cadresEnVente = (cadres ?? []).filter((c) => c.active !== false && !c.archivedAt);
  if (cadresSite && cadresEnVente.length) {
    const noms = cadresEnVente.map((c) => ligne(c.name)).join(", ");
    // Le supplément ne se dit que si le site l'affiche (BO › Cadres) ; et
    // seulement s'il est le même pour tous les cadres, sinon cadre par cadre.
    const supplements = POSTER_FORMATS.map((f) => {
      const p = cadresEnVente.map((c) => (f === "A3" ? c.priceA3Cents : c.priceA4Cents));
      return `${f} ${Math.min(...p) === Math.max(...p) ? "" : "dès "}${prix(Math.min(...p))}`;
    }).join(", ");
    out.push(`- Cadres en option : ${noms}${prixCadres ? ` (supplément : ${supplements})` : ""}.`);
  }
  out.push(
    "- Prix en euros, affichés sur chaque fiche ; frais de livraison en plus, calculés à la caisse.",
    "",
    "## Personnalisation et commande",
    "",
    // Les trois étapes du module de personnalisation (packages/configurator,
    // STEPS et MESSAGES_DEFAUT) et le déroulé de la commande (CGV, article 4).
    `1. Choisir une affiche personnalisable, puis la composer dans le module de personnalisation de sa fiche, en trois étapes : « Fond & texte » (le fond, jusqu'à ${NB_LIGNES_AFFICHE} lignes de texte — un lieu, des prénoms, une date —, leur police et leur couleur), « Personnages » (ajouter des personnages, choisir vêtements, pantalon, coupe de cheveux, accessoires et leurs couleurs, les placer sur l'affiche), « Format » (${POSTER_FORMATS.join(" ou ")}${cadresSite && cadresEnVente.length ? ", cadre en option" : ""}, nombre d'exemplaires).`,
    "2. Ajouter l'affiche au panier, saisir ses coordonnées et l'adresse de livraison, choisir le mode de livraison, puis payer.",
  );
  const moyens = [paiement?.stripe ? "carte bancaire (Stripe)" : "", paiement?.paypal ? "PayPal" : ""].filter(Boolean);
  out.push(
    `3. Paiement en ligne au moment de la commande${moyens.length ? `, par ${moyens.join(" ou ")}` : ""}. Un courriel de confirmation récapitule la commande ; elle part en fabrication une fois le paiement encaissé.`,
    "",
    "Les textes sont imprimés exactement tels qu'ils ont été saisis : l'orthographe des prénoms et des dates est à vérifier avant de payer.",
    "",
    "## Livraison",
    "",
    // Le délai de fabrication est celui que les fiches annoncent à Google
    // (donnees-structurees.ts) : les deux ne doivent pas se contredire.
    `- Impression à la demande : ${DELAI_PREPARATION.min} à ${DELAI_PREPARATION.max} jours ouvrés de préparation avant l'envoi, puis le délai du transporteur.`,
  );
  if (livraison) {
    out.push(...lignesLivraison(livraison));
    // Les délais lus dans les descriptions des modes (« 3 à 5 jours ouvrés »).
    if (!livraison.modes.some((m) => delaiDuMode(m.description)))
      out.push("- Délais d'acheminement : selon le transporteur.");
  }
  out.push(
    `- Le montant exact, selon le pays et le poids du colis, s'affiche avant le paiement. Détail : [Conditions générales de vente](${url("/pages/conditions-de-vente")}).`,
    "",
    "## Retours et garanties",
    "",
  );
  // Les règles que les fiches donnent à Google (politiqueDeRetour), d'après
  // les CGV : article 7 pour la rétractation, article 8 pour la garantie.
  const retourPretes = politiqueDeRetour("prete_a_imprimer");
  out.push(
    "- Affiches personnalisées : pas de droit de rétractation (article L221-28, 3° du Code de la consommation) — elles sont fabriquées d'après ce que le client a composé, ni reprises ni échangées pour un changement d'avis ou une faute de frappe.",
    `- Affiches prêtes à imprimer : retour possible sous ${retourPretes.merchantReturnDays} jours après réception, par la poste, frais de retour à la charge du client.`,
    "- Affiche abîmée, mal imprimée ou non conforme à la commande : réimprimée et renvoyée aux frais de la boutique, ou remboursée — en écrivant avec le numéro de commande et une photo.",
    "",
    "## Rayons",
    "",
    `- [${tr("catalogue.titre")}](${url("/affiches")}) : ${plan.produits.length} affiches`,
  );
  for (const g of GENRES)
    if (plan.genres[g] > 0)
      out.push(
        `- [${tr(g === "personnalisable" ? "nav.personnalisables" : "nav.pretes")}](${url(adresseDuRayon(g))}) : ${plan.genres[g]} affiches`,
      );
  // Les mêmes rayons que le plan du site : ouverts, non vides, non fusionnés.
  // Leur texte de présentation n'est pas repris : plusieurs datent de Shopify
  // et décrivent des articles que la boutique ne vend plus.
  for (const r of plan.rayons.filter((r) => r.produits > 0 && !RAYONS_FUSIONNES[r.slug]))
    out.push(
      `- [${nomDuRayon.get(r.slug) ?? r.slug}](${url(adresseDuRayon(r.genre, r.slug))}) : ${r.produits} affiche${r.produits > 1 ? "s" : ""}${r.genre ? ` ${nature(r.genre, r.produits)}` : ""}`,
    );
  out.push(
    `- [${tr("recherche.titre")}](${url("/recherche")}) : ajouter « ?q= » suivi d'une ville ou d'un lieu (${url("/recherche")}?q=amiens)`,
    "",
    "## Informations",
    "",
    `- [Contact](${url("/contact")}) : formulaire pour écrire à la boutique (question, correction d'une commande, suivi d'un colis)`,
  );
  pages.forEach((page, i) => {
    const slug = plan.pages[i]!.slug;
    const resume = descriptionMeta(page?.seoDescription);
    out.push(`- [${ligne(page?.title || slug)}](${url(`/pages/${slug}`)})${resume ? ` : ${ligne(resume)}` : ""}`);
  });
  if (instagram) out.push(`- [Instagram](${instagram}) : le compte de la boutique`);

  // La liste des affiches : utile pour savoir si un lieu existe, mais longue.
  // La section « Optional » est, d'après llmstxt.org, celle qu'on peut sauter.
  if (affiches.length) {
    out.push("", "## Optional", "");
    for (const a of affiches) {
      const tarifs = POSTER_FORMATS.flatMap((f) => {
        const v = a.variants.find((x) => x.format === f);
        return v ? [`${f} ${prix(v.priceCents)}`] : [];
      }).join(", ");
      out.push(
        `- [${ligne(nomCourtDeFiche(a.name))}](${url(`/affiches/${a.slug}`)}) : affiche ${nature(a.kind)}${tarifs ? `, ${tarifs}` : ""}`,
      );
    }
  }
  out.push("");
  return out.join("\n");
}

async function texteDuSite(base: string): Promise<string> {
  if (cache && Date.now() - cache.a < CACHE_MS) return cache.texte;
  enCours ??= composer(base)
    .then((texte) => {
      cache = { a: Date.now(), texte };
      return texte;
    })
    .finally(() => {
      enCours = null;
    });
  try {
    return await enCours;
  } catch (e) {
    if (cache) return cache.texte;
    throw e;
  }
}

export const GET: APIRoute = async ({ site }) => {
  const base = (site?.toString() ?? "https://memoryline.fr").replace(/\/$/, "");
  // Le serveur de test ne doit rien faire indexer, pas même ce fichier.
  const enTest = import.meta.env.PUBLIC_NOINDEX === "true";
  let texte: string;
  try {
    texte = await texteDuSite(base);
  } catch {
    return new Response("Description de la boutique momentanément indisponible.\n", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "300" },
    });
  }
  return new Response(texte, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Une heure chez le visiteur ou un proxy : le texte ne bouge qu'avec le catalogue.
      "Cache-Control": "public, max-age=3600",
      ...(enTest ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
    },
  });
};
