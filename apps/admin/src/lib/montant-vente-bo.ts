/**
 * « Corriger le montant » d'une vente du stand (26/11, Margaux : « pouvoir
 * modifier le montant € de la commande stand une fois qu'elle est
 * validée »), dans Ventes stand comme sur la fiche : la confirmation redit
 * l'ancien et le nouveau montant avant d'envoyer — une faute de frappe
 * (390 € pour 39 €) se voit là, pas dans les statistiques du soir.
 *
 * Chargé par un <script> d'Astro (OrderTable.astro, commandes/[id].astro).
 * Sans script, le formulaire part sans question : le serveur refuse ce qui
 * ne va pas.
 */
import { centimesSaisis, questionDeCorrection } from "./montant-vente.ts";

for (const form of document.querySelectorAll<HTMLFormElement>("form[data-montant-vente]")) {
  form.addEventListener("submit", (evenement) => {
    const montant = form.querySelector<HTMLInputElement>('input[name="montant"]');
    const motif = form.querySelector<HTMLInputElement>('input[name="motif"]');
    const question = questionDeCorrection(
      form.dataset.numero ?? "",
      Number(form.dataset.avant) || 0,
      centimesSaisis(montant?.value ?? ""),
      motif?.value ?? "",
    );
    if (question && !window.confirm(question)) evenement.preventDefault();
  });
}
