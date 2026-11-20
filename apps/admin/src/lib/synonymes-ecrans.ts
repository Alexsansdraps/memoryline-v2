/**
 * Les mots qu'on tape pour atteindre un écran, quand ce ne sont pas ceux de
 * l'écran.
 *
 * C'est la seule chose de la recherche des écrans qui s'écrive à la main, et
 * c'est voulu : le nom, les sections, les libellés et les aides sont lus dans
 * le source de chaque page (lib/index-ecrans.ts), mais personne n'écrit
 * « frais de port » sur l'écran Livraison, alors que c'est ce qu'on tape pour
 * le trouver. Ces mots-là ne se devinent pas, ils se notent.
 *
 * Rattachés à la ROUTE (le fichier de la page), jamais au titre : un écran
 * renommé dans le menu garde ses mots-clés. Une route qui disparaît laisse
 * ici une clé orpheline ; le test tests/recherche.test.mjs la signale.
 */
export const SYNONYMES: Readonly<Record<string, readonly string[]>> = {
  "/": ["tableau de bord", "chiffres du jour"],
  "/commandes": ["ventes du site", "boutique", "expéditions"],
  "/paniers": ["relances", "programmer la relance", "relance automatique"],
  "/clients": ["clientes", "fiches"],
  "/ventes-salon": ["salon", "foire", "marché", "stands"],
  "/produits": ["affiches", "catalogue"],
  "/produits/nouveau": ["créer un produit", "ajouter une affiche"],
  "/produits/import": ["import", "fichier", "tableur"],
  "/produits/modifier-en-masse": [
    "prix en masse", "modification groupée", "appliquer à tout",
    "modifier en masse", "changer les collections",
  ],
  "/cadres": ["encadrement"],
  "/personnages": ["silhouettes"],
  // La bibliothèque des pièces a son écran depuis octobre 2026 (elle vivait
  // en bas de Personnages) ; « clothes » : les noms de l'import, tels que la
  // boutique les lit encore sur ses pièces. Et ce qu'on cherche vraiment :
  // un chapeau, une robe — les pièces s'appellent encore « Accessories 1 »,
  // c'est donc l'écran qui doit répondre.
  "/pieces": [
    "bibliothèque", "vêtements", "pantalons", "coupes", "accessoires", "pièce",
    "renommer une pièce", "clothes",
    "chapeau", "casquette", "lunettes", "t-shirt", "robe",
  ],
  "/pieces/nouvelle": ["nouvelle pièce", "ajouter une pièce", "téléverser une pièce"],
  "/personnages/correspondances": ["équivalences des pièces"],
  "/types-affiche": ["modèles"],
  "/ia": ["intelligence artificielle", "générées"],
  "/collections": ["rayons"],
  "/cartes-cadeaux": ["bons cadeaux"],
  "/promotions": [
    "codes promo", "code promo", "coupon", "remises", "soldes", "réductions",
    "offre", "remise automatique", "affiche offerte", "3 achetées",
  ],
  "/livraison": [
    "frais de port", "transport", "colissimo", "point relais", "tarifs",
    "expédition", "transporteur", "mondial relay", "chronopost", "zones",
    "poids", "envoi",
  ],
  "/bandeau": ["annonce", "annonces", "message en haut", "bandeau du haut", "messages qui défilent"],
  "/contenu": [
    "textes", "accueil du site", "page d'accueil", "pied de page", "footer",
    "vidéo tuto", "signature", "affiches par ligne",
  ],
  "/pages": ["mentions", "mentions légales", "conditions", "conditions de vente", "cgv", "à propos"],
  "/menu": ["navigation"],
  // Ce qu'on tape en pensant à Shopify (« redirections d'URL », « redirects »)
  // ou au problème lui-même : un lien cassé, une ancienne adresse.
  "/redirections": [
    "redirection", "301", "redirection 301", "ancienne adresse", "anciennes adresses",
    "redirections d'url", "redirects", "liens cassés", "lien cassé", "url",
  ],
  "/lettre": ["abonnés", "envoi aux clients", "newsletter", "e-mailing"],
  "/courriers": [
    "mails", "e-mails", "messages automatiques", "confirmation de commande",
    "avis d'expédition", "facture par mail",
  ],
  "/finances": [
    "chiffre d'affaires", "comptabilité", "marges", "taxes", "paypal", "stripe",
    "virement", "remboursements", "export comptable",
  ],
  "/comptes": [
    "vendeuses", "accès", "mot de passe", "utilisateurs", "identifiants",
    "vendeur", "stands du vendeur", "rattacher un stand", "plusieurs marchés",
  ],
  "/facturation": [
    "siret", "adresse de la boutique", "mentions de la facture",
    "mentions obligatoires", "en-tête de facture",
  ],
  // Pas « stripe » ni « paypal » seuls : ils mènent aux Finances, où l'on
  // cherche l'argent. Ici, ce sont les clés et le passage en réel.
  "/paiements": [
    "clés stripe", "clés paypal", "clé api", "mode réel", "passer en réel",
    "mode essai", "mise en production", "webhook", "étiquettes payantes",
    "vraies étiquettes", "carte bancaire",
  ],
  "/livraison/lieux": [
    "chalet", "lieu de retrait", "lieux de retrait", "point de retrait",
    "click and collect", "retrait au chalet", "marché de Noël",
  ],

  // Les écrans que l'ancienne liste avait oubliés : c'est leur absence qui
  // faisait répondre « bandeau » par le seul « Bandeau et offre ».
  "/bandeaux-visuels": ["bannière", "grande image", "image en haut", "encart", "visuel de Noël"],
  "/decors": ["fonds", "arrière-plans", "paysages"],
  "/statistiques": ["ventes", "meilleures ventes", "ce qui se vend", "graphiques"],
  "/archives": ["corbeille", "supprimés", "restaurer"],
  "/aide": ["faq", "mode d'emploi", "comment faire", "tutoriel"],
  "/ia/styles": ["styles IA", "consignes IA", "prompt"],
  "/categories-produits": ["catégories d'affiches", "logistique"],
  "/produits/ordre": [
    "ordre", "classement", "ordre des affiches", "trier les affiches",
    "ordre d'apparition", "ranger les affiches",
  ],
  "/categories-pieces": [
    "nuancier", "nuanciers", "ordre des couleurs", "pastilles",
    "couleurs de peau", "peau",
  ],
  "/clients/import": ["importer des clients"],
  "/paniers/courriel": [
    "mail de relance", "mail", "modifier le mail", "e-mail panier", "texte de la relance",
    "courriel panier abandonné",
  ],
  "/produits/[id]": ["seo", "référencement", "titre google"],
  // Ce qu'on dit en pensant au marché de Noël : des affiches « de test »,
  // « d'exemple », imprimées d'avance pour la vitrine du stand.
  // Ce que dit Margaux d'un décor à faire depuis une photo (20/11).
  "/fonds": [
    // L'ancien nom de l'écran (« Créer un fond », jusqu'au 20/11 au soir).
    "créer un fond",
    "générer un fond", "nouveau décor", "fond de ville", "décor depuis une photo",
    "dessiner un décor", "photo de ville", "créer un décor",
  ],
  "/affiches-demo": [
    "affiches de test", "affiches d'exemple", "échantillons", "imprimer d'avance",
    "marché", "démo", "au hasard", "aléatoire", "vitrine",
  ],
};
