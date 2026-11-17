/// <reference lib="dom" />
/**
 * « Stand fermé », en haut de la tablette (17/11) :
 *
 *   « on ne doit pas pouvoir valider le panier si le stand est fermé, et il
 *   faut l'afficher en haut, sous la bande Mode stand, uniquement si le stand
 *   est fermé ; s'il est ouvert, on n'affiche rien. »
 *
 * À chaque page en mode stand, on demande au serveur l'état du stand dont la
 * tablette a retenu le code (Base.astro le range en arrivant par le lien du
 * back-office). Fermé : la bande `#ml-stand-ferme` apparaît, et la caisse du
 * stand refuse de valider (CommandeStand.tsx fait la même lecture).
 *
 * Sans code retenu, on ne peut savoir de quel stand il s'agit : la bande ne
 * s'affiche que si AUCUN stand n'est ouvert. Le serveur, lui, refuse toujours
 * une vente sans le code d'un stand ouvert : cette bande n'est qu'un repère.
 */
import { PUBLIC_API_URL } from "./api-navigateur.ts";
import { codeMemorise } from "./code-stand.ts";

export async function signalerStandFerme(): Promise<void> {
  if (document.documentElement.dataset.stand !== "1") return;
  const bande = document.getElementById("ml-stand-ferme");
  if (!bande) return;
  const code = (codeMemorise() ?? "").trim();
  try {
    const res = await fetch(`${PUBLIC_API_URL}/salon/etat`, {
      headers: code ? { "X-Salon-Code": code } : {},
    });
    if (!res.ok) return;
    const etat = (await res.json()) as {
      ouvert: boolean;
      autorise: boolean;
      standFerme?: boolean;
    };
    const ferme = code ? !etat.autorise && (etat.standFerme === true || !etat.ouvert) : !etat.ouvert;
    bande.hidden = !ferme;
    if (ferme) document.documentElement.dataset.standFerme = "1";
    else delete document.documentElement.dataset.standFerme;
  } catch {
    // Le serveur n'a pas répondu : on ne dit rien plutôt qu'une chose fausse.
  }
}
