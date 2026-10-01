/// <reference lib="dom" />
/**
 * La carte des points relais, à côté de la liste.
 *
 * Chaque point porte le même numéro sur la carte et dans la liste : on repère
 * sur la carte celui qui est au bout de sa rue, on le retrouve dans la liste
 * pour lire ses horaires. Cliquer un repère choisit le point, exactement comme
 * cocher sa ligne.
 *
 * Leaflet et ses styles ne se chargent qu'à la première carte affichée : un
 * client qui se fait livrer à domicile ne les télécharge jamais. Les fonds
 * viennent d'OpenStreetMap — ni cookie, ni mesure d'audience, ce que promet
 * le bandeau du site.
 */
import { createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import type { Map as CarteLeaflet, LayerGroup } from "leaflet";
import type { PointRelais } from "../lib/api.ts";
import { t, LANGUE_DEFAUT, type Langue } from "../i18n/utils.ts";

type Leaflet = typeof import("leaflet");

export default function CarteRelais(props: {
  langue?: Langue;
  points: PointRelais[];
  /** L'identifiant du point choisi, ou "" . */
  choisi: string;
  /** L'adresse d'où l'on cherche, quand le client l'a choisie. */
  depart?: { latitude: number; longitude: number } | null;
  onChoisir: (p: PointRelais) => void;
}) {
  const tr = t(props.langue ?? LANGUE_DEFAUT);
  let conteneur!: HTMLDivElement;
  let L: Leaflet | undefined;
  let carte: CarteLeaflet | undefined;
  let reperes: LayerGroup | undefined;
  const [prete, setPrete] = createSignal(false);
  const [panne, setPanne] = createSignal(false);

  onMount(async () => {
    try {
      const [module] = await Promise.all([
        import("leaflet"),
        import("leaflet/dist/leaflet.css"),
      ]);
      L = ((module as unknown as { default?: Leaflet }).default ?? module) as Leaflet;
      carte = L.map(conteneur, {
        // La molette fait défiler la PAGE : sinon, en descendant vers le
        // paiement, on zoome la carte sans le vouloir. On zoome aux boutons,
        // au pincement, ou molette + Ctrl.
        scrollWheelZoom: false,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(carte);
      reperes = L.layerGroup().addTo(carte);
      setPrete(true);
    } catch {
      // Pas de carte ? La liste suffit pour choisir : on ne bloque rien.
      setPanne(true);
    }
  });

  onCleanup(() => carte?.remove());

  const coordonnees = (p: PointRelais): [number, number] | null => {
    const lat = Number(p.latitude);
    const lng = Number(p.longitude);
    return p.latitude && p.longitude && Number.isFinite(lat) && Number.isFinite(lng)
      ? [lat, lng]
      : null;
  };

  // Les repères : redessinés à chaque liste, et à chaque choix pour que le
  // point choisi ressorte.
  createEffect(() => {
    if (!prete() || !L || !reperes) return;
    const choisi = props.choisi;
    const depart = props.depart;
    reperes.clearLayers();
    if (depart)
      L.marker([depart.latitude, depart.longitude], {
        icon: L.divIcon({
          className: "",
          html: '<span class="ml-repere-depart" aria-hidden="true"></span>',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
        interactive: false,
        keyboard: false,
      }).addTo(reperes);
    props.points.forEach((p, i) => {
      const position = coordonnees(p);
      if (!position) return;
      const actif = p.id === choisi;
      L!
        .marker(position, {
          icon: L!.divIcon({
            className: "",
            html: `<span class="ml-repere${actif ? " ml-repere-actif" : ""}">${i + 1}</span>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
          title: p.nom,
          alt: `${i + 1}. ${p.nom}`,
          zIndexOffset: actif ? 1000 : 0,
        })
        .on("click", () => props.onChoisir(p))
        .addTo(reperes!);
    });
  });

  // Le cadrage : seulement quand la LISTE change. Recadrer à chaque choix
  // ferait sauter la carte sous le doigt de celui qui vient de cliquer.
  createEffect(
    on(
      () => [prete(), props.points, props.depart] as const,
      () => {
        if (!prete() || !L || !carte) return;
        const positions = props.points
          .map(coordonnees)
          .filter((x): x is [number, number] => x !== null);
        if (props.depart) positions.push([props.depart.latitude, props.depart.longitude]);
        if (positions.length === 0) return;
        carte.invalidateSize();
        if (positions.length === 1) carte.setView(positions[0]!, 15);
        else carte.fitBounds(L.latLngBounds(positions), { padding: [28, 28], maxZoom: 16 });
      },
    ),
  );

  return (
    <div
      ref={conteneur}
      class="ml-carte-relais relative z-0 h-64 w-full border border-ink/20 bg-paper-deep sm:h-72"
      classList={{ hidden: panne() }}
      role="region"
      aria-label={tr("livraison.carte")}
    />
  );
}
