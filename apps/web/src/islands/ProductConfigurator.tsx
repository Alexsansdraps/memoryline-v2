/// <reference lib="dom" />
import type { CleUi, Langue } from "../i18n/utils.ts";
import {
  createSignal,
  lazy,
  onMount,
  onCleanup,
  Show,
  Suspense,
  type JSX,
} from "solid-js";
import type { PosterConfig, PosterFormat, SourceVideo } from "@memoryline/types";
import { sourceVideo } from "@memoryline/types/video";
import { getCartId, lirePanier } from "../lib/api-navigateur.ts";
import type { Cart, EncartVideoDTO } from "../lib/api.ts";

/*
 * Le module de composition et le lecteur vidéo ne se chargent qu'au besoin.
 *
 * Importés d'emblée, ils partaient avec la fiche — le module entier, le
 * dictionnaire des cinq langues et api.ts —, si bien que le bouton
 * « Personnaliser » n'était cliquable qu'au bout de trois secondes sur un
 * téléphone, pour une fenêtre que beaucoup n'ouvrent jamais (AUDIT-SEO.md,
 * VIT-2). Ils sont maintenant demandés dès que la page est au repos, ou dès
 * que la souris ou le doigt approche du bouton : à l'ouverture, ils sont
 * presque toujours déjà là, et sinon la fenêtre montre un rond qui tourne.
 */
const chargerConfigurateur = () => import("./ConfiguratorIsland.tsx");
const ConfiguratorIsland = lazy(chargerConfigurateur);
const LecteurVideo = lazy(async () => {
  const m = await import("./EncartVideo.tsx");
  return {
    default: (p: {
      source: NonNullable<SourceVideo>;
      posterBrut: string;
      titre: string;
      langue?: Langue;
      onFermer: () => void;
    }) =>
      m.LecteurVideo({
        source: p.source,
        poster: m.facadeEncart(p.posterBrut),
        titre: p.titre,
        langue: p.langue,
        onFermer: p.onFermer,
      }),
  };
});

/** Les mots de la fiche, traduits par la page (libelles(langue, LIBELLES_CONFIGURATEUR)). */
export const LIBELLES_CONFIGURATEUR = [
  "panier.moins",
  "panier.plus",
  "panier.quantite",
  "cfg.chargement",
  "produit.personnaliser",
  "cfg.titre",
  "cfg.video.titre",
  "cfg.video.lancer",
  "cfg.video.bulle",
  "cfg.fermer",
] as const satisfies readonly CleUi[];

/**
 * Bouton UNIQUE « Personnaliser » de la fiche produit + configurateur en
 * MODALE plein écran (popup), responsive mobile.
 *
 * - Un seul bouton (plus de doublon lien d'ancre + île).
 * - Au clic : ouverture d'une modale overlay contenant le configurateur.
 *   Fermeture par croix, Échap ou clic sur le fond.
 * - Mode ÉDITION (?edit=ITEM_ID, réouverture depuis le panier §18.3 I) :
 *   on charge la config de la ligne et on ouvre directement la modale.
 */
export interface ProductConfiguratorProps {
  /**
   * Au stand : ne montrer aucun montant, du premier écran au dernier.
   *
   * Le configurateur porte déjà cette option ; elle ne faisait que ne pas
   * traverser cette fiche-ci.
   */
  sansPrix?: boolean;
  /** Faux : le site ne propose pas les cadres (cf. ConfiguratorIslandProps). */
  cadresProposes?: boolean;
  /**
   * Faux : la boutique tait le supplément de chaque cadre (« + 15 € » sous sa
   * vignette), réglage de la page Cadres du back-office. Le prix du cadre
   * reste compté dans le total. Absent : le supplément s'affiche.
   */
  prixCadres?: boolean;
  /** Faux : « Voir sur un mur » coupé au back-office (page Cadres). */
  apercuMur?: boolean;
  /** Langue de la page — pilote tous les libellés affichés. */
  langue?: Langue;
  /** Les mots de la fiche, traduits par la page. */
  libelles: Record<(typeof LIBELLES_CONFIGURATEUR)[number], string>;
  product: { id: number; name: string; basePriceCents: number };
  /** Prix réels par format (centimes), ex. { A4: 2300, A3: 2900 }. */
  prices?: Partial<Record<string, number>>;
  /** Décor d'avant-plan du produit. */
  foregroundUrl?: string | null;
  /**
   * Le jeu de motifs que la fiche propose (28/11, affiche du stand de
   * Mulhouse). Null ou absent : affiche classique.
   */
  vueMotifs?: string | null;
  /**
   * La palette des couleurs du motif (28/11, réglage du back-office), noms
   * dans la langue de la page. Seulement sur une affiche à motifs.
   */
  couleursMotif?: { id: string; nom: string; hex: string }[] | null;
  /** Réglages par défaut du produit (pré-remplissage), une entrée par ligne. */
  defaults?: { lignes?: (string | null)[]; view?: string | null };
  /** Le format coché d'emblée sur la fiche — le moins cher, en général. */
  formatInitial?: string;
  /**
   * L'encart vidéo explicative, déjà résolu dans la langue de la page.
   *
   * Absent ou `null` : la marchande l'a éteint au back-office, ou l'on est au
   * stand — rien n'est monté du tout, pas même le rond de l'en-tête.
   *
   * C'est de la DONNÉE, pas un nœud : la modale est montée `client:only`, et
   * Astro sérialise ses props. C'est ici, dans le navigateur, qu'on en fait
   * la fonction attendue par le paquet du configurateur.
   */
  video?: EncartVideoDTO | null;
}

