/// <reference lib="dom" />
import { createMemo, createSignal, For, Show } from "solid-js";
import { aLaLargeur, urlAsset } from "@memoryline/types";
import type { CharacterDTO } from "../store";
import type { MessagesConfigurateur } from "../messages";
import { PastilleCouleur } from "./ui";
import { ZoneDefilante } from "./Defilement";

/**
 * Une couleur de la palette du motif (28/11, Alexandra : « faut qu'on puisse
 * mettre des couleurs pour les images dans le BO, dans un premier temps mets
 * en 10 par défaut qui pourraient aller à tous, modifiable dans le BO »).
 * Réglage « motifs.couleurs » (BO › Personnages › Couleurs des motifs), servi
 * avec la fiche (GET /products/:slug, `couleursMotif`), le nom dans la langue
 * de la page. La silhouette du motif prend `hex` (couleursDuMotif, store.ts).
 */
export interface CouleurDeMotif {
  id: string;
  /** Le nom montré (infobulle, lecteur d'écran), traduit. */
  nom: string;
  /** « #RRGGBB ». */
  hex: string;
}

/** Titre d'un groupe de choix (le même que celui des champs, sans <label>). */
export function TitreDeChoix(props: { children: string }) {
  return (
    <span
      style={{
        display: "block",
        "font-size": "13px",
        "font-weight": "600",
        color: "#374151",
        "margin-bottom": "4px",
      }}
    >
      {props.children}
    </span>
  );
}

/**
 * Le choix du motif d'une affiche à motifs (28/11, stand de Mulhouse), RANGÉ
 * PAR CATÉGORIES pour les clients (Alexandra : « tu les classes en plus pour
 * les clients stp ») : un onglet par catégorie, dans l'ordre du back-office
 * (BO › Personnages, où Margaux les range et les renomme), puis la grille des
 * motifs de l'onglet. Sur le modèle du choix des personnages.
 *
 * Les vignettes sont les images légères que l'API tire du SVG (« ?l=200 ») :
 * 47 dessins vectoriels à charger d'un coup pèseraient près de 2 Mo.
 */
