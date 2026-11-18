/**
 * La règle qui décide si un mode de livraison sort sur le site — et, quand il
 * ne sort pas, tout ce qui lui manque pour sortir.
 *
 * Elle a sa place à elle, hors des routes, pour deux raisons. Le SITE s'en
 * sert pour filtrer, le BACK-OFFICE pour expliquer : deux versions de cette
 * règle finiraient par afficher « proposé » sur un mode que personne ne voit,
 * et on chercherait l'erreur ailleurs pendant une heure. Et parce qu'une
 * règle qu'on peut lire et essayer seule est une règle qu'on peut vérifier,
 * ce qu'un fichier de routes de trois mille lignes n'offre pas.
 */
import { CODES_NATURE, MODE_RETRAIT_STAND, nomNature } from "@memoryline/types";
import { estConfigure as mondialRelayConfigure } from "./mondial-relay.js";
import { estConfigure as colissimoConfigure } from "./colissimo.js";
import {
  expedie as sendcloudExpedie,
  gerePoints as sendcloudGerePoints,
} from "./sendcloud-points.js";

/**
 * Les transporteurs connus, et ce qu'il faut pour qu'ils fonctionnent.
 *
 * Écrit ICI et nulle part ailleurs : le back-office lit cette liste plutôt
 * que d'en tenir une copie, qui finirait par annoncer un transporteur que
 * l'API ne sait pas interroger.
 *
 * `integre` dit si le code sait chercher les points de ce réseau. Les autres
 * peuvent être préparés dès maintenant — la cliente crée le mode, fixe ses
 * tarifs — mais restent masqués du site tant que l'intégration n'est pas
 * écrite : laisser choisir un point relais qu'on ne saurait pas transmettre
 * au transporteur reviendrait à vendre une livraison impossible.
 *
 * `integre` ne concerne QUE la recherche de points : un transporteur qui
 * livre à domicile n'a rien à chercher, et le sien peut rester à faux sans
 * rien bloquer.
 *
 * `contrat` et `aupres` disent, dans les mots du transporteur, CE QU'IL FAUT
 * DEMANDER et À QUI. C'est la première question d'Alexandra devant un mode
 * décoché, et la seule réponse qu'aucun code ne peut deviner à sa place. Les
 * codes d'accès eux-mêmes ne figurent pas ici : ils se lisent dans
 * `mondial-relay.ts` et `colissimo.ts`, là où ils servent.
 */
export const TRANSPORTEURS = [
  {
    code: "mondial_relay",
    nom: "Mondial Relay",
    integre: true,
    contrat:
      "compte SendCloud : clé publique d'API (à défaut, un contrat Mondial Relay direct : code enseigne et clé privée)",
    aupres: "SendCloud, dans Paramètres › Intégrations › API",
  },
  {
    code: "colissimo",
    nom: "Colissimo (La Poste)",
    integre: true,
    contrat:
      "compte SendCloud : clés d'API (à défaut, un contrat Colissimo Entreprise : numéro de contrat et mot de passe)",
    aupres: "SendCloud, dans Paramètres › Intégrations › API",
  },
  {
    code: "chronopost",
    nom: "Chronopost",
    integre: true,
    contrat: "compte SendCloud : clés d'API",
    aupres: "SendCloud, dans Paramètres › Intégrations › API",
  },
  {
    code: "relais_colis",
    nom: "Relais Colis",
    integre: false,
    contrat: "contrat Relais Colis : numéro de client et accès à l'espace expéditeur",
    aupres: "Relais Colis, au service commercial",
  },
  {
    code: "colis_prive",
    nom: "Colis Privé",
    integre: false,
    contrat: "compte Colis Privé : numéro de client et accès à l'espace expéditeur",
    aupres: "Colis Privé, au service commercial",
  },
  {
    code: "dpd",
    nom: "DPD",
    integre: false,
    contrat: "contrat DPD France : numéro de client et accès à DPD Station",
    aupres: "DPD France, à l'agence de votre secteur",
  },
  {
    code: "gls",
    nom: "GLS",
    integre: false,
    contrat: "contrat GLS France : numéro de client et accès à GLS-One",
    aupres: "GLS France, à l'agence de votre secteur",
  },
  {
    code: "shop2shop",
    nom: "Shop2Shop (Cdiscount / Chronopost)",
    integre: true,
    contrat: "compte SendCloud : clés d'API",
    aupres: "SendCloud, dans Paramètres › Intégrations › API",
  },
  {
    code: "ups",
    nom: "UPS",
    integre: false,
    contrat: "compte UPS professionnel : numéro de compte à six caractères",
    aupres: "UPS, au service clients entreprises",
  },
  {
    code: "dhl",
    nom: "DHL Express",
    integre: false,
    contrat: "compte DHL Express : numéro de compte export",
    aupres: "DHL Express, au service clients entreprises",
  },
] as const;