export default function ProductConfigurator(
  props: ProductConfiguratorProps,
): JSX.Element {
  const tr = (cle: CleUi): string =>
    (props.libelles as Record<string, string>)[cle] ?? String(cle);
  const [open, setOpen] = createSignal(false);
  /**
   * La fenêtre a-t-elle déjà été ouverte sur cette page ? Une fois montée, la
   * composition n'est plus démontée à la fermeture, seulement CACHÉE.
   *
   * Demande d'Alexandra (8/11) : un clic à côté de la fenêtre la fermait, et
   * tout ce qui avait été composé était perdu. Désormais :
   *   - un clic à côté ne ferme plus rien (voir l'overlay plus bas) ;
   *   - la croix, « Retour » et Échap ferment, mais l'affiche en cours reste
   *     là : la rouvrir sur la même page la rend telle quelle, à la même
   *     étape ;
   *   - partir composer une AUTRE affiche (une autre page) jette ce
   *     brouillon tout seul : il ne vit que dans cette page, rien n'est rangé
   *     dans le navigateur. Après « Ajouter au panier », la page part vers le
   *     panier : jeté aussi. Revenir du panier par le bouton « précédent »
   *     rouvre la page à neuf (voir `pageshow`).
   *
   * Recette du 17/11 : le bouton ou le geste « précédent » PENDANT la
   * composition (tablette du stand, Android) quittait la fiche et jetait
   * l'affiche. L'ouverture pose maintenant une entrée d'historique : le
   * « précédent » ne fait que fermer la fenêtre, comme la croix, et l'affiche
   * reste là. Même procédé que CommandeStand.tsx.
   */
  const [monte, setMonte] = createSignal(false);
  const [editItemId, setEditItemId] = createSignal<number | null>(null);

  /**
   * Le nombre d'exemplaires, choisi sur la fiche.
   *
   * Borné entre 1 et 20 : zéro laisserait une ligne vide dans le panier, et
   * au-delà de vingt on n'est plus dans l'achat d'une cliente mais dans une
   * commande de revente, qui se traite de vive voix.
   */
  const [quantite, setQuantite] = createSignal(1);
  const bornerQuantite = (n: number) =>
    Math.min(20, Math.max(1, Math.trunc(n) || 1));
  const [initialConfig, setInitialConfig] = createSignal<
    PosterConfig | undefined
  >(undefined);
  const [loadingEdit, setLoadingEdit] = createSignal(false);

  /*
   * Le format choisi sur la fiche.
   *
   * Les cases de taille sont rendues par le serveur, ce configurateur est un
   * îlot monté après coup : ni l'un ni l'autre ne peut appeler l'autre
   * directement. Un événement du navigateur est la seule chose qu'ils
   * partagent, et il évite d'avoir à les fondre en un seul composant pour
   * une information aussi petite qu'un nom de format.
   */
  const [formatChoisi, setFormatChoisi] = createSignal<string | undefined>(
    props.formatInitial,
  );
  onMount(() => {
    const surChoix = (e: Event) => {
      const f = (e as CustomEvent<{ format?: string }>).detail?.format;
      if (f) setFormatChoisi(f);
    };
    window.addEventListener("ml:format", surChoix);
    onCleanup(() => window.removeEventListener("ml:format", surChoix));
  });

  function lockScroll(lock: boolean) {
    document.body.style.overflow = lock ? "hidden" : "";
  }
  /** Notre entrée d'historique : posée à l'ouverture, consommée à la fermeture. */
  const entreeOuverte = () =>
    typeof history !== "undefined" && Boolean((history.state as { mlPerso?: boolean } | null)?.mlPerso);
  function openModal() {
    setMonte(true);
    setOpen(true);
    lockScroll(true);
    if (!entreeOuverte())
      history.pushState({ ...((history.state as object | null) ?? {}), mlPerso: true }, "");
  }
  /** Croix, « Retour », Échap : on repasse par l'historique, popstate ferme. */
  function closeModal() {
    if (entreeOuverte()) {
      history.back();
      return;
    }
    fermer();
  }
  /** Le « précédent » du navigateur, ou la fin de closeModal. */
  function surPopstate() {
    if (entreeOuverte()) return; // « suivant » vers notre entrée : rien à rouvrir
    setVideoOuverte(false);
    if (open()) fermer();
  }
  /**
   * Une entrée « fenêtre ouverte » retrouvée alors que la fenêtre est fermée
   * (page rechargée, ou resservie par le cache) : on retire la marque, sinon
   * la prochaine fermeture reculerait d'une page de trop.
   */
  function oublierEntreeOrpheline() {
    if (entreeOuverte() && !open()) {
      const { mlPerso: _retire, ...reste } = history.state as Record<string, unknown>;
      history.replaceState(reste, "");
    }
  }
  function fermer() {
    setOpen(false);
    lockScroll(false);
    // La couche vidéo est montée dans la modale : la laisser « ouverte » la
    // ferait reparaître à la réouverture, par-dessus l'étape 1.
    setVideoOuverte(false);
  }

  /* ---------------------------------------------------------------------
   * L'encart vidéo explicative.
   *
   * Rien de tiers n'existe tant que `videoOuverte()` est faux : ni iframe, ni
   * <video>, ni preconnect. C'est le clic de la cliente qui crée le lecteur,
   * et sa fermeture qui le démonte — donc qui coupe la connexion à l'hôte.
   * ------------------------------------------------------------------- */
  const [videoOuverte, setVideoOuverte] = createSignal(false);
  const source = () => sourceVideo(props.video?.url);
  /** Le bouton qui a ouvert la couche : c'est à lui que le focus revient. */
  let declencheur: HTMLElement | null = null;
  let boutonRouvrir: HTMLButtonElement | undefined;
  function ouvrirVideo(origine?: HTMLElement) {
    declencheur = origine ?? null;
    setVideoOuverte(true);
  }
  function fermerVideo() {
    setVideoOuverte(false);
    // Après le démontage de la couche, sinon le focus part sur un nœud qui
    // n'existe déjà plus et le navigateur le renvoie sur <body>.
    queueMicrotask(() => declencheur?.focus());
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    // Échap ferme la couche la plus haute, une seule à la fois. Sans cette
    // ligne, regarder la vidéo puis appuyer sur Échap refermait TOUTE la
    // personnalisation en cours — la régression la plus facile à écrire et
    // la plus dure à pardonner.
    if (videoOuverte()) {
      fermerVideo();
      return;
    }
    if (open()) closeModal();
  }

  /**
   * Demande le module de composition à l'avance (une seule fois : import() se
   * souvient), et avec lui les polices de départ de l'affiche (18/11) : la
   * ligne 1 en DM Serif Display, les lignes 2 et 3 en « another shabby »
   * (POLICE_TITRE_DEFAUT et POLICE_SOUSTITRE_DEFAUT de @memoryline/types,
   * écrites ici pour ne pas charger toute la liste des polices sur la fiche).
   * À l'ouverture, le texte s'affiche aussitôt dans sa police, sans la roue
   * qui l'attendait. Le navigateur ne les télécharge qu'une fois.
   */
  const prechargerConfigurateur = () => {
    void chargerConfigurateur().catch(() => {});
    try {
      for (const famille of ["DM Serif Display", "another shabby"])
        void document.fonts?.load(`1em '${famille}'`).catch(() => {});
    } catch {
      // Navigateur sans document.fonts : la police viendra à l'ouverture.
    }
  };

  /**
   * Une page resservie par le bouton « précédent » (cache du navigateur)
   * revient avec la composition d'avant, cachée — celle qu'on vient peut-être
   * d'ajouter au panier. On repart à neuf, comme une nouvelle visite.
   */
  function surRetour(e: PageTransitionEvent) {
    if (!e.persisted) return;
    setOpen(false);
    setMonte(false);
    setVideoOuverte(false);
    lockScroll(false);
    oublierEntreeOrpheline();
  }

  onMount(async () => {
    window.addEventListener("keydown", onKey);
    window.addEventListener("pageshow", surRetour);
    window.addEventListener("popstate", surPopstate);
    oublierEntreeOrpheline();
    // La page au repos, le module arrive sans gêner rien d'autre ; sans
    // requestIdleCallback (Safari), deux secondes après le montage.
    const auRepos = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 2000));
    auRepos(prechargerConfigurateur);
    // Mode édition depuis le panier (?edit=ITEM_ID).
    const params = new URLSearchParams(window.location.search);
    const editId = params.get("edit");
    if (!editId) return;
    setLoadingEdit(true);
    try {
      const cart = await lirePanier<Cart>(getCartId());
      const item = cart?.items.find((i) => String(i.id) === editId);
      // Une carte cadeau n'a pas de composition à rouvrir.
      if (item?.config) {
        setInitialConfig(item.config);
        setEditItemId(item.id);
        openModal();
      }
    } catch {
      /* silencieux : on retombe sur l'ajout classique */
    } finally {
      setLoadingEdit(false);
    }
  });

  onCleanup(() => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("pageshow", surRetour);
    window.removeEventListener("popstate", surPopstate);
    lockScroll(false);
  });

  return (
    <>
      <div class="mt-8 flex flex-wrap items-center gap-4">
        {/* Le nombre d'exemplaires, AVANT de composer — au même endroit que
            sur une affiche prête à imprimer. Il était auparavant à la
            dernière étape du configurateur : pour le trouver, il fallait
            avoir composé toute son affiche.

            En modification depuis le panier, il disparaît : la ligne existe
            déjà et porte son nombre ; le changer ici en ajouterait d'autres
            au lieu de corriger celle qu'on est venu corriger. */}
        <Show when={editItemId() == null}>
          <div class="inline-flex items-center border border-ink/20">
            <button
              type="button"
              onClick={() => setQuantite((q) => bornerQuantite(q - 1))}
              disabled={quantite() <= 1}
              aria-label={tr("panier.moins")}
              class="px-3 py-2.5 text-lg leading-none text-ink-soft transition-colors hover:text-ink disabled:opacity-40"
            >
              −
            </button>
            <input
              type="number"
              min="1"
              max="20"
              value={quantite()}
              onInput={(e) =>
                setQuantite(bornerQuantite(Number(e.currentTarget.value)))
              }
              aria-label={tr("panier.quantite")}
              class="w-12 border-x border-ink/20 bg-transparent py-2.5 text-center text-sm focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setQuantite((q) => bornerQuantite(q + 1))}
              disabled={quantite() >= 20}
              aria-label={tr("panier.plus")}
              class="px-3 py-2.5 text-lg leading-none text-ink-soft transition-colors hover:text-ink disabled:opacity-40"
            >
              +
            </button>
          </div>
        </Show>

        <button
          type="button"
          onClick={openModal}
          onPointerEnter={prechargerConfigurateur}
          onTouchStart={prechargerConfigurateur}
          onFocus={prechargerConfigurateur}
          disabled={loadingEdit()}
          aria-busy={loadingEdit()}
          class="inline-block rounded-full bg-ink px-8 py-3 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-60"
        >
          {loadingEdit() ? (
            <>
              {/* Le rond clair : le gris du rond d'origine disparaissait sur
                  le noir du bouton. */}
              <span class="ml-spinner ml-spinner-clair mr-2" aria-hidden="true" />
              {tr("cfg.chargement")}
            </>
          ) : (
            tr("produit.personnaliser")
          )}
        </button>
      </div>
      {/* Plus de « Choisissez le fond, le texte et vos personnages. » sous le
          bouton (27/11, Alexandra : « supprimer les phrases côté client qui
          sont inutiles ») : les étapes de la fenêtre le disent. */}

      <Show when={monte()}>
        {/* Cachée et non démontée quand elle est fermée (voir `monte`). Pas de
            fermeture au clic à côté : un doigt qui glisse hors de la fenêtre
            sur une tablette la refermait en pleine composition. */}
        {/* Une affiche à motifs s'ouvre en PLEIN ÉCRAN, sur le site comme à
            la tablette, ordinateur et téléphone (28/11, Alexandra : « et
            mettre en plein écran la popup ») : `ml-modal-plein-ecran`,
            global.css. Les autres gardent leur fenêtre. */}
        <div
          class={`ml-modal-overlay${props.vueMotifs ? " ml-modal-plein-ecran" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={tr("produit.personnaliser")}
          aria-hidden={open() ? undefined : "true"}
          style={open() ? undefined : { display: "none" }}
        >
          <div class="ml-modal-panel">
            <header class="ml-modal-head">
              {/* Le titre et la pilule « Tuto » ensemble, loin de la croix :
                  côte à côte quand ils tiennent sur une ligne, la pilule sous
                  le titre sur un téléphone (cf. .ml-modal-titre). */}
              <div class="ml-modal-titre">
              <h2 class="text-xl sm:text-2xl">
                {tr("cfg.titre")}
              </h2>
              {/* La pilule « ▶ Tuto », aux TROIS étapes.

                  Elle remplace l'encart qui ouvrait l'étape 1 : « ça prend
                  trop de place », a dit la boutique, qui voulait une petite
                  bulle dans un coin et la vidéo en pop-up. D'abord un rond
                  « TUTO ▶ » d'après son dessin du 22/10 ; jugé « pas assez
                  joli », remplacé le 8/11 par cette pilule, choisie parmi
                  cinq styles.

                  Ici et pas dans le fil d'étapes : cette rangée-là est pleine
                  (neuf pixels libres mesurés à 375 px, sans `flex-wrap`), et
                  un quatrième bouton la casserait sur téléphone. L'en-tête,
                  lui, est `flex: 0 0 auto` et vit hors du conteneur qui
                  défile : la bulle ne coûte aucun pixel de hauteur.

                  Elle n'existe QUE s'il y a une vidéo : une bulle qui n'ouvre
                  rien est un piège. */}
              <Show when={source()}>
                <button
                  type="button"
                  class="ml-modal-video"
                  ref={boutonRouvrir}
                  aria-label={`${props.video?.titre || tr("cfg.video.titre")} — ${tr("cfg.video.lancer")}`}
                  title={tr("cfg.video.lancer")}
                  onClick={() => ouvrirVideo(boutonRouvrir)}
                >
                  {/* Dessiné, et non le caractère ▶ : iOS l'affiche en émoji
                      bleu, et la boutique regarde sur tablette. */}
                  <span class="ml-modal-video-lecture" aria-hidden="true">
                    <svg
                      class="ml-modal-video-icone"
                      viewBox="0 0 10 12"
                      width="8"
                      height="9.6"
                    >
                      <path d="M0 0 10 6 0 12z" fill="currentColor" />
                    </svg>
                  </span>
                  <span>{tr("cfg.video.bulle")}</span>
                </button>
              </Show>
              </div>
              <button
                type="button"
                class="ml-modal-close"
                aria-label={tr("cfg.fermer")}
                onClick={closeModal}
              >
                ✕
              </button>
            </header>
            <div class="ml-modal-body">
              <Suspense
                fallback={
                  <p class="flex items-center justify-center gap-2 py-16 text-ink-soft" role="status">
                    <span class="ml-spinner" aria-hidden="true" />
                    {tr("cfg.chargement")}
                  </p>
                }
              >
              <ConfiguratorIsland
                langue={props.langue}
                product={props.product}
                prices={props.prices}
                sansPrix={props.sansPrix}
                /* Le supplément sous chaque cadre est tu par le
                   configurateur lui-même, qui sait quel bout de vignette il
                   dessine. Une règle de style de la fiche (l'ancienne
                   `.ml-sans-prix-cadres`) cachait le deuxième `div` de la
                   vignette : elle serait tombée en panne au premier élément
                   ajouté dans la vignette, sans que rien ne le signale. */
                sansPrixCadres={props.prixCadres === false}
                apercuMur={props.apercuMur}
                cadresProposes={props.cadresProposes}
                quantite={quantite()}
                foregroundUrl={props.foregroundUrl}
                vueMotifs={props.vueMotifs ?? null}
                couleursMotif={props.couleursMotif ?? null}
                defaults={{
                  ...props.defaults,
                  // Le format n'est repris qu'à l'AJOUT : rouvrir une ligne du
                  // panier doit rendre le format qu'elle porte, pas celui que
                  // la fiche affiche derrière la fenêtre.
                  ...(editItemId() == null && formatChoisi()
                    ? { format: formatChoisi() as PosterFormat }
                    : {}),
                }}
                mode={editItemId() != null ? "edit" : "add"}
                initialConfig={initialConfig()}
                itemId={editItemId() ?? undefined}
                onCancel={closeModal}
              />
              </Suspense>
            </div>
          </div>
          <Show when={videoOuverte() && source()}>
            {(s) => (
              <Suspense>
                <LecteurVideo
                  source={s()}
                  posterBrut={props.video?.poster ?? ""}
                  titre={props.video?.titre || tr("cfg.video.titre")}
                  langue={props.langue}
                  onFermer={fermerVideo}
                />
              </Suspense>
            )}
          </Show>
        </div>
      </Show>
    </>
  );
}
