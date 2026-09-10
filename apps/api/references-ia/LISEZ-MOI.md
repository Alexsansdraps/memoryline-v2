# Affiches de référence pour la génération IA

Ces images ne sont pas des produits. Elles ne se vendent pas, elles ne
s'affichent nulle part sur la boutique. Elles servent à **montrer le rendu
Memory Line au modèle**, en plus de la consigne écrite.

## Ce qu'il faut déposer ici

Quatre fichiers PNG ou JPEG, nommés pour que l'ordre saute aux yeux :

| Fichier | Ce qu'il montre |
|---|---|
| `1-people.png` | Le couple sur la terrasse |
| `2-architecture.png` | Le Crotoy |
| `3-landscape.png` | Les falaises et les cabines de plage |
| `4-family.png` | La famille devant la maison rouge |

**Les trois premiers par ordre alphabétique partent avec chaque génération.**
C'est pour cela qu'ils sont numérotés : changer l'ordre, c'est renommer les
fichiers, sans toucher au code.

La famille est en quatrième position parce qu'elle est la plus spécifique :
elle sert de remplaçante le jour où l'on saura reconnaître une photo de
famille et adapter les références en conséquence.

## Pourquoi l'ordre compte

La consigne envoyée au modèle dit, mot pour mot :

> IMAGE 1 is the CUSTOMER SOURCE PHOTO. IMAGE 1 is the absolute and exclusive
> visual authority for CONTENT. IMAGE 2, IMAGE 3 and IMAGE 4 are APPROVED
> STYLE REFERENCES ONLY.

La photo du client part donc toujours en premier, et ces fichiers-ci ensuite.
Inverser cet ordre reviendrait à demander au modèle de recopier le contenu
d'une affiche de la boutique et de ne garder que le style de la photo du
client : le client recevrait une affiche qui n'est pas la sienne.

## Si le dossier est vide

La génération fonctionne quand même. Le modèle ne reçoit alors que la photo et
la consigne écrite, comme avant que ces références existent. Le rendu est
moins constant : c'est justement ce que ces images corrigent.

## Ce qu'il ne faut pas y mettre

- Une affiche qui porte du texte visible sera ignorée pour son texte, mais
  autant éviter : la consigne doit répéter d'ignorer ce qu'elle voit.
- Une photographie non retouchée : le modèle y verrait le rendu à imiter.
- Un fichier lourd sans raison. Deux mille pixels de large suffisent
  largement pour montrer un style, et chaque image part à chaque génération.