/** Un transporteur sait-il chercher ses points ? */
export function transporteurConfigure(carrier: string | null | undefined): boolean {
  // Mondial Relay et Colissimo : par SendCloud, qui revend leurs étiquettes à
  // la boutique, ou en direct pour qui aurait un contrat avec eux.
  if (carrier === "colissimo") return sendcloudGerePoints(carrier) || colissimoConfigure();
  if (carrier === "mondial_relay")
    return sendcloudGerePoints(carrier) || mondialRelayConfigure();
  // Chronopost et Shop2Shop : par SendCloud seulement. Un transporteur
  // inconnu, ou connu mais pas encore intégré, répond faux : on ne prétend
  // pas savoir chercher ses points.
  return sendcloudGerePoints(carrier);
}

/**
 * Ce qu'une grille tarifaire dit d'un mode, une fois les tranches comptées.
 *
 * Les zones sont gardées une à une, et pas seulement comptées : l'écran
 * « Livraison » doit pouvoir écrire LAQUELLE attend encore un prix. « Il
 * manque un tarif » envoie ouvrir les trois grilles ; « il manque le tarif
 * Europe » se règle du premier coup.
 */
export interface CouvertureTarifaire {
  /** Zones où le mode a au moins une tranche vivante, active ou non. */
  zonesTarifees: ReadonlySet<number>;
  /** Zones où au moins une de ces tranches facture vraiment. */
  zonesActives: ReadonlySet<number>;
}

/** La couverture d'un mode qui n'a aucune tranche du tout. */
export const SANS_TARIF: CouvertureTarifaire = {
  zonesTarifees: new Set<number>(),
  zonesActives: new Set<number>(),
};

/** Le mode tel que la règle a besoin de le connaître. */
export interface ModeAExaminer {
  /** Sert à reconnaître « Retrait au stand », dont les lieux sont les stands. */
  slug?: string;
  kind: string;
  carrier: string | null;
  active: boolean;
  pickupLocation: string | null;
  archivedAt: Date | null;
}

/**
 * TOUT ce qui empêche ce mode de sortir sur le site — liste vide quand il en
 * sort.
 *
 * Elle rend une LISTE et non un seul motif : un mode préparé d'avance cumule
 * les manques — décoché, sans prix, sans compte transporteur. N'en montrer
 * qu'un obligeait à revenir trois fois pour découvrir le suivant, alors que
 * la question d'Alexandra est « qu'est-ce qu'il me reste à faire ».
 */
export function raisonsMasquage(
  m: ModeAExaminer,
  lieuxRetraitActifs: number,
  couverture: CouvertureTarifaire,
): string[] {
  // L'archivage passe AVANT tout le reste, et SEUL : un mode rangé ne sort
  // pas, et annoncer un compte Mondial Relay manquant sur un mode qu'on
  // n'offre plus enverrait chercher une panne là où il n'y en a pas.
  if (m.archivedAt) return ["Archivé : il ne sort plus du rangement."];

  const raisons: string[] = [];
  if (!m.active) raisons.push("Décoché : vous ne le proposez pas.");

  // Une nature que la liste ne connaît plus ne sait pas quoi demander au
  // client — ni adresse, ni point relais. Le mode reste donc dehors : c'est ce
  // qui arriverait à un mode « lettre suivie » restauré des archives, et une
  // commande sans adresse n'arriverait nulle part.
  if (!CODES_NATURE.includes(m.kind))
    raisons.push(
      `Nature « ${m.kind} » inconnue : ce mode ne sait plus quoi demander au client. Créez le mode à la nature voulue, et archivez celui-ci.`,
    );

  // Le prix avant le reste : c'est le manque le plus fréquent, et le seul
  // qu'Alexandra puisse lever seule, tout de suite, dans les grilles plus bas.
  if (couverture.zonesTarifees.size === 0)
    raisons.push(
      "Prix non défini : aucune tranche dans aucune zone. Remplissez sa grille plus bas — un mode sans prix afficherait 0 € de port.",
    );
  else if (couverture.zonesActives.size === 0)
    raisons.push(
      "Aucune zone active : ses tranches existent mais sont toutes retirées. Réactivez-en une dans les grilles plus bas.",
    );

  if (m.kind === "relay") {
    const t = TRANSPORTEURS.find((x) => x.code === m.carrier);
    if (!t)
      raisons.push(
        `Transporteur « ${m.carrier ?? "non renseigné"} » inconnu : la recherche de points relais est impossible.`,
      );
    else if (!t.integre)
      raisons.push(
        `L'intégration ${t.nom} n'est pas encore écrite : le client ne pourrait pas choisir son point.`,
      );
    else if (!transporteurConfigure(m.carrier))
      raisons.push(
        `Il manque le ${t.contrat} — à demander à ${t.aupres}. Sans lui, la carte des points relais reste désactivée.`,
      );
  }
  // Un retrait suppose un endroit où retirer : un lieu ACTIF de BO ›
  // Livraison › Lieux de retrait. Les stands ouverts ne comptent plus (un
  // stand est une tablette qui vend, pas un lieu de remise), ni l'ancien
  // champ « Où retirer », que la caisse n'affiche plus.
  if (m.kind === "pickup" && lieuxRetraitActifs === 0)
    raisons.push(
      m.slug === MODE_RETRAIT_STAND
        ? "Aucun stand ouvert : ce mode s'affiche tout seul dès qu'un stand ouvre (Ventes stand)."
        : "Aucun lieu de retrait actif : ajoutez-en un dans Livraison › Lieux de retrait.",
    );
  return raisons;
}

