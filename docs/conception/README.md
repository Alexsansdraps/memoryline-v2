# Conceptions — à lire avant de reconcevoir

Trois documents produits en septembre 2026, au format JSON parce qu'ils ont été écrits par
des agents et relus tels quels. Ils décrivent des **décisions**, pas du code : chacun dit
aussi ce qu'il a volontairement écarté, et pourquoi. Les rouvrir évite de refaire un
arbitrage déjà rendu.

| Fichier | Ce que c'est | État |
|---|---|---|
| `bordereau.json` | L'étiquette transporteur, en dix-sept étapes : joindre une étiquette achetée chez SendCloud, puis, plus tard, l'acheter depuis la commande | **Étapes 1 à 12 construites** (commits `0b36537` et `0dce0bd`), 13 à 17 non |
| `relance-panier.json` | Rendre modifiable le courrier de relance de panier abandonné, et libre son calendrier | **Conçu, rien n'est construit** |
| `audit-cartes.json` | Les cartes Trello de la cliente, vérifiées une par une dans le code : ce qui est fait, ce qui ne l'est que dans le code, ce qui reste, ce qu'il faut lui demander | Constat au 27/09/2026 |

Les champs utiles : `etapes` (l'ordre de construction, chaque étape nommant ses fichiers),
`verifications` (comment prouver chaque étape sans se connecter au back-office),
`hors_champ` (ce qui a été écarté), et, pour l'audit, `deja_fait` / `a_faire` /
`a_demander`.

Le récit de l'état général est dans `docs/PASSATION.md`.
