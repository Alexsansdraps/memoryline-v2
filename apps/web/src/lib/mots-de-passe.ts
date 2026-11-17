/// <reference lib="dom" />
/**
 * « Afficher / Masquer » sur chaque champ de mot de passe du site (17/11) :
 * on vérifie ce qu'on a tapé avant de valider, surtout sur un téléphone.
 *
 * Posé par script sur TOUS les champs `type="password"` de la page —
 * connexion, inscription, réinitialisation, Mes informations — plutôt que
 * réécrit dans chaque formulaire : un champ ajouté demain l'aura aussi. Sans
 * JavaScript, le champ reste un champ masqué ordinaire.
 *
 * Les libellés viennent de <html data-mdp-afficher / data-mdp-masquer>
 * (Base.astro), dans la langue de la page.
 */
export function brancherMotsDePasse(): void {
  const racine = document.documentElement;
  const afficher = racine.dataset.mdpAfficher || "Afficher";
  const masquer = racine.dataset.mdpMasquer || "Masquer";

  document.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((champ) => {
    if (champ.dataset.voirBranche) return;
    champ.dataset.voirBranche = "1";

    // Le champ passe dans une boîte qui porte le bouton, à droite, dedans.
    // La marge du haut passe à la boîte, pour que le bouton tombe au milieu
    // du champ et non de l'ensemble.
    const boite = document.createElement("span");
    boite.style.position = "relative";
    boite.style.display = "block";
    boite.style.marginTop = getComputedStyle(champ).marginTop;
    champ.style.marginTop = "0";
    champ.style.paddingRight = "6rem";
    champ.parentNode?.insertBefore(boite, champ);
    boite.appendChild(champ);

    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.textContent = afficher;
    bouton.setAttribute("aria-pressed", "false");
    Object.assign(bouton.style, {
      position: "absolute",
      right: "0.5rem",
      top: "50%",
      transform: "translateY(-50%)",
      padding: "0.35rem 0.6rem",
      fontSize: "13px",
      fontWeight: "600",
      color: "var(--color-ink-soft)",
      background: "transparent",
      border: "0",
      cursor: "pointer",
    } satisfies Partial<CSSStyleDeclaration>);
    bouton.addEventListener("click", () => {
      const visible = champ.type === "password";
      champ.type = visible ? "text" : "password";
      bouton.textContent = visible ? masquer : afficher;
      bouton.setAttribute("aria-pressed", visible ? "true" : "false");
      champ.focus();
    });
    boite.appendChild(bouton);
  });
}
