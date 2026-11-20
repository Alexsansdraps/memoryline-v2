/**
 * Le menu du back-office, sorti de la mise en page (layouts/Admin.astro).
 *
 * Il vit ici, dans un module sans Astro, parce que deux lecteurs s'en
 * servent : la mise en page, qui le dessine, et l'index de la recherche
 * (lib/index-ecrans.ts), qui y lit le nom de chaque écran, son groupe et sa
 * place. L'index le lit comme une DONNÉE : le jour où une entrée change de
 * nom ou de groupe, la recherche suit sans qu'on y pense — c'est exactement
 * ce qui manquait à l'ancienne liste d'écrans écrite à la main dans l'API.
 */

// Navigation type admin Shopify (vocabulaire familier à la cliente).
// `owner: true` = écran de configuration, masqué aux comptes « seller », qui
// vendent et impriment mais ne modifient ni le catalogue ni les réglages.
export interface NavItem {
  href: string;
  label: string;
  icon: string;
  owner?: boolean;
  /** Sous-entrées, affichées en retrait sous le parent. */
  children?: NavItem[];
  /**
   * D'autres écrans qui appartiennent à cette entrée sans avoir la leur
   * (« Catégories de produits », ouvert depuis Produits) : le menu la met en
   * avant quand on y est.
   */
  aussi?: string[];
}

/** Un thème du menu. `titre` à null pour le bloc du haut, qui n'en a pas. */
export interface GroupeNav {
  titre: string | null;
  entrees: NavItem[];
}

/*
 * Sept groupes, rangés par NATURE de la chose qu'on manipule — comme Shopify,
 * d'où vient la cliente et dont le vocabulaire lui est déjà familier. Une
 * hésitation s'y tranche en ouvrant l'écran, alors qu'un rangement par
 * fréquence d'usage se périme dès que les habitudes changent.
 *
 * `owner: true` = écran de configuration, masqué aux comptes « seller », qui
 * vendent et impriment mais ne modifient ni le catalogue ni les réglages.
 */
