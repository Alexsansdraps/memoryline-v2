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
import { CODES_NATURE, nomNature } from "@memoryline/types";
import { estConfigure as mondialRelayConfigure } from "./mondial-relay.js";
import { estConfigure as colissimoConfigure } from "./colissimo.js";

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
    contrat: "compte Mondial Relay : code enseigne, code marque et clé privée",
    aupres: "Mondial Relay, dans votre espace marchand",
  },
  {
    code: "colissimo",
    nom: "Colissimo (La Poste)",
    integre: true,
    contrat: "contrat Colissimo Entreprise : numéro de contrat et mot de passe",
    aupres: "La Poste, auprès de votre conseiller Colissimo Entreprise",
  },
  {
    code: "chronopost",
    nom: "Chronopost",
    integre: false,
    contrat: "compte Chronopost : numéro de compte et identifiants d'expédition",
    aupres: "Chronopost, au service commercial",
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
    integre: false,
    contrat: "compte Shop2Shop professionnel : identifiant d'expéditeur",
    aupres: "Shop2Shop, sur leur espace professionnel",
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

/**
 * Les libellés courts que le back-office proposait AVANT que cette liste
 * existe, et qui dorment encore dans la colonne `carrier` d'expéditions
 * parties depuis longtemps. Les reconnaître évite de faire disparaître le
 * lien de suivi d'un colis de l'an dernier.
 */
const LIBELLES_ANCIENS = new Map<string, string>([
  ["colissimo", "colissimo"],
  ["la poste", "colissimo"],
  ["dhl", "dhl"],
]);

/** Casse, accents et espaces mis de côté : « Colissimo » = « colissimo ». */
function aplatir(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Le CODE d'un transporteur, retrouvé depuis un libellé écrit à la main.
 *
 * La colonne `carrier` d'une expédition porte un LIBELLÉ — « Colissimo (La
 * Poste) », ou ce qu'Alexandra a tapé —, jamais un code. Pour en déduire quoi
 * que ce soit, un lien de suivi par exemple, il faut donc retraverser cette
 * liste, et la retraverser EXACTEMENT.
 *
 * Exactement, parce qu'une reconnaissance par morceaux de texte prenait
 * « Shop2Shop (Cdiscount / Chronopost) » pour du Chronopost, et fabriquait à
 * la cliente un lien qui ne suivrait jamais son colis. Un libellé qu'on ne
 * reconnaît pas rend donc `null`, et l'appelant n'en tire rien : c'est le
 * seul défaut acceptable ici.
 */
export function codeDuTransporteur(
  libelle: string | null | undefined,
): string | null {
  const l = aplatir(String(libelle ?? ""));
  if (!l) return null;
  const parNom = TRANSPORTEURS.find((t) => aplatir(t.nom) === l);
  if (parNom) return parNom.code;
  // Le code machine écrit tel quel, par un script ou une reprise de données.
  const parCode = TRANSPORTEURS.find((t) => t.code === l);
  if (parCode) return parCode.code;
  return LIBELLES_ANCIENS.get(l) ?? null;
}

/** Un transporteur sait-il chercher ses points ? */
export function transporteurConfigure(carrier: string | null | undefined): boolean {
  if (carrier === "colissimo") return colissimoConfigure();
  if (carrier === "mondial_relay") return mondialRelayConfigure();
  // Transporteur inconnu, ou connu mais pas encore intégré : on ne prétend
  // pas savoir chercher ses points.
  return false;
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
  standsOuverts: number,
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
        `Il manque le ${t.contrat} — à demander à ${t.aupres}. Sans lui, la carte des points relais reste éteinte.`,
      );
  }
  if (m.kind === "pickup" && standsOuverts === 0 && !m.pickupLocation?.trim())
    raisons.push(
      "Aucun stand ouvert et aucun lieu de retrait renseigné : personne ne pourrait remettre la commande.",
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
  standsOuverts: number;
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
            } Ces codes-là passent encore par nous : transmettez-les-nous, nous les posons dans la configuration du serveur et la carte des points s'allume. Vos clés SendCloud, elles, ne s'envoient à personne — vous les collez vous-même dans l'écran Livraison.`,
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
  if (m.kind === "pickup") {
    const ou = ctx.standsOuverts > 0 || Boolean(m.pickupLocation?.trim());
    etapes.push({
      fait: ou,
      titre: ou ? "Il y a un endroit où retirer" : "Dire où retirer",
      detail: ou
        ? ctx.standsOuverts > 0
          ? `${ctx.standsOuverts} stand(s) ouvert(s) : le client les voit par leur nom au moment de payer.`
          : "Le lieu de retrait est renseigné au-dessus."
        : "Aucun stand ouvert et aucun lieu renseigné : personne ne pourrait remettre la commande. Ouvrez un stand dans « Ventes stand », ou écrivez le lieu au-dessus.",
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
