/**
 * Les horaires d'un stand dictés en quelques mots (17/11) :
 *
 *   « on ne peut pas utiliser ChatGPT pour qu'elle fasse ses horaires en
 *   tapant du texte ? C'est trop galère » — « que ça modifie, tu vois ».
 *
 * Margaux écrit « fermé les lundis, le 24 jusqu'à 16 h, le 25 fermé » ; le
 * modèle reçoit le calendrier ACTUEL et la consigne, et rend le calendrier
 * complet mis à jour. Ce qui revient est relu par les mêmes règles que la
 * saisie à la main (horairesLus) avant d'être enregistré : une réponse
 * fantaisiste est refusée, jamais écrite.
 */
import {
  horairesLus,
  jourValide,
  type Creneau,
  type HorairesStand,
} from "@memoryline/types";

const OPENAI_BASE = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const MODELES = [
  (process.env.OPENAI_MODELE_TRADUCTION ?? "").trim(),
  "gpt-5-mini",
  "gpt-4.1-mini",
  "gpt-4o-mini",
].filter(Boolean);

export class EchecHorairesIa extends Error {}

/** Le calendrier tel qu'on le montre au modèle, et tel qu'il le rend. */
interface CalendrierTexte {
  dateDebut: string | null;
  dateFin: string | null;
  matin: Creneau | null;
  apresMidi: Creneau | null;
  jours: ({ date: string; ferme?: boolean; matin?: Creneau | null; apresMidi?: Creneau | null })[];
}

const CONSIGNE = (aujourdhui: string) => `Tu tiens le calendrier d'un stand de marché de la boutique Memory Line.
Tu reçois le calendrier ACTUEL (JSON) et une consigne écrite par la commerçante, en français courant.
Applique la consigne au calendrier et renvoie le calendrier COMPLET mis à jour, en JSON, exactement sous cette forme :
{"dateDebut":"AAAA-MM-JJ" ou null,"dateFin":"AAAA-MM-JJ" ou null,"matin":{"de":"HH:MM","a":"HH:MM"} ou null,"apresMidi":{"de":"HH:MM","a":"HH:MM"} ou null,"jours":[{"date":"AAAA-MM-JJ","ferme":true} ou {"date":"AAAA-MM-JJ","matin":{"de":"HH:MM","a":"HH:MM"} ou null,"apresMidi":{"de":"HH:MM","a":"HH:MM"} ou null}]}
Règles :
- "matin" et "apresMidi" sont les horaires de base, recopiés sur chaque jour du stand. "jours" ne contient QUE les jours qui s'en écartent : fermés, ou à horaires différents.
- Garde tel quel tout ce que la consigne ne change pas.
- « Fermé les lundis » : chaque lundi entre dateDebut et dateFin est fermé.
- Une journée continue (« 11h-20h ») : un seul créneau dans "matin", et "apresMidi" à null.
- « Le 24 jusqu'à 16h » : ce jour-là seulement, le dernier créneau finit à 16:00 ; un créneau qui commencerait après 16:00 devient null.
- Les heures sur 24 h, « HH:MM ». Les dates « AAAA-MM-JJ » ; l'année se déduit d'aujourd'hui (${aujourdhui}) : une date déjà passée cette année est celle de l'année suivante.
- Le matin finit avant le début de l'après-midi.
- Réponds par le JSON seul.`;

function versTexte(dateDebut: string | null, dateFin: string | null, h: HorairesStand | null): CalendrierTexte {
  return {
    dateDebut,
    dateFin,
    matin: h?.matin ?? null,
    apresMidi: h?.apresMidi ?? null,
    jours: Object.entries(h?.jours ?? {}).map(([date, j]) =>
      j.ferme ? { date, ferme: true } : { date, matin: j.matin ?? null, apresMidi: j.apresMidi ?? null },
    ),
  };
}

/**
 * Le calendrier mis à jour d'après la consigne, VÉRIFIÉ : dates valides et
 * dans l'ordre, horaires lisibles. Lève EchecHorairesIa avec une phrase à
 * montrer telle quelle.
 */
export async function horairesDepuisTexte(
  consigne: string,
  actuel: { dateDebut: string | null; dateFin: string | null; horaires: HorairesStand | null },
  aujourdhui: string,
): Promise<{ dateDebut: string | null; dateFin: string | null; horaires: HorairesStand }> {
  const cle = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!cle)
    throw new EchecHorairesIa("L'IA n'est pas branchée : il manque OPENAI_API_KEY dans les réglages du serveur.");
  const texte = consigne.trim().slice(0, 2000);
  if (!texte) throw new EchecHorairesIa("Écrivez d'abord les horaires, par exemple « fermé les lundis, le 24 jusqu'à 16 h ».");

  let derniere = "";
  for (const modele of MODELES) {
    let res: Response;
    try {
      res = await fetch(`${OPENAI_BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modele,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: CONSIGNE(aujourdhui) },
            {
              role: "user",
              content: JSON.stringify({
                aujourdhui,
                calendrierActuel: versTexte(actuel.dateDebut, actuel.dateFin, actuel.horaires),
                consigne: texte,
              }),
            },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new EchecHorairesIa("L'IA ne répond pas. Réessayez dans un instant.");
    }
    const corps = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      error?: { code?: string; message?: string };
    } | null;
    if (!res.ok) {
      derniere = corps?.error?.message ?? `réponse ${res.status}`;
      if (res.status === 404 || corps?.error?.code === "model_not_found") continue;
      throw new EchecHorairesIa(`L'IA a refusé : ${derniere.slice(0, 200)}`);
    }
    let lu: Partial<CalendrierTexte>;
    try {
      lu = JSON.parse(corps?.choices?.[0]?.message?.content ?? "") as Partial<CalendrierTexte>;
    } catch {
      throw new EchecHorairesIa("La réponse de l'IA est illisible. Reformulez, ou réessayez.");
    }
    const dateDebut = lu.dateDebut ? String(lu.dateDebut) : null;
    const dateFin = lu.dateFin ? String(lu.dateFin) : null;
    if ((dateDebut && !jourValide(dateDebut)) || (dateFin && !jourValide(dateFin)) || !dateDebut !== !dateFin)
      throw new EchecHorairesIa("L'IA a rendu des dates incomplètes ou fausses. Précisez le premier et le dernier jour du stand.");
    if (dateDebut && dateFin && dateDebut > dateFin)
      throw new EchecHorairesIa("L'IA a rendu une date de fin avant la date de début. Reformulez les dates.");
    const jours: Record<string, unknown> = {};
    for (const j of Array.isArray(lu.jours) ? lu.jours : []) {
      if (!j || typeof j !== "object" || !jourValide(j.date)) continue;
      jours[j.date] = j.ferme ? { ferme: true } : { matin: j.matin ?? null, apresMidi: j.apresMidi ?? null };
    }
    const horaires = horairesLus(
      { matin: lu.matin ?? null, apresMidi: lu.apresMidi ?? null, jours },
      dateDebut,
      dateFin,
    );
    if (typeof horaires === "string")
      throw new EchecHorairesIa(`L'IA a rendu un horaire impossible (${horaires}). Reformulez.`);
    return { dateDebut, dateFin, horaires };
  }
  throw new EchecHorairesIa(`Aucun modèle d'IA disponible sur ce compte OpenAI (${derniere.slice(0, 120)}).`);
}
