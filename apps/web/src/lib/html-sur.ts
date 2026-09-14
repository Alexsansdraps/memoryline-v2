/**
 * Le HTML saisi au back-office, rendu inoffensif avant d'entrer dans le site.
 *
 * POURQUOI ICI, À L'AFFICHAGE, ET PAS À L'ENREGISTREMENT. L'API écrit du HTML
 * à au moins six endroits — fiches produit, collections, pages, traductions,
 * imports — et chacun serait une porte à ne pas oublier. Le site, lui, ne
 * l'insère qu'à deux : la description d'une affiche et le texte d'une page.
 * Nettoyer là, c'est nettoyer tout ce qui s'affiche, quel que soit le chemin
 * par lequel c'est entré : un formulaire, un import mal formé, un compte
 * compromis ou un appel direct à l'API.
 *
 * L'éditeur du back-office filtre déjà les balises dangereuses — mais dans le
 * navigateur de la personne qui écrit. Ce filtre-là ne protège que ceux qui
 * passent par l'éditeur. Celui-ci protège les clientes, quoi qu'il arrive.
 *
 * POURQUOI UNE BIBLIOTHÈQUE. Un nettoyeur de HTML écrit à la main, à coups
 * d'expressions régulières, se contourne toujours : `<img/onerror=…>` sans
 * espace, `javascript&#58;` encodé, une balise mal fermée qui en avale une
 * autre. `sanitize-html` lit le HTML comme le fait un navigateur, avec un
 * véritable analyseur, et ne laisse sortir que ce qui est explicitement
 * permis.
 */
import sanitizeHtml from "sanitize-html";

/**
 * Exactement les balises que l'éditeur du back-office sait écrire, et rien de
 * plus. Deux listes qui divergeraient finiraient par effacer ici ce que la
 * boutiquière vient de mettre en forme là-bas.
 */
const REGLES: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "em",
    "u",
    "ul",
    "ol",
    "li",
    "a",
    "img",
    "h2",
    "h3",
    // Les anciennes descriptions importées de Shopify portent encore ces
    // deux-là. Les jeter viderait des fiches entières de leur mise en forme ;
    // elles sont inoffensives.
    "b",
    "i",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "width", "height"],
  },
  // Pas de `javascript:`, pas de `data:` — seulement des adresses web, un
  // courriel, ou un chemin du site. Une image en `data:` pourrait porter
  // n'importe quoi, et une adresse `javascript:` exécuterait du code au clic.
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  // Un lien vers l'extérieur ne doit pas pouvoir piloter l'onglet de la
  // boutique qu'il a ouvert.
  transformTags: {
    a: (nom, attributs) => {
      const href = attributs.href ?? "";
      const externe = /^https?:\/\//i.test(href);
      return {
        tagName: nom,
        attribs: externe
          ? { ...attributs, rel: "noopener noreferrer" }
          : attributs,
      };
    },
  },
  // Le contenu d'une balise refusée reste (le texte d'un <span> collé depuis
  // Word se lit toujours) ; celui d'une balise dangereuse part avec elle.
  disallowedTagsMode: "discard",
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe"],
};

/** Le HTML d'une fiche ou d'une page, prêt à être inséré dans le site. */
export function htmlSur(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(String(html), REGLES);
}

/**
 * Des données structurées prêtes à vivre dans une balise <script>.
 *
 * `JSON.stringify` n'échappe pas la séquence `</script>` : un nom d'affiche
 * qui la contiendrait refermerait la balise des données structurées et
 * écrirait la suite du nom en HTML — donc, potentiellement, un script. On
 * remplace les chevrons et l'esperluette par leur forme échappée, qui reste
 * du JSON parfaitement valide pour Google.
 */
export function jsonPourScript(donnees: unknown): string {
  return JSON.stringify(donnees)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
