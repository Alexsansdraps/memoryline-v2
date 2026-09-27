/**
 * Le fuseau de la boutique — partagé entre l'API, le back-office et le site.
 *
 * POURQUOI CE FICHIER EXISTE. Les serveurs tournent en temps universel, la
 * boutique vit à Paris, et l'écart est de deux heures l'été. Tant que le code
 * se contentait d'écrire `toLocaleString("fr-FR")`, il demandait l'heure AU
 * CONTENEUR : une commande passée à 16 h 40 s'affichait « 14:40 », et un filtre
 * « depuis le 10 » commençait en réalité le 10 à 2 h du matin — les commandes
 * de la nuit disparaissaient de la liste.
 *
 * Les conteneurs portent désormais `TZ=Europe/Paris` (docker-compose.yml et
 * docker-compose.prod.yml). CE N'EST PAS SUFFISANT, et c'est tout l'objet de ce
 * fichier : un conteneur relancé à la main, un script lancé de côté, une
 * machine de secours montée dans l'urgence, et l'heure se remet à mentir sans
 * que rien ne casse — c'est la panne la plus coûteuse qui soit, celle qui ne
 * se voit pas. Chaque affichage et chaque borne de période NOMMENT donc leur
 * fuseau, et la variable d'environnement ne fait plus que confirmer.
 *
 * LE PIÈGE À NE JAMAIS OUBLIER : le double décalage. Une valeur déjà exprimée
 * en heure de Paris — un jour civil « 2026-09-10 » sorti d'un `group by` que
 * Postgres a découpé à Paris — ne doit SURTOUT PAS repasser par ici. La
 * décaler une seconde fois la ferait changer de jour, et un chiffre juste
 * deviendrait faux. Ces jours-là se formatent avec {@link FUSEAU_JOUR_CIVIL}.
 *
 * La base, elle, n'a jamais menti : ses 88 colonnes de date sont des
 * `timestamptz`, c'est-à-dire des instants absolus. Rien de ce qui suit ne la
 * concerne — on ne corrige ici que la lecture humaine de ces instants.
 */

/** Le fuseau qui fait foi : celui de la boutique, et de ses clients. */
export const FUSEAU_BOUTIQUE = "Europe/Paris";

/**
 * Le fuseau à employer pour un JOUR CIVIL déjà calculé (« 2026-09-10 »).
 *
 * `new Date("2026-09-10")` place le jour à minuit UTC. Le relire en UTC le
 * rend tel qu'il a été écrit ; le relire à Paris le ferait glisser d'un jour
 * dès qu'un fuseau est en retard sur Greenwich. Ce n'est pas une contradiction
 * avec le reste du fichier : ces valeurs-là ne sont pas des instants, ce sont
 * des dates de calendrier que quelqu'un a déjà découpées à l'heure de Paris.
 */
export const FUSEAU_JOUR_CIVIL = "UTC";

/** Les parties d'un instant, lues dans un fuseau donné. */
export interface PartiesDeDate {
  annee: number;
  mois: number;
  jour: number;
  heures: number;
  minutes: number;
  secondes: number;
}

/**
 * Le lecteur d'horloge, fabriqué une fois par fuseau.
 *
 * `Intl.DateTimeFormat` coûte cher à construire — quelques dixièmes de
 * milliseconde — et la liste des commandes en demande une par ligne. On garde
 * donc le même objet : c'est ce qui rend ce fichier utilisable dans une
 * boucle sans y penser.
 */
const horloges = new Map<string, Intl.DateTimeFormat>();

