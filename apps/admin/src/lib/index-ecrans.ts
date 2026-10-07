/**
 * L'index des écrans du back-office et de la page d'aide, et la recherche
 * dedans.
 *
 * Il n'y a plus de liste d'écrans écrite à la main : l'ancienne, dans l'API,
 * avait pris du retard (ni « Bandeaux visuels », ni « Décors », ni
 * « Statistiques »…), et c'est pour cela que « bandeau » ne répondait que
 * « Bandeau et offre ». L'index se calcule ici, à partir du SOURCE de chaque
 * page (lib/sources-ecrans.ts), du menu (lib/menu.ts) et des mots-clés
 * (lib/synonymes-ecrans.ts). Une page ajoutée demain y entre sans rien écrire.
 *
 * Il vit dans le back-office et pas dans l'API parce que l'image de l'API ne
 * contient pas les sources du back-office.
 *
 * Module PUR : il reçoit les sources en paramètre et n'importe jamais
 * sources-ecrans.ts (le glob). Les tests le nourrissent avec les vrais
 * fichiers lus sur le disque, et avec une page factice.
 */
import type { GroupeNav } from "./menu.ts";
import {
  composantsImportes,
  extraireTextes,
  rubriquesAide,
  titreAdmin,
  type Morceau,
} from "./extraire-textes.ts";
import {
  TITRES_GROUPES,
  aplatir,
  comparer,
  correctionsServies,
  couperExtrait,
  evaluer,
  lienRecherche,
  motsDe,
  passagesUtiles,
  preparerRequete,
  texteACibler,
  type ChampEvalue,
  type Correction,
  type Evaluation,
  type GroupeRecherche,
  type OptionsRequete,
  type Passage,
  type Rang,
  type Requete,
  type ResultatRecherche,
} from "@memoryline/types/recherche";

export interface SectionEcran {
  titre: string | null;
  ancre: string | null;
  morceaux: Morceau[];
}

export interface EcranIndexe {
  /** La route du fichier : « /bandeaux-visuels », « /produits/[id] ». */
  route: string;
  /** Où mène le résultat : la route, ou pour une fiche la liste qui l'ouvre. */
  lien: string;
  titre: string;
  /** Le titre de la page (<Admin title>) quand il diffère du libellé du menu. */
  titresAussi: string[];
  groupe: string | null;
  dansLeMenu: boolean;
  fiche: boolean;
  ordre: number;
  synonymes: string[];
  sections: SectionEcran[];
}

export interface RubriqueAide {
  id: string;
  titre: string;
  morceaux: Morceau[];
}

export interface IndexEcrans {
  ecrans: EcranIndexe[];
  aide: RubriqueAide[];
  /**
   * Les mots connus des écrans, et le nombre de textes où chacun figure : de
   * quoi corriger une faute de frappe, vers le mot le plus courant.
   */
  vocabulaire: Map<string, number>;
}

/**
 * Les composants dont le texte n'appartient à aucun écran en particulier :
 * l'éditeur de texte et les tableaux de traductions sont partout, leurs
 * libellés feraient répondre vingt écrans à « gras » ou à « anglais ».
 */
const COMPOSANTS_GENERIQUES = new Set(["EditeurTexte", "Traductions", "TraductionsNoms"]);

/** La page d'aide : elle ne garde qu'une ligne d'écran, ses rubriques ont leur groupe. */
const ROUTE_AIDE = "/aide";

/* -------------------------------------------------------------------------- */
/*  Construction                                                              */
/* -------------------------------------------------------------------------- */

interface EntreeAplatie {
  href: string;
  label: string;
  groupe: string | null;
  ordre: number;
}

/** Le menu à plat, sous-entrées comprises, dans l'ordre où on le lit. */
function menuAPlat(menu: readonly GroupeNav[]): EntreeAplatie[] {
  const sortie: EntreeAplatie[] = [];
  for (const groupe of menu)
    for (const entree of groupe.entrees) {
      sortie.push({ href: entree.href, label: entree.label, groupe: groupe.titre, ordre: sortie.length });
      for (const enfant of entree.children ?? [])
        sortie.push({ href: enfant.href, label: enfant.label, groupe: groupe.titre, ordre: sortie.length });
    }
  return sortie;
}