/**
 * Combien de zones chaque mode dessert, d'après les tranches VIVANTES.
 *
 * Les tranches archivées ne facturent plus rien : les compter ferait dire
 * « ce mode a un prix » à un mode dont toute la grille a été rangée.
 */
export function couverturesParMode(
  tarifs: readonly {
    methodId: number;
    zoneId: number;
    active: boolean;
    archivedAt: Date | null;
  }[],
): Map<number, CouvertureTarifaire> {
  const tarifees = new Map<number, Set<number>>();
  const actives = new Map<number, Set<number>>();
  const noter = (carte: Map<number, Set<number>>, mode: number, zone: number) => {
    const s = carte.get(mode) ?? new Set<number>();
    s.add(zone);
    carte.set(mode, s);
  };
  for (const t of tarifs) {
    if (t.archivedAt) continue;
    noter(tarifees, t.methodId, t.zoneId);
    if (t.active) noter(actives, t.methodId, t.zoneId);
  }
  const couvertures = new Map<number, CouvertureTarifaire>();
  for (const mode of new Set([...tarifees.keys(), ...actives.keys()]))
    couvertures.set(mode, {
      zonesTarifees: tarifees.get(mode) ?? new Set<number>(),
      zonesActives: actives.get(mode) ?? new Set<number>(),
    });
  return couvertures;
}

/**
 * Une ligne de la liste « ce qu'il reste à faire pour ouvrir ce mode ».
 *
 * `fait` vaut oui ou non, jamais « peut-être » : la cliente doit pouvoir
 * balayer la liste des yeux et voir ce qui reste, sans lire.
 */
export interface EtapeOuverture {
  /** Fait, ou encore à faire. */
  fait: boolean;
  /** L'action, en quelques mots. */
  titre: string;
  /** Le détail : à qui le demander, ce qui manque au juste, où le saisir. */
  detail: string;
}

/** Ce que la liste a besoin de savoir, en plus du mode lui-même. */
export interface ContexteOuverture {
  /** Les zones de livraison, pour nommer celles qui attendent un prix. */
  zones: readonly { id: number; name: string }[];
  couverture: CouvertureTarifaire;
  /** Les lieux de retrait actifs (pickup_point), pour un mode « pickup ». */
  lieuxRetraitActifs: number;
  /**
   * Les transporteurs avec lesquels la boutique expédie DÉJÀ — un de leurs
   * modes est proposé, et tarifé.
   *
   * Sert à ne pas réclamer un contrat qui existe : le jour où « À domicile
   * avec signature » est préparé, le contrat Colissimo est signé depuis des
   * mois, et l'écran n'a pas à envoyer Alexandra le redemander à La Poste.
   */
  transporteursEnService: ReadonlySet<string>;
}

/**
 * Les transporteurs dont un mode est déjà proposé ET tarifé.
 *
 * Proposé et tarifé, les deux : un mode décoché ou sans prix ne prouve rien —
 * il a pu être préparé d'avance, justement.
 */