function horloge(fuseau: string): Intl.DateTimeFormat {
  let existante = horloges.get(fuseau);
  if (!existante) {
    existante = new Intl.DateTimeFormat("en-US", {
      timeZone: fuseau,
      // `hourCycle: "h23"` et non `hour12: false` : selon les versions, la
      // seconde forme rend « 24 » pour minuit, et minuit devenait 24 h du
      // jour précédent — exactement le genre de décalage qu'on traque ici.
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    horloges.set(fuseau, existante);
  }
  return existante;
}

/** L'instant, tel qu'une horloge murale du fuseau l'affiche. */
export function partiesDansLeFuseau(
  instant: Date,
  fuseau: string = FUSEAU_BOUTIQUE,
): PartiesDeDate {
  const morceaux: Record<string, string> = {};
  for (const p of horloge(fuseau).formatToParts(instant))
    if (p.type !== "literal") morceaux[p.type] = p.value;
  return {
    annee: Number(morceaux.year),
    mois: Number(morceaux.month),
    jour: Number(morceaux.day),
    heures: Number(morceaux.hour),
    minutes: Number(morceaux.minute),
    secondes: Number(morceaux.second),
  };
}

/**
 * L'écart du fuseau avec le temps universel, en minutes, À CET INSTANT-LÀ.
 *
 * Il change deux fois par an — +120 l'été, +60 l'hiver — et c'est pourquoi on
 * ne peut pas écrire « +2 h » une bonne fois quelque part : une période à
 * cheval sur le dernier dimanche d'octobre serait fausse d'une heure d'un
 * côté.
 */
function decalageMinutes(instant: Date, fuseau: string): number {
  const p = partiesDansLeFuseau(instant, fuseau);
  const commeSiUTC = Date.UTC(
    p.annee,
    p.mois - 1,
    p.jour,
    p.heures,
    p.minutes,
    p.secondes,
  );
  // Les millisecondes sont retirées des deux côtés : l'horloge ci-dessus
  // s'arrête à la seconde, et les comparer ferait apparaître un écart d'une
  // minute une fois sur mille.
  const instantALaSeconde = Math.floor(instant.getTime() / 1000) * 1000;
  return (commeSiUTC - instantALaSeconde) / 60000;
}

/** Deux chiffres, pour écrire un mois ou un jour. */
const deuxChiffres = (n: number): string => String(n).padStart(2, "0");

/**
 * Le JOUR de la boutique, « 2026-09-10 » : celui du calendrier accroché au
 * mur de l'atelier, pas celui du serveur.
 */
export function jourDansLeFuseau(
  instant: Date,
  fuseau: string = FUSEAU_BOUTIQUE,
): string {
  const p = partiesDansLeFuseau(instant, fuseau);
  return `${p.annee}-${deuxChiffres(p.mois)}-${deuxChiffres(p.jour)}`;
}

/**
 * Le jour de la boutique situé `decalage` jours avant (négatif) ou après
 * (positif) celui d'un instant. `jourDecale(new Date(), -6)` rend le premier
 * jour d'une fenêtre de sept jours.
 *
 * POURQUOI CETTE FONCTION EXISTE, et pourquoi on n'écrit plus
 * `jourDansLeFuseau(new Date(t - n * 86400000))`. Depuis que les journées se
 * découpent à Paris, deux d'entre elles par an ne durent pas 24 h : 25 h le
 * dernier dimanche d'octobre, 23 h le dernier de mars. Reculer par bonds FIXES
 * de 24 h puis convertir chaque bond en jour de Paris ne rend alors plus une
 * suite de jours distincts — mesuré : une fenêtre finissant le 27 octobre 2026
 * à 23 h 30 sortait le 25 octobre DEUX FOIS et perdait le 19, et une fenêtre
 * finissant le 31 mars 2027 à 0 h 30 faisait disparaître le 28 mars. Sur une
 * courbe, c'est une journée de ventes dessinée deux fois, ou effacée.
 *
 * On se déplace donc sur le CALENDRIER, où « la veille » veut toujours dire
 * « le numéro d'avant ». L'ancre est posée à MIDI en temps universel : toutes
 * les journées universelles font 24 h, l'arithmétique y est donc exacte, et
 * midi laisse douze heures de marge de part et d'autre. Le résultat se relit
 * en {@link FUSEAU_JOUR_CIVIL}, puisque l'ancre n'est plus un instant mais une
 * date de calendrier.
 */
export function jourDecale(
  instant: Date,
  decalage: number,
  fuseau: string = FUSEAU_BOUTIQUE,
): string {
  const p = partiesDansLeFuseau(instant, fuseau);
  const ancre = Date.UTC(p.annee, p.mois - 1, p.jour, 12);
  return jourDansLeFuseau(
    new Date(ancre + decalage * 86400000),
    FUSEAU_JOUR_CIVIL,
  );
}

/**
 * L'ANNÉE de la boutique. Elle sert à numéroter les factures : une facture
 * éditée le 31 décembre à 23 h 30 appartient à l'année qui s'achève, et un
 * serveur en temps universel la datait de l'année suivante — un numéro qui,
 * lui, ne se reprend pas.
 */
export function anneeDansLeFuseau(
  instant: Date,
  fuseau: string = FUSEAU_BOUTIQUE,
): number {
  return partiesDansLeFuseau(instant, fuseau).annee;
}

/**
 * L'instant précis où une heure de PENDULE sonne dans le fuseau.
 *
 * Deux passes, et les deux sont nécessaires. La première suppose l'écart de
 * l'instant approché ; la seconde le reprend à l'instant trouvé. Sans elle,
 * une date posée la nuit du changement d'heure se décalerait d'une heure —
 * une fois par an, sur une poignée de commandes, donc jamais reproductible
 * quand on la cherche.
 */
function instantDeLHeureLocale(
  annee: number,
  mois: number,
  jour: number,
  heures: number,
  minutes: number,
  secondes: number,
  millisecondes: number,
  fuseau: string,
): Date {
  const pendule = Date.UTC(
    annee,
    mois - 1,
    jour,
    heures,
    minutes,
    secondes,
    millisecondes,
  );
  const premierEssai = pendule - decalageMinutes(new Date(pendule), fuseau) * 60000;
  return new Date(
    pendule - decalageMinutes(new Date(premierEssai), fuseau) * 60000,
  );
}

/** Un jour écrit « 2026-09-10 », découpé. `null` si la forme n'y est pas. */
function morceauxDuJour(
  jourISO: string,
): { annee: number; mois: number; jour: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(jourISO.trim());
  if (!m) return null;
  const annee = Number(m[1]);
  const mois = Number(m[2]);
  const jour = Number(m[3]);
  // « 2026-02-31 » se lit sans broncher en JavaScript et donne le 3 mars. Une
  // date que le calendrier ne contient pas est refusée, plutôt que remplacée
  // en silence par une autre que personne n'a demandée.
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return null;
  return { annee, mois, jour };
}

/**
 * Le PREMIER instant d'un jour, à l'heure de la boutique.
 *
 * C'est la borne de gauche de tous les filtres par dates : « depuis le 10 »
 * commence le 10 à 0 h 00 rue de la boutique, et non à 2 h du matin comme le
 * faisait un serveur en temps universel. C'est cette ligne-là qui perdait les
 * commandes de la nuit.
 */
export function debutDuJour(
  jourISO: string,
  fuseau: string = FUSEAU_BOUTIQUE,
): Date | null {
  const m = morceauxDuJour(jourISO);
  if (!m) return null;
  const instant = instantDeLHeureLocale(
    m.annee,
    m.mois,
    m.jour,
    0,
    0,
    0,
    0,
    fuseau,
  );
  return memeJour(instant, m, fuseau) ? instant : null;
}

/**
 * Le DERNIER instant d'un jour, à l'heure de la boutique.
 *
 * « Jusqu'au 12 » comprend la journée du 12 tout entière : prise à minuit, la
 * borne retirerait au filtre la journée qu'on venait de lui demander.
 */
export function finDuJour(
  jourISO: string,
  fuseau: string = FUSEAU_BOUTIQUE,
): Date | null {
  const m = morceauxDuJour(jourISO);
  if (!m) return null;
  const instant = instantDeLHeureLocale(
    m.annee,
    m.mois,
    m.jour,
    23,
    59,
    59,
    999,
    fuseau,
  );
  return memeJour(instant, m, fuseau) ? instant : null;
}

/** L'instant retombe-t-il bien sur le jour demandé ? (cf. « 2026-02-31 ») */
function memeJour(
  instant: Date,
  attendu: { annee: number; mois: number; jour: number },
  fuseau: string,
): boolean {
  const p = partiesDansLeFuseau(instant, fuseau);
  return (
    p.annee === attendu.annee &&
    p.mois === attendu.mois &&
    p.jour === attendu.jour
  );
}

/**
 * Un instant vers la valeur d'un champ `<input type="datetime-local">`, qui
 * n'accepte aucun fuseau et affiche donc ce qu'on lui donne, tel quel.
 *
 * Écrit à l'heure de Paris, il montre à la propriétaire l'heure qu'elle a en
 * tête. Il forme une PAIRE avec {@link instantDepuisChampLocal} : les deux
 * doivent lire le même fuseau, sinon une date enregistrée ressort décalée à
 * chaque aller-retour, et dérive un peu plus à chaque enregistrement.
 */
export function champLocalDepuisInstant(
  instant: Date,
  fuseau: string = FUSEAU_BOUTIQUE,
): string {
  const p = partiesDansLeFuseau(instant, fuseau);
  return (
    `${p.annee}-${deuxChiffres(p.mois)}-${deuxChiffres(p.jour)}` +
    `T${deuxChiffres(p.heures)}:${deuxChiffres(p.minutes)}`
  );
}

/**
 * La valeur d'un champ `datetime-local` (« 2026-12-24T18:00 ») vers l'instant
 * qu'elle désigne à Paris. `null` si la saisie ne se lit pas.
 *
 * Sans fuseau nommé, « 18:00 » saisi par la propriétaire devenait 18 h TEMPS
 * UNIVERSEL, soit 20 h à Paris : le bandeau de Noël s'allumait deux heures
 * trop tard.
 */
export function instantDepuisChampLocal(
  valeur: string,
  fuseau: string = FUSEAU_BOUTIQUE,
): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    valeur.trim(),
  );
  if (!m) return null;
  const instant = instantDeLHeureLocale(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
    0,
    fuseau,
  );
  return Number.isNaN(instant.getTime()) ? null : instant;
}