export const MENU: GroupeNav[] = [
  // Sans titre, tout en haut : les deux écrans qu'on ouvre en arrivant, avant
  // même de savoir ce qu'on vient faire.
  {
    titre: null,
    entrees: [
      { href: "/", label: "Accueil", icon: "🏠", owner: true },
      // Deux écrans, deux questions. « Finances » répond à « où est
      // l'argent » ; « Statistiques » à « qu'est-ce qui se vend ». Les
      // réunir donnerait un écran qu'on ouvre pour deux raisons opposées.
      { href: "/statistiques", label: "Statistiques", icon: "📈", owner: true },
      { href: "/finances", label: "Finances", icon: "📊", owner: true },
    ],
  },
  {
    titre: "Commandes",
    entrees: [
      { href: "/commandes", label: "Commandes en ligne", icon: "🛒", owner: true },
      // La seule entrée qu'un vendeur voit : son stand, et rien d'autre.
      { href: "/ventes-salon", label: "Ventes stand", icon: "🎪" },
      {
        href: "/paniers",
        label: "Paniers abandonnés",
        icon: "🛍️",
        owner: true,
        // Le courriel de relance n'avait qu'un petit lien, calé à droite des
        // réglages : Margaux ne le trouvait pas. Il a son entrée.
        children: [
          { href: "/paniers/courriel", label: "Courriel de relance", icon: "✉️", owner: true },
        ],
      },
      // Ici et pas dans le catalogue : une carte cadeau n'est pas un article à
      // vendre, c'est de l'argent que quelqu'un a déjà payé.
      { href: "/cartes-cadeaux", label: "Code promo / Carte cadeau", icon: "🎁", owner: true },
    ],
  },
  {
    titre: "Produits",
    entrees: [
      {
        href: "/produits",
        label: "Produits",
        icon: "🖼️",
        owner: true,
        aussi: ["/categories-produits"],
        // Aucun autre écran ne pointe vers l'import : sans cette entrée, il
        // redevient introuvable, ce qu'il a déjà été une fois.
        children: [
          // Où ranger les affiches de CHAQUE page de liste du site : Toutes
          // les affiches, les deux pages de genre et chaque collection. La
          // fiche d'une collection renvoie ici.
          { href: "/produits/ordre", label: "Ordre d'affichage", icon: "↕️", owner: true },
          { href: "/produits/import", label: "Importer un fichier", icon: "📥", owner: true },
        ],
      },
      { href: "/collections", label: "Collections", icon: "📚", owner: true },
      // 🪵 et non 🖼 : Produits, Cadres et Décors portaient trois cadres photo
      // presque identiques, et sur un petit écran on vise la forme avant de
      // lire le mot.
      { href: "/cadres", label: "Cadres", icon: "🪵", owner: true },
    ],
  },
  {
    // « Atelier » et surtout pas « Personnalisation » : l'écran de
    // personnalisation des courriers arrive, et l'œil serait allé sur le
    // groupe qui porte le mot — celui des vêtements de personnages.
    titre: "Atelier",
    entrees: [
      // Une entrée par chose. Les personnages (ce que le client pose sur son
      // affiche) et les pièces (ce qu'ils portent) ont chacun leur écran
      // depuis octobre 2026 : réunis sur une seule page, 164 pièces
      // dépliées noyaient 67 personnages sous 35 000 px de défilement.
      {
        href: "/personnages",
        label: "Personnages",
        icon: "🧸",
        owner: true,
        children: [
          // Sa seule porte était un bouton discret en haut de la liste des
          // personnages. C'est pourtant lui qui rend utilisable une pièce
          // fraîchement créée, décochée partout par défaut.
          { href: "/personnages/correspondances", label: "Pièces par personnage", icon: "🧩", owner: true },
        ],
      },
      {
        href: "/pieces",
        label: "Pièces",
        icon: "👕",
        owner: true,
        // Les catégories de pièces rangent les pièces et portent le nuancier
        // de chacune : c'est sous Pièces qu'on les cherche. L'écran garde
        // aussi, en bas, les nuanciers des PERSONNAGES (peau, pelage) : ils
        // ont leur lien en tête de l'écran Personnages, et la recherche les
        // trouve (« peau », « nuancier »).
        children: [
          { href: "/categories-pieces", label: "Catégories de pièces", icon: "🎨", owner: true },
        ],
      },
      { href: "/types-affiche", label: "Types d'affiche", icon: "🎭", owner: true },
      // Le libellé garde « des affiches » : c'est le seul mot qui rattache cet
      // écran au catalogue, et on y NOMME un décor, on n'en ajoute pas.
      { href: "/decors", label: "Décors des affiches", icon: "🏞️", owner: true },
      // Des photos de lieux, et le modèle d'images dessine les décors (20/11).
      // Margaux : « Si seulement tu pouvais me faire un programme où j'ai juste
      // à mettre des photos et qu'il me génère des fonds automatiquement ». Juste
      // sous les décors : ce qu'il fabrique y entre.
      // « Créer des fonds » (20/11 au soir, Alexandra) : on y en fait plusieurs
      // d'un coup, une photo par fond.
      { href: "/fonds", label: "Créer des fonds", icon: "🖌️", owner: true },
      {
        href: "/ia",
        label: "Affiches IA",
        icon: "✨",
        owner: true,
        // Les styles proposés à la cliente — « Couple », « Paysage » — vivent
        // sous les affiches IA dont ils sont le réglage, et non à côté :
        // on n'y va qu'après avoir ouvert celles-ci.
        children: [
          { href: "/ia/styles", label: "Styles proposés", icon: "🎨", owner: true },
        ],
      },
      // Des affiches tirées au hasard, à imprimer d'avance pour un marché ou
      // une vitrine (20/11). Dans l'Atelier et pas dans « Commandes » : on n'y
      // vend rien, on y fabrique des affiches avec les personnages et les
      // décors réglés juste au-dessus.
      { href: "/affiches-demo", label: "Affiches de démonstration", icon: "🖨️", owner: true },
    ],
  },
  {
    titre: "Clients et marketing",
    entrees: [
      { href: "/clients", label: "Clients", icon: "👥", owner: true },
      { href: "/promotions", label: "Promotions", icon: "🎟️", owner: true },
      { href: "/lettre", label: "Lettre d'information", icon: "✉️", owner: true },
    ],
  },
  {
    titre: "Boutique en ligne",
    entrees: [
      // Les messages qui défilent en haut du site. Plus aucune remise ici :
      // les offres se règlent dans Promotions, le bandeau ne fait que parler.
      { href: "/bandeau", label: "Bandeau d'annonce", icon: "📢", owner: true },
      // Les grandes images en haut des pages (la bannière de Noël de
      // l'ancienne boutique). Juste sous le bandeau de texte, avec lequel on
      // les confondrait autrement : le nom de chacun dit ce qu'il porte.
      { href: "/bandeaux-visuels", label: "Bandeaux visuels", icon: "🌄", owner: true },
      // « Contenu » ne disait rien et se confondait avec « Pages du site »,
      // juste en dessous. Cet écran ne touche que quelques blocs de
      // l'accueil, la vidéo de la personnalisation et le pied de page.
      { href: "/contenu", label: "Accueil et pied de page", icon: "✏️", owner: true },
      { href: "/pages", label: "Pages du site", icon: "📄", owner: true },
      {
        href: "/menu",
        label: "Menu du site",
        icon: "🧭",
        owner: true,
        // Les colonnes de liens du bas du site (17/11) : le même écran, à
        // l'onglet « Pied de page ». Une entrée à elles, parce que c'est sous
        // ce nom que la boutique les cherche.
        children: [
          { href: "/menu?emplacement=pied", label: "Pied de page", icon: "⬇️", owner: true },
        ],
      },
      // Les adresses du site, comme les pages et le menu : où mène une
      // ancienne adresse (celles de Shopify, surtout). Shopify les range
      // aussi à côté de ses menus, d'où vient la cliente.
      { href: "/redirections", label: "Redirections", icon: "↪️", owner: true },
    ],
  },
  {
    titre: "Réglages",
    entrees: [
      {
        href: "/livraison",
        label: "Livraison",
        icon: "📦",
        owner: true,
        // Les endroits où la cliente vient chercher sa commande (le chalet du
        // marché de Noël) : sous Livraison, parce que c'est le mode « Retrait
        // sur place » qui les propose à la caisse.
        children: [
          { href: "/livraison/lieux", label: "Lieux de retrait", icon: "📍", owner: true },
        ],
      },
      // Les clés Stripe et PayPal, le passage de l'essai au réel et l'achat
      // des vraies étiquettes : juste après Livraison, dont il règle les
      // bordereaux payants.
      { href: "/paiements", label: "Paiements", icon: "💳", owner: true },
      // Ni « d'essai » — le mot ne décrivait qu'un bouton et faisait passer
      // l'écran pour un bac à sable — ni « automatiques », qui serait faux :
      // la facture et l'avis d'expédition ne partent que sur son geste.
      { href: "/courriers", label: "Courriers", icon: "📬", owner: true },
      // L'adresse et le SIRET imprimés sur chaque facture : des mentions
      // obligatoires, qu'on règle une fois et qu'on ne cherche qu'au moment
      // de déménager — d'où « Réglages ».
      { href: "/facturation", label: "Factures", icon: "🧾", owner: true },
      // Mentions légales, CGV, confidentialité, cookies (17/11) : chacun
      // s'ouvre dans l'éditeur visuel des pages.
      { href: "/textes-legaux", label: "Textes légaux", icon: "⚖️", owner: true },
      { href: "/comptes", label: "Comptes", icon: "🔑", owner: true },
      // Dans « Réglages » et pas dans un groupe à soi : on n'y va pas pour
      // travailler, on y va quand on cherche quelque chose qu'on a rangé.
      // Chaque écran garde par ailleurs sa propre section « Archivés ».
      { href: "/archives", label: "Archives", icon: "🗄️", owner: true },
      // Les questions qui reviennent (commandes test, bordereau, import CSV…).
      { href: "/aide", label: "Aide", icon: "❓", owner: true },
    ],
  },
];
