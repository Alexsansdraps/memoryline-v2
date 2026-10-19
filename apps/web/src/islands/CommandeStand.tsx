/// <reference lib="dom" />
import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { lien, t, LANGUE_DEFAUT, type Langue } from "../i18n/utils.ts";
import {
  ErreurSalon,
  getCartId,
  nouveauCartId,
  reprendreCartId,
  salonApi,
} from "../lib/api.ts";
import { codeMemorise, oublierCode, retenirCode } from "../lib/code-stand.ts";

/**
 * La dernière étape, au stand.
 *
 * Sur le site, on paie : adresse, livraison, carte bancaire. Au stand, le
 * client est devant la vendeuse et paie de la main à la main — il ne reste
 * qu'à savoir à qui appartient la commande, pour retrouver l'affiche à
 * l'impression et le prévenir quand elle est prête.
 *
 * Ce formulaire vit SOUS LE PANIER (CartIsland), qui sert de récapitulatif :
 * mêmes aperçus, mêmes quantités, sans aucun montant. Tout ce qui précède — le
 * catalogue, la fiche, le configurateur, l'affiche tirée d'une photo — est
 * celui de la boutique. C'était la demande : « le site, mais juste la
 * dernière étape qui change ». Une seule boutique vue autrement, plutôt que
 * deux interfaces qui divergent en silence.
 *
 * LE CODE DU STAND N'EST PAS UN DÉTAIL. Le mode stand, lui, ne fait
 * qu'effacer des prix de l'écran : n'importe qui pourrait poser le cookie.
 * Ce qui autorise réellement à enregistrer une vente — déclarée payée — est
 * ce code, vérifié par l'API, et il voyage dans un EN-TÊTE. L'adresse donnée
 * par le back-office le porte une seule fois (« ?code= ») : la mise en page
 * le range dans la tablette et l'ôte aussitôt de la barre d'adresse
 * (Base.astro).
 */

/** Une adresse e-mail plausible : la même règle que l'API (salon.ts). */
const COURRIEL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Ce que l'écran de confirmation a besoin de savoir de la vente. */
export interface VenteStand {
  numero: string;
  /** Le nom tapé par le client : « Revenir à ma commande » le lui rend. */
  nom: string;
  email: string;
  /** Le panier de la vente, pour pouvoir la ROUVRIR (« Revenir à ma commande »). */
  cartId: string;
  /** Le code du stand qui l'a validée. */
  code: string | null;
}

/**
 * Le nom et l'adresse d'une vente qu'on rouvre, le temps du rechargement.
 *
 * « Revenir à ma commande » recharge la page sur le panier rouvert : le
 * client devait retaper son nom et son adresse pour corriger une affiche
 * (recette du 6/10). Ils passent par la session de l'onglet, liés au panier
 * qu'ils accompagnent, et sont effacés dès qu'ils sont relus : le client
 * suivant ne les trouvera pas.
 */
const CLE_CLIENT_ROUVERT = "ml_stand_client_rouvert";

/** Des champs larges et hauts : on les touche du doigt, sur une tablette. */
const CHAMP_NU =
  "border border-ink/25 bg-paper px-4 py-3 text-lg outline-none focus:border-ink";
const CHAMP = `mt-1 w-full ${CHAMP_NU}`;
const PRINCIPAL =
  "inline-flex items-center justify-center px-6 py-4 text-lg font-medium bg-ink text-paper transition-colors hover:bg-ink/85 disabled:opacity-50";