export function transporteursEnService(
  modes: readonly (ModeAExaminer & { id: number })[],
  couvertures: ReadonlyMap<number, CouvertureTarifaire>,
): Set<string> {
  const codes = new Set<string>();
  for (const m of modes)
    if (
      !m.archivedAt &&
      m.active &&
      m.carrier &&
      (couvertures.get(m.id)?.zonesActives.size ?? 0) > 0
    )
      codes.add(m.carrier);
  return codes;
}

/**
 * TOUT ce qu'il reste à faire pour ouvrir ce mode, et tout ce qui est déjà
 * fait — l'écran « Livraison » n'a plus qu'à l'afficher.
 *
 * Pourquoi ici, et pas dans l'écran : c'est la MÊME règle que
 * `raisonsMasquage`, vue à l'endroit. L'une dit « pas visible, voilà
 * pourquoi », l'autre « voilà ce qu'il faut faire pour qu'il le soit » ; les
 * écrire à deux endroits, c'est se garantir qu'un jour l'une dira qu'il ne
 * manque rien pendant que l'autre cache le mode.
 *
 * Les lignes sont dans l'ordre où l'on s'en occupe : le contrat (qui prend des
 * semaines), le prix (qui prend cinq minutes), puis la case à cocher.
 */
export function checklistOuverture(
  m: ModeAExaminer,
  ctx: ContexteOuverture,
): EtapeOuverture[] {
  const etapes: EtapeOuverture[] = [];
  const t = TRANSPORTEURS.find((x) => x.code === m.carrier);
  // Le site ne sait vérifier un compte transporteur que dans un cas : celui
  // d'un point relais dont il interroge la carte. Partout ailleurs, il ne peut
  // que CONSTATER — un mode proposé, avec ses prix, s'expédie forcément avec
  // un contrat signé. Sans ce constat, l'écran réclamerait à Alexandra le
  // contrat Colissimo avec lequel elle expédie depuis des mois.
  const verifiable = m.kind === "relay" && Boolean(t?.integre);
  const dejaEnService = ctx.transporteursEnService.has(m.carrier ?? "");

  /* --- Le contrat transporteur ----------------------------------------- */
  if (m.carrier && !t)
    etapes.push({
      fait: false,
      titre: `Transporteur « ${m.carrier} » inconnu`,
      detail:
        "Ce transporteur ne figure pas dans la liste du site. Choisissez-en un autre au-dessus, ou demandez-nous de l'ajouter.",
    });
  // Le second cas où le site PEUT vérifier : un transporteur que SendCloud
  // expédie, et les deux clés SendCloud posées. Le compte SendCloud tient lieu
  // de contrat — ses tarifs négociés suffisent, rien à signer chez La Poste.
  else if (t && sendcloudExpedie(t.code))
    etapes.push({
      fait: true,
      titre: "Le compte SendCloud est en place",
      detail: `${t.nom} passe par SendCloud, qui fournit ${
        m.kind === "relay" ? "les points relais et " : ""
      }les bordereaux : rien à ouvrir chez le transporteur.`,
    });
  else if (t && verifiable)
    etapes.push(
      transporteurConfigure(t.code)
        ? {
            fait: true,
            titre: `Le ${t.contrat} est en place`,
            detail: "Rien à redemander : le site s'en sert déjà.",
          }
        : {
            fait: false,
            titre: `Demander le ${t.contrat}`,
            detail: `À demander à ${t.aupres}.${
              dejaEnService
                ? ` Vous expédiez déjà avec ${t.nom} : le contrat existe, ce sont les codes d'accès qui manquent — ils se réclament sur le compte que vous avez déjà.`
                : ""
            } Dès que vous nous les transmettez, nous les posons dans les réglages du site et la carte des points s'allume.`,
          },
    );
  else if (t)
    etapes.push(
      dejaEnService
        ? {
            fait: true,
            titre: `Le contrat ${t.nom} est en place`,
            detail: `Vous expédiez déjà avec ${t.nom} : un mode est proposé, avec ses prix. Rien à redemander.`,
          }
        : {
            fait: false,
            titre: `Demander le ${t.contrat}`,
            detail: `À demander à ${t.aupres}. Si vous l'avez déjà signé, passez à la suite : le site ne peut pas le voir d'ici, cette ligne restera affichée.`,
          },
    );

  /* --- L'intégration du réseau de points relais ------------------------- */
  if (m.kind === "relay") {
    const pret = Boolean(t?.integre) && transporteurConfigure(m.carrier);
    etapes.push({
      fait: pret,
      titre: pret
        ? "La carte des points relais fonctionne"
        : "Brancher la carte des points relais",
      detail: pret
        ? "Le client cherche autour de chez lui et choisit son point dans la liste."
        : t?.integre
          ? "Elle s'allumera toute seule dès que le compte ci-dessus sera en place — rien de plus à faire."
          : `Le site ne sait pas encore afficher les points ${t?.nom ?? "de ce transporteur"} : c'est un développement à prévoir de notre côté. Tant qu'il n'est pas fait, ce mode reste masqué même coché.`,
    });
  }

  /* --- Le lieu de retrait ----------------------------------------------- */
  if (m.kind === "pickup" && m.slug === MODE_RETRAIT_STAND) {
    const ou = ctx.lieuxRetraitActifs > 0;
    etapes.push({
      fait: ou,
      titre: ou ? "Un stand est ouvert" : "Ouvrir un stand",
      detail: ou
        ? `${ctx.lieuxRetraitActifs} stand${ctx.lieuxRetraitActifs > 1 ? "s" : ""} ouvert${ctx.lieuxRetraitActifs > 1 ? "s" : ""} : le client choisit où venir chercher sa commande, avec l'emplacement réglé dans Ventes stand.`
        : "Aucun stand ouvert : ce mode s'affiche tout seul à la caisse dès qu'un stand ouvre (Ventes stand).",
    });
  } else if (m.kind === "pickup") {
    const ou = ctx.lieuxRetraitActifs > 0;
    etapes.push({
      fait: ou,
      titre: ou ? "Il y a un endroit où retirer" : "Dire où retirer",
      detail: ou
        ? `${ctx.lieuxRetraitActifs} lieu${ctx.lieuxRetraitActifs > 1 ? "x" : ""} de retrait actif${ctx.lieuxRetraitActifs > 1 ? "s" : ""} : le client choisit le sien au moment de payer, avec son adresse et son texte.`
        : "Aucun lieu de retrait actif : personne ne saurait où venir chercher la commande. Ajoutez le chalet, l'atelier ou le salon dans Livraison › Lieux de retrait.",
    });
  }

  /* --- Les prix, zone par zone ------------------------------------------ */
  const avecPrix = ctx.zones.filter((z) => ctx.couverture.zonesActives.has(z.id));
  const sansPrix = ctx.zones.filter((z) => !ctx.couverture.zonesActives.has(z.id));
  // « Retirées » plutôt que « jamais saisies » : la grille existe, ses tranches
  // ont été décochées. C'est un geste à refaire, pas un tarif à retrouver.
  const retirees = sansPrix.filter((z) => ctx.couverture.zonesTarifees.has(z.id));
  etapes.push({
    fait: avecPrix.length > 0,
    titre:
      avecPrix.length > 0
        ? `Prix saisis pour : ${avecPrix.map((z) => z.name).join(", ")}`
        : "Saisir le prix",
    detail: [
      avecPrix.length === 0
        ? "Aucune zone n'a de tarif. Les prix se saisissent dans « Tarifs par poids », plus bas dans cette page — le mode n'apparaît pas tant qu'il n'a pas de prix, pour ne jamais offrir le port par accident."
        : sansPrix.length === 0
          ? "Toutes les zones ont leur tarif."
          : `Pas encore de prix pour : ${sansPrix
              .map((z) => z.name)
              .join(", ")} — le mode n'y sera simplement pas proposé, ce qui n'est pas une erreur si vous n'y livrez pas.`,
      retirees.length > 0
        ? `Des tranches existent mais ont toutes été retirées pour : ${retirees
            .map((z) => z.name)
            .join(
              ", ",
            )}. C'est voulu si vous n'y livrez pas ; sinon, rouvrez-en une dans la grille.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  });

  /* --- La case « Proposé » ---------------------------------------------- */
  etapes.push({
    fait: m.active,
    titre: m.active ? "« Proposé » est coché" : "Cocher « Proposé »",
    detail: m.active
      ? "Vous le proposez au client, dès que le reste de cette liste est fait."
      : "La dernière étape, une fois le reste réglé : la case en haut de cette fiche.",
  });

  /* --- Une nature que la liste ne connaît plus --------------------------- */
  if (!CODES_NATURE.includes(m.kind))
    etapes.push({
      fait: false,
      titre: `Nature « ${nomNature(m.kind)} » inconnue`,
      detail:
        "Ce mode ne sait plus quoi demander au client. Créez le mode à la nature voulue, puis archivez celui-ci — rien n'est perdu.",
    });

  return etapes;
}