/** « /src/pages/produits/[id].astro » → « /produits/[id] » ; index → le dossier. */
function routeDe(cle: string): string | null {
  const m = /^\/src\/pages(\/.*)\.astro$/.exec(cle);
  if (!m) return null;
  const route = m[1]!.replace(/\/index$/, "");
  return route || "/";
}

/** « categories-produits » → « Categories produits » : faute de mieux. */
function nomDeFichier(route: string): string {
  const dernier = route.split("/").filter(Boolean).pop() ?? "accueil";
  const t = dernier.replace(/[\[\]]/g, "").replace(/[-_]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Les textes d'une page regroupés par section, dans l'ordre du fichier. Un
 * titre ouvre une section ; un texte dont la section diffère de la courante
 * (l'entête, lu après le gabarit) en ouvre une autre.
 */
function regrouper(morceaux: readonly Morceau[]): SectionEcran[] {
  const sections: SectionEcran[] = [];
  let courante: SectionEcran | null = null;
  for (const m of morceaux) {
    if (m.genre === "section") {
      courante = { titre: m.texte, ancre: m.ancre, morceaux: [] };
      sections.push(courante);
      continue;
    }
    if (!courante || courante.titre !== m.section) {
      courante = { titre: m.section, ancre: null, morceaux: [] };
      sections.push(courante);
    }
    courante.morceaux.push(m);
  }
  return sections;
}

export function construireIndex(
  sources: Readonly<Record<string, string>>,
  menu: readonly GroupeNav[],
  synonymes: Readonly<Record<string, readonly string[]>>,
): IndexEcrans {
  const entrees = menuAPlat(menu);
  const parRoute = new Map(entrees.map((e) => [e.href, e]));

  const composants = new Map<string, string>();
  for (const [cle, source] of Object.entries(sources)) {
    const m = /^\/src\/components\/([\w-]+)\.astro$/.exec(cle);
    if (m) composants.set(m[1]!, source);
  }
  // Les textes d'un composant ne se lisent qu'une fois, quel que soit le
  // nombre de pages qui l'importent.
  const textesComposants = new Map<string, Morceau[]>();
  const textesDe = (nom: string): Morceau[] => {
    let t = textesComposants.get(nom);
    if (!t) {
      t = extraireTextes(composants.get(nom) ?? "");
      textesComposants.set(nom, t);
    }
    return t;
  };

  const ecrans: EcranIndexe[] = [];
  let aide: RubriqueAide[] = [];
  const horsMenu: EcranIndexe[] = [];
  const fiches: EcranIndexe[] = [];

  const cles = Object.keys(sources).sort();
  for (const cle of cles) {
    const route = routeDe(cle);
    if (!route) continue;
    const source = sources[cle] ?? "";
    const fiche = route.includes("[");
    const lien = fiche ? route.slice(0, route.lastIndexOf("/")) || "/" : route;
    const entree = parRoute.get(route);
    const titrePage = titreAdmin(source);

    // Le parent : l'entrée du menu dont la route est la plus longue à
    // préfixer celle-ci (« /produits » pour « /produits/nouveau »).
    let parent: EntreeAplatie | undefined;
    for (const e of entrees)
      if (e.href !== "/" && (lien === e.href || route.startsWith(e.href + "/")))
        if (!parent || e.href.length > parent.href.length) parent = e;

    let titre: string;
    if (entree) titre = entree.label;
    else if (fiche) titre = `${titrePage ?? parent?.label ?? nomDeFichier(lien)} (fiche)`;
    else titre = titrePage ?? nomDeFichier(route);

    const titresAussi =
      !fiche && titrePage && aplatir(titrePage) !== aplatir(titre) ? [titrePage] : [];

    let sections: SectionEcran[] = [];
    if (route === ROUTE_AIDE) {
      aide = rubriquesAide(source);
    } else {
      sections = regrouper(extraireTextes(source));
      for (const nom of composantsImportes(source))
        if (!COMPOSANTS_GENERIQUES.has(nom) && composants.has(nom))
          sections.push(...regrouper(textesDe(nom)));
    }

    const ecran: EcranIndexe = {
      route,
      lien,
      titre,
      titresAussi,
      groupe: entree?.groupe ?? parent?.groupe ?? null,
      dansLeMenu: !!entree,
      fiche,
      ordre: entree?.ordre ?? 0,
      synonymes: [...(synonymes[route] ?? [])],
      sections: sections.filter((s) => s.titre || s.morceaux.length),
    };
    ecrans.push(ecran);
    if (!entree) (fiche ? fiches : horsMenu).push(ecran);
  }

  // Le menu d'abord, dans son ordre ; puis les pages hors du menu ; puis les
  // fiches. C'est l'ordre qui départage deux écrans également bien trouvés.
  horsMenu.forEach((e, k) => (e.ordre = 100 + k));
  fiches.forEach((e, k) => (e.ordre = 200 + k));
  ecrans.sort((a, b) => a.ordre - b.ordre);

  const vocabulaire = new Map<string, number>();
  const noter = (texte: string | null | undefined) => {
    if (texte) for (const mot of motsDe(texte)) vocabulaire.set(mot, (vocabulaire.get(mot) ?? 0) + 1);
  };
  for (const e of ecrans) {
    noter(e.titre);
    e.titresAussi.forEach(noter);
    noter(e.groupe);
    e.synonymes.forEach(noter);
    for (const s of e.sections) {
      noter(s.titre);
      for (const m of s.morceaux) noter(m.texte);
    }
  }
  for (const r of aide) {
    noter(r.titre);
    for (const m of r.morceaux) noter(m.texte);
  }

  return { ecrans, aide, vocabulaire };
}

/* -------------------------------------------------------------------------- */
/*  Les lignes à évaluer, préparées une fois par index                        */
/* -------------------------------------------------------------------------- */

/** Ce qu'est un champ d'une ligne : de quoi dire « où » et « vers où ». */
type RoleChamp =
  | { role: "titre" }
  | { role: "aussi"; texte: string }
  | { role: "synonyme"; texte: string }
  | { role: "groupe" }
  | { role: "contexte" }
  | { role: "section" }
  | { role: "morceau"; morceau: Morceau };

interface Champ extends ChampEvalue {
  plat: string;
  sens: RoleChamp;
}

interface Ligne {
  id: string;
  ecran: EcranIndexe | null;
  rubrique: RubriqueAide | null;
  section: SectionEcran | null;
  champs: Champ[];
}

interface Lignes {
  noms: Ligne[];
  sections: Ligne[];
  aide: Ligne[];
}

/** Poids des champs : menu 6 > titre 5 > fiche ou mot-clé 4 > section 3 > libellé 2 > aide 1. */
const POIDS = { menu: 6, horsMenu: 5, fiche: 4, synonyme: 4, section: 3, libelle: 2, aide: 1, groupe: 1, contexte: 0 };

const champ = (texte: string, poids: number, sens: RoleChamp): Champ => ({
  texte,
  plat: aplatir(texte),
  poids,
  sens,
});

const PREPAREES = new WeakMap<IndexEcrans, Lignes>();

function lignesDe(index: IndexEcrans): Lignes {
  const connues = PREPAREES.get(index);
  if (connues) return connues;
  const lignes: Lignes = { noms: [], sections: [], aide: [] };
  for (const e of index.ecrans) {
    const poidsTitre = e.dansLeMenu ? POIDS.menu : e.fiche ? POIDS.fiche : POIDS.horsMenu;
    // Un nom d'écran peut se taper en sigle (voir ChampEvalue.sigles) ; pas
    // une rubrique d'aide, dont le titre est une phrase.
    const nom: Champ[] = [{ ...champ(e.titre, poidsTitre, { role: "titre" }), sigles: true }];
    for (const t of e.titresAussi) nom.push({ ...champ(t, poidsTitre - 1, { role: "aussi", texte: t }), sigles: true });
    for (const s of e.synonymes) nom.push(champ(s, POIDS.synonyme, { role: "synonyme", texte: s }));
    if (e.groupe) nom.push(champ(e.groupe, POIDS.groupe, { role: "groupe" }));
    lignes.noms.push({ id: `ecran:${e.route}`, ecran: e, rubrique: null, section: null, champs: nom });

    e.sections.forEach((s, k) => {
      // Le nom de l'écran est là pour le CONTEXTE (poids 0, champ neutre) :
      // « bandeau couleur » trouve la section « Couleur » de l'écran Bandeau…
      // mais une section ne répond jamais par le seul nom de son écran, la
      // ligne du nom s'en charge (voir ChampEvalue.neutre).
      const champs: Champ[] = [{ ...champ(e.titre, POIDS.contexte, { role: "contexte" }), neutre: true }];
      if (s.titre) champs.push(champ(s.titre, POIDS.section, { role: "section" }));
      for (const m of s.morceaux)
        champs.push(champ(m.texte, m.genre === "libelle" ? POIDS.libelle : POIDS.aide, { role: "morceau", morceau: m }));
      lignes.sections.push({ id: `ecran:${e.route}§${k}`, ecran: e, rubrique: null, section: s, champs });
    });
  }
  for (const r of index.aide) {
    const champs: Champ[] = [champ(r.titre, 5, { role: "titre" })];
    for (const m of r.morceaux) champs.push(champ(m.texte, POIDS.aide, { role: "morceau", morceau: m }));
    lignes.aide.push({ id: `aide:${r.id}`, ecran: null, rubrique: r, section: null, champs });
  }
  PREPAREES.set(index, lignes);
  return lignes;
}

/* -------------------------------------------------------------------------- */
/*  Recherche                                                                 */
/* -------------------------------------------------------------------------- */

interface Trouvee {
  ligne: Ligne;
  ev: Evaluation;
  rang: Rang;
  /** Le poids qui classe : voir classer(). */
  poids: number;
  motsEntiers: number;
  ordre: number;
}

/** Le mot tapé (et non son singulier) commence-t-il un mot de ce texte ? */
function commenceUnMot(plat: string, mot: string): boolean {
  return plat.startsWith(mot) || plat.includes(" " + mot);
}

/**
 * Le rang et le poids qui classent une ligne.
 *
 *   - « Exact » est réservé au NOM d'un écran (ou à un mot-clé, au titre d'une
 *     rubrique) : un libellé de tableau qui s'appelle tout bonnement
 *     « Bandeau » ne doit pas passer devant l'écran « Bandeau et offre ».
 *   - Le poids est celui du champ le plus lourd qui a répondu (un écran
 *     trouvé par son titre ET par son groupe compte comme trouvé par son
 *     titre), multiplié par cent pour laisser la place à deux départages :
 *     d'abord la saisie de plusieurs mots retrouvée TELLE QUELLE dans un
 *     champ (« mot de passe » : « Nouveau mot de passe » passe devant une
 *     section où « mot », « de » et « passe » sont éparpillés, comme l'API le
 *     fait de son côté) ; puis un point par mot retrouvé TEL QU'IL EST TAPÉ.
 *     « bandeaux » met ainsi « Bandeaux visuels » devant « Bandeau et
 *     offre », que le singulier trouve aussi.
 */
function classer(ligne: Ligne, ev: Evaluation, requete: Requete, exactPermis: (i: number) => boolean): { rang: Rang; poids: number } {
  let rang = ev.rang;
  if (rang === 0) {
    const exact = ligne.champs.some((c, i) => exactPermis(i) && c.plat === requete.plat);
    if (!exact) rang = 1;
  }
  let poids = 0;
  ligne.champs.forEach((c, i) => {
    if ((ev.passages[i]?.length ?? 0) > 0 && c.poids > poids) poids = c.poids;
  });
  let telsQuels = 0;
  for (const j of requete.jetons)
    if (ligne.champs.some((c, i) => c.poids > 0 && (ev.passages[i]?.length ?? 0) > 0 && commenceUnMot(c.plat, j.mot)))
      telsQuels++;
  const expression =
    requete.jetons.length >= 2 &&
    !!requete.plat &&
    ligne.champs.some((c) => c.poids > 0 && commenceUnMot(c.plat, requete.plat));
  return { rang, poids: poids * 100 + (expression ? 50 : 0) + telsQuels };
}

/**
 * Le passage à transporter vers l'écran (texteACibler : jamais un « de »
 * seul, ni un mot vide), et jamais à cheval sur un « … » — une valeur
 * calculée, que l'écran remplace par autre chose.
 */
function cibleDe(texte: string, passages: readonly Passage[]): string {
  const p = texteACibler(texte, passages);
  if (!p.includes("…")) return p;
  const premier = passagesUtiles(passages).sort((a, b) => a.debut - b.debut)[0];
  const seul = premier ? texte.slice(premier.debut, premier.fin).trim() : "";
  return seul ? texteACibler(seul, [{ debut: 0, fin: seul.length }]) : "";
}

/** Une ligne plus longue que ça se lit mal dans « où » : on la coupe. */
function court(texte: string, max = 60): string {
  return texte.length <= max ? texte : texte.slice(0, max - 1).trimEnd() + "…";
}

function detailEcran(e: EcranIndexe): string | null {
  if (e.fiche) return "Fiche : s'ouvre depuis la liste";
  if (!e.dansLeMenu) return "Hors du menu";
  return e.groupe;
}

function resultatNom(t: Trouvee): ResultatRecherche {
  const e = t.ligne.ecran!;
  const meilleur = t.ligne.champs[t.ev.meilleur]!;
  let ou: string | null = null;
  if (meilleur.sens.role === "synonyme") ou = `mot-clé « ${meilleur.sens.texte} »`;
  else if (meilleur.sens.role === "aussi") ou = `aussi appelé « ${meilleur.sens.texte} »`;
  return {
    id: t.ligne.id,
    nature: "Écran",
    titre: e.titre,
    titrePassages: t.ev.passages[0] ?? [],
    ou,
    detail: detailEcran(e),
    extrait: null,
    href: lienRecherche(e.lien),
    image: null,
    rang: t.rang,
  };
}

/**
 * Le champ d'une section qui porte le passage : celui qu'`evaluer` a choisi
 * (jamais le nom de l'écran, champ neutre), sauf s'il n'a trouvé que des
 * mots courts (« du », « de ») alors qu'un autre champ de la ligne porte un
 * passage qui dit quelque chose — c'est lui qu'on montre et qu'on cherche.
 */
function champDeLaSection(t: Trouvee): number {
  const utilesDans = (i: number) => (t.ev.passages[i] ?? []).filter((p) => p.fin - p.debut >= 3).length;
  if (utilesDans(t.ev.meilleur) > 0) return t.ev.meilleur;
  let choix = t.ev.meilleur;
  let meilleurs = 0;
  for (let i = 1; i < t.ligne.champs.length; i++) {
    const n = utilesDans(i);
    if (n > meilleurs || (n === meilleurs && n > 0 && t.ligne.champs[i]!.poids > t.ligne.champs[choix]!.poids)) {
      choix = i;
      meilleurs = n;
    }
  }
  return choix;
}

function resultatSection(t: Trouvee): ResultatRecherche {
  const e = t.ligne.ecran!;
  const s = t.ligne.section!;
  const indice = champDeLaSection(t);
  const meilleur = t.ligne.champs[indice]!;
  const passages = t.ev.passages[indice] ?? [];
  let ou: string | null = s.titre;
  let extrait: ResultatRecherche["extrait"] = null;
  let ancre = s.ancre;
  // Un texte qui ne s'affiche pas (une infobulle, un texte pour lecteur
  // d'écran) : l'écran s'ouvre sur son ancre, sans rien chercher — le script
  // d'arrivée ne lit que le texte affiché et la valeur des champs.
  let cache = false;
  if (meilleur.sens.role === "morceau") {
    const m = meilleur.sens.morceau;
    if (m.genre === "libelle") ou = [s.titre, court(m.texte)].filter(Boolean).join(" › ") || null;
    extrait = couperExtrait(m.texte, passagesUtiles(passages));
    ancre = m.ancre ?? s.ancre;
    cache = m.origine === "attribut";
  }
  // Une fiche (« /produits/[id] ») ne s'ouvre pas sans son numéro : le
  // résultat mène à la liste qui l'ouvre, sans passage à chercher.
  const href = e.fiche
    ? lienRecherche(e.lien)
    : lienRecherche(e.route, {
        trouver: cache ? undefined : cibleDe(meilleur.texte, passages),
        ancre: ancre ?? undefined,
      });
  return {
    id: t.ligne.id,
    nature: "Écran",
    titre: e.titre,
    titrePassages: t.ev.passages[0] ?? [],
    ou,
    detail: detailEcran(e),
    extrait,
    href,
    image: null,
    rang: t.rang,
  };
}

function resultatAide(t: Trouvee): ResultatRecherche {
  const r = t.ligne.rubrique!;
  const meilleur = t.ligne.champs[t.ev.meilleur]!;
  const passages = t.ev.passages[t.ev.meilleur] ?? [];
  const dansLeTitre = meilleur.sens.role === "titre";
  const cache = meilleur.sens.role === "morceau" && meilleur.sens.morceau.origine === "attribut";
  return {
    id: t.ligne.id,
    nature: "Aide",
    titre: r.titre,
    titrePassages: t.ev.passages[0] ?? [],
    ou: null,
    detail: null,
    extrait: dansLeTitre ? null : couperExtrait(meilleur.texte, passagesUtiles(passages)),
    // Le titre trouvé : l'ancre ordinaire suffit, aide.astro ouvre déjà la
    // rubrique désignée par « #id » (et le script d'arrivée, si l'on est
    // déjà sur l'aide). Un passage du corps : le script d'arrivée le cherche
    // dans la rubrique.
    href: dansLeTitre
      ? `${lienRecherche(ROUTE_AIDE)}#${encodeURIComponent(r.id)}`
      : lienRecherche(ROUTE_AIDE, {
          trouver: cache ? undefined : cibleDe(meilleur.texte, passages),
          ancre: r.id,
        }),
    image: null,
    rang: t.rang,
  };
}

/**
 * Les mots tapés que les écrans connaissent tels quels. Le back-office les
 * passe à l'API (paramètre « connus ») : elle ne les corrige pas. Sans cela,
 * « vidéo » devenait « vider » côté données, alors que l'écran Accueil et
 * pied de page parle de la vidéo.
 */
export function motsConnusDesEcrans(index: IndexEcrans, saisie: string): string[] {
  return preparerRequete(saisie, index.vocabulaire)
    .jetons.filter((j) => j.connu && /^\p{L}{3,}$/u.test(j.mot))
    .map((j) => j.mot);
}

export interface ReponseIndex {
  ecrans: GroupeRecherche | null;
  aide: GroupeRecherche | null;
  /** Les corrections qui ont RÉELLEMENT servi (Evaluation.approches). */
  corrections: Correction[];
  /**
   * Le premier écran répond par son PROPRE nom (le libellé du menu ou le
   * titre de la page), pas par un mot-clé ni par une section : c'est ce qui
   * l'autorise, à égalité de rang avec les données, à passer en tête
   * (recherche-bo.ts).
   */
  premierParSonNom: boolean;
}

/**
 * Les écrans et les rubriques d'aide qui répondent à la saisie.
 *
 * Une ligne par écran pour son NOM, puis une par section ; trois au plus par
 * écran, pour qu'un écran bavard (la fiche commande) ne remplisse pas le
 * panneau à lui seul.
 *
 * `options` (voir OptionsRequete) : `connus`, les mots que les DONNÉES ont
 * trouvés tels quels et qu'il ne faut donc pas corriger ici (« montagne »
 * n'est pas « montant » : huit affiches s'appellent ainsi) ; `forcer`, le
 * repli quand ni les données ni les écrans n'ont rien trouvé.
 */
export function chercherDansIndex(
  index: IndexEcrans,
  saisie: string,
  limite: number,
  options: Pick<OptionsRequete, "connus" | "forcer"> = {},
): ReponseIndex {
  const requete = preparerRequete(saisie, index.vocabulaire, options);
  if (!requete.jetons.length) return { ecrans: null, aide: null, corrections: [], premierParSonNom: false };
  const lignes = lignesDe(index);
  const servies: Correction[][] = [];

  const evaluerLigne = (ligne: Ligne, ordre: number, exactPermis: (i: number) => boolean): Trouvee | null => {
    // Une section ne répond pas par le seul nom de son écran : c'est un champ
    // neutre, `evaluer` l'écarte.
    const ev = evaluer(ligne.champs, requete);
    if (!ev) return null;
    const { rang, poids } = classer(ligne, ev, requete, exactPermis);
    return { ligne, ev, rang, poids, motsEntiers: ev.motsEntiers, ordre };
  };
  const noterCorrections = (t: Trouvee) => servies.push(t.ev.approches ?? []);

  // Les écrans : le nom, puis les sections, trois lignes au plus par écran.
  const parEcran = new Map<string, Trouvee[]>();
  for (const ligne of lignes.noms) {
    const t = evaluerLigne(ligne, ligne.ecran!.ordre, (i) => ligne.champs[i]!.sens.role !== "groupe");
    if (t) parEcran.set(ligne.ecran!.route, [t]);
  }
  lignes.sections.forEach((ligne, k) => {
    const t = evaluerLigne(ligne, ligne.ecran!.ordre + k / 100000, () => false);
    if (!t) return;
    const liste = parEcran.get(ligne.ecran!.route) ?? [];
    liste.push(t);
    parEcran.set(ligne.ecran!.route, liste);
  });
  const retenues: Trouvee[] = [];
  for (const liste of parEcran.values()) retenues.push(...liste.sort(comparer).slice(0, 3));
  retenues.sort(comparer);
  retenues.forEach(noterCorrections);

  const aide: Trouvee[] = [];
  lignes.aide.forEach((ligne, k) => {
    const t = evaluerLigne(ligne, k, (i) => i === 0);
    if (t) aide.push(t);
  });
  aide.sort(comparer);
  aide.forEach(noterCorrections);

  const premier = retenues[0];
  const sensPremier = premier && !premier.ligne.section ? premier.ligne.champs[premier.ev.meilleur]?.sens.role : null;
  const premierParSonNom = sensPremier === "titre" || sensPremier === "aussi";

  const ecrans: GroupeRecherche | null = retenues.length
    ? {
        id: "ecrans",
        titre: TITRES_GROUPES.ecrans,
        total: retenues.length,
        plafonne: false,
        resultats: retenues
          .slice(0, limite)
          .map((t) => (t.ligne.section ? resultatSection(t) : resultatNom(t))),
      }
    : null;
  const groupeAide: GroupeRecherche | null = aide.length
    ? {
        id: "aide",
        titre: TITRES_GROUPES.aide,
        total: aide.length,
        plafonne: false,
        resultats: aide.slice(0, limite).map(resultatAide),
      }
    : null;

  // Une correction ne s'annonce que si elle a servi, et c'est celle-là qu'on
  // annonce : « Résultats approchés pour … » au-dessus de résultats trouvés
  // tels quels serait une fausse alerte.
  return { ecrans, aide: groupeAide, corrections: correctionsServies(servies), premierParSonNom };
}