export default function CommandeStand(props: {
  langue?: Langue;
  /**
   * Le nombre d'affiches du panier, exemplaires compris : le bouton dit
   * « Valider mon affiche » ou « Valider mes affiches ».
   */
  nombre: number;
  /** Une ligne du panier est en train d'être modifiée : on attend qu'elle ait fini. */
  occupe?: boolean;
  /** La vente est enregistrée : le panier laisse la place à la confirmation. */
  onEnregistree: (vente: VenteStand) => void;
}): JSX.Element {
  const tr = t(props.langue ?? LANGUE_DEFAUT);

  /*
   * Le code, en trois états : on vérifie celui que la tablette a retenu, il
   * est bon, ou il faut en saisir un. Il n'y a pas d'état « refusé » à part :
   * un code refusé redemande une saisie, et le message dit pourquoi.
   */
  const [etatCode, setEtatCode] = createSignal<"verification" | "saisie" | "valide">(
    "verification",
  );
  const [code, setCode] = createSignal<string | null>(null);
  const [saisieCode, setSaisieCode] = createSignal("");
  const [erreurCode, setErreurCode] = createSignal<string | null>(null);
  /** La dernière saisie déjà soumise au stand : quitter le champ ne la renvoie pas. */
  let dejaVerifie = "";

  /*
   * Le bloc du code ne se montre que s'il a quelque chose à dire.
   *
   * Le code retenu par la tablette est revérifié à CHAQUE client, au
   * chargement de cette étape. Affiché d'office, « Vérification du code… »
   * clignotait sous les yeux du client — un message de vendeuse —, puis le
   * bloc s'effaçait et le formulaire remontait d'un cran. Une réponse rapide
   * ne montre donc rien (le bouton, grisé, fait patienter) ; une réponse
   * lente s'annonce au bout de 0,6 s. Et dès que la vendeuse a eu à saisir
   * le code, le bloc reste en place, vérification comprise, jusqu'à ce qu'il
   * soit bon.
   */
  const [verificationLente, setVerificationLente] = createSignal(false);
  const [codeDemande, setCodeDemande] = createSignal(false);
  const blocCodeVisible = () =>
    !!erreurCode() ||
    (etatCode() !== "valide" &&
      (etatCode() === "saisie" || codeDemande() || verificationLente()));
  function demanderCode() {
    setCodeDemande(true);
    setEtatCode("saisie");
  }

  const [nom, setNom] = createSignal("");
  const [courriel, setCourriel] = createSignal("");
  const [envoi, setEnvoi] = createSignal(false);
  const [erreur, setErreur] = createSignal<string | null>(null);

  /**
   * Soumet un code au stand. Vrai s'il ouvre un stand OUVERT.
   *
   * `autorise`, et non `ouvert` : `ouvert` dit seulement qu'un stand est
   * ouvert QUELQUE PART. Le lire seul laissait passer n'importe quel code dès
   * qu'un stand était ouvert, et le refus tombait au moment de valider, le
   * client devant soi, sa commande composée.
   */
  async function verifierCode(saisi: string, retenu: boolean): Promise<boolean> {
    setEtatCode("verification");
    setErreurCode(null);
    const lente = setTimeout(() => setVerificationLente(true), 600);
    try {
      const etat = await salonApi.etat(saisi);
      if (etat.autorise) {
        retenirCode(saisi);
        setCode(saisi);
        setSaisieCode("");
        setEtatCode("valide");
        return true;
      }
      // Un code retenu devenu faux — stand fermé depuis hier, code changé —
      // est effacé : sinon la tablette le réessaierait à chaque client.
      if (retenu) oublierCode();
      setCode(null);
      setErreurCode(tr(retenu ? "stand.code_perime" : "stand.code_refuse"));
    } catch {
      // Le stand n'a pas répondu : une coupure de réseau n'est pas un code
      // faux, on garde donc celui que la tablette a retenu pour réessayer.
      setErreurCode(tr("stand.code_injoignable"));
    } finally {
      clearTimeout(lente);
      setVerificationLente(false);
    }
    demanderCode();
    return false;
  }

  onMount(() => {
    const retenu = codeMemorise();
    // On vérifie le code retenu AVANT de s'en servir : un stand fermé depuis
    // hier se découvrirait sinon au pire moment.
    if (retenu) void verifierCode(retenu, true);
    else demanderCode();

    // Une vente rouverte : on rend au client le nom et l'adresse qu'il avait
    // tapés, s'ils accompagnent bien le panier qui revient.
    try {
      const brut = sessionStorage.getItem(CLE_CLIENT_ROUVERT);
      sessionStorage.removeItem(CLE_CLIENT_ROUVERT);
      const client = brut
        ? (JSON.parse(brut) as { cartId?: string; nom?: string; email?: string })
        : null;
      if (client && client.cartId === getCartId()) {
        setNom(client.nom ?? "");
        setCourriel(client.email ?? "");
      }
    } catch {
      // Session refusée ou illisible : les champs restent vides, comme avant.
    }
  });

  function soumettreCode(e: Event) {
    e.preventDefault();
    const saisi = saisieCode().trim();
    if (!saisi) {
      setErreurCode(tr("stand.code_vide"));
      return;
    }
    dejaVerifie = saisi;
    void verifierCode(saisi, false);
  }

  async function valider(e: Event) {
    e.preventDefault();
    if (envoi() || props.occupe || props.nombre === 0) return;
    const n = nom().trim();
    const m = courriel().trim();
    if (!n) {
      setErreur(tr("stand.nom_vide"));
      return;
    }
    if (!COURRIEL.test(m)) {
      setErreur(tr("stand.email_invalide"));
      return;
    }
    setErreur(null);

    // Pas encore de code bon : celui qui est tapé, sinon celui que la tablette
    // a retenu (le stand n'avait pas répondu au chargement).
    let valable = etatCode() === "valide" ? code() : null;
    if (!valable) {
      const tape = saisieCode().trim();
      const essai = tape || codeMemorise();
      if (!essai) {
        setErreurCode(tr("stand.code_vide"));
        return;
      }
      if (!(await verifierCode(essai, !tape))) return;
      valable = code();
    }

    setEnvoi(true);
    try {
      const panierServi = getCartId();
      const commande = await salonApi.commander(valable, {
        cartId: panierServi,
        name: n,
        email: m,
      });
      // Le panier servi est clos : la tablette repart d'un panier neuf tout de
      // suite, même si personne ne touche « Client suivant ». On retient
      // l'ancien : « Revenir à ma commande » le rouvre.
      nouveauCartId();
      props.onEnregistree({
        numero: commande.number,
        nom: n,
        email: m,
        cartId: panierServi,
        code: valable,
      });
    } catch (err) {
      if (err instanceof ErreurSalon && err.statut === 403) {
        // Stand refermé ou code changé en plein salon : le panier, le nom et
        // l'adresse restent en l'état, on redemande le code seulement.
        oublierCode();
        setCode(null);
        demanderCode();
        setErreurCode(tr("stand.code_refuse"));
      } else {
        setErreur(
          err instanceof ErreurSalon && err.message ? err.message : tr("stand.erreur"),
        );
      }
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div class="max-w-xl">
      {/* Le code d'abord, dans son propre formulaire : « Entrée » dans ce
          champ vérifie le code, sans envoyer une commande à moitié remplie.
          Une fois le code bon, plus rien n'en parle : c'est le client qui
          tient la tablette, et « Stand : … — Changer de code » ne le
          concernait pas. La vendeuse change de code par l'adresse que donne
          le back-office (« /?stand=1&code=… »), et la saisie revient d'elle-
          même si le code n'est plus celui d'un stand ouvert. Pendant la
          vérification du code retenu, rien non plus, tant qu'elle est rapide
          (voir `blocCodeVisible`). */}
      <Show when={blocCodeVisible()}>
      <div class="border-b border-ink/10 pb-5">
        <Show when={etatCode() === "verification"}>
          <p class="flex items-center text-ink-soft" aria-live="polite">
            <span class="ml-spinner mr-3" aria-hidden="true" />
            {tr("stand.code_verification")}
          </p>
        </Show>

        <Show when={etatCode() === "saisie"}>
          <form class="flex flex-col gap-2" onSubmit={soumettreCode}>
            <label class="block" for="ml-stand-code">
              <span class="text-sm font-medium">{tr("stand.code")}</span>
            </label>
            <div class="flex flex-wrap gap-3">
              <input
                id="ml-stand-code"
                value={saisieCode()}
                onInput={(e) => setSaisieCode(e.currentTarget.value)}
                onBlur={() => {
                  // Quitter le champ suffit à savoir si le code est bon : le
                  // refus arrive tout de suite, pas après le nom et l'adresse.
                  const saisi = saisieCode().trim();
                  if (saisi && saisi !== dejaVerifie) {
                    dejaVerifie = saisi;
                    void verifierCode(saisi, false);
                  }
                }}
                autocomplete="off"
                autocapitalize="characters"
                spellcheck={false}
                aria-invalid={erreurCode() ? "true" : undefined}
                aria-describedby="ml-stand-code-aide"
                class={`${CHAMP_NU} min-w-0 flex-1 uppercase tracking-[0.15em]`}
              />
              <button
                type="submit"
                class="border border-ink px-5 py-3 font-medium transition-colors hover:bg-ink hover:text-paper"
              >
                {tr("stand.code_valider")}
              </button>
            </div>
            <span id="ml-stand-code-aide" class="text-sm text-ink-soft">
              {tr("stand.code_aide")}
            </span>
          </form>
        </Show>

        <Show when={erreurCode()}>
          <p role="alert" class="mt-3 bg-terracotta/10 px-4 py-3 text-terracotta-deep">
            {erreurCode()}
          </p>
        </Show>
      </div>
      </Show>

      <form class="mt-5 flex flex-col gap-5" onSubmit={valider} novalidate>
        <label class="block">
          <span class="text-sm font-medium">{tr("stand.nom")}</span>
          <input
            value={nom()}
            onInput={(e) => {
              setNom(e.currentTarget.value);
              // Le reproche s'efface dès qu'on corrige : resté affiché, il
              // laisserait croire que la correction n'a pas été prise.
              setErreur(null);
            }}
            autocomplete="off"
            required
            class={CHAMP}
          />
        </label>
        <label class="block">
          <span class="text-sm font-medium">{tr("stand.email")}</span>
          <input
            type="email"
            value={courriel()}
            onInput={(e) => {
              setCourriel(e.currentTarget.value);
              setErreur(null);
            }}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            inputmode="email"
            required
            class={CHAMP}
          />
          {/* Aucune phrase sous l'adresse : au stand, le client parle à la
              vendeuse, qui lui dit elle-même la suite. (Aucun courrier ne part
              à la validation ; le seul qu'il recevra est « Votre affiche est
              prête », quand la commande est marquée prête au back-office.) */}
        </label>
        <Show when={erreur()}>
          <p role="alert" class="bg-terracotta/10 px-4 py-3 text-terracotta-deep">
            {erreur()}
          </p>
        </Show>
        <button
          type="submit"
          class={PRINCIPAL}
          disabled={
            envoi() || props.occupe || props.nombre === 0 || etatCode() === "verification"
          }
          aria-busy={envoi()}
        >
          {/* Pendant l'enregistrement : un rond qui tourne à côté du libellé,
              et le bouton reste noir (global.css lit `aria-busy`). */}
          {envoi() ? (
            <>
              <span class="ml-spinner ml-spinner-clair mr-3" aria-hidden="true" />
              {tr("stand.envoi")}
            </>
          ) : props.nombre > 1 ? (
            tr("stand.valider_plusieurs")
          ) : (
            tr("stand.valider_une")
          )}
        </button>
      </form>
    </div>
  );
}

/**
 * La vente est enregistrée.
 *
 * C'est l'écran que la vendeuse regarde en rendant la tablette : le numéro se
 * lit de loin, et « Client suivant » repart du catalogue avec un panier vide.
 * Le lien repose `?stand=1` : il renouvelle pour une journée le mode stand de
 * la tablette, qu'un salon de deux jours aurait sinon laissé expirer.
 */
export function ConfirmationStand(props: {
  langue?: Langue;
  vente: VenteStand;
}): JSX.Element {
  const langue = props.langue ?? LANGUE_DEFAUT;
  const tr = t(langue);
  const [retour, setRetour] = createSignal<"repos" | "encours" | "erreur">("repos");
  const [raison, setRaison] = createSignal("");

  /*
   * « Revenir à ma commande » — le bouton, ET la flèche retour de la
   * tablette. Le client voit une erreur après avoir validé : la vente est
   * rouverte côté serveur (salon.ts, /salon/commandes/rouvrir), son panier
   * rendu à la tablette, et la page se recharge dessus, prête à corriger.
   */
  async function revenir() {
    if (retour() === "encours") return;
    setRetour("encours");
    try {
      await salonApi.rouvrir(props.vente.code ?? codeMemorise(), {
        cartId: props.vente.cartId,
        numero: props.vente.numero,
      });
      reprendreCartId(props.vente.cartId);
      try {
        sessionStorage.setItem(
          CLE_CLIENT_ROUVERT,
          JSON.stringify({
            cartId: props.vente.cartId,
            nom: props.vente.nom,
            email: props.vente.email,
          }),
        );
      } catch {
        // Sans session, le client retapera son nom : la vente est rouverte.
      }
      window.dispatchEvent(new Event("ml:panier"));
      window.location.reload();
    } catch (e) {
      setRaison(e instanceof ErreurSalon && e.message ? e.message : "");
      setRetour("erreur");
      // La flèche retour a déjà consommé l'entrée d'historique : on la
      // remet, pour qu'un second appui retente.
      history.pushState({ mlVenteStand: true }, "");
    }
  }

  onMount(() => {
    // Une entrée d'historique à nous : la flèche retour de la tablette
    // revient à la commande au lieu de quitter la page sur un panier vide.
    history.pushState({ mlVenteStand: true }, "");
    const surRetour = () => void revenir();
    window.addEventListener("popstate", surRetour);
    // Le navigateur peut garder cette page en mémoire et la RESSERVIR telle
    // quelle par la flèche retour, confirmation comprise. Qui tient alors la
    // tablette, on n'en sait rien : peut-être déjà le client suivant, et
    // « Revenir à ma commande » lui rendrait le nom et l'adresse e-mail du
    // précédent. Une page resservie se recharge donc TOUJOURS, sur le panier
    // neuf (il l'est depuis l'enregistrement). Ne la recharger qu'après
    // « Client suivant » laissait le trou ouvert : la tablette pouvait
    // quitter la confirmation par l'en-tête (logo, menu, panier), qui reste
    // affiché au stand. La flèche retour depuis la confirmation elle-même
    // n'est pas concernée : elle reste dans la page (`popstate` ci-dessus).
    const surPageResservie = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", surPageResservie);
    onCleanup(() => {
      window.removeEventListener("popstate", surRetour);
      window.removeEventListener("pageshow", surPageResservie);
    });
  });

  return (
    <div class="mx-auto mt-6 max-w-2xl border border-ink/15 bg-paper-deep px-6 py-10 text-center sm:px-10">
      {/* Le message que la boutique a demandé : le client sait qu'il a fini,
          et à qui s'adresser. Plus de « nous vous écrirons à… ». */}
      <p class="text-2xl sm:text-3xl">{tr("stand.merci")}</p>
      <p class="mt-8 text-sm uppercase tracking-[0.08em] text-ink-soft">
        {tr("stand.numero")}
      </p>
      <p class="mt-1 text-5xl font-medium tabular-nums sm:text-6xl">
        {props.vente.numero}
      </p>
      <Show when={retour() === "erreur"}>
        <p class="mt-6 text-terracotta-deep">{raison() || tr("stand.revenir_erreur")}</p>
      </Show>
      {/* Les deux boutons dans une rangée à eux, séparés : collés l'un à
          l'autre (le `inline-flex` de PRINCIPAL l'emportait sur le `flex` qui
          devait les empiler), ils se lisaient comme un seul bouton bicolore,
          décalé de deux pixels. Côte à côte et de même hauteur dès la
          tablette, l'un sous l'autre sur un téléphone. */}
      <div class="mt-10 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:justify-center">
        <button
          type="button"
          onClick={() => void revenir()}
          disabled={retour() === "encours"}
          class="inline-flex items-center justify-center border-2 border-ink px-8 py-4 text-lg font-medium transition-colors hover:bg-ink hover:text-paper disabled:opacity-50"
        >
          ← {tr("stand.revenir")}
        </button>
        <a
          href={`${lien(langue, "/affiches")}?stand=1`}
          class={`${PRINCIPAL} px-10`}
          onClick={() => {
            // Le panier a déjà été remis à neuf à l'enregistrement. On le refait
            // ici au cas où une affiche y serait entrée depuis — un retour
            // arrière, un second onglet : le client suivant n'hérite de rien.
            nouveauCartId();
          }}
        >
          {tr("stand.suivant")}
        </a>
      </div>
    </div>
  );
}
