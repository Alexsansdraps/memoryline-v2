/// <reference lib="dom" />
import { t, LANGUE_DEFAUT, type Langue } from "../i18n/utils.ts";
import {
  createResource,
  createSignal,
  createEffect,
  untrack,
  Show,
  For,
  type JSX,
} from "solid-js";
import {
  demandeUnPointRelais,
  demandeUneAdresse,
  formaterPoids,
  optionsLivraison,
  seuilPortOffertCents,
  remisesPanier,
  totalPanierCents,
  urlAsset,
  type OptionLivraison,
  type RegleParier,
} from "@memoryline/types";
import {
  PosterPreview,
  createSvgCache,
  stateFromConfig,
  SLOTS,
  findVariant,
  variantesDeVue,
} from "@memoryline/configurator";

/**
 * Pays proposés à la livraison. Volontairement court : ceux où la boutique
 * expédie vraiment, plus « autre pays », qui tombe dans la zone de repli.
 */
const PAYS = [
  { code: "FR", nom: "France" },
  { code: "BE", nom: "Belgique" },
  { code: "CH", nom: "Suisse" },
  { code: "LU", nom: "Luxembourg" },
  { code: "DE", nom: "Allemagne" },
  { code: "ES", nom: "Espagne" },
  { code: "IT", nom: "Italie" },
  { code: "NL", nom: "Pays-Bas" },
  { code: "PT", nom: "Portugal" },
  { code: "GB", nom: "Royaume-Uni" },
  { code: "CA", nom: "Canada" },
  { code: "US", nom: "États-Unis" },
  { code: "ZZ", nom: "Autre pays" },
];
import { loadStripe } from "@stripe/stripe-js";
import type { Stripe, StripeElements } from "@stripe/stripe-js";
import {
  browserApi,
  formatPrice,
  getCartId,
  PUBLIC_API_URL,
  type PointRelais,
} from "../lib/api.ts";
import { apercuAbsolu, urlApercu } from "../lib/ia.ts";
import { codePromoRetenu } from "./CartIsland.tsx";
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
 * GET /payments/config (l'API lit le .env). Si aucun n'est configuré, on le
 * signale clairement au lieu de laisser un bouton mort.
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
function loadPaypalSdk(clientId: string): Promise<PayPalNamespace> {
  if (window.paypal) return Promise.resolve(window.paypal);
  if (paypalSdk) return paypalSdk;
  paypalSdk = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      clientId,
    )}&currency=EUR`;
    s.onload = () =>
      window.paypal
        ? resolve(window.paypal)
        : reject(new Error("SDK PayPal indisponible"));
    s.onerror = () => reject(new Error("Chargement du SDK PayPal échoué"));
    document.head.appendChild(s);
  });
  return paypalSdk;
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
  /** La cliente connectée. La page ne rend le tunnel qu'à elle. */
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
  const tr = t(props.langue ?? LANGUE_DEFAUT);
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

  // Config paiement (moyens actifs + clés publiques).
  const [config] = createResource(async () => browserApi.paymentsConfig());
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
      return await browserApi.characters();
    } catch {
      return null;
    }
  });
  const { cache, fetchSvg } = createSvgCache(PUBLIC_API_URL);
  const personnageParId = (id: string | number) =>
    biblio()?.characters.find((c) => String(c.id) === String(id));

  // Sans ce préchargement, les personnages resteraient absents de l'aperçu.
  createEffect(() => {
    const lib = biblio();
    if (!lib) return;
    for (const ligne of cart()?.items ?? []) {
      for (const perso of ligne.config.characters ?? []) {
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
  // réplique locale à maintenir en phase avec le serveur.
  const [promos] = createResource(async () => {
    try {
      const res = await fetch(`${PUBLIC_API_URL}/promos`);
      return res.ok ? ((await res.json()) as RegleParier[]) : [];
    } catch {
      return [];
    }
  });
  const lignes = () =>
    (cart()?.items ?? []).map((it) => ({
      unitPriceCents: it.unitPriceCents,
      quantity: it.quantity,
      format:
        (it.config as { format?: string } | null | undefined)?.format ?? null,
    }));
  /**
   * Code promo saisi au panier. Il est revérifié ici, puis renvoyé au serveur
   * qui refait seul le calcul : ce qui suit ne sert qu'à afficher le bon
   * montant avant de payer.
   */
  const [codePromo] = createResource(async () => {
    const code = codePromoRetenu();
    if (!code) return null;
    try {
      const regle = await browserApi.verifierCode(code);
      return { ...regle, id: 0 } as unknown as RegleParier;
    } catch {
      return null;
    }
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

  const discount = () =>
    remisesPanier(lignes(), reglesEnJeu(), new Date(), codes()).remiseCents;

  /* --- Livraison ------------------------------------------------------- */
  const [catalogue] = createResource(async () => {
    try {
      return await browserApi.shipping();
    } catch {
      return null;
    }
  });
  const [pays, setPays] = createSignal(
    (props.carnet ?? []).find((a) => a.parDefaut)?.country ??
      (props.carnet ?? [])[0]?.country ??
      "FR",
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
    if (a.country) setPays(a.country);
    if (a.name) setName(a.name);
  }
  const [pointRelais, setPointRelais] = createSignal({ id: "", label: "" });

  /*
   * Retrait sur place : quel stand.
   *
   * Les stands ouverts arrivent avec le catalogue de livraison. Un seul
   * ouvert, il est choisi d'office — faire cliquer sur l'unique possibilité
   * n'apporte rien. Plusieurs, le client choisit ; tant qu'il n'a pas choisi,
   * la commande ne part pas, sinon personne ne saurait où la remettre.
   */
  const standsOuverts = (): { id: number; nom: string }[] =>
    catalogue()?.stands ?? [];
  const [standChoisi, setStandChoisi] = createSignal<number | null>(null);
  const standRetenu = (): { id: number; nom: string } | null => {
    const l = standsOuverts();
    return l.find((x) => x.id === standChoisi()) ?? l[0] ?? null;
  };
  /** Vrai quand le mode choisi est un retrait et qu'il reste à dire où. */
  const standManquant = (): boolean =>
    optionChoisie()?.mode.kind === "pickup" &&
    standsOuverts().length > 0 &&
    standRetenu() === null;


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
    setPointRelais({ id: "", label: "" });
    setRelaisEtat("repos");
    // Et si c'est un mode point relais, on cherche tout de suite autour du
    // code postal qu'on connaît déjà : la cliente connectée a son adresse, la
    // faire retaper puis cliquer « Chercher » est un pas de trop avant de
    // payer. Lu sans suivi : taper son adresse ne doit pas relancer la
    // recherche à chaque chiffre.
    untrack(() => {
      if (!demandeUnPointRelais(optionChoisie()?.mode.kind ?? "")) return;
      if (!cpRecherche().trim() && adresse().postalCode.trim())
        setCpRecherche(adresse().postalCode.trim());
      if (cpRecherche().trim()) void chercherRelais();
    });
  });

  /** Numéro de la dernière recherche : une réponse plus ancienne est ignorée. */
  let derniereRecherche = 0;

  async function chercherRelais(e?: Event) {
    e?.preventDefault();
    const cp = cpRecherche().trim();
    if (!cp) return;
    const numero = ++derniereRecherche;
    setRelaisEtat("recherche");
    try {
      // La ville aide le transporteur à situer un code postal partagé par
      // plusieurs communes — seulement si c'est bien celle de ce code-là.
      const a = adresse();
      const liste = await browserApi.pointsRelais(
        cp,
        pays(),
        optionChoisie()?.mode.carrier ?? "mondial_relay",
        a.postalCode.trim() === cp ? a.city.trim() : undefined,
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

  /** « 350 m », « 1,2 km » : la distance au code postal cherché. */
  function distanceLisible(metres: number): string {
    if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
    return `${(metres / 1000).toLocaleString(props.langue ?? LANGUE_DEFAUT, { maximumFractionDigits: 1 })} km`;
  }

  /** Panier après remises : c'est lui qui décide de la franchise de port. */
  const apresRemise = () => Math.max(0, subtotal() - discount());

  /**
   * Le seuil de la promotion « livraison offerte dès X € », s'il y en a une.
   *
   * L'écran l'affiche, le serveur le recalcule avant d'encaisser : c'est la
   * même fonction des deux côtés, donc le port annoncé ne peut pas différer
   * du port facturé.
   */
  const seuilPort = () =>
    seuilPortOffertCents(reglesEnJeu(), new Date(), codes());

  const optionsPort = (): OptionLivraison[] => {
    const cat = catalogue();
    return cat
      ? optionsLivraison(cat, pays(), apresRemise(), poidsColis(), seuilPort())
      : [];
  };
  const optionChoisie = () =>
    optionsPort().find((o) => o.mode.slug === modeChoisi()) ?? null;
  const fraisPort = () => optionChoisie()?.fraisCents ?? 0;

  // Premier mode disponible par défaut, et repli si le choix devient
  // impossible — changer de pays peut retirer le retrait sur place.
  createEffect(() => {
    const dispo = optionsPort();
    if (!dispo.length) return;
    if (!dispo.some((o) => o.mode.slug === modeChoisi()))
      setModeChoisi(dispo[0]!.mode.slug);
  });

  /** Ce que le mode choisi exige avant de pouvoir payer. */
  const livraisonValide = () => {
    const o = optionChoisie();
    if (!o) return false;
    if (demandeUneAdresse(o.mode.kind)) {
      const a = adresse();
      return (
        a.line1.trim().length > 0 &&
        a.postalCode.trim().length > 0 &&
        a.city.trim().length > 0
      );
    }
    if (demandeUnPointRelais(o.mode.kind))
      return pointRelais().id.trim().length > 0;
    return true;
  };

  /** Montant réellement dû (= ce que débitera Stripe/PayPal). */
  const total = () =>
    totalPanierCents(lignes(), reglesEnJeu(), new Date(), codes()) + fraisPort();

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
    !standManquant();

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
      loadPaypalSdk(cfg.clientId)
        .then((pp) =>
          pp
            .Buttons({
              createOrder: async () => {
                const oid = orderId();
                if (oid == null) throw new Error("Commande manquante");
                const { paypalOrderId } = await browserApi.paypalOrder(oid);
                return paypalOrderId;
              },
              onApprove: async (data) => {
                const oid = orderId();
                if (oid == null) return;
                try {
                  await browserApi.paypalCapture(oid, data.orderID);
                  finishSuccess();
                } catch (e) {
                  setError(String(e));
                }
              },
              onError: (e) => setError(String(e)),
            })
            .render(paypalMountRef!),
        )
        .catch((e) => {
          paypalRendered = false;
          setError(String(e));
        });
    }
  });

  /* --- Flux --------------------------------------------------------------- */

  function finishSuccess() {
    localStorage.removeItem("ml_cart_id");
    setPhase("details");
    // orderNumber déjà en mémoire -> l'écran « Merci » s'affiche via <Show>.
    setSubmitting(false);
    // Marque la commande comme finalisée pour l'affichage.
    setPaid(true);
  }
  const [paid, setPaid] = createSignal(false);

  /** Phase 1 -> 2 : crée la commande (pending) puis prépare le moyen choisi. */
  async function goToPay(e: Event) {
    e.preventDefault();
    if (!formValid() || !method() || submitting()) return;
    setSubmitting(true);
    setError(null);
    try {
      const a = adresse();
      // Un retrait sur stand se range là où se range un point relais : ces
      // deux champs disent « où va la commande », et le mode de livraison dit
      // de quelle sorte d'endroit il s'agit. Le préfixe « stand: » évite de
      // confondre un identifiant de stand avec un identifiant de transporteur.
      const st = optionChoisie()?.mode.kind === "pickup" ? standRetenu() : null;
      const relais = st
        ? { id: `stand:${st.id}`, label: st.nom }
        : pointRelais();
      const order = await browserApi.createOrder(
        getCartId(),
        { name: name().trim(), email: email().trim() },
        codePromoRetenu() || undefined,
        {
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
        },
      );
      setOrderId(order.orderId);
      setOrderNumber(order.number);

      if (method() === "stripe") {
        const cfg = config()?.stripe;
        if (!cfg) throw new Error("Stripe non disponible");
        stripe = await loadStripe(cfg.publicKey);
        if (!stripe) throw new Error("Stripe indisponible");
        const { clientSecret } = await browserApi.stripeIntent(order.orderId);
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
      } else setError(String(err));
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
      const panier = await browserApi.cart(getCartId());
      if (panier.status === "draft") {
        setError(
          "Votre panier a changé depuis le calcul du total. Revenez à l'étape précédente pour le recalculer avant de payer.",
        );
        return;
      }
      const { error: stripeErr, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: `${window.location.origin}/commande` },
      });
      if (stripeErr) {
        setError(stripeErr.message ?? "Paiement refusé.");
        return;
      }
      if (paymentIntent && paymentIntent.status === "succeeded") {
        const oid = orderId();
        if (oid != null) await browserApi.stripeConfirm(oid);
        finishSuccess();
      } else {
        setError("Paiement non finalisé. Réessayez.");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Show
      when={!paid()}
      fallback={
        <div class="rounded-2xl border border-sage/40 bg-sage/10 p-8 text-center">
          <h2 class="font-serif text-3xl">Merci !</h2>
          <p class="mt-3 text-ink-soft">
            Votre paiement a bien été reçu et votre commande est confirmée.
          </p>
          <p class="mt-4 text-lg">
            Numéro de commande :{" "}
            <span class="text-2xl">{orderNumber()}</span>
          </p>
          <a
            href="/affiches"
            class="mt-6 inline-block rounded-full bg-ink px-6 py-3 text-paper font-medium hover:bg-ink/85 transition-colors"
          >
            Retour aux affiches
          </a>
        </div>
      }
    >
      <Show when={cart() && cart()!.items.length === 0}>
        <div class="rounded-2xl border border-ink/10 bg-paper-deep/40 p-8 text-center">
          <p class="text-ink-soft">Votre panier est vide.</p>
          <a
            href="/affiches"
            class="mt-6 inline-block rounded-full bg-ink px-6 py-3 text-paper font-medium hover:bg-ink/85 transition-colors"
          >
            Découvrir les affiches
          </a>
        </div>
      </Show>

      <Show when={cart() && cart()!.items.length > 0}>
        <div class="grid lg:grid-cols-[1fr_320px] gap-8 items-start">
          <div class="space-y-8">
            {/* Coordonnées */}
            <fieldset class="space-y-4" disabled={phase() === "pay"}>
              <legend class="text-2xl mb-2">Vos coordonnées</legend>
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
                {/* Celle du compte : c'est elle qui identifie la commande et
                    l'historique. La changer ici rattacherait la commande à
                    quelqu'un d'autre. */}
                <Show when={props.compte}>
                  <span class="mt-1 block text-xs text-ink-soft">
                    C'est l'adresse de votre compte. Pour en changer, passez par
                    « Mes informations ».
                  </span>
                </Show>
                <Show when={email().length > 0 && !emailValid()}>
                  <span class="mt-1 block text-xs text-terracotta-deep">
                    E-mail invalide.
                  </span>
                </Show>
              </label>
            </fieldset>

            {/* Livraison */}
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
                    {(p) => <option value={p.code}>{p.nom}</option>}
                  </For>
                </select>
              </label>

              {/* Le poids commande la tranche d'affranchissement : l'écrire
                  ici est ce qui rend compréhensible un prix de port qui monte
                  parce qu'on a ajouté un cadre. */}
              <Show when={poidsColis() > 0}>
                <p class="text-xs text-ink-soft">
                  {tr("livraison.poids_colis")} {formaterPoids(poidsColis())}
                </p>
              </Show>

              <Show
                when={optionsPort().length > 0}
                fallback={
                  /* Rien tant que le catalogue n'est pas arrivé : une liste
                     vide en cours de chargement n'est pas un refus. */
                  <Show when={!catalogue.loading}>
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
                    {(o) => (
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
                                : formatPrice(o.fraisCents)}
                            </span>
                          </span>
                          <Show when={o.mode.description}>
                            <span class="mt-0.5 block text-sm text-ink-soft">
                              {o.mode.description}
                            </span>
                          </Show>
                          {/* Retrait sur place : le lieu fixe du back-office,
                              quand il y en a un. */}
                          <Show
                            when={
                              o.mode.kind === "pickup" && o.mode.pickupLocation
                            }
                          >
                            <span class="mt-1 block text-sm">
                              {o.mode.pickupLocation}
                            </span>
                          </Show>
                          {/* Et les stands ouverts en ce moment. Un seul, on
                              l'annonce ; plusieurs, on fait choisir — sans
                              quoi personne ne saurait où remettre la
                              commande. */}
                          <Show
                            when={
                              o.mode.kind === "pickup" &&
                              standsOuverts().length > 0
                            }
                          >
                            <span class="mt-2 block space-y-1">
                              <span class="block text-sm text-ink-soft">
                                Où souhaitez-vous retirer&nbsp;?
                              </span>
                              <For each={standsOuverts()}>
                                {(st) => (
                                  <label class="flex items-center gap-2 text-sm">
                                    <input
                                      type="radio"
                                      name="stand-retrait"
                                      checked={standRetenu()?.id === st.id}
                                      onChange={() => setStandChoisi(st.id)}
                                    />
                                    <span>{st.nom}</span>
                                  </label>
                                )}
                              </For>
                            </span>
                          </Show>
                        </span>
                      </label>
                    )}
                  </For>
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
                        Vos adresses enregistrées
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
                                {a.label || a.line1 || "Adresse"}
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
                          Une autre adresse
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
                      placeholder="12 rue des Bains"
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
                      placeholder="Bâtiment B, 3e étage"
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
                  <label class="block">
                    <span class="text-sm font-medium">
                      {tr("livraison.telephone")}
                    </span>
                    <input
                      type="tel"
                      value={adresse().phone}
                      onInput={(e) =>
                        setAdresse({ ...adresse(), phone: e.currentTarget.value })
                      }
                      class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                      placeholder="06 12 34 56 78"
                    />
                  </label>
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
                    <input
                      type="text"
                      inputmode="numeric"
                      value={cpRecherche()}
                      onInput={(e) => setCpRecherche(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void chercherRelais();
                        }
                      }}
                      class="min-w-0 flex-1 rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                      placeholder={tr("livraison.cp_recherche")}
                    />
                    <button
                      type="button"
                      onClick={chercherRelais}
                      disabled={relaisEtat() === "recherche" || !cpRecherche().trim()}
                      class="border border-ink px-5 font-medium hover:bg-ink hover:text-paper disabled:opacity-40 transition-colors"
                    >
                      {tr("livraison.chercher")}
                    </button>
                  </div>

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
                    <ul class="max-h-72 space-y-2 overflow-y-auto">
                      <For each={relais()}>
                        {(r) => (
                          <li>
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
                                onChange={() =>
                                  setPointRelais({
                                    id: r.id,
                                    // Le numéro du point voyage avec son nom :
                                    // c'est lui qu'on donne au transporteur
                                    // pour préparer le colis, et que le
                                    // point relais retrouve au guichet.
                                    label: `${r.nom}, ${r.adresse}, ${r.codePostal} ${r.ville}${r.code ? ` (n° ${r.code})` : ""}`,
                                  })
                                }
                              />
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
                                        {(ligne) => <li>{ligne}</li>}
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
                  </Show>

                  <Show when={pointRelais().id}>
                    <p class="text-sm text-sage">
                      {tr("livraison.relais_choisi")} {pointRelais().label}
                    </p>
                  </Show>
                </div>
              </Show>
            </fieldset>

            {/* Paiement */}
            <fieldset class="space-y-4">
              <legend class="text-2xl mb-2">Paiement</legend>

              {/* Aucun moyen configuré */}
              <Show when={config() && methods().length === 0}>
                <div class="rounded-lg border border-dashed border-terracotta/40 bg-terracotta/5 p-4 text-sm text-ink-soft">
                  Le paiement en ligne n'est pas encore activé. Ajoutez vos clés
                  Stripe et/ou PayPal dans le fichier <code>.env</code> pour
                  l'activer.
                </div>
              </Show>

              {/* Mode essai : ce qu'il faut saisir. Sans ce rappel on cherche
                  le numéro de carte de test ailleurs à chaque fois, et devant
                  PayPal on essaie son vrai compte, qui ne marche pas. */}
              <Show when={config()?.essai && methods().length > 0}>
                <div class="rounded-lg border border-sage/40 bg-sage/10 p-4 text-sm">
                  <p class="font-medium">
                    Boutique en mode essai : aucun paiement réel.
                  </p>
                  <ul class="mt-2 space-y-1 text-ink-soft">
                    <li>
                      <b>Carte bancaire :</b> 4242 4242 4242 4242, une date
                      future, trois chiffres au dos, et n'importe quel code
                      postal.
                    </li>
                    <li>
                      <b>PayPal :</b> connectez-vous avec le compte acheteur
                      d'essai, pas le vôtre. Il se trouve sur
                      developer.paypal.com, « Testing Tools » puis « Sandbox
                      accounts », en <code>@personal.example.com</code>.
                    </li>
                  </ul>
                </div>
              </Show>

              <Show when={methods().length > 0}>
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
                        {m === "stripe" ? "Carte bancaire" : "PayPal"}
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
                    class="w-full rounded-full bg-terracotta px-8 py-4 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting()
                      ? "Préparation…"
                      : `Continuer vers le paiement · ${formatPrice(total())}`}
                  </button>
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
                      class="w-full bg-ink px-8 py-4 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-50"
                    >
                      {submitting() ? "…" : `${tr("commande.payer")} ${formatPrice(total())}`}
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
                    ← Modifier mes coordonnées
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

          {/* Récapitulatif */}
          <aside class="rounded-2xl border border-ink/10 bg-paper-deep/40 p-6 lg:sticky lg:top-24">
            <h2 class="text-xl mb-4">Récapitulatif</h2>
            <Show when={cadresRetires()}>
              <p
                role="status"
                class="mb-4 rounded-lg border border-ink/15 bg-paper px-3 py-2 text-sm"
              >
                {tr("panier.cadres_retires")}
              </p>
            </Show>
            <ul class="space-y-3 text-sm">
              <For each={cart()?.items ?? []}>
                {(it) => (
                  <li class="flex justify-between gap-3">
                    <div class="flex min-w-0 gap-3">
                      {/* Aperçu FILIGRANÉ : la commande n'est pas encore
                          payée, l'affiche montrée ici en porte donc un,
                          exactement comme au panier. */}
                      <div class="ml-panier-vignette w-14 shrink-0">
                        <Show
                          when={it.config.aiPublicId}
                          fallback={
                            <Show
                              when={biblio()}
                              fallback={
                                <div class="ml-skeleton aspect-[1/1.4142] w-full" />
                              }
                            >
                              <PosterPreview
                                state={stateFromConfig(it.config)}
                                characterById={personnageParId}
                                slots={biblio()!.slots}
                                cache={cache}
                                assetBaseUrl={PUBLIC_API_URL}
                                foregroundUrl={
                                  urlAsset(
                                    PUBLIC_API_URL,
                                    it.config.foregroundUrl ||
                                      (it.config.view === "back"
                                        ? "/assets/muret_officiel.svg"
                                        : ""),
                                  ) || undefined
                                }
                              />
                            </Show>
                          }
                        >
                          <div
                            class="relative w-full overflow-hidden bg-paper-deep"
                            style={{ "aspect-ratio": "1 / 1.4142" }}
                          >
                            <img
                              src={apercuAbsolu(
                                it.config.aiApercuUrl ||
                                  urlApercu(it.config.aiPublicId!),
                              )}
                              alt=""
                              class="absolute inset-0 h-full w-full object-contain"
                              onError={(e) => {
                                e.currentTarget.hidden = true;
                              }}
                            />
                          </div>
                        </Show>
                      </div>
                      <div class="min-w-0">
                        <span class="block truncate">
                          {it.title ?? "Affiche personnalisée"}
                        </span>
                        <span class="text-ink-soft">
                          {it.config.format ?? "A4"} · Qté {it.quantity}
                        </span>
                      </div>
                    </div>
                    <span class="shrink-0">
                      {formatPrice(it.unitPriceCents * it.quantity)}
                    </span>
                  </li>
                )}
              </For>
            </ul>
            <Show when={discount() > 0}>
              <div class="mt-4 flex justify-between text-sm text-ink-soft">
                <span>Sous-total</span>
                <span>{formatPrice(subtotal())}</span>
              </div>
              <div class="mt-1 flex justify-between text-sm text-sage">
                <span>✨ Remise</span>
                <span>− {formatPrice(discount())}</span>
              </div>
            </Show>
            <Show when={optionChoisie()}>
              <div class="mt-1 flex justify-between text-sm text-ink-soft">
                <span>{optionChoisie()!.mode.name}</span>
                <span>
                  {optionChoisie()!.offert
                    ? tr("livraison.offerte")
                    : formatPrice(fraisPort())}
                </span>
              </div>
            </Show>
            <div class="mt-4 flex justify-between border-t border-ink/10 pt-4">
              <span class="font-medium">{tr("panier.total")}</span>
              <span class="text-xl">{formatPrice(total())}</span>
            </div>
            <a
              href="/panier"
              class="mt-4 block text-center text-sm text-ink-soft hover:text-terracotta"
            >
              Modifier le panier
            </a>
          </aside>
        </div>
      </Show>
    </Show>
  );
}
