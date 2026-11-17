/// <reference lib="dom" />
import {
  t,
  lien,
  LANGUE_DEFAUT,
  LOCALE_COMPLETE,
  type CleUi,
  type Langue,
} from "../i18n/utils.ts";
import {
  createResource,
  createSignal,
  createEffect,
  onMount,
  untrack,
  Show,
  For,
  type JSX,
} from "solid-js";
import {
  MODE_RETRAIT_STAND,
  codePaysSaisi,
  codePostalValide,
  telephoneValide,
  demandeUnPointRelais,
  demandeUneAdresse,
  formaterPoids,
  optionsLivraison,
  PAYS_PROPOSES,
  seuilPortCents,
  remisesPanier,
  totalPanierCents,
  partCarteCadeau,
  resteAPayerCents,
  urlAsset,
  type OptionLivraison,
  type RegleParier,
} from "@memoryline/types";
import {
  PosterPreview,
  ZoneDefilante,
  createSvgCache,
  stateFromConfig,
  SLOTS,
  findVariant,
  variantesDeVue,
} from "@memoryline/configurator";

/**
 * Pays proposés à la livraison : la liste partagée avec le carnet d'adresses
 * du compte (cf. PAYS_PROPOSES). Leurs noms, le navigateur les connaît dans
 * toutes les langues (nomPays).
 */
const PAYS = PAYS_PROPOSES;

/**
 * Les refus de l'API que la caisse sait dire elle-même, par leur code. Leur
 * texte français est celui de l'API ; les autres langues ont enfin le leur.
 */
/** Les jours abrégés tels que l'API les écrit dans les horaires des points. */
const JOURS_API = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const ERREURS_PAR_CODE: Record<string, CleUi> = {
  compte_requis: "commande.err.compte_requis",
  point_relais_inconnu: "livraison.relais_plus_disponible",
  point_relais_requis: "livraison.relais_requis",
  point_relais_transporteur: "livraison.relais_autre_reseau",
  mode_indisponible: "commande.err.mode_indisponible",
  adresse_incomplete: "commande.err.adresse_incomplete",
  panier_vide: "panier.vide",
  panier_modifie: "commande.err.panier_modifie",
  lieu_retrait_requis: "commande.err.lieu_retrait_requis",
  telephone_invalide: "livraison.telephone_invalide",
  retrait_stand_compris: "livraison.stand_compris_requis",
  // La boutique a basculé entre l'essai et le réel pendant la commande : la
  // caisse relit ses moyens de paiement, la cliente choisit de nouveau.
  paiement_reconfigure: "commande.err.paiement_reconfigure",
  // Le code promo, la carte cadeau, la commande à 0 € (17/11).
  code_invalide: "caisse.code.invalide",
  carte_invalide: "caisse.code.invalide",
  code_deja_utilise: "caisse.code.deja_utilise",
  trop_d_essais: "caisse.code.trop_essais",
  carte_solde: "caisse.err.carte_solde",
  carte_sur_carte: "caisse.carte.sur_carte",
  carte_email: "caisse.err.carte_email",
  carte_ligne_invalide: "caisse.err.carte_ligne",
  montant_non_nul: "caisse.err.montant_non_nul",
};

/**
 * Un encaissement qui n'aboutit pas, par carte comme par PayPal : 402, le
 * paiement n'est pas complet ; 502, le prestataire n'a pas répondu.
 */
const ECHEC_ENCAISSEMENT: Partial<Record<number, CleUi>> = {
  402: "commande.err.paiement",
  502: "commande.err.paiement",
};
import { loadStripe } from "@stripe/stripe-js";
import type { Stripe, StripeElements } from "@stripe/stripe-js";
import {
  browserApi,
  formatPrice,
  getCartId,
  PUBLIC_API_URL,
  type OrderItem,
  type PointRelais,
  type SuggestionAdresse,
} from "../lib/api.ts";
import CarteRelais from "./CarteRelais.tsx";
import { apercuAbsolu, urlApercu } from "../lib/ia.ts";
// « catalogue » est déjà, ici, celui de la livraison.
import {
  catalogue as catalogueProduits,
  estPretAImprimer,
  nomDeLaLigne,
  visuelBoutique,
} from "../lib/catalogue-panier.ts";
import {
  codePromoRetenu,
  oublierCodePromo,
  retenirCodePromo,
} from "../lib/code-promo.ts";
import VignetteCarteCadeau from "./carte-cadeau-vignette.tsx";
import { clientFictif } from "./jeu-essai.ts";
// Le même découpage que la fiche client : deux versions finiraient par
// proposer deux noms pour la même personne.
import { decouperNom as decouper } from "../lib/compte.ts";

/**
 * Tunnel de commande (§11 — canal web), en DEUX phases :
 *  1. Coordonnées (nom + email) + choix du moyen de paiement.
 *  2. Paiement : on crée la commande (statut `pending`, montant serveur),
 *     puis on monte le widget du moyen choisi :
 *       - Stripe : Payment Element (Stripe.js) sur un clientSecret.
 *       - PayPal : boutons du SDK PayPal (create order -> approve -> capture).
 *
 * La commande n'est marquée « payée » (et les PDF générés) qu'APRÈS
 * encaissement, côté serveur (webhook / confirm Stripe, capture PayPal).
 *
 * Les moyens réellement actifs + leurs clés PUBLIQUES viennent de
 * GET /payments/config (l'API lit les clés de BO › Réglages › Paiements,
 * sinon le .env). Si aucun n'est configuré, on le signale clairement au lieu
 * de laisser un bouton mort.
 *
 * La boutique peut basculer entre l'essai et le réel pendant qu'une cliente
 * est ici. Stripe.js se charge donc avec la clé publique que renvoie
 * l'intention de paiement (et non avec celle lue à l'ouverture), et PayPal
 * envoie le client-id de ses boutons : si ce n'est plus le bon, l'API le dit
 * (paiement_reconfigure) et la caisse relit ses moyens de paiement.
 */

type Method = "stripe" | "paypal";

/* --- SDK PayPal (chargé dynamiquement, non typé) ------------------------- */
interface PayPalButtonsConfig {
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<void>;
  onError?: (err: unknown) => void;
  onCancel?: () => void;
}
interface PayPalNamespace {
  Buttons: (cfg: PayPalButtonsConfig) => {
    render: (target: HTMLElement) => Promise<void>;
  };
}
declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

let paypalSdk: Promise<PayPalNamespace> | null = null;
/**
 * `locale` au format de PayPal (« fr_FR ») : sans lui, boutons et fenêtre
 * suivent le navigateur et le pays du visiteur, pas la langue de la page.
 */
