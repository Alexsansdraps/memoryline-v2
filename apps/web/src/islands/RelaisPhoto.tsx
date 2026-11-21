/// <reference lib="dom" />
import {
  createEffect,
  createSignal,
  on,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import { lien, t, LANGUE_DEFAUT, type Langue } from "../i18n/utils.ts";
import { codeMemorise, oublierCode, retenirCode } from "../lib/code-stand.ts";
import {
  ErreurRelais,
  confirmerReception,
  fermerRelais,
  ouvrirRelais,
  releverRelais,
  type RelaisOuvert,
} from "../lib/ia.ts";

/**
 * « Envoyer la photo depuis votre téléphone » — sur la tablette du stand, et
 * (21/11) sur les grands écrans du site.
 *
 * Au marché de Noël, la photo à mettre en affiche est dans le téléphone du
 * client. Plutôt que de la faire passer par un courriel ou une messagerie, la
 * tablette montre un QR code et une adresse courte : le client scanne, choisit
 * sa photo, et elle apparaît ici en une ou deux secondes. Elle suit ensuite
 * EXACTEMENT le chemin d'une photo choisie sur la tablette (`onPhoto`) : même
 * aperçu, même réduction, même envoi — puis le style et « Créer mon affiche »,
 * comme d'habitude. Jamais de création lancée d'office : c'est une dépense,
 * elle part d'un geste.
 *
 * Au stand, le relais s'ouvre avec le code du stand — celui que la tablette
 * retient déjà pour valider les ventes.
 *
 * Sur le site aussi, depuis le 21/11 (Alexandra : « le module de QR code pour
 * envoyer une image sur le site classique aussi ») : sur un ordinateur, la
 * photo est le plus souvent dans le téléphone. Là, `stand` est faux : jamais
 * de code du stand, le relais s'ouvre au premier clic, sans en-tête
 * X-Salon-Code — c'est ce qui le désigne « site » à l'API, qui le borne à sa
 * façon (frein par IP plus serré, plafond global de relais ouverts). Tout le
 * reste — relève, confirmation, fermeture, la page du téléphone — est
 * commun. La fiche ne le montre que sur un grand écran (AfficheIA.tsx).
 *
 * La tablette RELÈVE le relais toutes les secondes et demie, plutôt que de
 * garder une connexion ouverte : un wifi de marché coupe les connexions
 * longues sans prévenir, une relève manquée se rattrape à la suivante.
 *
 * Une fois la photo arrivée, la tablette CONFIRME l'avoir reçue — c'est
 * seulement alors que le serveur l'efface — et CESSE de relever : sans quoi,
 * un quart d'heure plus tard, le code arrivait à échéance et l'écran
 * annonçait « Ce code a expiré » à un client occupé à composer son affiche.
 * Pour une autre photo, la vendeuse touche « Recevoir une autre photo » : la
 * tablette se remet à l'écoute du même code.
 */

/** Une photo déposée sur le téléphone arrive ici en moins de deux secondes. */
const SONDAGE_MS = 1500;

/**
 * Au-delà de l'échéance, on laisse au serveur le temps de le dire lui-même.
 * L'horloge d'une tablette n'est pas toujours juste ; la sienne fait foi.
 */
const TOLERANCE_MS = 10_000;

type Etat =
  | "ferme"
  | "code_stand"
  | "ouverture"
  | "attente"
  | "recue"
  | "expire"
  | "erreur";

/** Un bouton secondaire, assez grand pour le doigt. */
const SECONDAIRE =
  "border border-ink/30 px-4 py-2.5 text-sm font-medium transition-colors hover:border-ink disabled:opacity-60";

export default function RelaisPhoto(props: {
  langue?: Langue;
  /**
   * La tablette du stand (absent : la tablette aussi, comme avant le 21/11).
   * Faux : un écran du site — ni code du stand, ni phrase qui parle de toucher.
   */
  stand?: boolean;
  /** Faux tant qu'un style reste à choisir : la même règle que la zone de dépôt. */
  disponible: boolean;
  /** La tablette envoie une photo : la suivante attend qu'elle ait fini. */
  occupe: boolean;
  /** Une création est lancée : le relais n'a plus rien à attendre. */
  interrompre: boolean;
  /** La photo du téléphone, prête à suivre le chemin d'une photo choisie ici. */
  onPhoto: (fichier: File) => void;
}): JSX.Element {
  const langue = props.langue ?? LANGUE_DEFAUT;
  const tr = t(langue);
  /** Fixé au montage : la fiche ne passe pas du stand au site sous les yeux. */
  const auStand = props.stand !== false;

  const [etat, setEtat] = createSignal<Etat>("ferme");
  const [relais, setRelais] = createSignal<RelaisOuvert | null>(null);
  const [message, setMessage] = createSignal<string | null>(null);
  const [saisieCode, setSaisieCode] = createSignal("");
  /** Le QR code, en SVG. Null tant qu'il se dessine — l'adresse écrite suffit. */
  const [qr, setQr] = createSignal<string | null>(null);
  /** L'échéance du code en heure de la TABLETTE, recalée à chaque relève. */
  const [fin, setFin] = createSignal(0);
  const [maintenant, setMaintenant] = createSignal(Date.now());

  let sondage: ReturnType<typeof setTimeout> | undefined;
  let horloge: ReturnType<typeof setInterval> | undefined;
  let champCode: HTMLInputElement | undefined;
  /**
   * Le numéro du relais en cours. Une réponse qui arrive pour un relais déjà
   * fermé — la vendeuse a demandé un nouveau code entre-temps — est ignorée :
   * sans cela, une photo destinée au client précédent pourrait s'afficher.
   */
  let numero = 0;
  /**
   * Le numéro de la dernière photo montrée, sur le relais en cours. Si la
   * confirmation s'est perdue en route, le serveur la ressert au passage
   * suivant : elle est alors confirmée de nouveau, sans repasser à l'écran.
   */
  let derniereRecue: number | null = null;

  /**
   * Demande le code du stand, curseur dans le champ : la vendeuse n'a pas à
   * viser la case après un code refusé, elle retape directement.
   */
  function demanderCode(motif: string | null) {
    setMessage(motif);
    setEtat("code_stand");
    // Au tour suivant : le champ vient seulement d'être dessiné.
    setTimeout(() => {
      champCode?.focus();
      champCode?.select();
    });
  }

  /**
   * L'adresse du téléphone, bâtie sur le site que la tablette affiche.
   *
   * Pas sur celle que l'API croit être la sienne : la tablette est, par
   * définition, sur une adresse que le téléphone peut joindre — tunnel de
   * test compris —, et le texte et le QR code disent ainsi la même chose.
   */
  const adresse = () => {
    const r = relais();
    return r ? `${window.location.origin}${lien(langue, r.chemin)}` : "";
  };
  /** La même, sans « https:// » : c'est ce qu'on lit à voix haute et qu'on tape. */
  const debutAdresse = () => {
    const r = relais();
    if (!r) return "";
    const chemin = lien(langue, r.chemin);
    return `${window.location.host}${chemin.slice(0, chemin.length - r.code.length)}`;
  };
  const minutesRestantes = () =>
    Math.max(1, Math.ceil((fin() - maintenant()) / 60_000));

  function arreterMinuteries() {
    clearTimeout(sondage);
    clearInterval(horloge);
    sondage = undefined;
    horloge = undefined;
  }

  /** Oublie le relais en cours, côté tablette ET côté serveur. */
  function abandonner() {
    const r = relais();
    numero++;
    derniereRecue = null;
    arreterMinuteries();
    setRelais(null);
    setQr(null);
    if (r) void fermerRelais(r.jeton);
  }

  function fermer() {
    abandonner();
    setMessage(null);
    setEtat("ferme");
  }

  async function dessinerQr(texte: string, moi: number) {
    try {
      // Chargé à la demande : seuls la tablette du stand et les grands écrans
      // du site en ont besoin, et seulement quand un client n'a pas sa photo
      // sous la main. C'est un module CommonJS : Vite en range le contenu
      // sous `default`.
      const module = await import("qrcode");
      const QRCode = module.default ?? module;
      const svg = await QRCode.toString(texte, {
        type: "svg",
        // « M » : un reflet sur l'écran de la tablette ou une trace de doigt
        // ne l'empêchent pas d'être lu, et le code reste gros et simple.
        errorCorrectionLevel: "M",
        margin: 2,
        color: { dark: "#121212", light: "#ffffff" },
      });
      if (moi === numero) setQr(svg);
    } catch {
      // Pas de QR code : l'adresse écrite en dessous fait le même travail.
    }
  }

  /**
   * Ouvre un relais avec ce code de stand. `retenu` : le code vient de la
   * mémoire de la tablette, et non d'une saisie — refusé, il est oublié.
   * `null` : un relais du site, sans code (21/11).
   */
  async function ouvrir(code: string | null, retenu: boolean) {
    abandonner();
    const moi = numero;
    setMessage(null);
    setEtat("ouverture");
    try {
      const r = await ouvrirRelais(code);
      if (moi !== numero) {
        void fermerRelais(r.jeton);
        return;
      }
      if (code !== null) retenirCode(code);
      setSaisieCode("");
      setRelais(r);
      setFin(Date.now() + r.resteSecondes * 1000);
      setMaintenant(Date.now());
      setEtat("attente");
      void dessinerQr(adresse(), moi);
      horloge = setInterval(() => setMaintenant(Date.now()), 1000);
      planifier(moi);
    } catch (e) {
      if (moi !== numero) return;
      const cause = e instanceof ErreurRelais ? e.code : "injoignable";
      // Sur le site, aucun code à redemander : un refus (une API d'avant le
      // 21/11, qui exigeait le code du stand) se dit comme une panne.
      if (cause === "code_stand" && code !== null) {
        // Un code retenu devenu faux — stand fermé depuis hier, code changé —
        // est effacé, comme à la validation de la commande.
        if (retenu) oublierCode();
        demanderCode(tr(retenu ? "stand.code_perime" : "stand.code_refuse"));
      } else {
        setMessage(tr(cause === "rafale" ? "ia.relais.rafale" : "ia.relais.injoignable"));
        setEtat("erreur");
      }
    }
  }

  function demarrer() {
    if (!props.disponible) return;
    if (!auStand) {
      void ouvrir(null, false);
      return;
    }
    const retenu = codeMemorise();
    if (retenu) void ouvrir(retenu, true);
    else demanderCode(null);
  }

  function soumettreCode(e: Event) {
    e.preventDefault();
    const saisi = saisieCode().trim();
    if (!saisi) {
      setMessage(tr("stand.code_vide"));
      return;
    }
    void ouvrir(saisi, false);
  }

  function planifier(moi: number) {
    sondage = setTimeout(() => void relever(moi), SONDAGE_MS);
  }

  function expirer() {
    // Le code est mort côté serveur, ou le sera dans l'instant : inutile de
    // lui demander de le fermer.
    numero++;
    arreterMinuteries();
    setRelais(null);
    setQr(null);
    setEtat("expire");
  }

  async function relever(moi: number) {
    const r = relais();
    if (moi !== numero || !r) return;
    // La tablette envoie encore la photo précédente : la suivante attendra le
    // prochain passage, plutôt que de se mêler à un envoi en cours.
    if (props.occupe) {
      planifier(moi);
      return;
    }
    try {
      const releve = await releverRelais(r.jeton, `${tr("ia.relais.nom_photo")}.jpg`);
      if (moi !== numero) return;
      if (releve.etat === "expire") {
        expirer();
        return;
      }
      if (releve.resteSecondes !== null)
        setFin(Date.now() + releve.resteSecondes * 1000);
      if (releve.etat === "photo") {
        const nouvelle = releve.envoi !== derniereRecue;
        if (nouvelle) {
          derniereRecue = releve.envoi;
          setEtat("recue");
          props.onPhoto(releve.fichier);
        }
        const suite = await confirmerReception(r.jeton, releve.envoi);
        if (moi !== numero) return;
        // La photo est là : plus rien à attendre, plus de relève. Sauf si le
        // téléphone en a déjà déposé une plus récente — on repasse la
        // prendre — ou si c'était une photo déjà montrée, resservie faute de
        // confirmation : on attend toujours la suivante.
        if (nouvelle && !suite?.autre) {
          arreterMinuteries();
          return;
        }
      }
    } catch {
      // Un hoquet du réseau : on repasse au prochain tour.
    }
    if (moi !== numero) return;
    if (Date.now() > fin() + TOLERANCE_MS) expirer();
    else planifier(moi);
  }

  /**
   * « Recevoir une autre photo » : la tablette se remet à l'écoute du MÊME
   * code, et le client renvoie depuis la page déjà ouverte sur son
   * téléphone. Un code qui n'a plus qu'une minute à vivre est remplacé par un
   * neuf : le client n'aurait pas le temps de s'en servir.
   */
  function reprendre() {
    const r = relais();
    if (!r || fin() - Date.now() < 60_000) {
      demarrer();
      return;
    }
    arreterMinuteries();
    const moi = numero;
    setMessage(null);
    setEtat("attente");
    setMaintenant(Date.now());
    horloge = setInterval(() => setMaintenant(Date.now()), 1000);
    void relever(moi);
  }

  // « Créer mon affiche » : la photo est choisie, le relais se ferme. Une
  // photo envoyée ensuite du téléphone ne doit pas remplacer, sous les yeux du
  // client, celle dont l'affiche est en train de naître.
  createEffect(
    on(
      () => props.interrompre,
      (oui) => {
        if (oui && relais()) fermer();
      },
      { defer: true },
    ),
  );

  onCleanup(abandonner);

  return (
    <div class="mt-3">
      <Show when={etat() === "ferme"}>
        <button
          type="button"
          disabled={!props.disponible || props.occupe}
          onClick={demarrer}
          class="flex w-full items-center justify-center gap-3 border-2 border-ink px-5 py-3.5 font-medium transition-colors hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            aria-hidden="true"
            class="shrink-0"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="6" y="2.5" width="12" height="19" rx="2" />
            <path d="M10.5 18.5h3" />
          </svg>
          {tr("ia.relais.ouvrir")}
        </button>
        <p class="mt-1.5 text-center text-xs text-ink-soft">{tr("ia.relais.ouvrir_aide")}</p>
      </Show>

      <Show when={etat() !== "ferme"}>
        <div class="border border-ink/15 bg-paper-deep/60 p-4 sm:p-5" aria-live="polite">
          {/* Le code du stand manque, ou n'est plus bon : la vendeuse le tape
              une fois, la tablette le retient pour la journée. */}
          <Show when={etat() === "code_stand"}>
            <form class="flex flex-col gap-2" onSubmit={soumettreCode}>
              <label class="text-sm font-medium" for="ml-relais-code-stand">
                {tr("stand.code")}
              </label>
              <p class="text-sm text-ink-soft">{tr("ia.relais.code_stand_aide")}</p>
              <div class="flex flex-wrap gap-3">
                <input
                  ref={champCode}
                  id="ml-relais-code-stand"
                  value={saisieCode()}
                  onInput={(e) => setSaisieCode(e.currentTarget.value)}
                  autocomplete="off"
                  autocapitalize="characters"
                  spellcheck={false}
                  class="min-w-0 flex-1 border border-ink/25 bg-paper px-4 py-2.5 text-lg uppercase tracking-[0.15em] outline-none focus:border-ink"
                />
                <button type="submit" class={SECONDAIRE}>
                  {tr("stand.code_valider")}
                </button>
              </div>
            </form>
          </Show>

          <Show when={etat() === "ouverture"}>
            <p class="flex items-center text-sm text-ink-soft">
              <span class="ml-spinner mr-3" aria-hidden="true" />
              {tr("ia.relais.preparation")}
            </p>
          </Show>

          {/* Le code, assez grand pour être scanné à bout de bras, et l'adresse
              pour qui préfère la taper : le code seul, en capitales espacées,
              se dicte sans ambiguïté (ni O ni 0, ni I ni 1). */}
          {/* Tout en colonne : sur la tablette, la colonne des réglages est
              étroite (l'aperçu occupe l'autre moitié), et un QR code posé à
              côté du texte l'écrasait en une lettre par ligne. */}
          <Show when={etat() === "attente" && relais()}>
            <div class="flex flex-col items-center text-center">
              <p class="font-medium">{tr("ia.relais.scanner")}</p>
              <div
                role="img"
                aria-label={tr("ia.relais.qr")}
                class="mt-3 aspect-square w-full max-w-64 bg-paper [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                innerHTML={qr() ?? ""}
              />
              <p class="mt-4 text-sm text-ink-soft">{tr("ia.relais.ou_adresse")}</p>
              {/* Si l'adresse doit passer à la ligne, c'est avant le code,
                  jamais au milieu : « F4 / 96J4 » se lit comme deux codes. */}
              <p class="mt-1 max-w-full text-xl [overflow-wrap:anywhere]">
                {debutAdresse()}
                <wbr />
                <span class="font-semibold tracking-[0.12em] whitespace-nowrap">
                  {relais()!.code}
                </span>
              </p>
              <p class="mt-4 flex items-center justify-center text-sm font-medium">
                <span class="ml-spinner mr-3" aria-hidden="true" />
                {tr("ia.relais.attente")}
              </p>
              <p class="mt-1 text-xs text-ink-soft tabular-nums">
                {tr("ia.relais.reste").replace("{minutes}", String(minutesRestantes()))}
              </p>
            </div>
            <div class="mt-4 flex flex-wrap justify-center gap-3">
              <button type="button" class={SECONDAIRE} onClick={demarrer}>
                {tr("ia.relais.nouveau_code")}
              </button>
              <button type="button" class={SECONDAIRE} onClick={fermer}>
                {tr("ia.relais.annuler")}
              </button>
            </div>
          </Show>

          {/* La photo est arrivée : elle est déjà dans l'aperçu, comme si on
              l'avait choisie ici, et la tablette ne relève plus rien. Le code
              reste ouvert : un client qui s'est trompé de photo en renvoie une
              autre de son téléphone, une fois la tablette remise à l'écoute. */}
          <Show when={etat() === "recue" && relais()}>
            <p class="flex items-center gap-2 font-medium">
              <span
                aria-hidden="true"
                class="inline-flex h-6 w-6 shrink-0 items-center justify-center bg-ink text-xs text-paper"
              >
                ✓
              </span>
              {tr("ia.relais.recue")}
            </p>
            <p class="mt-1 text-sm text-ink-soft">
              {tr(auStand ? "ia.relais.recue_aide" : "ia.relais.recue_aide_site")}
            </p>
            <div class="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                class={SECONDAIRE}
                disabled={props.occupe}
                onClick={reprendre}
              >
                {tr("ia.relais.autre")}
              </button>
              <button type="button" class={SECONDAIRE} onClick={fermer}>
                {tr("ia.relais.fermer")}
              </button>
            </div>
          </Show>

          <Show when={etat() === "expire"}>
            <p class="text-sm">{tr("ia.relais.expire")}</p>
            <div class="mt-3 flex flex-wrap gap-3">
              <button type="button" class={SECONDAIRE} onClick={demarrer}>
                {tr("ia.relais.nouveau_code")}
              </button>
              <button type="button" class={SECONDAIRE} onClick={fermer}>
                {tr("ia.relais.fermer")}
              </button>
            </div>
          </Show>

          <Show when={message()}>
            <p
              role="alert"
              class={`${etat() === "erreur" ? "" : "mt-3"} bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep`}
            >
              {message()}
            </p>
          </Show>

          <Show when={etat() === "erreur"}>
            <div class="mt-3 flex flex-wrap gap-3">
              <button type="button" class={SECONDAIRE} onClick={demarrer}>
                {tr("ia.relais.reessayer")}
              </button>
              <button type="button" class={SECONDAIRE} onClick={fermer}>
                {tr("ia.relais.fermer")}
              </button>
            </div>
          </Show>

          <Show when={etat() === "code_stand"}>
            <button
              type="button"
              onClick={fermer}
              class="mt-3 text-sm text-ink-soft underline underline-offset-4 hover:text-ink"
            >
              {tr("ia.relais.annuler")}
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