export function ChoixMotif(props: {
  motifs: readonly CharacterDTO[];
  /** L'identifiant du motif choisi. */
  choisi: string | number | undefined;
  onChoisir: (motif: CharacterDTO) => void;
  /** La palette (couleurs activées au back-office), dans son ordre. */
  couleurs: readonly CouleurDeMotif[];
  /** La couleur du motif choisi, « #RRGGBB ». */
  couleur: string;
  onCouleur: (hex: string) => void;
  assetBaseUrl: string;
  messages: MessagesConfigurateur;
}) {
  const m = () => props.messages;
  /** Clé de rangement, jamais montrée : la catégorie, sinon « autres ». */
  const SANS_CAT = "\u0000autres";
  const cle = (c: CharacterDTO) =>
    c.categoryId != null ? `#${c.categoryId}` : (c.category ?? SANS_CAT);

  /** Les onglets, dans l'ordre où l'API rend les motifs (= ordre du BO). */
  const onglets = createMemo(() => {
    const vus: { cle: string; nom: string }[] = [];
    for (const c of props.motifs) {
      const k = cle(c);
      if (!vus.some((o) => o.cle === k)) vus.push({ cle: k, nom: c.category ?? m().autres });
    }
    return vus;
  });

  const ongletDuChoisi = () => {
    const c = props.motifs.find((x) => String(x.id) === String(props.choisi));
    return c ? cle(c) : onglets()[0]?.cle;
  };
  /** L'onglet touché par le client ; à défaut, celui du motif choisi. */
  const [touche, setTouche] = createSignal<string | null>(null);
  const actif = () => {
    const t = touche();
    return t && onglets().some((o) => o.cle === t) ? t : ongletDuChoisi();
  };
  const motifsDeLOnglet = createMemo(() => props.motifs.filter((c) => cle(c) === actif()));

  const vignette = (c: CharacterDTO) =>
    aLaLargeur(urlAsset(props.assetBaseUrl, c.baseSvgUrl), 200) ?? c.baseSvgUrl;

  return (
    <div class="ml-cfg-motifs" style={{ "margin-bottom": "14px" }}>
      <TitreDeChoix>{m().motif}</TitreDeChoix>
      <p style={{ margin: "0 0 8px", "font-size": "12px", color: "#6b7280", "line-height": "1.4" }}>
        {m().motifAide}
      </p>

      <Show when={onglets().length > 1}>
        <ZoneDefilante
          sens="horizontal"
          versDebut={m().precedent}
          versFin={m().suivant}
          class="ml-cfg-categories"
          style={{ display: "flex", gap: "6px", "overflow-x": "auto", padding: "2px 0 8px" }}
        >
          <For each={onglets()}>
            {(o) => (
              <button
                type="button"
                onClick={() => setTouche(o.cle)}
                aria-pressed={actif() === o.cle}
                style={{
                  flex: "0 0 auto",
                  border: actif() === o.cle ? "1px solid #4f46e5" : "1px solid #d1d5db",
                  background: actif() === o.cle ? "#4f46e5" : "#fff",
                  color: actif() === o.cle ? "#fff" : "#374151",
                  "border-radius": "9999px",
                  padding: "5px 12px",
                  "font-size": "13px",
                  "font-weight": "600",
                  "white-space": "nowrap",
                  cursor: "pointer",
                }}
              >
                {o.nom}
              </button>
            )}
          </For>
        </ZoneDefilante>
      </Show>

      <ZoneDefilante
        sens="vertical"
        versDebut={m().defilerHaut}
        versFin={m().defilerBas}
        class="ml-cfg-grille-motifs"
        style={{
          display: "grid",
          "grid-template-columns": "repeat(auto-fill, minmax(84px, 1fr))",
          gap: "8px",
          "max-height": "236px",
          "overflow-y": "auto",
          padding: "2px",
        }}
      >
        <For each={motifsDeLOnglet()}>
          {(c) => {
            const choisi = () => String(props.choisi) === String(c.id);
            return (
              <button
                type="button"
                class="ml-choix ml-choix-dedans"
                aria-pressed={choisi()}
                title={c.name}
                data-item
                onClick={() => props.onChoisir(c)}
                style={{
                  display: "flex",
                  "flex-direction": "column",
                  "align-items": "stretch",
                  gap: "4px",
                  padding: "4px",
                  "min-width": "0",
                  border: choisi() ? "2px solid #4f46e5" : "1px solid #d1d5db",
                  "border-radius": "8px",
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    display: "block",
                    width: "100%",
                    "aspect-ratio": "1 / 1",
                    background: "#f3f4f6",
                    "border-radius": "6px",
                    overflow: "hidden",
                  }}
                >
                  <img
                    src={vignette(c)}
                    alt={c.name}
                    loading="lazy"
                    draggable={false}
                    style={{
                      display: "block",
                      width: "100%",
                      height: "100%",
                      "object-fit": "contain",
                      padding: "6px",
                      "box-sizing": "border-box",
                    }}
                  />
                </span>
                <span
                  style={{
                    "font-size": "11px",
                    "line-height": "1.25",
                    "text-align": "center",
                    color: "#374151",
                    overflow: "hidden",
                    display: "-webkit-box",
                    "-webkit-line-clamp": "2",
                    "-webkit-box-orient": "vertical",
                    "overflow-wrap": "anywhere",
                  }}
                >
                  {c.name}
                </span>
              </button>
            );
          }}
        </For>
      </ZoneDefilante>

      {/* La couleur du motif, dans la palette du back-office : la silhouette
          la prend, les détails restent lisibles (crème sur une couleur
          foncée, sombres sur une claire), les façades des maisons gardent
          leurs couleurs (couleursDuMotif). Une rangée qui passe à la ligne :
          dix pastilles ne tiennent pas sur la largeur d'un téléphone. */}
      <Show when={props.couleurs.length > 0}>
        <div role="group" aria-label={m().couleurMotif} style={{ "margin-top": "10px" }}>
          <TitreDeChoix>{m().couleurMotif}</TitreDeChoix>
          <div
            class="ml-cfg-couleurs-motif"
            style={{ display: "flex", "flex-wrap": "wrap", gap: "10px", padding: "4px 2px" }}
          >
            <For each={props.couleurs}>
              {(c) => (
                <PastilleCouleur
                  couleur={c.hex}
                  libelle={c.nom}
                  actif={props.couleur.toUpperCase() === c.hex.toUpperCase()}
                  onClick={() => props.onCouleur(c.hex)}
                />
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