function loadPaypalSdk(
  clientId: string,
  locale: string,
): Promise<PayPalNamespace> {
  if (window.paypal) return Promise.resolve(window.paypal);
  if (paypalSdk) return paypalSdk;
  paypalSdk = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      clientId,
    )}&currency=EUR&locale=${locale}`;
    s.onload = () =>
      window.paypal
        ? resolve(window.paypal)
        : reject(new Error("SDK PayPal indisponible"));
    s.onerror = () => reject(new Error("Chargement du SDK PayPal échoué"));
    document.head.appendChild(s);
  });
  return paypalSdk;
}

/**
 * Oublie le SDK PayPal chargé : il porte le client-id d'un côté de PayPal
 * (bac à sable ou réel), et la boutique vient d'en changer. Le prochain
 * affichage des boutons le recharge avec le bon.
 */
function oublierSdkPaypal(): void {
  paypalSdk = null;
  document
    .querySelectorAll('script[src^="https://www.paypal.com/sdk/js"]')
    .forEach((s) => s.remove());
  window.paypal = undefined;
}

/** Une adresse du carnet, telle que la page la transmet. */
interface AdresseCarnet {
  id: number;
  label: string | null;
  name: string | null;
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  parDefaut: boolean;
}

export default function CheckoutIsland(props: {
  langue?: Langue;
  /**
   * La cliente connectée. Sans elle (17/11), la caisse s'ouvre quand même :
   * le récapitulatif se modifie, le code se saisit, et un bloc « Connectez-
   * vous ou créez votre compte » prend la place des informations et du
   * paiement. Commander demande toujours un compte (le serveur le vérifie).
   */
  compte?: {
    nom: string;
    prenom?: string;
    nomFamille?: string;
    email: string;
    telephone: string;
  };
  /** Ses adresses déjà enregistrées, la première étant celle par défaut. */
  carnet?: AdresseCarnet[];
}): JSX.Element {
  const langue = props.langue ?? LANGUE_DEFAUT;
  const tr = t(langue);
  const locale = LOCALE_COMPLETE[langue];
  const nomsPays = new Intl.DisplayNames([langue], { type: "region" });
  /**
   * « Lun 09:00 - 19:00 » tel que l'API l'écrit (sendcloud-points.ts), avec le
   * jour dans la langue de la page : « Mon 09:00 - 19:00 ». Le 1er janvier
   * 2024 était un lundi ; UTC, pour que le fuseau ne décale pas le jour.
   */
  const joursLocaux = JOURS_API.map((_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, 1 + i)),
    ),
  );
  const horaireLocal = (ligne: string): string => {
    const i = JOURS_API.indexOf(ligne.slice(0, 3));
    return i < 0 || ligne[3] !== " " || langue === LANGUE_DEFAUT
      ? ligne
      : joursLocaux[i] + ligne.slice(3);
  };
  /** Le nom d'un pays dans la langue de la page ; ZZ n'en a pas. */
  const nomPays = (code: string): string =>
    code === "ZZ" ? tr("livraison.autre_pays") : (nomsPays.of(code) ?? code);

  /*
   * Ce que la caisse affiche quand une étape échoue.
   *
   * browserSend rend « API POST /orders -> 401 {"error":…,"code":…} » :
   * affiché tel quel, c'était du jargon, et en français dans toutes les
   * langues. Un refus connu — par son code, sinon par son statut (`parStatut`,
   * propre à chaque étape) — a sa phrase dans la langue du visiteur. Un autre
   * refus (4xx) garde le texte de l'API, sans l'enveloppe technique : il dit
   * ce qui ne va pas.
   *
   * Tout le reste est une PANNE, pas un refus : l'API qui lève (500
   * « erreur_interne »), le proxy qui ne la joint pas (502, 504, une page
   * HTML au lieu d'un JSON), le réseau coupé — fetch lève alors une
   * TypeError, sans statut —, un SDK qui échoue. La cliente lisait « Error:
   * API POST /orders -> 500 » ; elle lit désormais la phrase de l'étape
   * (`repli`), qui lui dit où elle en est et quoi faire. Le détail part dans
   * la console, pour qui cherche la cause.
   */
  function messageErreur(
    err: unknown,
    parStatut: Partial<Record<number, CleUi>>,
    repli: CleUi = "commande.err.technique",
  ): string {
    console.error("[caisse]", err);
    const m = /-> (\d{3})(?: (\{.*\}))?\s*$/s.exec(String(err));
    if (!m) return tr(repli);
    const statut = Number(m[1]);
    let corps: { error?: unknown; code?: unknown } = {};
    try {
      if (m[2]) corps = JSON.parse(m[2]) as typeof corps;
    } catch {
      /* corps illisible : le statut suffit */
    }
    const cle =
      (typeof corps.code === "string" ? ERREURS_PAR_CODE[corps.code] : undefined) ??
      parStatut[statut];
    if (cle) return tr(cle);
    const refus =
      statut < 500 &&
      corps.code !== "erreur_interne" &&
      typeof corps.error === "string" &&
      corps.error.trim() !== "";
    return refus ? (corps.error as string) : tr(repli);
  }

  /**
   * Une phrase traduite dont un nom technique s'affiche en <code> : la phrase
   * garde l'ordre de sa langue, le nom reste tel quel.
   */
  const avecCode = (cle: CleUi, variable: string, code: string): JSX.Element => {
    const [avant, apres] = tr(cle).split(variable);
    return (
      <>
        {avant}
        <code>{code}</code>
        {apres}
      </>
    );
  };
  /*
   * Prénom et nom, séparés — comme sur la fiche client.
   *
   * Un champ unique obligeait à deviner où couper pour l'étiquette de colis :
   * « Marie Dupont » se coupe bien, « Jean-Pierre de la Tour » beaucoup moins.
   * Le compte connaît déjà les deux ; on les reprend tels quels.
   */
  const [prenom, setPrenom] = createSignal(
    props.compte?.prenom ?? decouper(props.compte?.nom ?? "").prenom,
  );
  const [nomFamille, setNomFamille] = createSignal(
    props.compte?.nomFamille ?? decouper(props.compte?.nom ?? "").nom,
  );
  /** Ce qui part à l'API : toujours la concaténation des deux. */
  const name = (): string => `${prenom().trim()} ${nomFamille().trim()}`.trim();
  /** Repose un nom complet venu d'ailleurs (carnet, relance, jeu d'essai). */
  const setName = (complet: string) => {
    const d = decouper(complet);
    setPrenom(d.prenom);
    setNomFamille(d.nom);
  };
  const [email, setEmail] = createSignal(props.compte?.email ?? "");
  const [method, setMethod] = createSignal<Method | null>(null);
  const [phase, setPhase] = createSignal<"details" | "pay">("details");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [orderNumber, setOrderNumber] = createSignal<string | null>(null);
  const [orderId, setOrderId] = createSignal<number | null>(null);

  // Config paiement (moyens actifs + clés publiques). Relue quand la
  // boutique a changé de clés pendant la commande (paiement_reconfigure).
  const [config, { refetch: relireConfig }] = createResource(async () =>
    browserApi.paymentsConfig(),
  );
  /**
   * Des cadres que le site ne propose plus ont quitté le panier à l'ouverture
   * de la caisse. On y arrive aussi sans passer par le panier — le lien d'un
   * courrier de relance mène droit ici —, le retrait doit donc se voir ici.
   */
  const [cadresRetires, setCadresRetires] = createSignal(false);
  // Récapitulatif du panier (lecture seule, sauf les cadres hors site).
  const [cart, { refetch: relirePanier }] = createResource(async () => {
    const cartId = getCartId();
    const panier = await browserApi.cart(cartId);
    if ((panier.cadresHorsSite ?? 0) === 0) return panier;
    // Un échec ne cache pas la caisse : la validation de la commande retire
    // de toute façon ces cadres, et le dit.
    const { retires } = await browserApi
      .retirerCadres(cartId)
      .catch(() => ({ retires: 0 }));
    if (retires === 0) return panier;
    setCadresRetires(true);
    return browserApi.cart(cartId);
  });
  const subtotal = () =>
    (cart()?.items ?? []).reduce(
      (s, it) => s + it.unitPriceCents * it.quantity,
      0,
    );

  /*
   * Le récapitulatif se MODIFIE ici (17/11) : la page /panier n'existe plus
   * sur le site. Quantité, retrait, « Modifier » qui rouvre la composition —
   * les mêmes gestes qu'au panier (CartIsland), et le serveur recalcule tout.
   * Un changement pendant le paiement ramène à la saisie : le serveur a
   * remis la commande en panier, l'ancien montant ne vaut plus.
   */
  const [occupe, setOccupe] = createSignal<number | null>(null);
  async function changerLigne(action: () => Promise<unknown>, id: number) {
    setOccupe(id);
    setError(null);
    try {
      await action();
      if (phase() === "pay") backToDetails();
      await relirePanier();
      // La pastille de l'en-tête compte les exemplaires : elle doit suivre.
      window.dispatchEvent(new Event("ml:panier"));
    } catch (e) {
      setError(messageErreur(e, {}));
    } finally {
      setOccupe(null);
    }
  }
  /** Change la quantité d'une affiche ; une carte cadeau garde la sienne. */
  const setQuantite = (it: OrderItem, quantite: number) => {
    const q = Math.max(1, Math.min(99, quantite));
    if (q === it.quantity || it.giftCard || !it.config) return;
    const config = it.config;
    void changerLigne(
      () => browserApi.updateCartItem(getCartId(), it.id, { config, quantity: q, langue }),
      it.id,
    );
  };
  const retirerLigne = (it: OrderItem) =>
    void changerLigne(() => browserApi.deleteCartItem(getCartId(), it.id), it.id);
  /** « Modifier » rouvre la composition sur la fiche ; pas pour une carte, une IA, une affiche prête. */
  const lienModifier = (it: OrderItem): string | null => {
    if (it.giftCard || !it.config || it.config.aiPublicId) return null;
    if (estPretAImprimer(fiches(), it)) return null;
    const slug = it.productId != null ? fiches()?.get(it.productId)?.slug : null;
    return slug ? `${lien(langue, `/affiches/${slug}`)}?edit=${it.id}` : null;
  };
  /**
   * Poids du colis, tel que le serveur l'a pesé. Le refaire ici demanderait
   * de connaître le poids des variantes, des catégories et des cadres : deux
   * pesées finiraient par se contredire, et c'est la facture qui aurait
   * raison. Champ absent (API pas encore à jour) = 0, comme avant.
   */
  const poidsColis = () => cart()?.poidsGrammes ?? 0;

  /**
   * Bibliothèque de personnages : le récapitulatif montre les affiches, pas
   * seulement leurs noms. Le client doit voir CE QU'IL PAIE avant de payer —
   * et l'aperçu porte le filigrane jusqu'au règlement.
   */
  const [biblio] = createResource(async () => {
    try {
      return await browserApi.characters(props.langue);
    } catch {
      return null;
    }
  });
  const { cache, fetchSvg } = createSvgCache(PUBLIC_API_URL);
  const personnageParId = (id: string | number) =>
    biblio()?.characters.find((c) => String(c.id) === String(id));
  /**
   * Le genre et le visuel des produits, comme au panier : sans eux, une
   * affiche prête à imprimer passait par l'aperçu en calques, qui n'a rien à
   * empiler, et le récapitulatif montrait une vignette blanche.
   */
  const [fiches] = createResource(catalogueProduits);

  // Sans ce préchargement, les personnages resteraient absents de l'aperçu.
  createEffect(() => {
    const lib = biblio();
    if (!lib) return;
    for (const ligne of cart()?.items ?? []) {
      for (const perso of ligne.config?.characters ?? []) {
        const base = personnageParId(perso.typeId);
        if (!base) continue;
        void fetchSvg(base.baseSvgUrl);
        const jeu = variantesDeVue(lib.slots, base.orientation);
        for (const slot of SLOTS) {
          const v = findVariant(jeu[slot], perso.assets?.[slot]);
          if (v) void fetchSvg(v.svgUrl);
        }
      }
    }
  });

  // Promos actives. Le calcul lui-même vient du moteur PARTAGÉ : plus de
  // réplique locale à maintenir en phase avec le serveur. Leurs noms dans la
  // langue de la page, comme au panier : la caisse ne les affiche pas
  // aujourd'hui, mais le jour où elle le fera, ils seront déjà les bons.
  const [promos] = createResource(async () => {
    try {
      return await browserApi.promos<RegleParier>(langue);
    } catch {
      return [];
    }
  });
  // La part du cadre vient du serveur : une affiche offerte « cadre non
  // compris » se déduit sans son cadre, ici comme à l'encaissement.
  // Les cartes cadeaux du panier n'entrent pas dans les promotions — ni
  // comptées, ni remisées — et ne pèsent rien : le moteur ne voit que les
  // affiches, exactement comme le serveur.
  const lignes = () =>
    (cart()?.items ?? [])
      .filter((it) => !it.giftCard)
      .map((it) => ({
        unitPriceCents: it.unitPriceCents,
        quantity: it.quantity,
        format: it.config?.format ?? null,
        cadreCents: it.cadreCents ?? 0,
      }));
  /** Les cartes cadeaux achetées, à leur montant (vérifié par le serveur). */
  const cartesAchetees = () => (cart()?.items ?? []).filter((it) => it.giftCard);
  const cartesCents = () =>
    cartesAchetees().reduce((s, it) => s + it.unitPriceCents * it.quantity, 0);
  /** Des affiches à livrer ? Sinon : ni mode, ni adresse, ni port. */
  const avecAffiches = () => lignes().length > 0;
  const sousTotalAffiches = () =>
    lignes().reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);

  /*
   * Le champ « Code promo ou carte cadeau » (17/11) : un seul champ, deux
   * sortes de codes. Un code promo et une carte cadeau servent ensemble ; un
   * second de la même sorte remplace le premier.
   *
   * Rien de ce qui suit ne fixe un montant : le serveur revérifie le code et
   * la carte au passage en caisse, recalcule tout, et c'est son total qui
   * s'encaisse. Ici, on affiche le bon montant AVANT de payer.
   */
  const [codePromo, setCodePromo] = createSignal<RegleParier | null>(null);
  const [carte, setCarte] = createSignal<{
    code: string;
    masque: string;
    soldeCents: number;
  } | null>(null);
  const [codeSaisi, setCodeSaisi] = createSignal("");
  const [codeEnvoi, setCodeEnvoi] = createSignal(false);
  const [codeErreur, setCodeErreur] = createSignal<string | null>(null);
  /** Le code d'une visite précédente a été revérifié (la page attend ce moment). */
  const [codeRepris, setCodeRepris] = createSignal(false);

  async function appliquerCode(saisie: string, silencieux = false) {
    const propre = saisie.trim();
    if (!propre || codeEnvoi()) return;
    setCodeEnvoi(true);
    setCodeErreur(null);
    try {
      // Dans la langue de la page : le nom de la promotion s'écrit sur la
      // ligne de remise.
      const r = await browserApi.codeCaisse(propre, langue);
      if (r.type === "promo") {
        // Son vrai identifiant, gardé : à priorité égale, il range le code
        // parmi les autres règles comme le fait le serveur (reglesActives).
        setCodePromo({ id: 0, ...r.regle } as unknown as RegleParier);
        retenirCodePromo(r.regle.code);
      } else {
        setCarte(r.carte);
      }
      setCodeSaisi("");
      // Le total a changé : un paiement préparé pour l'ancien ne vaut plus.
      if (phase() === "pay") backToDetails();
    } catch (e) {
      if (silencieux) oublierCodePromo();
      else
        setCodeErreur(
          messageErreur(
            e,
            { 404: "caisse.code.invalide", 409: "caisse.code.deja_utilise", 429: "caisse.code.trop_essais" },
            "caisse.code.invalide",
          ),
        );
    } finally {
      setCodeEnvoi(false);
    }
  }
  function retirerPromo() {
    setCodePromo(null);
    oublierCodePromo();
    if (phase() === "pay") backToDetails();
  }
  function retirerCarte() {
    setCarte(null);
    if (phase() === "pay") backToDetails();
  }
  // Le code promo d'une visite précédente — ou remis par le lien d'une
  // relance de panier — est revérifié en silence : s'il ne vaut plus rien,
  // il disparaît sans reproche.
  onMount(async () => {
    const retenu = codePromoRetenu();
    if (retenu) await appliquerCode(retenu, true);
    setCodeRepris(true);
  });

  const reglesEnJeu = (): RegleParier[] => {
    const auto = promos() ?? [];
    const c = codePromo();
    return c ? [...auto, c] : auto;
  };
  const codes = () => {
    const c = codePromo() as { code?: string } | null;
    return c?.code ? [c.code] : [];
  };

  const remises = () =>
    remisesPanier(lignes(), reglesEnJeu(), new Date(), codes());
  const discount = () => remises().remiseCents;
  /**
   * Le nom des promotions, dans la langue de la page, comme au panier
   * (CartIsland) : la cliente doit reconnaître à la caisse l'offre qu'elle a
   * vue au panier. « Remise » ne sert plus que faute de règle nommée.
   */
  const libelleRemise = () => {
    const noms = remises().detail.map((d) => d.regle).filter(Boolean);
    return noms.length ? noms.join(" · ") : tr("compte.commande.remise");
  };

  /* --- Livraison ------------------------------------------------------- */
  // Le nom, la description et le lieu de retrait des modes dans la langue de
  // la page. La commande, elle, gardera le nom français (calcul du port côté
  // serveur) : c'est celui que lit la boutique.
  const [catalogue] = createResource(async () => {
    try {
      return await browserApi.shipping(langue);
    } catch {
      return null;
    }
  });
  // Lu par codePaysSaisi : une adresse gardée avec « France » en toutes
  // lettres laissait la liste des pays vide et ne proposait que le port de
  // la zone de repli.
  const [pays, setPays] = createSignal(
    codePaysSaisi(
      (props.carnet ?? []).find((a) => a.parDefaut)?.country ??
        (props.carnet ?? [])[0]?.country,
    ) || "FR",
  );
  const [modeChoisi, setModeChoisi] = createSignal<string | null>(null);
  /** L'adresse à proposer d'emblée : celle par défaut, sinon la première. */
  const adresseDepart = (): AdresseCarnet | null => {
    const c = props.carnet ?? [];
    return c.find((a) => a.parDefaut) ?? c[0] ?? null;
  };
  const [adresseChoisie, setAdresseChoisie] = createSignal<number | null>(
    adresseDepart()?.id ?? null,
  );
  const depart = adresseDepart();
  const [adresse, setAdresse] = createSignal({
    line1: depart?.line1 ?? "",
    line2: depart?.line2 ?? "",
    postalCode: depart?.postalCode ?? "",
    city: depart?.city ?? "",
    phone: depart?.phone ?? props.compte?.telephone ?? "",
  });

  /** Recopie une adresse du carnet dans le formulaire. */
  function choisirAdresse(id: number | null) {
    setAdresseChoisie(id);
    if (id === null) {
      setAdresse({ line1: "", line2: "", postalCode: "", city: "", phone: "" });
      return;
    }
    const a = (props.carnet ?? []).find((x) => x.id === id);
    if (!a) return;
    setAdresse({
      line1: a.line1 ?? "",
      line2: a.line2 ?? "",
      postalCode: a.postalCode ?? "",
      city: a.city ?? "",
      phone: a.phone ?? "",
    });
    const code = codePaysSaisi(a.country);
    if (code) setPays(code);
    if (a.name) setName(a.name);
  }
  /**
   * Le point relais choisi. `label` part avec la commande, en français :
   * c'est lui que lisent le back-office et le transporteur. `affiche` est le
   * même, dans la langue du visiteur, pour l'écran seulement.
   */
  const [pointRelais, setPointRelais] = createSignal({
    id: "",
    label: "",
    affiche: "",
  });

  /*
   * Retrait sur place : quel lieu.
   *
   * Les lieux de retrait (le chalet du marché de Noël, l'atelier…) arrivent
   * avec le catalogue de livraison, réglés au back-office. Un seul, il est
   * choisi d'office — faire cliquer sur l'unique possibilité n'apporte rien.
   * Plusieurs, la cliente choisit ; tant qu'elle n'a pas choisi, la commande
   * ne part pas : personne ne saurait où la lui remettre. Le serveur relit
   * de toute façon le lieu (actif, pas archivé) avant d'écrire la commande.
   */
  type LieuRetrait = {
    id: number;
    nom: string;
    adresse: string | null;
    description: string | null;
    standId?: number | null;
    /** Retrait au stand : le dernier jour pour venir (« AAAA-MM-JJ »). */
    retirerAvant?: string | null;
    /** L'heure où il ferme ce dernier jour (« 20:00 »). */
    retirerAvantHeure?: string | null;
    /** Le stand est-il ouvert en ce moment ? */
    ouvert?: boolean | null;
    /** Premier et dernier jour du stand (« AAAA-MM-JJ »). */
    du?: string | null;
    au?: string | null;
    /** Ses 7 prochains jours, vraies heures ou fermé ; `suite` : il continue après. */
    semaine?: {
      jours: { jour: string; ferme: boolean; creneaux: { de: string; a: string }[] }[];
      suite: boolean;
    } | null;
  };
  /** Les stands ouverts, chacun proposé comme une option à part entière. */
  const lieuxDesStands = (): LieuRetrait[] =>
    (catalogue()?.lieuxRetrait ?? []).filter((l: LieuRetrait) => l.standId != null);
  /** La case « je viendrai avant la fin du stand » (17/11). */
  const [standCompris, setStandCompris] = createSignal(false);
  /** « jeudi 24 décembre », dans la langue de la page. */
  const jourLong = (jour: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(new Date(`${jour}T12:00:00Z`));
  /** « Ven. 20 nov. », pour le tableau des 7 jours du stand. */
  const jourCourt = (jour: string) => {
    const t = new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${jour}T12:00:00Z`));
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  /** Aujourd'hui à Paris (« AAAA-MM-JJ »), pour mettre la ligne du jour en avant. */
  const aujourdhuiAParis = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  /**
   * Les lieux du mode choisi : les stands ouverts sous « Retrait au stand »
   * (gratuit, avec leur emplacement), les lieux de BO › Livraison sous les
   * autres modes de retrait (17/11).
   */
  const lieuxRetrait = (): LieuRetrait[] => {
    const tous: LieuRetrait[] = catalogue()?.lieuxRetrait ?? [];
    const auStand = optionChoisie()?.mode.slug === MODE_RETRAIT_STAND;
    return tous.filter((l) => (l.standId != null) === auStand);
  };
  const [lieuChoisi, setLieuChoisi] = createSignal<number | null>(null);
  const lieuRetenu = (): LieuRetrait | null => {
    const l = lieuxRetrait();
    return l.find((x) => x.id === lieuChoisi()) ?? (l.length === 1 ? l[0]! : null);
  };
  /** Vrai quand le mode choisi est un retrait et qu'il reste à dire où. */
  const lieuManquant = (): boolean =>
    avecAffiches() && optionChoisie()?.mode.kind === "pickup" && lieuRetenu() === null;


  /* Recherche de points relais : on interroge le transporteur avec un code
     postal, le client choisit dans la liste. Pas de champ libre — une adresse
     saisie à la main ne correspondrait à aucun point réel. */
  const [cpRecherche, setCpRecherche] = createSignal("");
  // Jeu d'essai : hors production, le formulaire arrive rempli d'un client
  // tiré au sort. `clientFictif()` renvoie null partout ailleurs — c'est le
  // seul garde-fou, et il tient à une variable d'environnement absente en
  // production (voir islands/jeu-essai.ts).
  //
  // Il ne remplit QUE ce qui est vide. Connectée, la cliente arrive avec son
  // nom, son e-mail et son adresse déjà en place : les remplacer par un
  // client tiré au sort lui ferait croire, sur le site de test, que ses
  // informations ne sont pas reprises. Un compte connu l'emporte toujours.
  const essai = clientFictif();
  if (essai) {
    if (!name()) setName(essai.nom);
    if (!email()) setEmail(essai.email);
    if (!adresse().line1) {
      setAdresse({
        line1: essai.line1,
        line2: essai.line2,
        postalCode: essai.postalCode,
        city: essai.city,
        phone: adresse().phone || essai.phone,
      });
      setCpRecherche(essai.postalCode);
    } else {
      setCpRecherche(adresse().postalCode);
    }
  }

  /*
   * Retour par un lien de relance : la page de récupération vient de déposer
   * le nom et l'adresse que la cliente nous avait déjà donnés. Les lui faire
   * retaper serait la première chose qu'on lui demanderait après lui avoir
   * écrit « votre commande vous attend » — exactement ce qu'on veut éviter.
   *
   * APRÈS le jeu d'essai, et c'est voulu : de vraies coordonnées l'emportent
   * toujours sur un client tiré au sort. Lues PUIS effacées, car elles ne
   * valent que pour ce retour-là — le client suivant, sur le même navigateur,
   * ne doit pas trouver le nom de quelqu'un d'autre dans ses champs.
   */
  try {
    const garde = localStorage.getItem("ml_relance_client");
    if (garde) {
      localStorage.removeItem("ml_relance_client");
      const d = JSON.parse(garde) as { nom?: string; email?: string };
      if (d.nom) setName(d.nom);
      if (d.email) setEmail(d.email);
    }
  } catch {
    /* stockage indisponible : la cliente saisira ses coordonnées, comme avant */
  }

  const [relais, setRelais] = createSignal<PointRelais[]>([]);
  const [relaisEtat, setRelaisEtat] = createSignal<
    "repos" | "recherche" | "vide" | "erreur"
  >("repos");

  createEffect(() => {
    // Le mode change : les points trouvés pour l'autre transporteur n'ont
    // plus cours, et le point choisi encore moins.
    modeChoisi();
    setRelais([]);
    setPointRelais({ id: "", label: "", affiche: "" });
    setRelaisEtat("repos");
    // Et si c'est un mode point relais, on cherche tout de suite autour du
    // code postal qu'on connaît déjà : la cliente connectée a son adresse, la
    // faire retaper puis cliquer « Chercher » est un pas de trop avant de
    // payer. Lu sans suivi : taper son adresse ne doit pas relancer la
    // recherche à chaque chiffre.
    untrack(() => {
      if (!demandeUnPointRelais(optionChoisie()?.mode.kind ?? "")) return;
      // L'adresse entière plutôt que le seul code postal : les points se
      // classent alors depuis sa rue, pas depuis le centre de la commune.
      if (!cpRecherche().trim()) {
        const a = adresse();
        const complete = [a.line1.trim(), `${a.postalCode.trim()} ${a.city.trim()}`.trim()]
          .filter(Boolean)
          .join(" ");
        if (a.postalCode.trim()) setCpRecherche(complete);
      }
      if (cpRecherche().trim()) void chercherRelais();
    });
  });

  /*
   * La recherche par ADRESSE, avec suggestions pendant la frappe.
   *
   * On tape « 12 rue des Trois… », la Base Adresse Nationale propose les
   * adresses qui commencent ainsi, on en choisit une : les points se classent
   * depuis cette porte-là. Un code postal seul marche toujours, et c'est ce
   * qui reste hors de France, où la base ne sait rien.
   */
  type Depart = { latitude: number; longitude: number; codePostal: string; ville: string };
  const [departRelais, setDepartRelais] = createSignal<Depart | null>(null);
  const [suggestions, setSuggestions] = createSignal<SuggestionAdresse[]>([]);
  const [suggestionActive, setSuggestionActive] = createSignal(-1);
  /** La base ne couvre que la France (Monaco et outre-mer compris). */
  const adressesConnues = () => pays() === "FR" || pays() === "MC";
  let minuterieSuggestions: ReturnType<typeof setTimeout> | undefined;
  let derniereSuggestion = 0;

  /**
   * « Me localiser » : la position du téléphone ou de l'ordinateur sert de
   * point de départ, comme une adresse choisie dans les suggestions. Le
   * navigateur ne la donne qu'en HTTPS (ou en local) et avec l'accord du
   * client : sans HTTPS, le bouton n'est pas proposé ; sans accord, il dit
   * pourquoi il n'a rien donné.
   */
  const [localisable, setLocalisable] = createSignal(false);
  onMount(() => setLocalisable(window.isSecureContext && "geolocation" in navigator));
  const [localisation, setLocalisation] = createSignal<
    "repos" | "en_cours" | "refusee" | "introuvable"
  >("repos");

  function meLocaliser() {
    if (!localisable() || localisation() === "en_cours") return;
    setLocalisation("en_cours");
    clearTimeout(minuterieSuggestions);
    setSuggestions([]);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const { latitude, longitude } = coords;
        // L'adresse dit au client d'où l'on cherche (« 80000 Amiens ») ; la
        // position, elle, classe les points depuis sa porte. Hors de France,
        // pas d'adresse : on cherche sur la seule position.
        const adresse = await browserApi.adresseDuLieu(latitude, longitude).catch(() => null);
        setLocalisation("repos");
        setCpRecherche(adresse?.label ?? tr("livraison.ma_position"));
        setDepartRelais({
          latitude,
          longitude,
          codePostal: adresse?.codePostal ?? "",
          ville: adresse?.ville ?? "",
        });
        void chercherRelais();
      },
      (err) => setLocalisation(err.code === err.PERMISSION_DENIED ? "refusee" : "introuvable"),
      // Quelques centaines de mètres suffisent pour des points relais : la
      // demander précise réveillerait le GPS pour rien, et ferait attendre.
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  function saisirRecherche(v: string) {
    setCpRecherche(v);
    setLocalisation("repos");
    // L'adresse choisie ne vaut plus dès qu'on retouche le texte.
    setDepartRelais(null);
    clearTimeout(minuterieSuggestions);
    if (!adressesConnues() || v.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    // Un quart de seconde après la dernière touche : assez pour ne pas
    // interroger la base à chaque lettre, assez peu pour paraître immédiat.
    minuterieSuggestions = setTimeout(async () => {
      const numero = ++derniereSuggestion;
      try {
        const liste = await browserApi.suggestionsAdresse(v);
        if (numero !== derniereSuggestion) return;
        setSuggestions(liste);
        setSuggestionActive(-1);
      } catch {
        // Service indisponible : le champ reste un simple code postal.
        setSuggestions([]);
      }
    }, 250);
  }

  function choisirSuggestion(s: SuggestionAdresse) {
    clearTimeout(minuterieSuggestions);
    derniereSuggestion++;
    setSuggestions([]);
    setCpRecherche(s.label);
    setDepartRelais({
      latitude: s.latitude,
      longitude: s.longitude,
      codePostal: s.codePostal,
      ville: s.ville,
    });
    void chercherRelais();
  }

  function toucheRecherche(e: KeyboardEvent) {
    const liste = suggestions();
    if (e.key === "ArrowDown" && liste.length) {
      e.preventDefault();
      setSuggestionActive((i) => (i + 1) % liste.length);
    } else if (e.key === "ArrowUp" && liste.length) {
      e.preventDefault();
      setSuggestionActive((i) => (i <= 0 ? liste.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setSuggestions([]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const s = liste[suggestionActive()];
      if (s) choisirSuggestion(s);
      else void chercherRelais();
    }
  }

  /** Numéro de la dernière recherche : une réponse plus ancienne est ignorée. */
  let derniereRecherche = 0;

  async function chercherRelais(e?: Event) {
    e?.preventDefault();
    const saisie = cpRecherche().trim();
    if (!saisie) return;
    clearTimeout(minuterieSuggestions);
    setSuggestions([]);
    const numero = ++derniereRecherche;
    setRelaisEtat("recherche");
    try {
      // D'où chercher. Une adresse choisie dans les suggestions donne sa
      // position exacte. Sinon, en France, une saisie qui n'est pas un simple
      // code postal est une adresse : on prend la première que la base
      // reconnaît, comme si le client l'avait choisie.
      let d = departRelais();
      const codeSeul = /^\d{4,5}$/.test(saisie);
      if (!d && adressesConnues() && !codeSeul) {
        const [premiere] = await browserApi.suggestionsAdresse(saisie).catch(() => []);
        if (numero !== derniereRecherche) return;
        if (premiere) {
          d = {
            latitude: premiere.latitude,
            longitude: premiere.longitude,
            codePostal: premiere.codePostal,
            ville: premiere.ville,
          };
          setDepartRelais(d);
          setCpRecherche(premiere.label);
        }
      }
      // Une position sans adresse (client localisé hors de France) n'a pas de
      // code postal : l'API cherche alors sur ses seules coordonnées.
      const cp = d ? d.codePostal : /\b\d{4,5}\b/.exec(saisie)?.[0] || saisie;
      const liste = await browserApi.pointsRelais(
        cp,
        pays(),
        optionChoisie()?.mode.carrier ?? "mondial_relay",
        d?.ville,
        d ? { latitude: d.latitude, longitude: d.longitude } : undefined,
      );
      if (numero !== derniereRecherche) return;
      setRelais(liste);
      setRelaisEtat(liste.length ? "repos" : "vide");
    } catch {
      if (numero !== derniereRecherche) return;
      setRelais([]);
      setRelaisEtat("erreur");
    }
  }

  function choisirRelais(r: PointRelais) {
    const lieu = `${r.nom}, ${r.adresse}, ${r.codePostal} ${r.ville}`;
    setPointRelais({
      id: r.id,
      // Le numéro du point voyage avec son nom : c'est lui qu'on donne au
      // transporteur pour préparer le colis, et que le point relais
      // retrouve au guichet.
      label: `${lieu}${r.code ? ` (n° ${r.code})` : ""}`,
      affiche: `${lieu}${r.code ? ` ${tr("livraison.relais_numero").replace("{code}", r.code)}` : ""}`,
    });
    // Choisi sur la carte, le point doit aussi se voir dans la liste.
    document
      .getElementById(`relais-${r.id}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /** « 350 m », « 1,2 km » : la distance au code postal cherché. */
  function distanceLisible(metres: number): string {
    if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
    return `${(metres / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} km`;
  }

  /** Les affiches après remises : c'est lui qui décide de la franchise de port. */
  const apresRemise = () => Math.max(0, sousTotalAffiches() - discount());

  /**
   * Le seuil de la promotion « livraison offerte dès X € », s'il y en a une.
   *
   * L'écran l'affiche, le serveur le recalcule avant d'encaisser : c'est la
   * même fonction des deux côtés, donc le port annoncé ne peut pas différer
   * du port facturé.
   */
  const seuilPort = () =>
    // 0 quand un code offre la livraison (« tout gratuit »), sinon le seuil
    // des promotions « livraison offerte dès X € » — la fonction du serveur.
    seuilPortCents(lignes(), reglesEnJeu(), new Date(), codes());

  const optionsPort = (): OptionLivraison[] => {
    const cat = catalogue();
    // Des cartes cadeaux seules : rien à livrer.
    return cat && avecAffiches()
      ? optionsLivraison(cat, pays(), apresRemise(), poidsColis(), seuilPort())
      : [];
  };
  const optionChoisie = () =>
    optionsPort().find((o) => o.mode.slug === modeChoisi()) ?? null;
  // Sans compte, le mode de livraison ne se choisit pas encore : pas de
  // port dans le total, il s'y ajoute une fois connectée.
  const fraisPort = () => (props.compte ? (optionChoisie()?.fraisCents ?? 0) : 0);

  // Premier mode disponible par défaut, et repli si le choix devient
  // impossible — changer de pays peut retirer le retrait sur place.
  createEffect(() => {
    const dispo = optionsPort();
    if (!dispo.length) return;
    if (!dispo.some((o) => o.mode.slug === modeChoisi()))
      setModeChoisi(dispo[0]!.mode.slug);
  });

  /**
   * Le code postal et le téléphone ne se signalent faux qu'une fois le champ
   * quitté : pendant la frappe, « 8035 » n'est pas une erreur, juste pas
   * fini. Le bouton de paiement, lui, attend une forme valide dès le début.
   */
  const [cpQuitte, setCpQuitte] = createSignal(false);
  const [telQuitte, setTelQuitte] = createSignal(false);

  /** Ce que le mode choisi exige avant de pouvoir payer. */
  const livraisonValide = () => {
    if (!avecAffiches()) return true;
    const o = optionChoisie();
    if (!o) return false;
    if (demandeUneAdresse(o.mode.kind)) {
      const a = adresse();
      return (
        a.line1.trim().length > 0 &&
        codePostalValide(a.postalCode, pays()) &&
        a.city.trim().length > 0 &&
        telephoneValide(a.phone)
      );
    }
    if (demandeUnPointRelais(o.mode.kind))
      return pointRelais().id.trim().length > 0;
    // Retrait au stand : un stand choisi, et la case cochée s'il a une date de fin.
    if (o.mode.slug === MODE_RETRAIT_STAND) {
      const l = lieuRetenu();
      if (!l) return false;
      if (l.retirerAvant && !standCompris()) return false;
    }
    return true;
  };

  /** Ce que vaut la commande : affiches remisées, cartes achetées, port. */
  const total = () =>
    totalPanierCents(lignes(), reglesEnJeu(), new Date(), codes()) +
    cartesCents() +
    fraisPort();
  /**
   * La part de la carte cadeau : jusqu'au total, sans dépasser son solde, et
   * jamais sur les cartes achetées. Le serveur refait le même calcul.
   */
  const partCarte = () => {
    const c = carte();
    return c ? partCarteCadeau(total(), cartesCents(), c.soldeCents) : 0;
  };
  /** Ce que débiteront Stripe ou PayPal : le total, moins la carte. */
  const aPayer = () => resteAPayerCents(total(), partCarte());
  /**
   * Rien à payer : la caisse remplace le paiement par « Valider ma
   * commande ». C'est une estimation de l'écran ; le serveur décide au
   * passage en caisse (aPayerCents), et recalcule tout avant de valider.
   */
  const gratuit = () =>
    Boolean(cart()) && cart()!.items.length > 0 && aPayer() === 0 &&
    (!avecAffiches() || optionChoisie() !== null);

  /*
   * Le destinataire de chaque carte cadeau achetée : son e-mail (celle de la
   * cliente si rien n'est dit), son prénom et un petit mot, facultatifs.
   */
  const [destinataires, setDestinataires] = createSignal<
    Record<number, { email: string; prenom: string; message: string }>
  >({});
  const destinataire = (id: number) =>
    destinataires()[id] ?? { email: "", prenom: "", message: "" };
  const majDestinataire = (
    id: number,
    champ: "email" | "prenom" | "message",
    valeur: string,
  ) => setDestinataires({ ...destinataires(), [id]: { ...destinataire(id), [champ]: valeur } });
  const destinatairesValides = () =>
    cartesAchetees().every((it) => {
      const e = destinataire(it.id).email.trim();
      return !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
    });

  const methods = (): Method[] => {
    const c = config();
    const list: Method[] = [];
    if (c?.stripe) list.push("stripe");
    if (c?.paypal) list.push("paypal");
    return list;
  };
  // Sélection par défaut = 1er moyen disponible.
  createEffect(() => {
    if (method() === null && methods().length > 0) setMethod(methods()[0]!);
  });

  const emailValid = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email().trim());
  const formValid = () =>
    name().trim().length > 0 &&
    emailValid() &&
    livraisonValide() &&
    !lieuManquant() &&
    destinatairesValides();

  /**
   * Ce qui manque encore pour passer au paiement, en toutes lettres, sous le
   * bouton grisé. Il restait grisé sans un mot, et l'on cherchait ce qui
   * clochait (recette du 6/10). La liste suit pas à pas `formValid()` et le
   * moyen de paiement : rien n'y manque, rien n'y est en trop.
   */
  const manques = (): string[] => {
    const liste: string[] = [];
    if (!name().trim()) liste.push(tr("commande.manque.nom"));
    if (!emailValid()) liste.push(tr("commande.manque.email"));
    const o = optionChoisie();
    if (!avecAffiches()) {
      // Des cartes cadeaux seules : rien à livrer, rien à choisir.
    } else if (!o) liste.push(tr("commande.manque.mode"));
    else if (!livraisonValide())
      liste.push(
        tr(
          demandeUnPointRelais(o.mode.kind)
            ? "commande.manque.relais"
            : "commande.manque.adresse",
        ),
      );
    if (lieuManquant()) liste.push(tr("commande.manque.lieu"));
    if (!destinatairesValides()) liste.push(tr("caisse.err.carte_email"));
    // À 0 €, il n'y a pas de moyen de paiement à choisir.
    if (!method() && !gratuit()) liste.push(tr("commande.manque.moyen"));
    return liste;
  };

  /* --- Stripe --------------------------------------------------------- */
  let stripe: Stripe | null = null;
  let elements: StripeElements | null = null;
  let stripeMountRef: HTMLDivElement | undefined;
  let expressMountRef: HTMLDivElement | undefined;
  const [stripeClientSecret, setStripeClientSecret] = createSignal<
    string | null
  >(null);

  // Monte le Payment Element dès qu'on est en phase paiement + Stripe prêt.
  createEffect(() => {
    if (
      phase() === "pay" &&
      method() === "stripe" &&
      stripe &&
      stripeClientSecret() &&
      stripeMountRef &&
      !elements
    ) {
      elements = stripe.elements({
        clientSecret: stripeClientSecret()!,
        // La langue de la page : sans elle, Stripe prend celle du navigateur.
        locale: langue,
        appearance: { theme: "stripe" },
      });

      /* Apple Pay et Google Pay, en boutons dédiés au-dessus du formulaire.
         Stripe ne les affiche que s'ils sont réellement utilisables : appareil
         compatible, portefeuille approvisionné, moyen activé dans le tableau
         de bord Stripe — et, pour Apple Pay, domaine vérifié chez Apple. Rien
         à afficher : l'élément reste vide, le formulaire de carte suffit. */
      if (expressMountRef) {
        const express = elements.create("expressCheckout");
        express.on("confirm", () => {
          void payStripe();
        });
        express.mount(expressMountRef);
      }

      /* La CARTE d'abord, et rien d'autre par défaut.
       *
       * Sans cet ordre, Stripe met Link en tête — son service de carte
       * enregistrée. Une adresse déjà connue de Link déclenche alors son
       * propre formulaire, qui refuse les cartes d'essai avec « We weren't
       * able to add this card » et laisse croire à une panne de la boutique.
       * Link reste proposé, il ne passe plus devant. */
      elements
        .create("payment", { paymentMethodOrder: ["card"] })
        .mount(stripeMountRef);
    }
  });

  /* --- PayPal --------------------------------------------------------- */
  let paypalMountRef: HTMLDivElement | undefined;
  let paypalRendered = false;

  createEffect(() => {
    const cfg = config()?.paypal;
    if (
      phase() === "pay" &&
      method() === "paypal" &&
      cfg &&
      paypalMountRef &&
      !paypalRendered
    ) {
      paypalRendered = true;
      loadPaypalSdk(cfg.clientId, locale.replace("-", "_"))
        .then((pp) =>
          pp
            .Buttons({
              createOrder: async () => {
                const oid = orderId();
                if (oid == null) throw new Error("Commande manquante");
                try {
                  // Le client-id de CES boutons : l'API vérifie que c'est
                  // toujours celui de la boutique.
                  const { paypalOrderId } = await browserApi.paypalOrder(oid, cfg.clientId);
                  return paypalOrderId;
                } catch (e) {
                  if (String(e).includes("paiement_reconfigure")) moyensReconfigures();
                  throw e;
                }
              },
              onApprove: async (data) => {
                const oid = orderId();
                if (oid == null) return;
                try {
                  await browserApi.paypalCapture(oid, data.orderID);
                  finishSuccess();
                } catch (e) {
                  // Une panne ici tombe APRÈS l'accord donné chez PayPal :
                  // la phrase du paiement, qui dit d'écrire si c'est débité.
                  setError(messageErreur(e, ECHEC_ENCAISSEMENT, "commande.err.paiement"));
                }
              },
              // PayPal n'a pas ouvert le paiement : 502, refus de son côté,
              // ou une panne avant même d'y arriver (API, réseau, SDK).
              onError: (e) =>
                setError(messageErreur(e, {}, "commande.err.paypal_ouverture")),
            })
            .render(paypalMountRef!),
        )
        .catch(() => {
          paypalRendered = false;
          setError(tr("commande.err.paypal_indisponible"));
        });
    }
  });

  /* --- Flux --------------------------------------------------------------- */

  function finishSuccess() {
    localStorage.removeItem("ml_cart_id");
    // La pastille de l'en-tête comptait encore l'affiche payée sur l'écran
    // « Merci » (« Panier 1 » au-dessus d'un panier vidé) : on lui dit de
    // relire, comme après une vente du stand.
    window.dispatchEvent(new Event("ml:panier"));
    setPhase("details");
    // orderNumber déjà en mémoire -> l'écran « Merci » s'affiche via <Show>.
    setSubmitting(false);
    // Marque la commande comme finalisée pour l'affichage.
    setPaid(true);
  }
  const [paid, setPaid] = createSignal(false);

  /*
   * Retour d'un moyen de paiement À REDIRECTION (Bancontact, iDEAL, Klarna…).
   *
   * confirmPayment ne quitte le site que pour ces moyens-là (redirect:
   * "if_required") ; Stripe ramène alors la cliente ICI, avec
   * ?payment_intent=…&payment_intent_client_secret=…&redirect_status=…, dans
   * une caisse neuve qui a tout oublié. Elle retombait sur le formulaire,
   * rempli de son panier déjà réglé.
   *
   * L'adresse ne décide de rien — redirect_status s'écrit à la main : on la
   * transmet au serveur, qui relit l'intention chez Stripe, marque la
   * commande payée par le même chemin que le paiement sans redirection, et
   * répond par l'écran à montrer. En attendant : « nous vérifions ». Lu dès
   * la création de l'îlot (client:only), pour ne pas laisser voir le
   * formulaire un instant.
   */
  const paramsRetour = new URLSearchParams(window.location.search);
  const intentionRetour = paramsRetour.get("payment_intent");
  const secretRetour = paramsRetour.get("payment_intent_client_secret");
  const [retour, setRetour] = createSignal<
    "verif" | "en_cours" | "ecart" | "refuse" | "injoignable" | null
  >(intentionRetour && secretRetour ? "verif" : null);

  /** Le secret n'a rien à faire dans l'adresse, ni dans l'historique. */
  const effacerRetourDeLAdresse = () =>
    history.replaceState(history.state, "", window.location.pathname);

  onMount(async () => {
    if (!intentionRetour || !secretRetour) return;
    try {
      const r = await browserApi.stripeRetour(intentionRetour, secretRetour);
      effacerRetourDeLAdresse();
      setOrderNumber(r.number);
      if (r.issue === "payee") {
        finishSuccess();
        setRetour(null);
      } else if (r.issue === "en_cours" || r.issue === "ecart") {
        // Le panier est engagé dans ce paiement : on l'oublie, comme après un
        // paiement réussi. Y ajouter une affiche le remettrait en panier sous
        // un paiement que la banque peut encore accepter.
        localStorage.removeItem("ml_cart_id");
        window.dispatchEvent(new Event("ml:panier"));
        setRetour(r.issue === "ecart" ? "ecart" : "en_cours");
      } else {
        // Refusé : la commande est restée en attente, le panier aussi. La
        // caisse ordinaire s'affiche, et revalider ouvre un nouveau paiement.
        setRetour("refuse");
      }
    } catch (err) {
      console.error("[caisse] retour de paiement", err);
      // 4xx : une adresse qui ne correspond à aucun de nos paiements (copiée,
      // trafiquée). Rien à vérifier : la caisse ordinaire.
      if (/-> 4\d\d/.test(String(err))) {
        effacerRetourDeLAdresse();
        setRetour(null);
        return;
      }
      // Une panne : on ne sait pas. L'adresse est gardée, pour qu'un
      // rechargement refasse la vérification ; surtout pas de formulaire
      // qui inviterait à payer une seconde fois.
      setRetour("injoignable");
    }
  });

  /** L'écran du retour, tant qu'il n'y a ni « Merci » ni caisse à montrer. */
  const ecranRetour = () => (
    <div class="rounded-2xl border border-ink/10 bg-paper-deep/40 p-8 text-center">
      <Show when={retour() === "verif"}>
        <p role="status" class="text-ink-soft">
          <span class="ml-spinner mr-2" aria-hidden="true" />
          {tr("commande.retour.verification")}
        </p>
      </Show>
      <Show when={retour() === "en_cours" || retour() === "ecart"}>
        <h2 class="font-serif text-3xl">{tr("commande.retour.en_cours_titre")}</h2>
        <p class="mt-3 text-ink-soft">
          {tr(retour() === "ecart" ? "commande.retour.ecart_texte" : "commande.retour.en_cours_texte")}
        </p>
        <p class="mt-4 text-lg">
          {tr("commande.numero")}{" "}
          <span class="text-2xl">{orderNumber()}</span>
        </p>
      </Show>
      <Show when={retour() === "injoignable"}>
        <p role="alert" class="text-terracotta-deep">
          {tr("commande.retour.injoignable")}
        </p>
      </Show>
      <Show when={retour() !== "verif"}>
        <a
          href={lien(langue, "/affiches")}
          class="mt-6 inline-block rounded-full bg-ink px-6 py-3 text-paper font-medium hover:bg-ink/85 transition-colors"
        >
          {tr("produit.retour")}
        </a>
      </Show>
    </div>
  );

  /** Phase 1 -> 2 : crée la commande (pending) puis prépare le moyen choisi. */
  /**
   * Valide une commande à 0 € : le serveur recalcule TOUT (articles, code,
   * livraison, carte) et refuse le moindre centime à payer.
   */
  async function validerSansPaiement(oid: number): Promise<void> {
    const r = await browserApi.validerGratuite(oid);
    if (r.status !== "paid") throw new Error("API POST /payments/gratuit -> 409 {\"code\":\"montant_non_nul\"}");
    setOrderNumber(r.number);
    setSansPaiement(true);
    finishSuccess();
  }
  /** La commande s'est validée sans paiement : le « Merci » le dit autrement. */
  const [sansPaiement, setSansPaiement] = createSignal(false);

  async function goToPay(e: Event) {
    e.preventDefault();
    if (!formValid() || (!method() && !gratuit()) || submitting()) return;
    setSubmitting(true);
    setError(null);
    // Le refus d'une redirection précédente ne vaut plus : elle réessaie.
    if (retour() === "refuse") setRetour(null);
    // L'étape où l'on en est : un 502 ne dit pas la même chose selon qu'il
    // répond à la commande (le proxy n'a pas joint l'API, une panne comme une
    // autre) ou à la carte (Stripe n'a pas préparé le paiement).
    let etapeCarte = false;
    try {
      const a = adresse();
      // Un retrait sur place envoie le lieu choisi, par son identifiant : le
      // serveur relit le lieu et en garde une copie sur la commande. Il ne
      // passe plus par les champs du point relais (l'ancien « stand:… »).
      const lieu = optionChoisie()?.mode.kind === "pickup" ? lieuRetenu() : null;
      const relais = lieu ? { id: "", label: "" } : pointRelais();
      const order = await browserApi.createOrder(
        getCartId(),
        { name: name().trim(), email: email().trim() },
        codePromo()?.code ?? undefined,
        // Des cartes cadeaux seules : rien à livrer, pas de livraison envoyée.
        avecAffiches()
          ? {
              method: modeChoisi() ?? "",
              name: name().trim(),
              line1: a.line1.trim(),
              line2: a.line2.trim(),
              postalCode: a.postalCode.trim(),
              city: a.city.trim(),
              country: pays(),
              phone: a.phone.trim(),
              relayPointId: relais.id.trim(),
              relayPointLabel: relais.label.trim(),
              ...(lieu ? { pickupPointId: lieu.id } : {}),
              ...(lieu?.standId != null ? { retraitCompris: standCompris() } : {}),
            }
          : undefined,
        langue,
        {
          carteCadeau: carte()?.code,
          cartesCadeaux: cartesAchetees().map((it) => ({
            itemId: it.id,
            email: destinataire(it.id).email.trim(),
            prenom: destinataire(it.id).prenom.trim(),
            message: destinataire(it.id).message.trim(),
          })),
        },
      );
      setOrderId(order.orderId);
      setOrderNumber(order.number);

      // Le reste à payer que le SERVEUR a calculé. À 0 €, rien à encaisser :
      // la commande se valide sans prestataire, après un dernier recalcul.
      const resteServeur = order.aPayerCents ?? order.totalCents;
      if (resteServeur === 0) {
        await validerSansPaiement(order.orderId);
        return;
      }
      // L'écran croyait la commande gratuite, le serveur non : on le dit, et
      // la cliente choisit un moyen de paiement.
      if (!method()) {
        setError(tr("caisse.err.montant_non_nul"));
        return;
      }

      if (method() === "stripe") {
        const cfg = config()?.stripe;
        // L'intention D'ABORD : elle rend la clé publique des clés qui l'ont
        // créée. Charger Stripe.js avec celle lue à l'ouverture de la caisse
        // mariait, après une bascule entre l'essai et le réel, une clé d'un
        // mode à une intention de l'autre — et la carte était refusée.
        etapeCarte = true;
        const { clientSecret, publicKey } = await browserApi.stripeIntent(order.orderId);
        const cle = publicKey || cfg?.publicKey || "";
        // La boutique a changé de clés depuis l'ouverture : l'encadré « mode
        // essai » et les moyens proposés se relisent.
        if (cfg && publicKey && publicKey !== cfg.publicKey) void relireConfig();
        // Stripe.js qui ne se charge pas (réseau, bloqueur) : la carte est
        // indisponible pour l'instant, la commande attend d'être payée.
        stripe = cle ? await loadStripe(cle).catch(() => null) : null;
        if (!stripe) {
          setError(tr("commande.err.carte_indisponible"));
          return;
        }
        setStripeClientSecret(clientSecret);
      }
      // PayPal : les boutons se rendent via l'effet une fois en phase "pay".
      setPhase("pay");
    } catch (err) {
      if (String(err).includes("cadres_retires")) {
        // La boutique a retiré les cadres du site pendant que la cliente
        // remplissait la caisse : le serveur les a ôtés du panier et refusé la
        // commande. Le récapitulatif se relit, et elle valide en voyant le
        // nouveau montant.
        setError(tr("panier.cadres_retires"));
        void relirePanier();
      } else {
        // 400 : des coordonnées ou une livraison que le serveur refuse. Les
        // refus connus ont leur code ; un refus sans code garde, en français,
        // le texte de l'API, qui dit précisément quoi corriger. Les autres
        // langues ne peuvent pas le lire : elles ont la phrase générique.
        // 502, 503 à l'étape de la carte : le paiement par carte n'a pas pu
        // être préparé chez Stripe, ou Stripe n'est pas branché.
        // Toute autre panne — l'API qui lève, le réseau coupé — a la phrase
        // technique : rien n'est débité à ce stade, le panier est intact.
        setError(
          messageErreur(err, {
            ...(etapeCarte
              ? {
                  502: "commande.err.carte_indisponible" as const,
                  503: "commande.err.carte_indisponible" as const,
                }
              : {}),
            ...(langue === LANGUE_DEFAUT ? {} : { 400: "commande.err.generique" as const }),
          }),
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  /** Retour à la saisie : on démonte les widgets pour repartir propre. */
  function backToDetails() {
    elements = null;
    setStripeClientSecret(null);
    paypalRendered = false;
    if (paypalMountRef) paypalMountRef.innerHTML = "";
    setPhase("details");
    setError(null);
  }

  /**
   * La boutique a changé de clés de paiement pendant la commande (bascule
   * entre l'essai et le réel). On repart de la saisie, sans moyen choisi,
   * avec la configuration relue et le SDK PayPal oublié. Après la main : le
   * SDK PayPal termine d'abord son propre refus.
   */
  function moyensReconfigures() {
    setTimeout(() => {
      oublierSdkPaypal();
      backToDetails();
      setMethod(null);
      setError(tr("commande.err.paiement_reconfigure"));
      void relireConfig();
    }, 0);
  }

  /** Confirmation Stripe (carte). */
  async function payStripe() {
    if (!stripe || !elements || submitting()) return;
    setSubmitting(true);
    setError(null);
    try {
      // Le panier a-t-il bougé depuis l'ouverture du paiement — un autre
      // onglet, un retour au panier ? Il est alors revenu à l'état de panier,
      // et le serveur refusera de valider l'ancien montant ; mais la carte,
      // elle, serait déjà débitée. Mieux vaut le dire AVANT de payer.
      // Une panne ICI a lieu avant la carte : rien n'est débité, et le dire
      // évite à la cliente de guetter son relevé.
      const panier = await browserApi.cart(getCartId()).catch(() => null);
      if (!panier) {
        setError(tr("commande.err.avant_paiement"));
        return;
      }
      if (panier.status === "draft") {
        setError(tr("commande.err.panier_modifie"));
        return;
      }
      const { error: stripeErr, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: {
          return_url: `${window.location.origin}${lien(langue, "/commande")}`,
        },
      });
      if (stripeErr) {
        setError(stripeErr.message ?? tr("commande.err.refuse"));
        return;
      }
      if (paymentIntent && paymentIntent.status === "succeeded") {
        const oid = orderId();
        if (oid != null) await browserApi.stripeConfirm(oid);
        finishSuccess();
      } else {
        setError(tr("commande.err.non_finalise"));
      }
    } catch (err) {
      // La carte a pu être débitée avant la panne : la phrase du paiement,
      // pas celle d'un panier « gardé ».
      setError(messageErreur(err, ECHEC_ENCAISSEMENT, "commande.err.paiement"));
    } finally {
      setSubmitting(false);
    }
  }

  /*
   * La page attend que la caisse soit PRÊTE pour la montrer d'un coup
   * (commande.astro, .ml-attente) : le panier lu, les promotions, le
   * catalogue de livraison et les fiches lus, le code d'une visite précédente
   * revérifié — le récapitulatif est alors calculé —, puis les polices
   * chargées. Le retour de la banque, lui, se montre tout de suite : c'est
   * l'écran « nous vérifions votre paiement ».
   */
  let pretSignale = false;
  createEffect(() => {
    const retourBanque = retour() !== null && retour() !== "refuse";
    const pret =
      retourBanque ||
      paid() ||
      (!cart.loading &&
        !promos.loading &&
        !catalogue.loading &&
        !fiches.loading &&
        codeRepris());
    if (!pret || pretSignale) return;
    pretSignale = true;
    const montrer = () => document.getElementById("ml-attente")?.setAttribute("data-pret", "");
    // Les polices d'abord : sinon le texte apparaîtrait, puis changerait.
    void (document.fonts?.ready ?? Promise.resolve()).then(montrer, montrer);
  });

  return (
    <Show
      when={!paid() && (retour() === null || retour() === "refuse")}
      fallback={
        <Show when={paid()} fallback={ecranRetour()}>
          <div class="rounded-2xl border border-sage/40 bg-sage/10 p-8 text-center">
            <h2 class="font-serif text-3xl">{tr("commande.merci_titre")}</h2>
            <p class="mt-3 text-ink-soft">
              {tr(sansPaiement() ? "caisse.merci_gratuit" : "commande.merci_texte")}
            </p>
            <p class="mt-4 text-lg">
              {tr("commande.numero")}{" "}
              <span class="text-2xl">{orderNumber()}</span>
            </p>
            <a
              href={lien(langue, "/affiches")}
              class="mt-6 inline-block rounded-full bg-ink px-6 py-3 text-paper font-medium hover:bg-ink/85 transition-colors"
            >
              {tr("produit.retour")}
            </a>
          </div>
        </Show>
      }
    >
      {/* Revenue de la banque sur un refus : en tête, là où elle regarde en
          arrivant, et pas au pied du formulaire comme les autres erreurs. */}
      <Show when={retour() === "refuse"}>
        <p
          role="alert"
          class="mb-6 rounded-lg bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep"
        >
          {tr("commande.retour.refuse")}
        </p>
      </Show>
      {/* Le panier se lit : la silhouette de la caisse, et non une page
          blanche (17/11). */}
      <Show when={cart.loading}>
        <div
          class="grid items-start gap-8 lg:grid-cols-[1fr_320px]"
          aria-busy="true"
          aria-label={tr("panier.chargement")}
        >
          <div class="space-y-4">
            <div class="ml-skeleton h-7 w-52" />
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="ml-skeleton h-12" />
              <div class="ml-skeleton h-12" />
            </div>
            <div class="ml-skeleton h-12" />
            <div class="ml-skeleton mt-8 h-7 w-36" />
            <div class="ml-skeleton h-12" />
            <div class="ml-skeleton h-16" />
            <div class="ml-skeleton h-16" />
            <div class="ml-skeleton h-16" />
          </div>
          <div class="ml-skeleton h-72" />
        </div>
      </Show>
      <Show when={cart() && cart()!.items.length === 0}>
        <div class="rounded-2xl border border-ink/10 bg-paper-deep/40 p-8 text-center">
          <p class="text-ink-soft">{tr("panier.vide")}</p>
          <a
            href={lien(langue, "/affiches")}
            class="mt-6 inline-block rounded-full bg-ink px-6 py-3 text-paper font-medium hover:bg-ink/85 transition-colors"
          >
            {tr("accueil.cta")}
          </a>
        </div>
      </Show>

      <Show when={cart() && cart()!.items.length > 0}>
        <div class="grid lg:grid-cols-[1fr_320px] gap-8 items-start">
          {/* Sans compte (17/11) : le récapitulatif reste modifiable, à droite,
              et la connexion n'est demandée qu'ici, au moment des
              informations et du paiement. Le retour ramène à cette page,
              panier intact. */}
          <Show when={!props.compte}>
            <div class="rounded-2xl border border-ink/10 bg-paper-deep/40 p-6">
              <h2 class="text-2xl">{tr("caisse.connexion.titre")}</h2>
              <p class="mt-3 text-ink-soft">{tr("caisse.connexion.texte")}</p>
              <div class="mt-6 flex flex-wrap gap-3">
                <a
                  href={`${lien(langue, "/compte/connexion")}?retour=${encodeURIComponent(lien(langue, "/commande"))}`}
                  class="inline-flex items-center justify-center rounded-full bg-ink px-6 py-3 font-medium text-paper hover:bg-ink/85 transition-colors"
                >
                  {tr("caisse.connexion.se_connecter")}
                </a>
                <a
                  href={`${lien(langue, "/compte/inscription")}?retour=${encodeURIComponent(lien(langue, "/commande"))}`}
                  class="inline-flex items-center justify-center rounded-full border-2 border-ink px-6 py-3 font-medium hover:bg-ink hover:text-paper transition-colors"
                >
                  {tr("caisse.connexion.creer")}
                </a>
              </div>
            </div>
          </Show>
          <Show when={props.compte}>
          <div class="space-y-8">
            {/* Coordonnées */}
            <fieldset class="space-y-4" disabled={phase() === "pay"}>
              <legend class="text-2xl mb-2">{tr("commande.coordonnees")}</legend>
              <div class="grid gap-4 sm:grid-cols-2">
                <label class="block">
                  <span class="text-sm font-medium">{tr("compte.prenom")}</span>
                  <input
                    type="text"
                    required
                    value={prenom()}
                    onInput={(e) => setPrenom(e.currentTarget.value)}
                    autocomplete="given-name"
                    class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                    placeholder="Camille"
                  />
                </label>
                <label class="block">
                  <span class="text-sm font-medium">{tr("compte.nom")}</span>
                  <input
                    type="text"
                    required
                    value={nomFamille()}
                    onInput={(e) => setNomFamille(e.currentTarget.value)}
                    autocomplete="family-name"
                    class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                    placeholder="Durand"
                  />
                </label>
              </div>
              <label class="block">
                <span class="text-sm font-medium">{tr("commande.email")}</span>
                <input
                  type="email"
                  required
                  value={email()}
                  readOnly={Boolean(props.compte)}
                  onInput={(e) => setEmail(e.currentTarget.value)}
                  class={`mt-1 w-full rounded-lg border border-ink/20 px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60 ${
                    props.compte ? "bg-paper-deep text-ink-soft" : "bg-paper"
                  }`}
                  placeholder="camille@example.com"
                />
                {/* Celle du compte, grisée : c'est elle qui identifie la
                    commande. La phrase qui l'expliquait est retirée (17/11) :
                    le champ grisé se comprend tout seul. */}
                <Show when={email().length > 0 && !emailValid()}>
                  <span class="mt-1 block text-xs text-terracotta-deep">
                    {tr("commande.email_invalide")}
                  </span>
                </Show>
              </label>
            </fieldset>

            {/* Les cartes cadeaux achetées : à qui les envoyer. */}
            <Show when={cartesAchetees().length > 0}>
              <fieldset class="space-y-4" disabled={phase() === "pay"}>
                <legend class="text-2xl mb-2">{tr("caisse.cartes.titre")}</legend>
                <p class="text-sm text-ink-soft">{tr("caisse.cartes.intro")}</p>
                <For each={cartesAchetees()}>
                  {(it) => (
                    <div class="space-y-3 rounded-lg border border-ink/15 p-4">
                      <p class="font-medium">
                        {tr("caisse.cartes.numero").replace("{montant}", () =>
                          formatPrice(it.unitPriceCents, locale),
                        )}
                      </p>
                      <label class="block">
                        <span class="text-sm font-medium">{tr("caisse.cartes.email")}</span>
                        <input
                          type="email"
                          value={destinataire(it.id).email}
                          onInput={(e) => majDestinataire(it.id, "email", e.currentTarget.value)}
                          placeholder={email()}
                          maxlength="200"
                          class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                        />
                        <span class="mt-1 block text-xs text-ink-soft">{tr("caisse.cartes.email_aide")}</span>
                      </label>
                      <label class="block">
                        <span class="text-sm font-medium">{tr("caisse.cartes.prenom")}</span>
                        <input
                          type="text"
                          value={destinataire(it.id).prenom}
                          onInput={(e) => majDestinataire(it.id, "prenom", e.currentTarget.value)}
                          maxlength="60"
                          class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                        />
                      </label>
                      <label class="block">
                        <span class="text-sm font-medium">{tr("caisse.cartes.message")}</span>
                        <textarea
                          rows="3"
                          value={destinataire(it.id).message}
                          onInput={(e) => majDestinataire(it.id, "message", e.currentTarget.value)}
                          maxlength="300"
                          class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                        />
                      </label>
                    </div>
                  )}
                </For>
              </fieldset>
            </Show>

            {/* Livraison : des affiches seulement. Des cartes cadeaux seules
                n'ont rien à livrer. */}
            <Show
              when={avecAffiches()}
              fallback={
                <p class="rounded-lg border border-ink/10 bg-paper-deep/40 px-4 py-3 text-sm text-ink-soft">
                  {tr("caisse.sans_livraison")}
                </p>
              }
            >
            <fieldset class="space-y-4" disabled={phase() === "pay"}>
              <legend class="text-2xl mb-2">{tr("livraison.titre")}</legend>

              <label class="block">
                <span class="text-sm font-medium">{tr("livraison.pays")}</span>
                <select
                  value={pays()}
                  onChange={(e) => setPays(e.currentTarget.value)}
                  class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                >
                  <For each={PAYS}>
                    {(code) => <option value={code}>{nomPays(code)}</option>}
                  </For>
                </select>
              </label>

              {/* Le poids du colis n'est plus affiché (17/11) : il ne dit rien
                  à la cliente. Il sert toujours, en coulisse, à ne proposer
                  que les modes qui savent le porter. */}
              <Show
                when={optionsPort().length > 0}
                fallback={
                  /* Rien tant que le catalogue n'est pas arrivé : une liste
                     vide en cours de chargement n'est pas un refus. */
                  <Show
                    when={!catalogue.loading}
                    fallback={
                      <div class="space-y-3" aria-busy="true">
                        <div class="ml-skeleton h-16" />
                        <div class="ml-skeleton h-16" />
                        <div class="ml-skeleton h-16" />
                      </div>
                    }
                  >
                    <p class="text-sm text-terracotta-deep">
                      {poidsColis() > 0
                        ? tr("livraison.aucune_pour_ce_poids")
                        : tr("livraison.aucune")}
                    </p>
                  </Show>
                }
              >
                <div class="space-y-2">
                  <For each={optionsPort()}>
                    {(o) =>
                      o.mode.slug === MODE_RETRAIT_STAND ? (
                        /* Retrait au stand (17/11) : le même rectangle que les
                           autres modes ; dedans, sous sa phrase, un bouton de
                           couleur par stand ouvert (ville / événement). DESSOUS
                           le rectangle : l'emplacement, les dates et horaires du
                           stand choisi, et la case « je viendrai avant le … ».
                           Pas de <label> autour : des boutons dans un libellé ne
                           se lisent pas bien. */
                        <>
                          <div
                            class={`flex items-start gap-3 border p-4 transition-colors ${
                              modeChoisi() === o.mode.slug
                                ? "border-ink"
                                : "border-ink/20 hover:border-ink/50"
                            }`}
                          >
                            <input
                              id="mode-retrait-stand"
                              type="radio"
                              name="mode-livraison"
                              class="mt-1"
                              checked={modeChoisi() === o.mode.slug}
                              onChange={() => setModeChoisi(o.mode.slug)}
                            />
                            <span class="flex-1">
                              <label
                                for="mode-retrait-stand"
                                class="flex cursor-pointer items-baseline justify-between gap-3"
                              >
                                <span class="font-medium">{o.mode.name}</span>
                                <span>
                                  {/* « Offert » plutôt que « 0 € » (17/11). */}
                                  {o.offert
                                    ? tr("livraison.offerte")
                                    : o.fraisCents === 0
                                      ? tr("livraison.offert")
                                      : formatPrice(o.fraisCents, locale)}
                                </span>
                              </label>
                              <Show when={o.mode.description}>
                                <label
                                  for="mode-retrait-stand"
                                  class="mt-0.5 block cursor-pointer whitespace-pre-line text-sm text-ink-soft"
                                >
                                  {o.mode.description}
                                </label>
                              </Show>
                              <span class="mt-3 flex flex-wrap gap-2">
                                <For each={lieuxDesStands()}>
                                  {(lieu) => {
                                    const choisi = () =>
                                      modeChoisi() === o.mode.slug && lieuRetenu()?.id === lieu.id;
                                    return (
                                      <button
                                        type="button"
                                        aria-pressed={choisi()}
                                        onClick={() => {
                                          // Un autre stand, une autre date : la
                                          // case se recoche.
                                          if (lieuChoisi() !== lieu.id) setStandCompris(false);
                                          setModeChoisi(o.mode.slug);
                                          setLieuChoisi(lieu.id);
                                        }}
                                        class={`rounded-full border-2 border-terracotta px-4 py-2 text-sm font-semibold transition-colors ${
                                          choisi()
                                            ? "bg-terracotta text-paper"
                                            : "bg-paper text-terracotta hover:bg-terracotta/10"
                                        }`}
                                      >
                                        <span class="block">{lieu.nom}</span>
                                        {/* Ouvert ou fermé en ce moment (17/11). */}
                                        <Show when={lieu.ouvert != null}>
                                          <span class="block text-xs font-normal opacity-85">
                                            {lieu.ouvert ? "● " + tr("livraison.stand_ouvert") : "○ " + tr("livraison.stand_ferme")}
                                          </span>
                                        </Show>
                                      </button>
                                    );
                                  }}
                                </For>
                              </span>
                            </span>
                          </div>
                          <Show
                            when={
                              modeChoisi() === o.mode.slug && lieuRetenu()?.standId != null
                                ? lieuRetenu()
                                : null
                            }
                          >
                            {(lieu) => (
                              <div class="border border-ink/15 bg-paper-deep/40 p-4 text-sm">
                                <span class="block font-medium">
                                  {lieu().nom}
                                  <Show when={lieu().ouvert != null}>
                                    <span class={`ml-2 text-xs font-normal ${lieu().ouvert ? "text-green-700" : "text-ink-soft"}`}>
                                      {lieu().ouvert ? "● " + tr("livraison.stand_ouvert") : "○ " + tr("livraison.stand_ferme")}
                                    </span>
                                  </Show>
                                </span>
                                <Show when={lieu().adresse}>
                                  <span class="mt-0.5 block whitespace-pre-line">{lieu().adresse}</span>
                                </Show>
                                {/* Les 7 prochains jours en petit tableau (17/11 :
                                    « plus buvable », « que les 7 premiers puis des
                                    points de suspension ») ; le texte d'avant ne sert
                                    plus que si l'API ne les donne pas. */}
                                <Show
                                  when={lieu().semaine?.jours.length ? lieu().semaine : null}
                                  fallback={
                                    <Show when={lieu().description}>
                                      <span class="mt-2 block whitespace-pre-line text-ink-soft">
                                        {lieu().description}
                                      </span>
                                    </Show>
                                  }
                                >
                                  {(semaine) => (
                                    <>
                                      <Show when={lieu().du && lieu().au}>
                                        <span class="mt-2 block text-ink-soft">
                                          {tr("livraison.stand_periode")
                                            .replace("{du}", jourLong(lieu().du!))
                                            .replace("{au}", jourLong(lieu().au!))}
                                        </span>
                                      </Show>
                                      <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 tabular-nums">
                                        <For each={semaine().jours}>
                                          {(j) => (
                                            <>
                                              <dt class={j.jour === aujourdhuiAParis ? "font-medium" : "text-ink-soft"}>
                                                {j.jour === aujourdhuiAParis ? tr("livraison.aujourdhui") : jourCourt(j.jour)}
                                              </dt>
                                              <dd class={j.ferme ? "text-ink-soft" : j.jour === aujourdhuiAParis ? "font-medium" : ""}>
                                                {j.ferme
                                                  ? tr("livraison.jour_ferme")
                                                  : j.creneaux.map((c) => `${c.de}–${c.a}`).join(" · ")}
                                              </dd>
                                            </>
                                          )}
                                        </For>
                                        <Show when={semaine().suite}>
                                          <dt class="text-ink-soft">…</dt>
                                          <dd />
                                        </Show>
                                      </dl>
                                    </>
                                  )}
                                </Show>
                                {/* La pièce à présenter au retrait (17/11). */}
                                <span class="mt-3 block font-medium">
                                  {tr("livraison.stand_identite")}
                                </span>
                                <Show when={lieu().retirerAvant}>
                                  <label class="mt-3 flex cursor-pointer items-start gap-2 border-t border-ink/10 pt-3">
                                    <input
                                      type="checkbox"
                                      class="mt-0.5"
                                      checked={standCompris()}
                                      onChange={(e) => setStandCompris(e.currentTarget.checked)}
                                    />
                                    <span>
                                      {/* En gras de « au plus tard » à la fin (17/11) :
                                          le passage est entre ** dans la traduction. */}
                                      {tr("livraison.stand_compris")
                                        .replace(
                                          "{date}",
                                          jourLong(lieu().retirerAvant!) +
                                            (lieu().retirerAvantHeure
                                              ? " " + tr("livraison.a_heure").replace("{heure}", lieu().retirerAvantHeure!)
                                              : ""),
                                        )
                                        .split("**")
                                        .map((morceau, i) =>
                                          i % 2 ? <strong class="font-semibold">{morceau}</strong> : morceau,
                                        )}
                                    </span>
                                  </label>
                                </Show>
                              </div>
                            )}
                          </Show>
                        </>
                      ) : (
                      <label
                        class={`flex cursor-pointer items-start gap-3 border p-4 transition-colors ${
                          modeChoisi() === o.mode.slug
                            ? "border-ink"
                            : "border-ink/20 hover:border-ink/50"
                        }`}
                      >
                        <input
                          type="radio"
                          name="mode-livraison"
                          class="mt-1"
                          checked={modeChoisi() === o.mode.slug}
                          onChange={() => setModeChoisi(o.mode.slug)}
                        />
                        <span class="flex-1">
                          <span class="flex items-baseline justify-between gap-3">
                            <span class="font-medium">{o.mode.name}</span>
                            <span>
                              {o.offert
                                ? tr("livraison.offerte")
                                : o.fraisCents === 0
                                  ? tr("livraison.offert")
                                  : formatPrice(o.fraisCents, locale)}
                            </span>
                          </span>
                          {/* Le texte du mode, sur autant de lignes que la
                              boutique en a écrit (un retrait sur place y
                              met ses horaires, ce qu'il faut apporter). */}
                          <Show when={o.mode.description}>
                            <span class="mt-0.5 block whitespace-pre-line text-sm text-ink-soft">
                              {o.mode.description}
                            </span>
                          </Show>
                        </span>
                      </label>
                      )
                    }
                  </For>
                  {/* Retrait sur place : les lieux réglés au back-office,
                      HORS du libellé du mode — des boutons radio dans un
                      libellé ne se lisent pas (ni au clavier, ni par un
                      lecteur d'écran). Nom, adresse et texte de chaque lieu,
                      ligne à ligne. Un seul : il est déjà choisi. */}
                  <Show
                    when={
                      optionChoisie()?.mode.kind === "pickup" &&
                      optionChoisie()?.mode.slug !== MODE_RETRAIT_STAND &&
                      lieuxRetrait().length > 0
                    }
                  >
                    <fieldset class="space-y-2 border border-ink/20 p-4">
                      <legend class="px-1 text-sm font-medium">
                        {tr("livraison.ou_retirer")}
                      </legend>
                      <For each={lieuxRetrait()}>
                        {(lieu) => (
                          <label
                            class={`flex cursor-pointer items-start gap-3 border p-3 text-sm transition-colors ${
                              lieuRetenu()?.id === lieu.id
                                ? "border-ink"
                                : "border-ink/20 hover:border-ink/50"
                            }`}
                          >
                            <input
                              type="radio"
                              name="lieu-retrait"
                              class="mt-1"
                              checked={lieuRetenu()?.id === lieu.id}
                              onChange={() => setLieuChoisi(lieu.id)}
                            />
                            <span class="flex-1">
                              <span class="block font-medium">{lieu.nom}</span>
                              <Show when={lieu.adresse}>
                                <span class="mt-0.5 block whitespace-pre-line">
                                  {lieu.adresse}
                                </span>
                              </Show>
                              <Show when={lieu.description}>
                                <span class="mt-1 block whitespace-pre-line text-ink-soft">
                                  {lieu.description}
                                </span>
                              </Show>
                            </span>
                          </label>
                        )}
                      </For>
                    </fieldset>
                  </Show>
                </div>
              </Show>

              {/* Adresse : demandée seulement quand le mode en a besoin. */}
              <Show when={demandeUneAdresse(optionChoisie()?.mode.kind ?? "")}>
                <div class="space-y-4">
                  {/* Le carnet : une adresse déjà enregistrée se choisit d'un
                      clic plutôt que de se retaper. */}
                  <Show when={(props.carnet ?? []).length > 0}>
                    <div class="rounded-lg border border-ink/15 p-3">
                      <p class="mb-2 text-sm font-medium">
                        {tr("livraison.carnet")}
                      </p>
                      <div class="flex flex-wrap gap-2">
                        <For each={props.carnet}>
                          {(a) => (
                            <button
                              type="button"
                              onClick={() => choisirAdresse(a.id)}
                              class={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                                adresseChoisie() === a.id
                                  ? "border-terracotta bg-terracotta/10"
                                  : "border-ink/20 hover:border-ink"
                              }`}
                            >
                              <span class="block font-medium">
                                {a.label || a.line1 || tr("livraison.adresse")}
                              </span>
                              <span class="block text-xs text-ink-soft">
                                {[a.postalCode, a.city].filter(Boolean).join(" ")}
                              </span>
                            </button>
                          )}
                        </For>
                        <button
                          type="button"
                          onClick={() => choisirAdresse(null)}
                          class={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                            adresseChoisie() === null
                              ? "border-terracotta bg-terracotta/10"
                              : "border-ink/20 hover:border-ink"
                          }`}
                        >
                          {tr("livraison.autre_adresse")}
                        </button>
                      </div>
                    </div>
                  </Show>
                  <label class="block">
                    <span class="text-sm font-medium">
                      {tr("livraison.adresse")}
                    </span>
                    <input
                      type="text"
                      value={adresse().line1}
                      onInput={(e) =>
                        setAdresse({ ...adresse(), line1: e.currentTarget.value })
                      }
                      class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                      placeholder={tr("livraison.adresse_exemple")}
                    />
                  </label>
                  <label class="block">
                    <span class="text-sm font-medium">
                      {tr("livraison.complement")}
                    </span>
                    <input
                      type="text"
                      value={adresse().line2}
                      onInput={(e) =>
                        setAdresse({ ...adresse(), line2: e.currentTarget.value })
                      }
                      class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                      placeholder={tr("livraison.complement_exemple")}
                    />
                  </label>
                  <div class="grid grid-cols-[8rem_1fr] gap-4">
                    <label class="block">
                      <span class="text-sm font-medium">
                        {tr("livraison.code_postal")}
                      </span>
                      <input
                        type="text"
                        value={adresse().postalCode}
                        onBlur={() => setCpQuitte(true)}
                        onInput={(e) =>
                          setAdresse({
                            ...adresse(),
                            postalCode: e.currentTarget.value,
                          })
                        }
                        class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                        placeholder="80350"
                      />
                    </label>
                    <label class="block">
                      <span class="text-sm font-medium">
                        {tr("livraison.ville")}
                      </span>
                      <input
                        type="text"
                        value={adresse().city}
                        onInput={(e) =>
                          setAdresse({ ...adresse(), city: e.currentTarget.value })
                        }
                        class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                        placeholder="Mers-les-Bains"
                      />
                    </label>
                  </div>
                  <Show
                    when={
                      cpQuitte() &&
                      adresse().postalCode.trim() !== "" &&
                      !codePostalValide(adresse().postalCode, pays())
                    }
                  >
                    <p class="-mt-2 text-sm text-red-700" role="alert">
                      {tr("livraison.code_postal_invalide")}
                    </p>
                  </Show>
                  <label class="block">
                    <span class="text-sm font-medium">
                      {tr("livraison.telephone")}
                    </span>
                    <input
                      type="tel"
                      value={adresse().phone}
                      onBlur={() => setTelQuitte(true)}
                      onInput={(e) =>
                        setAdresse({ ...adresse(), phone: e.currentTarget.value })
                      }
                      class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                      placeholder="06 12 34 56 78"
                    />
                  </label>
                  <Show when={telQuitte() && !telephoneValide(adresse().phone)}>
                    <p class="-mt-2 text-sm text-red-700" role="alert">
                      {tr("livraison.telephone_invalide")}
                    </p>
                  </Show>
                </div>
              </Show>

              {/* Point relais : le client cherche autour de chez lui et choisit
                  dans la liste renvoyée par le transporteur. */}
              <Show when={demandeUnPointRelais(optionChoisie()?.mode.kind ?? "")}>
                <div class="space-y-3">
                  <span class="block text-sm font-medium">
                    {tr("livraison.point_relais")}
                  </span>
                  <div class="flex items-stretch gap-2">
                    <div class="relative min-w-0 flex-1">
                      <input
                        type="text"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={suggestions().length > 0}
                        aria-controls="ml-suggestions-adresse"
                        aria-activedescendant={
                          suggestionActive() >= 0
                            ? `ml-suggestion-${suggestionActive()}`
                            : undefined
                        }
                        autocomplete="off"
                        value={cpRecherche()}
                        onInput={(e) => saisirRecherche(e.currentTarget.value)}
                        onKeyDown={toucheRecherche}
                        // Le temps d'un clic sur une suggestion avant de fermer
                        // la liste : sinon elle disparaît sous le doigt.
                        onBlur={() => setTimeout(() => setSuggestions([]), 150)}
                        class="w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                        placeholder={
                          adressesConnues()
                            ? tr("livraison.adresse_recherche")
                            : tr("livraison.cp_recherche")
                        }
                      />
                      <Show when={suggestions().length > 0}>
                        <ul
                          id="ml-suggestions-adresse"
                          role="listbox"
                          class="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-ink/20 bg-paper text-sm shadow-lg"
                        >
                          <For each={suggestions()}>
                            {(s, i) => (
                              <li
                                id={`ml-suggestion-${i()}`}
                                role="option"
                                aria-selected={suggestionActive() === i()}
                                class={`cursor-pointer px-4 py-2 ${
                                  suggestionActive() === i()
                                    ? "bg-paper-deep"
                                    : "hover:bg-paper-deep"
                                }`}
                                // mousedown plutôt que click : il passe avant
                                // la perte de focus du champ.
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  choisirSuggestion(s);
                                }}
                              >
                                {s.label}
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                    </div>
                    <button
                      type="button"
                      onClick={chercherRelais}
                      disabled={relaisEtat() === "recherche" || !cpRecherche().trim()}
                      class="border border-ink px-3 font-medium hover:bg-ink hover:text-paper disabled:opacity-40 transition-colors sm:px-5"
                    >
                      {tr("livraison.chercher")}
                    </button>
                    <Show when={localisable()}>
                      <button
                        type="button"
                        onClick={meLocaliser}
                        disabled={localisation() === "en_cours"}
                        aria-label={
                          localisation() === "en_cours"
                            ? tr("livraison.localisation_en_cours")
                            : tr("livraison.me_localiser")
                        }
                        title={tr("livraison.me_localiser")}
                        class="flex w-12 shrink-0 items-center justify-center border border-ink hover:bg-ink hover:text-paper disabled:opacity-60 transition-colors"
                      >
                        {/* Le symbole « ma position » que tout le monde connaît
                            des applications de cartes : une cible, un point au
                            centre. Il pulse le temps que le navigateur réponde. */}
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          class={`h-5 w-5 ${localisation() === "en_cours" ? "animate-pulse" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                        >
                          <circle cx="12" cy="12" r="7" />
                          <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
                          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                        </svg>
                      </button>
                    </Show>
                  </div>

                  <Show when={localisation() === "refusee"}>
                    <p class="text-sm text-terracotta-deep" role="status">
                      {tr("livraison.position_refusee")}
                    </p>
                  </Show>
                  <Show when={localisation() === "introuvable"}>
                    <p class="text-sm text-terracotta-deep" role="status">
                      {tr("livraison.position_introuvable")}
                    </p>
                  </Show>

                  <Show when={relaisEtat() === "recherche"}>
                    <p class="text-sm text-ink-soft">
                      {tr("livraison.recherche_en_cours")}
                    </p>
                  </Show>
                  <Show when={relaisEtat() === "vide"}>
                    <p class="text-sm text-ink-soft">
                      {tr("livraison.aucun_relais")}
                    </p>
                  </Show>
                  <Show when={relaisEtat() === "erreur"}>
                    <p class="text-sm text-terracotta-deep">
                      {tr("livraison.relais_indisponible")}
                    </p>
                  </Show>

                  <Show when={relais().length > 0}>
                    <Show when={relais().some((r) => r.latitude && r.longitude)}>
                      <CarteRelais
                        langue={langue}
                        points={relais()}
                        choisi={pointRelais().id}
                        depart={departRelais()}
                        onChoisir={choisirRelais}
                      />
                    </Show>
                    {/* La liste défile dans sa case : ˄ ˅ en grand à sa droite
                        et une barre bien visible, comme les listes du module
                        de personnalisation (retour cliente : le défilement
                        était trop discret). */}
                    <ZoneDefilante
                      sens="vertical"
                      versDebut={tr("defiler.haut")}
                      versFin={tr("defiler.bas")}
                      class="max-h-72 overflow-y-auto"
                    >
                    <ul class="space-y-2">
                      <For each={relais()}>
                        {(r, i) => (
                          <li id={`relais-${r.id}`}>
                            <label
                              class={`flex cursor-pointer items-start gap-3 border p-3 text-sm transition-colors ${
                                pointRelais().id === r.id
                                  ? "border-ink"
                                  : "border-ink/20 hover:border-ink/50"
                              }`}
                            >
                              <input
                                type="radio"
                                name="point-relais"
                                class="mt-1"
                                checked={pointRelais().id === r.id}
                                onChange={() => choisirRelais(r)}
                              />
                              {/* Le même numéro que son repère sur la carte. */}
                              <span
                                class={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-paper ${
                                  pointRelais().id === r.id ? "bg-terracotta" : "bg-ink"
                                }`}
                                aria-hidden="true"
                              >
                                {i() + 1}
                              </span>
                              <span class="min-w-0 flex-1">
                                <span class="flex items-baseline justify-between gap-3">
                                  <span class="font-medium">{r.nom}</span>
                                  <Show when={r.distanceMetres !== undefined}>
                                    <span class="shrink-0 text-xs text-ink-soft">
                                      {distanceLisible(r.distanceMetres!)}
                                    </span>
                                  </Show>
                                </span>
                                <span class="block text-ink-soft">
                                  {r.adresse}, {r.codePostal} {r.ville}
                                </span>
                                <Show when={(r.horairesSemaine ?? []).length > 0}>
                                  <details class="mt-1 text-xs text-ink-soft">
                                    <summary class="cursor-pointer select-none">
                                      {tr("livraison.horaires")}
                                    </summary>
                                    <ul class="mt-1 space-y-0.5">
                                      <For each={r.horairesSemaine}>
                                        {(ligne) => <li>{horaireLocal(ligne)}</li>}
                                      </For>
                                    </ul>
                                  </details>
                                </Show>
                              </span>
                            </label>
                          </li>
                        )}
                      </For>
                    </ul>
                    </ZoneDefilante>
                  </Show>

                  <Show when={pointRelais().id}>
                    <p class="text-sm text-sage">
                      {tr("livraison.relais_choisi")} {pointRelais().affiche}
                    </p>
                  </Show>
                </div>
              </Show>
            </fieldset>
            </Show>

            {/* Paiement */}
            <fieldset class="space-y-4">
              <legend class="text-2xl mb-2">
                {tr("compte.commande.paiement")}
              </legend>

              {/* Aucun moyen configuré. La cliente lit ce message : il ne
                  parle ni de fichier ni de clé, seulement de ce qu'elle peut
                  faire — revenir plus tard, ou nous écrire. */}
              {/* Rien à payer (estimation de l'écran ; le serveur décide) :
                  pas de moyen de paiement, un bouton qui valide. */}
              <Show when={gratuit() && phase() === "details"}>
                <p class="rounded-lg border border-sage/40 bg-sage/10 p-4 text-sm">
                  {tr("caisse.valider_texte")}
                </p>
                <button
                  type="button"
                  onClick={goToPay}
                  disabled={!formValid() || submitting()}
                  aria-busy={submitting()}
                  class="w-full rounded-full bg-terracotta px-8 py-4 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting() ? (
                    <>
                      <span class="ml-spinner ml-spinner-clair mr-2" aria-hidden="true" />
                      {tr("caisse.validation_en_cours")}
                    </>
                  ) : (
                    tr("caisse.valider")
                  )}
                </button>
                <Show when={!submitting() && manques().length > 0}>
                  <p class="mt-2 text-center text-sm text-ink-soft" role="status">
                    {tr("commande.il_manque").replace("{liste}", manques().join(", "))}
                  </p>
                </Show>
              </Show>

              <Show when={!gratuit() && config() && methods().length === 0}>
                <div
                  role="status"
                  class="rounded-lg border border-dashed border-terracotta/40 bg-terracotta/5 p-4 text-sm text-ink-soft"
                >
                  {tr("commande.paiement_indisponible")}{" "}
                  <a href={lien(langue, "/contact")} class="underline underline-offset-2">
                    {tr("pied.contact")}
                  </a>
                </div>
              </Show>

              {/* Mode essai : ce qu'il faut saisir. Sans ce rappel on cherche
                  le numéro de carte de test ailleurs à chaque fois, et devant
                  PayPal on essaie son vrai compte, qui ne marche pas. */}
              <Show when={!gratuit() && config()?.essai && methods().length > 0}>
                <div class="rounded-lg border border-sage/40 bg-sage/10 p-4 text-sm">
                  <p class="font-medium">{tr("commande.essai.titre")}</p>
                  <ul class="mt-2 space-y-1 text-ink-soft">
                    <li>
                      <b>{tr("commande.essai.carte_libelle")}</b>{" "}
                      {tr("commande.essai.carte")}
                    </li>
                    <li>
                      <b>{tr("commande.essai.paypal_libelle")}</b>{" "}
                      {avecCode(
                        "commande.essai.paypal",
                        "{domaine}",
                        "@personal.example.com",
                      )}
                    </li>
                  </ul>
                </div>
              </Show>

              <Show when={methods().length > 0 && (!gratuit() || phase() === "pay")}>
                {/* Onglets moyens de paiement */}
                <div class="flex gap-3">
                  <For each={methods()}>
                    {(m) => (
                      <button
                        type="button"
                        disabled={phase() === "pay"}
                        onClick={() => setMethod(m)}
                        class={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors disabled:opacity-60 ${
                          method() === m
                            ? "border-terracotta bg-terracotta/10"
                            : "border-ink/20 hover:border-ink"
                        }`}
                      >
                        {m === "stripe" ? tr("commande.carte") : "PayPal"}
                      </button>
                    )}
                  </For>
                </div>

                {/* Phase 1 : bouton continuer */}
                <Show when={phase() === "details"}>
                  <button
                    type="button"
                    onClick={goToPay}
                    disabled={!formValid() || !method() || submitting()}
                    aria-busy={submitting()}
                    class="w-full rounded-full bg-terracotta px-8 py-4 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {/* Occupé : un rond qui tourne avec le libellé, et le
                        bouton garde sa couleur (global.css lit `aria-busy`). */}
                    {submitting() ? (
                      <>
                        <span class="ml-spinner ml-spinner-clair mr-2" aria-hidden="true" />
                        {tr("commande.preparation")}
                      </>
                    ) : (
                      tr("commande.continuer_paiement").replace(
                        "{total}",
                        formatPrice(aPayer(), locale),
                      )
                    )}
                  </button>
                  <Show when={!submitting() && manques().length > 0}>
                    <p class="mt-2 text-center text-sm text-ink-soft" role="status">
                      {tr("commande.il_manque").replace("{liste}", manques().join(", "))}
                    </p>
                  </Show>
                </Show>

                {/* Phase 2 : widget du moyen choisi */}
                <Show when={phase() === "pay"}>
                  <Show when={method() === "stripe"}>
                    {/* Apple Pay / Google Pay : Stripe n'affiche ces boutons
                        que s'ils sont utilisables ici et maintenant. Sinon la
                        zone reste vide et on passe directement à la carte. */}
                    <div ref={expressMountRef} class="mb-3 empty:hidden" />
                    <div class="rounded-lg border border-ink/15 bg-paper p-4">
                      <div ref={stripeMountRef} />
                    </div>
                    <button
                      type="button"
                      onClick={payStripe}
                      disabled={submitting()}
                      aria-busy={submitting()}
                      class="w-full bg-ink px-8 py-4 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-50"
                    >
                      {/* « Paiement en cours… » et un rond qui tourne, plutôt
                          qu'un « … » grisé qu'on prenait pour une panne — le
                          pire moment pour faire douter quelqu'un. */}
                      {submitting() ? (
                        <>
                          <span class="ml-spinner ml-spinner-clair mr-2" aria-hidden="true" />
                          {tr("commande.paiement_en_cours")}
                        </>
                      ) : (
                        `${tr("commande.payer")} ${formatPrice(aPayer(), locale)}`
                      )}
                    </button>
                  </Show>

                  <Show when={method() === "paypal"}>
                    <div
                      ref={paypalMountRef}
                      class="rounded-lg border border-ink/15 bg-paper p-4 min-h-[52px]"
                    />
                  </Show>

                  <button
                    type="button"
                    onClick={backToDetails}
                    class="text-sm text-ink-soft hover:text-terracotta"
                  >
                    {tr("commande.modifier_coordonnees")}
                  </button>
                </Show>
              </Show>

              <Show when={error()}>
                <p class="rounded-lg bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep">
                  {error()}
                </p>
              </Show>
            </fieldset>
          </div>
          </Show>

          {/* Récapitulatif */}
          <aside class="rounded-2xl border border-ink/10 bg-paper-deep/40 p-6 lg:sticky lg:top-24">
            <h2 class="text-xl mb-4">{tr("commande.recapitulatif")}</h2>
            <Show when={cadresRetires()}>
              <p
                role="status"
                class="mb-4 rounded-lg border border-ink/15 bg-paper px-3 py-2 text-sm"
              >
                {tr("panier.cadres_retires")}
              </p>
            </Show>
            <ul class="space-y-4 text-sm">
              <For each={cart()?.items ?? []}>
                {(it) => (
                  <li class="flex justify-between gap-3">
                    <div class="flex min-w-0 gap-3">
                      {/* Aperçu FILIGRANÉ : la commande n'est pas encore
                          payée, l'affiche montrée ici en porte donc un,
                          exactement comme au panier. Une carte cadeau a sa
                          vignette, avec son montant. */}
                      <div class="ml-panier-vignette w-14 shrink-0">
                        <Show
                          when={!it.giftCard && it.config}
                          fallback={
                            <VignetteCarteCadeau
                              libelle={tr("carte.titre")}
                              montant={formatPrice(it.unitPriceCents, locale)}
                            />
                          }
                        >
                        <Show
                          when={it.config!.aiPublicId}
                          fallback={
                            /* Une affiche prête à imprimer : son visuel de
                               boutique, comme au panier. */
                            <Show
                              when={visuelBoutique(fiches(), it)}
                              fallback={
                            <Show
                              when={biblio()}
                              fallback={
                                <div class="ml-skeleton aspect-[1/1.4142] w-full" />
                              }
                            >
                              <PosterPreview
                                state={stateFromConfig(it.config!)}
                                characterById={personnageParId}
                                slots={biblio()!.slots}
                                cache={cache}
                                assetBaseUrl={PUBLIC_API_URL}
                                messages={{
                                  exempleAffiche: tr("cfg.exemple_affiche"),
                                }}
                                foregroundUrl={
                                  urlAsset(
                                    PUBLIC_API_URL,
                                    it.config!.foregroundUrl ||
                                      (it.config!.view === "back"
                                        ? "/assets/muret_officiel.svg"
                                        : ""),
                                  ) || undefined
                                }
                              />
                            </Show>
                              }
                            >
                              {(image) => (
                                <img
                                  src={image()}
                                  alt=""
                                  class="w-full rounded object-cover"
                                  style={{ "aspect-ratio": "1 / 1.4142" }}
                                />
                              )}
                            </Show>
                          }
                        >
                          <div
                            class="relative w-full overflow-hidden bg-paper-deep"
                            /* La feuille dans son vrai sens, comme au panier :
                               une création en paysage n'est pas réduite au
                               milieu d'une vignette en portrait. */
                            style={{
                              "aspect-ratio":
                                it.config!.orientation === "paysage"
                                  ? "1.4142 / 1"
                                  : "1 / 1.4142",
                            }}
                          >
                            <img
                              src={apercuAbsolu(
                                it.config!.aiApercuUrl ||
                                  urlApercu(it.config!.aiPublicId!),
                              )}
                              alt=""
                              class="absolute inset-0 h-full w-full object-contain"
                              onError={(e) => {
                                e.currentTarget.hidden = true;
                              }}
                            />
                          </div>
                        </Show>
                        </Show>
                      </div>
                      <div class="min-w-0">
                        <span class="block truncate">
                          {it.giftCard
                            ? tr("carte.titre")
                            : (nomDeLaLigne(fiches(), it) ?? tr("panier.affiche_sans_titre"))}
                        </span>
                        <span class="block text-ink-soft">
                          {it.giftCard
                            ? tr("carte.envoi")
                            : `${it.config?.format ?? "A4"} · ${formatPrice(it.unitPriceCents, locale)}`}
                        </span>
                        {/* Les gestes du panier : la quantité, le retrait,
                            « Modifier ». Figés pendant le paiement. */}
                        <div class="mt-1.5 flex flex-wrap items-center gap-2">
                          <Show when={!it.giftCard}>
                            <span class="inline-flex items-center rounded-md border border-ink/20">
                              <button
                                type="button"
                                onClick={() => setQuantite(it, it.quantity - 1)}
                                disabled={occupe() === it.id || it.quantity <= 1 || phase() === "pay" || submitting()}
                                aria-label={tr("panier.moins")}
                                class="px-2 py-0.5 leading-none hover:bg-paper-deep disabled:opacity-40"
                              >
                                −
                              </button>
                              <span class="w-7 text-center tabular-nums">{it.quantity}</span>
                              <button
                                type="button"
                                onClick={() => setQuantite(it, it.quantity + 1)}
                                disabled={occupe() === it.id || phase() === "pay" || submitting()}
                                aria-label={tr("panier.plus")}
                                class="px-2 py-0.5 leading-none hover:bg-paper-deep disabled:opacity-40"
                              >
                                +
                              </button>
                            </span>
                          </Show>
                          <button
                            type="button"
                            onClick={() => retirerLigne(it)}
                            disabled={occupe() === it.id || phase() === "pay" || submitting()}
                            class="text-xs text-ink-soft underline underline-offset-2 hover:text-terracotta-deep disabled:opacity-40"
                          >
                            {tr("panier.supprimer")}
                          </button>
                          <Show when={lienModifier(it) && phase() !== "pay"}>
                            <a
                              href={lienModifier(it)!}
                              class="text-xs text-ink-soft underline underline-offset-2 hover:text-terracotta"
                            >
                              {tr("panier.modifier")}
                            </a>
                          </Show>
                        </div>
                      </div>
                    </div>
                    <span class="shrink-0">
                      {formatPrice(it.unitPriceCents * it.quantity, locale)}
                    </span>
                  </li>
                )}
              </For>
            </ul>
            <Show when={discount() > 0}>
              <div class="mt-4 flex justify-between text-sm text-ink-soft">
                <span>{tr("panier.sous_total")}</span>
                <span>{formatPrice(subtotal(), locale)}</span>
              </div>
              <div class="mt-1 flex justify-between text-sm text-sage">
                <span>✨ {libelleRemise()}</span>
                <span>− {formatPrice(discount(), locale)}</span>
              </div>
            </Show>
            <Show when={props.compte && avecAffiches() && optionChoisie()}>
              <div class="mt-1 flex justify-between text-sm text-ink-soft">
                <span>{optionChoisie()!.mode.name}</span>
                <span>
                  {optionChoisie()!.offert
                    ? tr("livraison.offerte")
                    : fraisPort() === 0
                      ? tr("livraison.offert")
                      : formatPrice(fraisPort(), locale)}
                </span>
              </div>
            </Show>
            <div class="mt-4 flex justify-between border-t border-ink/10 pt-4">
              <span class="font-medium">{tr("panier.total")}</span>
              <span class="text-xl">{formatPrice(total(), locale)}</span>
            </div>
            {/* La carte cadeau : sa part, son code masqué, et ce qui restera
                dessus. Puis ce que débitera la carte bancaire ou PayPal. */}
            <Show when={carte()}>
              {(c) => (
                <>
                  <div class="mt-2 flex items-start justify-between gap-3 text-sm">
                    <span>
                      {tr("caisse.carte.ligne").replace("{code}", () => c().masque)}
                      <button
                        type="button"
                        onClick={retirerCarte}
                        disabled={phase() === "pay" || submitting()}
                        class="ml-2 text-xs text-ink-soft underline underline-offset-2 hover:text-ink disabled:opacity-40"
                      >
                        {tr("caisse.code.retirer")}
                      </button>
                    </span>
                    <span class="shrink-0 text-sage">− {formatPrice(partCarte(), locale)}</span>
                  </div>
                  <Show when={partCarte() === 0 && cartesCents() > 0}>
                    <p class="mt-1 text-xs text-terracotta-deep">{tr("caisse.carte.sur_carte")}</p>
                  </Show>
                  <Show when={c().soldeCents - partCarte() > 0 && partCarte() > 0}>
                    <p class="mt-1 text-xs text-ink-soft">
                      {tr("caisse.carte.reste").replace("{solde}", () =>
                        formatPrice(c().soldeCents - partCarte(), locale),
                      )}
                    </p>
                  </Show>
                  <div class="mt-2 flex justify-between">
                    <span class="font-medium">{tr("caisse.reste_a_payer")}</span>
                    <span class="text-xl">{formatPrice(aPayer(), locale)}</span>
                  </div>
                </>
              )}
            </Show>

            {/* Le champ « Code promo ou carte cadeau » : un code promo et une
                carte peuvent servir ensemble. */}
            <div class="mt-5 border-t border-ink/10 pt-4 text-left">
              <Show when={codePromo()}>
                {(p) => (
                  <p class="mb-2 flex items-center justify-between gap-3 text-sm">
                    <span class="text-sage">
                      {tr("caisse.code.applique").replace("{code}", () => (p() as { code?: string }).code ?? "")}
                    </span>
                    <button
                      type="button"
                      onClick={retirerPromo}
                      disabled={phase() === "pay" || submitting()}
                      class="text-xs text-ink-soft underline underline-offset-2 hover:text-ink disabled:opacity-40"
                    >
                      {tr("caisse.code.retirer")}
                    </button>
                  </p>
                )}
              </Show>
              <label id="ml-code-caisse-titre" for="ml-code-caisse" class="mb-1 block text-sm font-medium">
                {tr("caisse.code.titre")}
              </label>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void appliquerCode(codeSaisi());
                }}
                class="flex items-stretch gap-2"
              >
                <input
                  id="ml-code-caisse"
                  aria-labelledby="ml-code-caisse-titre"
                  value={codeSaisi()}
                  onInput={(e) => {
                    setCodeSaisi(e.currentTarget.value);
                    setCodeErreur(null);
                  }}
                  autocomplete="off"
                  autocapitalize="characters"
                  spellcheck={false}
                  disabled={phase() === "pay" || submitting()}
                  class="min-w-0 flex-1 rounded-lg border border-ink/20 bg-paper px-3 py-2 text-sm outline-none focus:border-ink disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={codeEnvoi() || !codeSaisi().trim() || phase() === "pay" || submitting()}
                  class="rounded-lg border border-ink px-3 py-2 text-sm font-medium hover:bg-ink hover:text-paper disabled:opacity-40 transition-colors"
                >
                  {tr("caisse.code.appliquer")}
                </button>
              </form>
              <Show when={codeErreur()}>
                <p role="alert" class="mt-2 text-sm text-terracotta-deep">
                  {codeErreur()}
                </p>
              </Show>
            </div>
            <a
              href={lien(langue, "/affiches")}
              class="mt-4 block text-center text-sm text-ink-soft hover:text-terracotta"
            >
              {tr("panier.continuer")}
            </a>
          </aside>
        </div>
      </Show>
    </Show>
  );
}
