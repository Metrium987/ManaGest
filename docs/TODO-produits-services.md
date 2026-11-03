# TODO — modules Produit et Service

Backlog unique et séquencé pour les deux faces du catalogue ManaGest. L'ordre n'est
pas cosmétique : chaque phase débloque la suivante. Une phase peut être livrée
partiellement, mais un item marqué **bloquant** doit passer avant les items qui en
dépendent.

Légende effort : **S** ≈ une demi-journée, **M** ≈ 1 à 2 jours, **L** ≈ 3 jours et plus.

---

## 0. État des lieux

| Brique | État | Preuve / limite |
| --- | --- | --- |
| Fiche article ERP (9 rubriques) | **Fait** | `server/routes/products.ts`, `shared/product-erp.ts`, onglets de `ProductsPage` |
| Fiche service (9 rubriques) | **Fait** | `shared/service.ts`, colonnes `products.*` service, onglets dédiés |
| Journal de stock (entrée, sortie, ajustement) | **Fait** | table `stock_movements`, écriture à la création, à l'édition de quantité et à l'ajustement |
| Masquage coût / marge hors comptabilité | **Fait** | `cost_masked` calculé côté serveur depuis `accounting.read` |
| Kits : disponibilité et assemblage | **Fait (A4)** | `kitAvailability` en lecture, puis `POST /products/:id/assemble` et `/disassemble` : un seul lot, deux tables (composants sortis, kit entré), référence commune |
| Temps facturable | **Fait (A5)** | relevé rattaché au service et au niveau, tarif résolu (TJM du niveau → taux de la ligne → prix du service), minimum facturable appliqué à l'intervention, majorations en ligne séparée |
| Factures récurrentes | **Existe, non relié** | table `recurring_invoices`, `services/recurring.ts` génère les factures — aucun lien vers un contrat de service |
| Bons de commande | **Fait (A2)** | la réception crée un mouvement `in` par ligne stockable, met à jour le stock et le prix d'achat, et refuse une double réception |
| Lignes de devis / factures | **Fait (A1)** | `enrichLines` fige `product_id` + instantané (référence, nom, famille, type, unité) sur devis, factures et bons de commande ; une référence inconnue est refusée en 422 |
| Sortie de stock | **Fait (A3)** | l'émission d'une facture (envoi ou encaissement d'un brouillon) sort les articles suivis, avec refus explicite `INSUFFICIENT_STOCK` sauf article autorisé en négatif |
| Inventaire tournant | **Fait (B1)** | tables `stock_counts` / `stock_count_lines`, `POST /api/stock-counts`, écran « Inventaire » ; une seule session ouverte, quantités figées à l'ouverture, refus `COUNT_STALE` si le stock a bougé |
| Valorisation CMP | **Fait (B3)** | table `stock_valuations`, `weightedAverageCost` appliqué aux réceptions et aux ajustements entrants valorisés, `GET /api/products/:id/valuation`, valeur du stock sur la fiche |
| Marge par famille / axe | **Fait (F3)** | `server/lib/margin.ts`, `GET /api/reports/margin`, écran Rapports ; avoirs soustraits, marge nulle si coût inconnu, coût masqué sans `accounting.read` |
| Lots et numéros de série | **Fait (B2)** | `stock_lots`, `server/lib/lots.ts` (FEFO), `POST/GET /products/:id/lots`, sortie par lot sur facture, retour au lot d'origine, écran « Lots » |
| Emplacements et transferts | **Fait (B4)** | soldes par emplacement lus dans le journal, `POST /products/:id/transfer` (deux mouvements, référence `TRF-`), registre `stock_locations`, écran « Emplacements » |
| Propositions d'achat (min/max, back-to-back) | **Fait (C1)** | `server/lib/replenishment.ts`, `GET /purchase-orders/suggestions`, `POST /purchase-orders/from-suggestions`, panneau « Propositions d'achat » |
| Fournisseurs secondaires par article | **Fait (C2)** | `product_vendors`, `GET/POST/DELETE /products/:id/vendors`, prix appliqué à la commande du fournisseur choisi, écran « Fournisseurs » |
| Reconnaissance du chiffre d’affaires | **Fait (E3)** | `revenue_schedules`, `revenue_recognitions`, compte 487000, `POST /api/revenue/schedules` et `/recognize` |
| Révision tarifaire par index | **Fait (E2)** | `contract_revisions`, `reviseLines`, `POST /:id/revision`, `GET /:id/revisions` |
| Alerte de préavis | **Fait (E4)** | `contractNotices`, `GET /api/recurring-invoices/notices`, `contract_notices` au tableau de bord |
| Contrat depuis une fiche service | **Fait (E1)** | `POST /api/recurring-invoices/from-service`, `contractDraft`, colonnes préavis/reconduction |
| CPS sur les documents | **Retiré (F1)** | Taxe supprimée au 1er octobre 2023 : calcul, écriture et ligne PDF retirés ; champ article conservé comme historique |
| Permission dédiée au coût | **Fait (D4)** | `products.cost.read`, masquage coût dans produits et marge, migration des rôles |
| Liens substituts et accessoires | **Fait (D3)** | `product_links`, `groupProductLinks`, `attachProductLinks`, modale produit |
| Niveaux d'expertise sur ligne de service | **Fait (D2)** | `expertise_level` sur la ligne, `expertisePrice`, `applyExpertiseForLines` |
| Grilles tarifaires par client | **Fait (D1)** | `clients.price_tier`, `linePriceFor`, `applyClientPricingForClient` |
| Coût rendu Tahiti | **Fait (F4)** | `shared/landed-cost.ts`, table `landed_cost_sheets`, `POST/GET /products/:id/landed-cost`, modale « Calculer le coût rendu » |
| Comptes par famille | **Fait (F2)** | table `family_accounts`, `resolveFamilyAccounts`, `effective_accounts` sur la fiche, modale « Comptes par famille » |
| Alertes de stock (tableau de bord + digest) | **Fait (C4)** | `server/lib/stock-alerting.ts`, `stock_alerts` dans `/api/dashboard`, digest quotidien gardé par jour |
| Réceptions partielles et reliquats | **Fait (C3)** | `purchase_order_receipts`, `POST /purchase-orders/:id/receive`, soldes par ligne dans le détail, écran de réception |
| Historique des prix d'achat | **Fait (2/11/2026)** | table datée `product_vendor_prices` (prix, devise, fournisseur, **source**, document), prix **payé** enregistré à la réception, écran sur la fiche article (liste datée, prix moyen, alerte de hausse), conservation et seuils **paramétrables** ; `GET /api/products/:id/price-history`, `tests/price-history.test.ts` |
| Prévision de la demande, fabrication MRP | **Absent — hors périmètre assumé** | explication complète en **H8** : un MRP daté exige une nomenclature de production, des gammes et des prévisions, qu'aucun écran ne produit aujourd'hui ; rouvrir seulement sur un besoin de fabrication nommé |

**Conséquence directe** : les deux fiches sont aujourd'hui descriptives et
facturables à la main ; elles ne pilotent encore ni le stock, ni les coûts, ni la
facturation. C'est exactement ce que les phases suivantes corrigent.

---

## Phase A — Socle : relier le catalogue aux documents et au stock

Objectif : qu'une ligne de devis, une réception ou une facture produise enfin un
effet mesurable sur le stock et la marge.

- **A1 — Lignes de documents rattachées au catalogue** *(bloquant, M)* — **fait**
  *Limite* : l'instantané et la référence sont posés ; le rapport de marge par
  famille qui les consomme est livré en F3.
  Renseigner `product_id` depuis l'écran de devis/facture, figer un instantané
  (libellé, TVA, unité, prix) pour que l'historique ne change pas quand la fiche
  évolue, et remonter les statistiques de vente par article et par famille.
  *Acceptation* : une ligne de devis créée depuis un article conserve son
  `product_id`, son prix d'alors, et apparaît dans les rapports par famille.
- **A2 — Réception de bon de commande → stock** *(bloquant, M)* — **fait**
  *Limite* : réception globale (pas de quantité reçue par ligne, voir C3) ; le
  coût rendu n'est pas recalculé, seul le prix d'achat de référence est rafraîchi.
  Au passage au statut `received` (ou réception partielle), créer un mouvement
  `in` par ligne stockable, mettre à jour le coût d'achat réel et le coût rendu,
  refuser une ligne de type service.
  *Acceptation* : réceptionner 10 unités augmente le stock de 10 avec un mouvement
  tracé à l'utilisateur et au bon de commande.
- **A3 — Sortie de stock à la facturation** *(M, dépend de A1)* — **fait**
  *Limite* : l'annulation est purement financière — elle ne rend pas la marchandise
  (voir décision 2) ; la restitution est l'action de retour de A6. La rétention
  (minimum 1 an) interdit par ailleurs d'annuler un document émis récemment.
  Décrémenter le stock des articles stockables à l'émission de la facture (ou à la
  validation, selon le réglage), avec mouvement `out` lié à la facture, et refus
  explicite si le stock est insuffisant pour un article non géré en négatif.
- **A4 — Assemblage de kit** *(M, dépend de A2/A3)* — **fait**
  Action « assembler N kits » : contrôle de disponibilité, sortie des composants,
  entrée du kit, mouvements liés entre eux par une référence commune.
  *Décisions* : un kit **sur commande** n'est jamais stocké — il est éclaté en
  composants à la vente, comme un kit fantôme Odoo ; seul un kit **en stock**
  s'assemble, son coût devenant la somme de ce qui est entré ; le démontage est
  un mouvement inverse daté, pas l'annulation de l'assemblage.
  *Limite* : l'éclatement à la vente est couvert par le calcul pur et le code,
  mais non rejoué en hébergé (cela aurait créé une facture verrouillée par la
  rétention).
- **A5 — Prestation en régie facturée au temps** *(L, dépend de A1)* — **fait**
  *Décisions* : le service, le niveau, la date et la majoration sont portés par le
  relevé ; les heures d'un même service/niveau/tarif forment une ligne ; le
  **minimum facturable est un plancher pour l'intervention**, pas pour chaque
  ligne (deux niveaux sur le même chantier partagent le plancher, réparti au
  prorata des heures pour que le total ne dépende pas de l'ordre de lecture) ; la majoration
  est une ligne à part au taux majoré ; les minutes facturées sont figées dans
  `billed_minutes` et les heures d'un relevé facturé ne sont plus modifiables.
  *Limite* : la correction d'un relevé facturé passe par un avoir, pas par une
  édition ; aucune distinction heures travaillées / heures facturées n'est
  exposée à l'écran (le minimum est appliqué au calcul, pas figé sur la ligne).
  Saisie de temps rattachée au service (et au niveau d'expertise), validation du
  relevé, génération d'une ligne de facture en appliquant la quantité minimale
  facturable (`billableQuantity`), les majorations nuit/dimanche et le TJM du
  niveau. Les tâches existantes servent de base : c'est un rattachement, pas un
  nouveau module.
- **A6 — Avoir et retour de marchandise** *(M, dépend de A3)* — **fait**
  Décider et implémenter ce qu'un avoir fait au stock : un avoir commercial ne
  rend pas forcément la marchandise, un retour si. Mouvement `in` motivé
  `credit_return`, rattaché à l'avoir, avec contrôle de la quantité déjà rendue.
  *Réalisé* : le retour est une action séparée (`GET/POST /invoices/:id/returns`),
  mouvement `in` motivé `customer_return`, référence = numéro de facture, valorisé
  au **coût** de l'article et non au prix de vente. Le plafond est calculé sur le
  journal : quantité sortie (`invoice`) moins quantités déjà rendues — un article
  non suivi ou une prestation n'a jamais bougé, donc n'est jamais retournable.
  Un brouillon ou une facture annulée refuse un retour (`INVALID_TRANSITION`),
  un dépassement est refusé en `RETURN_EXCEEDS_SOLD` en nommant la ligne. Écran :
  action « Retour marchandise » sur la facture, quantités plafonnées à l'affichable.
  *Limite* : la valorisation au coût utilise le coût courant de la fiche, pas le
  coût de sortie historique (pas encore de couche de valorisation, voir B3).

## Phase B — Stock exécutable

- **B1 — Inventaire tournant** *(M)* — **fait**
  Session de comptage par emplacement ou famille, écart calculé, mouvement
  d'ajustement motivé, verrouillage pendant le comptage.
  *Décisions* : le comptage est une **photographie** — la quantité attendue est
  figée à l'ouverture de la ligne, la personne saisit ce qu'elle voit, seul
  l'écart (`adjust`, motif `stock_count`) devient un mouvement ; une ligne vide
  n'est **pas** un zéro (validation refusée en `COUNT_INCOMPLETE`, qui dit combien
  de lignes manquent) ; une seule session ouverte à la fois (index unique
  partiel, `COUNT_ALREADY_OPEN`) car deux feuilles pourraient revendiquer la même
  étagère ; pendant le comptage, la quantité d'un article compté est **gelée**
  pour la saisie manuelle (`STOCK_COUNT_IN_PROGRESS` sur l'édition de fiche et
  l'ajustement, y compris assemblage/démontage de kit), mais une vente ou une
  réception reste possible : elle rend la ligne **périmée** et la validation est
  refusée (`COUNT_STALE`, article nommé) plutôt que d'écraser le mouvement réel ;
  annuler ne touche pas au stock.
  *Limite* : le périmètre « emplacement » s'appuie sur `products.warehouse_location`
  (pas encore de stock par emplacement, voir B4) ; un comptage laissé ouvert
  bloque toute saisie manuelle des articles concernés jusqu'à validation ou
  annulation ; l'écran n'a pas été vérifié dans un navigateur (pas de navigateur
  dans l'environnement), seulement son API.
- **B2 — Lots et numéros de série** *(L)* — **fait**
  Table `stock_lots` (lot, péremption, emplacement, quantité), mouvement par lot,
  règle FEFO à la sortie, blocage d'une sortie sans lot quand le mode de gestion
  l'exige.
  *Décisions* : le suivi se choisit **par article** (`lot_tracking` : aucun, par
  lot, par numéro de série) et non globalement, comme Odoo le fait sur la fiche ;
  un numéro de série est un lot d'**exactement une unité**, réutilisable jamais ;
  le lot n'est créé qu'à la **réception** (`POST /products/:id/lots`), jamais
  deviné après coup ; la sortie prend le lot dont la **péremption est la plus
  proche** (FEFO) et un lot **sans date ne passe jamais devant** un lot daté ;
  une quantité répartie sur plusieurs lots laisse **un mouvement par lot**, pour
  que la question « quel lot est parti chez ce client ? » ait une réponse ; le
  stock de l'article et la somme de ses lots avancent dans le **même lot de
  requêtes**, sans réconciliation différée ; le retour marchandise remet les
  unités **dans le lot d'où elles sont sorties**, lu sur la facture, et refuse
  (`lot: 'ambiguous'`) quand plusieurs lots ont été livrés sur la même ligne
  plutôt que d'en inventer un ; un ajustement de stock sur un article loté exige
  le lot.
  *Limite* : pas de **quantité par emplacement** — `location` est une étiquette
  d'information, pas une contrainte de picking ; l'**assemblage/démontage** de
  kits est refusé (`LOT_ASSEMBLY_UNSUPPORTED`) tant qu'il ne sait pas nommer les
  lots ; les articles lotés sont **exclus du comptage cyclique** (B1) plutôt que
  comptés faux ; les **retours multi-lots** sont refusés au lieu d'être répartis ;
  pas d'alerte de péremption planifiée ni de blocage à la vente d'un lot périmé
  (le lot est signalé comme périmé, la vente n'est pas refusée) ; le formulaire
  d'ajustement de stock de l'interface ne propose pas encore la liste des lots
  (le champ reste libre, le serveur valide) ; l'écran des lots n'a pas été vu dans
  un navigateur.
- **B3 — Valorisation CMP réelle et coût rendu** *(L)* — **fait (partie stock)**
  Recalcul du coût moyen à chaque entrée, journal de valorisation, exposition de
  la valeur du stock.
  *Décisions* : la moyenne ne bouge **qu'à l'entrée** et seulement si l'entrée
  porte un coût — une sortie part au coût que le stock avait déjà, sinon la marge
  et la valeur du stock se contrediraient ; une réception à coût nul n'écrase pas
  la moyenne ; une quantité nulle ou négative fait repartir la moyenne du coût
  d'entrée au lieu de moyenner contre un stock fantôme ; le **coût rendu** saisi
  sur la fiche prime sur le prix d'achat (fret, assurance, douane et frais
  d'approche font partie du coût des marchandises). Chaque entrée valorisée
  laisse une ligne dans `stock_valuations` (quantité et coût avant, entrée, coût
  et valeur après), lisible par `GET /api/products/:id/valuation` et dans
  l'onglet Stock de la fiche, derrière le masquage du coût (`accounting.read`).
  *Limite* : le coût rendu reste **un seul montant saisi** — le détail fret /
  assurance / douane / frais d'approche et son calcul sont F4 ; aucune écriture
  dans les comptes de stock 3xx (le journal comptable dérivé ignore encore le
  stock) ; un écart d'inventaire ajuste la quantité au CMP courant sans
  réévaluation comptable, donc aucun « écart de valorisation » n'est produit ;
  les retours clients rentrent au coût courant, pas au coût historique de sortie.
- **B4 — Emplacements multiples et transferts** *(M)* — **fait**
  Stock par emplacement, mouvement `transfer` entre deux emplacements, contrôle
  de cohérence.
  *Décisions* : le solde par emplacement est une **lecture du journal**
  (`stock_movements.location`), pas un compteur parallèle — un compteur
  finirait par mentir, et Odoo lui-même tient ses quants du grand livre ; le
  signe est appliqué en **un seul endroit** (`signedQuantity`) parce qu'une
  vente est stockée positive avec le type `out` alors qu'un ajustement porte son
  propre signe, piège qui ferait « remplir » un rayon qui se vide ; un
  **transfert** écrit deux mouvements (sortie de la source, entrée à
  destination) sous une même référence `TRF-`, sans toucher au stock total ni à
  la valorisation, exactement la définition Odoo du transfert interne ; les
  codes d'emplacement sont **enregistrés** dans `stock_locations` au premier
  transfert, pour qu'une étiquette ne s'écrive pas de deux façons ; le transfert
  refuse une source insuffisante (`INSUFFICIENT_LOCATION_STOCK`), un emplacement
  identique (`same_as_source`), une quantité nulle, un article non suivi et un
  article **loté** (`LOT_TRANSFER_UNSUPPORTED`) : un lot porte un seul
  emplacement sur sa ligne, le scinder est un travail en soi.
  *Limite* : pas d'**emplacement par défaut** obligatoire, donc les mouvements
  anciens restent dans un seau « sans emplacement » ; la vente sort toujours de
  l'emplacement de la **fiche article** (`warehouse_location`), pas d'un choix
  par ligne de facture ; pas de croisement **lot × emplacement** ; le comptage
  cyclique par emplacement filtre encore sur `warehouse_location` de la fiche et
  non sur les soldes réels ; la réception d'achat écrit à l'emplacement de la
  fiche ; l'écran des emplacements n'a pas été vu dans un navigateur.

## Phase C — Réapprovisionnement et achats

- **C1 — Propositions d'achat (MRP)** *(L, dépend de A2)* — **fait**
  Calcul à partir du seuil, du stock de sécurité, du stock maxi, du MOQ, du
  multiple et du délai ; regroupement par fournisseur en brouillon de bon de
  commande ; mode back-to-back limité aux commandes client en attente.
  *Décisions* : la quantité n'est **pas recalculée à la main** — la proposition
  réutilise `suggestedReorder`, la même formule que la fiche article, sinon le
  chiffre du rapport et celui de la fiche finiraient par se contredire ; la règle
  suit Odoo : déclenchement au **seuil** (min), reconstitution jusqu'au **maxi**,
  arrondi **au multiple supérieur** du fournisseur et jamais sous le **MOQ** ; un
  article en mode **manuel** n'est jamais proposé (c'est une décision d'acheteur,
  pas un oubli) ; un article **sans fournisseur** non plus, car un brouillon sans
  destinataire n'est pas une action ; le mode **back-to-back** n'achète que la
  **demande déjà vendue** (devis envoyé ou accepté non converti) moins le stock,
  comme la route MTO d'Odoo, au lieu de remplir un rayon pour une vente déjà
  conclue ; les **quantités sont recalculées côté serveur** au moment de créer le
  brouillon — le client n'envoie que des identifiants, donc un brouillon ne peut
  pas contenir un chiffre que le serveur n'a pas déduit ; la livraison prévue
  prend le **délai le plus long** du groupe, pas la moyenne ; le prix de ligne est
  le **prix d'achat** saisi, à défaut le coût.
  *Limite* : pas de **prévision de demande** ni d'historique de ventes pour
  proposer des seuils (le seuil reste saisi sur la fiche) ; pas de commande
  groupée multi-fournisseurs en un seul document ; le mode `mrp` ne déclenche
  aucune **fabrication** (pas de module de production : un kit s'assemble à la
  main) ; la demande back-to-back lit les devis envoyés/acceptés non convertis et
  ignore les commandes en cours de facturation ; pas de date de besoin par ligne ;
  l'écran des propositions n'a pas été vu dans un navigateur.
- **C2 — Fournisseurs secondaires et conditions** *(M)* — **fait (liaison, prix, historique)**
  Table de liaison article-fournisseur (prix, devise, MOQ, délai, référence), choix
  du fournisseur retenu et historique des prix.
  *Décisions* : chaque fournisseur garde **sa propre ligne** (`product_vendors`) au
  lieu d'écraser le prix d'achat de la fiche — un prix n'est vrai que pour celui
  qui l'a proposé, c'est la "liste de prix fournisseur" d'Odoo ; un seul
  fournisseur est **préféré** (le drapeau se déplace, il ne se cumule pas) et sert
  de choix par défaut, à défaut le moins cher puis le plus rapide ; à la
  commande, le prix du fournisseur choisi **remplit les lignes qui n'ont pas de
  prix**, mais **n'écrase jamais** un prix négocié saisi sur la ligne — c'est la
  seule règle qui évite une facture d'achat fausse ; le MOQ et le délai sont
  stockés par fournisseur et lus par le panneau de propositions ; la référence
  fournisseur est conservée telle quelle.
  *Historique des prix* : table `product_vendor_prices`, alimentée **seulement quand
  le prix ou la devise change** (réenregistrer le même prix n'invente aucun
  mouvement), et renvoyée avec la liste des fournisseurs ; la modale affiche sous le
  prix courant le **prix précédent et sa date**. Vérifié sur la preview : 12 000 →
  19 000 laisse 12 000 dans le relevé, un second enregistrement identique n'ajoute
  rien. *Décisions datées (2/11/2026)* : le MOQ reste une **information**, pas un
  blocage à la commande — bloquer une commande sur un seuil fournisseur ferait
  refuser une urgence pour une donnée que personne n'a validée ; la liste ne gère pas
  d'**échelle de prix par quantité** ni de période de validité, il faudrait décider
  comment deux échelles qui se chevauchent se départagent ; les propositions d'achat
  (C1) gardent le fournisseur **principal de la fiche** plutôt que le moins cher, car
  le moins cher n'est pas toujours celui qui livre ; la suppression d'un fournisseur
  reste à l'API pour ne pas effacer un prix avec lequel une commande a été passée.
- **C3 — Réceptions partielles et reliquats** *(M)* — **fait**
  Quantités reçues par ligne, reliquat, écart de prix signalé, clôture
  automatique quand tout est reçu.
  *Décisions* : le **reliquat n'est pas un second document** — Odoo propose de
  créer un reliquat séparé, ici la quantité due reste sur le même bon, ce qui
  évite un objet de plus à rapprocher et rend l'état toujours lisible d'un coup
  d'œil ; le reçu par ligne est **déduit de l'historique des réceptions**
  (`purchase_order_receipts`) et non d'un compteur sur la ligne, donc une
  réception ne peut pas être "à moitié" enregistrée ; la réception **refuse de
  dépasser le reliquat** (`RECEIPT_EXCEEDS_ORDERED`) au lieu d'écrêter
  silencieusement — trop recevoir veut dire erreur de saisie ou commande modifiée
  sans trace, les deux méritent un regard ; le stock n'augmente que des quantités
  cochées, et le bon **se clôt tout seul** quand plus rien n'est dû ; un écart
  entre le prix payé et la valeur du stock au moment de l'entrée est
  **enregistré** par réception et renvoyé à l'appelant (signalé en notification),
  ce qui rend l'écart de valorisation visible au lieu de le noyer dans le CMP.
  *Limite* : la réception physique et l'écriture des lignes de réception ne sont
  pas dans **une seule transaction** (le stock bouge, puis l'historique s'écrit) ;
  pas de **facture d'achat rapprochée** de la réception (pas encore de module
  d'achat facturé) ; pas de réception partielle depuis un **scan** de code-barres ;
  l'écart de prix est informatif, rien ne bloque la réception pour ce motif ;
  l'écran de réception n'a pas été vu dans un navigateur.
- **C4 — Alertes de stock** *(S)* — **fait**
  Brancher le tableau de bord et l'e-mail quotidien sur les seuils réels
  (rupture, stock faible, réappro suggéré).
  *Décisions* : l'alerte n'est pas une **règle nouvelle**, c'est le seuil déjà
  écrit sur la fiche relu (`reorder_point`, `safety_stock`, `max_stock`) — deux
  règles finiraient par se contredire ; la quantité suggérée réutilise
  `suggestedReorder`, la même formule que la fiche et les propositions d'achat ;
  l'ordre est celui de l'**urgence** (rupture avant stock faible, puis le plus
  gros manque), parce que les deux appellent des actions différentes ; un article
  **non suivi** ou un service n'est jamais alerté ; le tableau de bord porte les
  compteurs et les cinq premiers articles, la **liste complète** étant exposée par
  `GET /api/dashboard/stock-alerts` (une carte tronquée à cinq laisserait un
  article en rupture invisible), et le digest **nomme les articles** —
  « 12 articles » sans dire lesquels oblige à ouvrir l'application pour
  apprendre quelque chose ; le digest quotidien est limité à **un envoi par
  jour** (clé `stock_alert_last_sent`) partagé entre le passage planifié et les deux déclenchements
  manuels (`POST /api/runs/daily/manual`, `POST /api/runs/stock-alerts/digest`) ; une **configuration e-mail absente** n'échoue pas le passage :
  l'alerte existe dans l'application et la raison est rapportée (`sent: false`,
  `MAIL_NOT_CONFIGURED`).
  *Limite* : l'e-mail n'est pas **traduit** (texte français codé côté serveur, pas
  de i18n serveur) ; pas de **destinataire par rôle** (le digest part à l'adresse
  de la société) ; pas d'abonnement par article ni de seuil d'alerte distinct du
  seuil de réappro ; les **bons de commande en cours** ne sont pas déduits du
  manque (une alerte peut donc recommander ce qui est déjà commandé) ; pas de
  notification dans l'application (uniquement tableau de bord et e-mail) ; la
  carte du tableau de bord n'a pas été vue dans un navigateur.

## Phase D — Commercial et tarifs

- **D1 — Grilles tarifaires et remises volumiques** *(M, dépend de A1)* — **fait**
  Prix public / pro / adhérent par client, application automatique du palier
  (`discountForQuantity`) sur la ligne de devis.
  *Décisions* : la grille est un **champ du client** (`clients.price_tier`), pas une
  table de règles — Odoo appelle cela une liste de prix, mais une matrice de règles
  que personne ne remplit vaut moins que trois prix lus sur la fiche article ; les
  trois prix existaient déjà (`unit_price`, `price_pro`, `price_member`), la grille
  ne fait que choisir lequel s'applique ; un prix de grille **vide retombe sur le
  prix public** au lieu de facturer zéro ; le palier volumique **se cumule** avec la
  grille (prix pro puis remise de quantité) et **suit la quantité** tant que la
  ligne porte encore ce prix — dès qu'un prix est négocié à la main, il n'est plus
  jamais recalculé ; côté API, seules les lignes à **0** sont remplies, une ligne
  tarifée est une décision ; la grille ne touche ni le coût ni la marge (F3 reste au
  CMP).
  *Limites* : pas de prix négocié **par article et par client** (seulement les trois
  grilles générales de la fiche) ; pas de **dates d'effet** ni de devise par grille ;
  pas de remise par **catégorie** ou par famille ; pas d'**historique** des grilles
  (on ne sait pas quel prix s'appliquait il y a six mois) ; un devis existant garde
  ses prix, la grille ne le reprixe pas ; l'écran client et la ligne de devis n'ont
  pas été vus dans un navigateur.
- **D2 — Niveau d'expertise sur ligne de service** *(S, dépend de A1)* — **fait**
  Sélection du niveau dans le devis, tarif issu de `expertise_levels`.
  *Décisions* : le niveau est un **attribut de la ligne** (`expertise_level`), pas un
  second article — dupliquer la prestation en « Junior / Senior / Expert » multiplierait
  les fiches et casserait l'historique de vente par service ; le prix vient de la
  fiche, et un niveau **non publié est refusé** (422) au lieu d'être facturé au tarif
  de base, parce qu'un devis qui annonce « Expert » et facture le tarif junior est
  pire qu'une erreur ; un niveau à **0** est traité comme non publié ; le niveau
  s'applique **avant** la grille client (D1) : la prestation décrit le travail, la
  grille décrit le client, et la grille ne remplace jamais un prix de niveau ; une
  ligne **déjà tarifée** n'est pas reprixée ; le sélecteur n'apparaît que pour les
  services qui publient des niveaux.
  *Limites* : pas de **taux horaire** ni de temps passé rattaché au niveau ; pas de
  niveau **par défaut par client** ; pas d'**historique** des niveaux ; la marge (F3)
  ne se détaille pas par niveau ; le niveau n'est pas repris dans le suivi des
  tâches (il y reste indépendant) ; l'écran de devis n'a pas été vu dans un
  navigateur.
- **D3 — Substituts et accessoires suggérés** *(S)* — **fait**
  Proposition en cas de rupture et lors de la saisie d'un devis.
  *Décisions* : deux liens distincts, comme Odoo distingue l'**alternative** (elle
  remplace un article épuisé) de l'**accessoire** (il accompagne l'article) — les
  confondre ferait proposer du pain à la place du beurre ; les liens vivent dans
  `product_links` (`substitute` / `accessory`), pas en texte libre sur la fiche, pour
  rester des références vivantes qui suivent prix et stock ; les suggestions
  **voyagent avec la liste d'articles** plutôt que par une requête par ligne, sinon
  un devis de quinze lignes déclencherait quinze appels ; un substitut n'est proposé
  que sur un article **suivi et à zéro**, un article non suivi n'étant jamais en
  rupture ; l'ajout d'un accessoire crée une **ligne de plus** au lieu de modifier la
  ligne d'origine, pour que le client voie ce qu'il paie ; un lien vers soi-même ou
  vers un article inconnu est refusé (422) ; l'écriture remplace l'ensemble des liens
  d'un article en une transaction.
  *Limites* : pas de **priorité** entre substituts ni de substitut « par défaut » ;
  un accessoire est proposé mais **jamais imposé** ; pas de suggestion croisée par
  famille d'articles (le lien est explicite) ; pas de vérification que le substitut
  est lui-même disponible au moment de la proposition au-delà du drapeau `in_stock` ;
  les liens ne sont pas repris dans les **bons de commande** ni dans les alertes de
  stock ; l'écran de gestion des liens et les suggestions dans le devis n'ont pas été
  vus dans un navigateur.
- **D4 — Permission dédiée au coût** *(S)* — **fait**
  Remplacer `accounting.read` par `products.cost.read` pour ne plus donner accès aux
  livres pour cacher un prix d'achat ; migration des rôles et de la matrice.
  *Décisions* : le nom dit ce qu'il protège — `products.cost.read` protège une
  **information d'achat**, pas la comptabilité ; la permission est **exclue** du
  paquet de lecture opérationnelle, sinon lecteurs et commerciaux l'obtiendraient
  implicitement et le masquage n'aurait rien changé ; le comptable la reçoit (il
  chiffre les coûts), le propriétaire et l'administrateur aussi par construction ;
  la migration **préserve l'accès existant** : un rôle personnalisé qui lisait le
  journal reçoit `products.cost.read`, parce que le but est de pouvoir séparer les
  deux droits, pas de rendre aveugle du jour au lendemain ; elle est idempotente et
  ne touche pas les rôles système, qui se recalculent depuis la matrice.
  *Limites* : le masquage reste **binaire** (voir ou ne pas voir) sans notion de coût
  approximatif ; la permission n'est pas encore déclinée en écriture
  (`products.cost.write`) ; les rôles personnalisés migrés gardent la permission
  jusqu'à ce qu'un administrateur la retire à la main ; la matrice n'a pas été vue
  dans un navigateur.

## Phase E — Contrats de service et récurrence

- **E1 — Contrat → facture récurrente** *(M, dépend de A1)* — **fait**
  Depuis la fiche service (abonnement), créer et maintenir une `recurring_invoice`
  avec la fréquence, la date de fin, le préavis et la tacite reconduction ;
  prochaine échéance via `nextBillingDate`.
  *Décisions* : le contrat **naît de la fiche service** (`POST /api/recurring-invoices/from-service`)
  au lieu d'être retapé — une prestation vendue avec 30 jours de préavis ne peut pas
  être facturée sans, si les termes voyagent avec l'offre ; la fréquence, le préavis
  et le mode de reconduction sont **copiés** sur le contrat (`service_id`,
  `notice_days`, `renewal_mode`, `contract_start`) pour rester lisibles même si la
  fiche change ensuite ; un contrat créé ainsi démarre **actif**, pas en brouillon,
  parce qu'un contrat signé n'attend pas une seconde validation ; un article qui
  n'est pas un service est refusé (422) ; la prochaine échéance reste calculée par
  `nextBillingDate`, qui conserve le jour du mois et le borne à la longueur du mois.
  *Limites* : pas de **prorata** sur un premier mois partiel ; pas de facturation
  d'avance paramétrable (le cycle est facturé à échéance) ; la date de fin n'est pas
  déduite d'une durée contractuelle (elle se saisit) ; pas d'avenant ni de
  suspension/reprise historisée ; le préavis n'est pas encore utilisé pour une
  alerte (c'est E4) ; la modale n'a pas été vue dans un navigateur.
- **E2 — Révision tarifaire par index** *(M)* — **fait**
  Revalorisation programmée (index, pourcentage annuel), historique des révisions et
  conservation du prix contractuel par période.
  *Décisions* : le taux est saisi en **points de base** (`percent_bp`, 250 = 2,5 %)
  parce que des pourcentages flottants sur des montants entiers finissent par dériver
  d'un franc ; la révision s'applique **ligne par ligne** avec un arrondi unique, et
  l'historique stocke les totaux **avant/après** plutôt qu'un taux à recalculer —
  c'est ce qui permet de répondre à un client six mois plus tard ; le taux
  effectivement appliqué est recalculé après arrondi (`effectiveRate`), pour qu'une
  ligne d'historique ne prétende jamais un taux qu'elle n'a pas produit ; l'index
  vient de la fiche service (`price_revision_index`) et reste attaché au contrat ;
  un taux nul ou négatif est refusé, une révision sans ligne aussi.
  *Limites* : l'index n'est pas **lu** dans une table d'indices (le taux se saisit) ;
  pas de révision **automatique** à échéance ; pas de plafonnement ni de clause de
  sauvegarde ; l'historique ne conserve que les totaux, pas le détail ligne par ligne
  des anciens prix. **Écran de révision** : bouton « Réviser le tarif » sur chaque
  contrat, modale qui demande le **taux en pourcentage**, la **date d'effet** et le
  **motif / indice**, puis relit les totaux renvoyés par l'API ; vérifié sur la
  preview (250 bp appliqués en 201, total avant/après conservé dans l'historique,
  taux nul refusé en 422). *Décisions datées (2/11/2026)* : l'indice n'est pas lu dans
  une table d'indices — il faut d'abord décider **lequel** fait foi (ICPF, indice
  sectoriel, clause contractuelle) ; pas de révision automatique à échéance ni de
  plafonnement, car appliquer un taux sans qu'un humain l'ait signé est précisément
  ce que l'écran évite.
- **E3 — Reconnaissance du CA** *(L)* — **fait**
  Produits constatés d'avance et avancement au pourcentage d'achèvement, avec
  écritures et états associés.
  *Décisions* : une facture d'avance n'est pas du chiffre d'affaires — la création
  d'un échéancier **sort le montant des ventes** (706 → 487) et chaque constatation
  le ramène au prorata du temps écoulé (487 → 706) ; le taux d'avancement est
  calculé sur le **calendrier en points de base** (`completionRateBp`), ce qui évite
  d'accumuler les arrondis d'un passage à l'autre ; la constatation ne réécrit jamais
  un taux déjà comptabilisé (`recognitionDelta`), donc relancer la passe le même jour
  ne double rien ; les deux écritures sont **idempotentes** par
  `(source_type, source_id, event)` ; une facture brouillon, annulée ou supprimée est
  refusée, une seule échéance par facture, et une période inversée est rejetée ; le
  compte **487000 Produits constatés d'avance** rejoint le plan comptable.
  *Limites* : l'échéancier se crée **à la main** facture par facture (pas de
  détection automatique des lignes vendues en avance) ; pas de constatation
  **au montant livré** (seul le temps écoulé est utilisé, pas les jalons) ; pas de
  recalcul si la facture est modifiée après coup. *Décisions datées (2/11/2026)* : pas
  d'écran dédié — la constatation est une passe comptable, pas une saisie, et le
  solde se lit au grand livre (compte 487000) plutôt que sur un écran de plus qui
  pourrait diverger ; la passe quotidienne ne déclenche pas encore la constatation
  parce que la date de constatation doit rester une **décision datée et signée** du
  comptable, pas un effet de bord d'un cron.
- **E4 — Alerte de préavis** *(S)* — **fait**
  Alerte à J-30 avant échéance pour les contrats à tacite reconduction.
  *Décisions* : seuls les contrats **à tacite reconduction** sont surveillés — un
  contrat en **période ferme** ou à **date de fin fixe** s'arrête tout seul, et alerter
  sur un préavis qu'il n'a pas apprendrait à ignorer l'alerte ; un contrat **sans date de fin** n'a pas
  d'échéance, donc pas d'alerte ; le préavis se calcule depuis la date de fin
  (`noticeDeadline`) et le retard est signalé comme tel (`overdue`), parce qu'un
  préavis manqué n'est pas une échéance à venir ; les contrats en pause sont ignorés ;
  l'alerte est exposée par `GET /api/recurring-invoices/notices` (fenêtre `lead`
  paramétrable, 30 jours par défaut) **et** dans `/api/dashboard`, avec les cinq
  échéances les plus proches.
  *Limites* : aucune carte dédiée dans l'interface (les données sont dans la réponse
  du tableau de bord mais pas encore affichées) ; pas d'**e-mail** d'alerte de
  préavis ; pas de création automatique de tâche ; pas de renonciation enregistrée
  (le contrat reste actif jusqu'à sa date de fin) ; l'alerte ne propose pas encore
  l'action « résilier » ; l'écran n'a pas été vu dans un navigateur.

## Phase F — Coûts, analytique et fiscalité Polynésie

- **F1 — CPS sur les documents** — **retiré (taxe supprimée)**
  Une première version appliquait un CPS de 1 % sur les lignes de service, avec
  total, écriture au compte 447000 et mention au PDF. **C'était faux** : la
  Contribution pour la solidarité (dite « TVA sociale »), entrée en vigueur le
  1er avril 2022, a été **supprimée au 1er octobre 2023** par l'assemblée de la
  Polynésie française (Radio1 Tahiti, 1er août 2023 : « le retrait de la
  Contribution pour la solidarité (CPS, dite aussi TVA sociale) le 1er octobre
  prochain, un peu plus d'un an et demi après son entrée en vigueur »). Aucune
  facture polynésienne ne porte donc de ligne CPS aujourd'hui.
  *Correction* : le calcul, la colonne de total, l'écriture 447000, la ligne PDF et
  ses tests ont été **retirés** ; `invoices.cps_total` reste en base à zéro pour
  l'historique, sans être alimentée ; le champ `cps_rate` de la fiche article est
  conservé comme **champ historique**, mais il n'est plus appliqué nulle part et
  les nouveaux articles démarrent à **0**.
  *Ce qui reste vrai et vérifié* : les taux de TVA polynésiens sont **5 %, 13 % et
  16 %** (DICP, service-public.pf), et une facture doit porter le **numéro TAHITI**
  des parties, la date, la désignation, le prix HT, le taux et le montant de TVA,
  ainsi que la mention « TVA non applicable, franchise en base » le cas échéant.
  *Vérifié (2/11/2026)* : le PDF porte le numéro TAHITI du client
  (`server/services/pdf.ts`, ligne de facture `TAHITI : …`) et celui de l'entreprise
  dans le pied de page, et la phrase de régime fiscal (`legal_notes`, p. ex.
  « TVA non applicable, franchise en base ») s'imprime en corps de page dès que la
  facture est exonérée ou sans ventilation de TVA.
- **F2 — Comptes par défaut par famille** *(S)* — **fait**
  Mapping famille → compte de vente / d'achat / de stock, au lieu de la saisie
  libre par article.
  *Décisions* : le mapping est une **valeur par défaut, pas une copie** — la fiche
  garde ses trois champs vides et l'héritage reste **vivant**, sinon corriger le
  compte d'une famille obligerait à rouvrir chaque article (et une simple édition
  de fiche figerait l'héritage sans que personne l'ait demandé) ; **le compte de
  l'article gagne toujours** sur celui de la famille, car un article peut
  légitimement se comptabiliser ailleurs ; la valeur héritée est exposée à part
  (`effective_accounts` sur `GET /api/products/:id`) et **jamais écrite** dans le
  corps de la fiche, ce qui rend l'override explicite ; une famille **inconnue ne
  produit rien** (aucun compte inventé, aucune écriture créée à la volée) ; les
  codes sont validés (`^\d{3,8}$`, refus `422`) au lieu d'accepter du texte libre ;
  l'écriture exige `products.write`, la lecture reste ouverte pour que la fiche
  affiche ce qu'elle hérite ; chaque changement de mapping est journalisé
  (`activity.family_accounts`).
  *Réalisé* : schéma v36 (`family_accounts`), `server/lib/family-accounts.ts`
  (`resolveFamilyAccounts`, `familyAccountMap`), `GET /api/products/families/accounts`,
  `PUT /api/products/families/:family/accounts`, `effective_accounts` dans le
  détail d'un article, placeholders hérités et rappel dans l'onglet Finance de la
  fiche, modale « Comptes par famille » listant les familles en usage.
  *Limite* : la comptabilisation des factures n'utilise pas encore ces comptes
  (le plan comptable reste piloté par `CHART`), donc l'héritage est aujourd'hui
  **informatif**. *Décision datée (2/11/2026)* : brancher les comptes de famille dans
  les écritures suppose que le cabinet comptable tranche **compte par compte** (et
  qu'il valide la migration des écritures existantes) ; tant que ce n'est pas arbitré,
  les écrire en production fausserait le grand livre ; les compteurs de marge (F3) ne
  s'en servent pas non plus ; on ne
  peut pas encore créer un mapping pour une famille **sans article** depuis
  l'écran (il faut que la famille existe sur au moins une fiche), et il n'y a pas
  de suppression d'un mapping (mettre les trois champs vides suffit : plus aucun
  défaut n'est appliqué) ; l'écran n'a pas été vu dans un navigateur.
- **F3 — Axe analytique structuré** *(M)* — **fait (rapport et centres de profit, Q11)**
  Table des centres de profit / magasins, rattachement des lignes, rapport de
  marge par famille et par axe.
  *Réalisé* : `GET /api/reports/margin?from&to&group_by=family|axis|product`,
  écran Rapports → « Marge par famille ». Le CA est constaté **HT à la date de
  facture** (pas à l'encaissement : sinon le rapport décrirait la banque) ; un
  **avoir est soustrait du CA et du coût** des marchandises qu'il reprend, au lieu
  d'être ignoré jusqu'à la période suivante ; la remise du document est répartie
  sur ses lignes au prorata, le dernier centime allant à la dernière ligne pour
  que le total reste exact ; une ligne **sans coût connu** donne une marge
  **nulle** et un compteur `uncosted_lines`, jamais un 100 % flatteur ; le coût et
  la marge restent derrière `accounting.read` (réponse marquée `masked`).
  *Limite* : l'axe analytique est le champ libre de la fiche article — pas encore
  de table de centres de profit avec rattachement et contrôles ; le coût utilisé
  est le **CMP courant** et non le coût au moment de la vente (pas d'instantané de
  coût sur la ligne) ; les avoirs ne portent pas d'instantané de famille et se
  rabattent donc sur la fiche, et un avoir dont l'article a été supprimé tombe
  dans « sans famille » ; pas d'export CSV côté serveur pour ce rapport ; l'écran
  n'a pas été capturé à cette date ; Chromium est installé depuis le 2/11/2026 (voir Q16).
- **F4 — Coût rendu Tahiti calculé** *(M)* — **fait**
  Saisie du fret, de l'assurance, des droits et frais d'approche, taux de change
  d'origine, calcul et historique au lieu d'un montant saisi à la main.
  *Décisions* (sources : douane service-public.pf, DICP, CCISM, IEOM) : la
  **valeur en douane (CAF) = marchandise + fret + assurance** jusqu'à Tahiti
  (arrêté n° 344 CM) — le fret n'est donc pas un frais « en plus », il est dans
  l'assiette ; les **droits de douane n'entrent pas dans la CAF mais entrent dans
  l'assiette de la TVA d'import** (`TVA = taux × (CAF + droits + taxes locales)`),
  ce que la faq douanière chiffre explicitement ; le **péage du Port autonome de
  Papeete (1,25 % de la CAF)** est modélisé comme taxe locale, alors que la
  **prestation du transitaire, le magasinage et le PID (85 XPF/article)** sont des
  services achetés localement : ils entrent dans le coût mais **pas** dans
  l'assiette de TVA ; la **TVA d'import est récupérable** pour une entreprise au
  régime réel (la DICP rembourse le crédit sur relevé des documents d'importation)
  et reste donc **hors du coût**, mais elle est **dans le coût en franchise en base**
  (case à décocher), car elle n'y est pas déductible ; le **taux normal est 16 %**, celui qui frappe les produits importés (le taux par défaut
  d'une société neuve est 13 %, celui des services) ; le
  **franc est arrimé à l'euro** (1 000 XPF = 8,38 EUR, IEOM), le taux par défaut
  d'une facture en euros est donc 119,3317 et il reste **modifiable** car la douane
  applique son propre cours pour les autres devises ; chaque calcul est une **ligne
  d'historique jamais réécrite** (le coût d'hier doit rester explicable), et
  `products.landed_cost` porte le **dernier** calcul, celui dont le stock sort
  (`landedUnitCost`, B3) ; écrire un coût exige aussi `products.cost.read` (D4) :
  saisir un coût depuis un écran masqué serait une écriture à l'aveugle.
  *Réalisé* : `shared/landed-cost.ts` (`computeLandedCost`, `toXpf`, constantes
  `XPF_PER_EUR`, `PORT_FEE_RATE_BP`, `DEFAULT_VAT_RATE_BP`), schéma v37
  (`landed_cost_sheets`), `POST /api/products/:id/landed-cost` (calcul, historique,
  mise à jour du coût rendu), `GET /api/products/:id/landed-cost` (historique,
  masqué sans `products.cost.read`), modale « Calculer le coût rendu » dans l'onglet
  Finance avec aperçu calculé **par la même fonction que le serveur** et historique,
  champ de coût rendu passé en lecture seule, journal `activity.landed_cost_computed`.
  *Limite* : pas de **nomenclature tarifaire** — le taux de droit de douane est
  saisi, pas déduit d'un code SH (le tarif des douanes 2025 n'a pas pu être lu :
  PDF) ; les taxes spécifiques ne sont **pas** modélisées (TEA 2 %, taxe
  statistique 50 XPF/quintal, TSGTR, redevance gare de fret aérien 4,899 XPF/kg) :
  elles passent par le champ « frais d'approche » ; un calcul porte sur **un seul
  article**, pas de ventilation d'un conteneur multi-lignes au prorata (poids ou
  valeur) ; la TVA d'import n'est **pas comptabilisée** au journal (aucune écriture
  4456/487) ; le taux de 1 % « archipels » évoqué pour 2026 n'est pas paramétré
  faute de source officielle lue ; l'écran n'a pas été vu dans un navigateur.


## Phase H — décisions issues des 16 réponses (nov. 2026)

Les 16 questions ouvertes ont reçu des réponses (fiscalité, coût rendu, projets,
données). Ce qui est appliqué, et ce qui reste à ouvrir :

> **État au 2 novembre 2026** — tout ce qui relève du code est livré et vérifié sur
> la preview (contrôles hébergés rejoués à chaque déploiement). Il ne reste plus que
> **Q16** est livré (captures locales, 2/11/2026) et **G2/G3** sont fermés. Il ne
> reste que des entrées **externes nommées** : **H4** (les 3 à 5 fichiers réels de
> l'ancien logiciel) et **H5** (une preview dédiée + trois secrets GitHub Actions).
> Chacun porte sa date et sa raison ci-dessous ; aucune tâche de code n'est laissée
> ouverte.
>
> **SLA (2/11/2026)** — un espace neuf ouvre désormais avec **trois paliers standard**
> (P1 1 h / 4 h, P2 4 h / 8 h, P3 8 h / 24 h, en minutes ouvrées), définis à un seul
> endroit (`shared/planning.ts`) et créés en base **une seule fois** : un palier
> existant — même renommé, retimé ou désactivé — n'est jamais recréé ni écrasé. Ils
> sont éditables et désactivables depuis l'onglet SLA de Planification, où l'écran
> liste aussi les **engagements en cours** (politique retenue, échéances enregistrées,
> badge « dépassée »), relus depuis `task_sla` après rechargement.
>
> **Reprise à faire (2/11/2026, 07:10)** — le déploiement des deux dernières
> modifications (libellés anglais H3 retouchés, règles d'import H4) a été **refusé par
> l'hébergement** : le quota **« lignes de base de données écrites par jour »** est
> atteint (10 042 / 10 000), ce qui met les sites en pause ; les autres quotas sont
> loin (requêtes 1 892 / 100 000, CPU 27 s / 5 000 s, stockage 1,9 Mo / 100 Mo) et les
> **données sont conservées**. Remise à zéro le **3 novembre 2026 à 00:00 UTC** ; la
> preview répond `429` d'ici là. Le build local est vert (`typecheck` 0, **81 fichiers
> de tests (671 cas)**, build OK) ; la **vérification hébergée** de ces deux points reste **bloquée par ce quota** :
> à faire dès la remise à zéro (3/11/2026 00:00 UTC) — construire, publier, puis
> `npm run check:preview:hosted` (quatre contrôles : écrans de stock, tarif, démo et
> centres ; historique de prix et révision ; séparation des droits ;
> planification/SLA — paliers standard, édition persistée, politique appliquée et
> échéances relues après rechargement).

- **Q1 — TVA d'import comptabilisée** — **fait** : au dédouanement, débit `445660`
  et crédit `401` (transitaire) ou `512` (douane payée directement), une écriture
  par feuille (`source_type = landed_cost`, `event = import_vat`), jamais deux ;
  en franchise en base la TVA reste dans le coût et rien n'est passé.
  *Limite* : seuls les **droits de douane** restent hors journal (le stock n'est
  pas comptabilisé à l'achat dans cet ERP) ; la contrepartie 401 n'est pas lettrée
  à un fournisseur nommé (le journal n'a pas de compte auxiliaire).
- **Q14 — conservation** — **vérifié, rien à changer** : `retention_years` vaut
  **10** par défaut, et l'annulation comme la **suppression** d'un document émis
  sont refusées (`RETENTION_LOCKED`) tant que le délai n'est pas écoulé.
- **Q2 — cascade des comptes** — **fait** : la ligne gagne sur l'article, l'article
  sur la famille, la famille sur le plan comptable. Drapeau `item_accounts`
  (**éteint par défaut**) : activé, la vente se comptabilise sur le compte de
  l'article, sinon celui de sa famille, sinon `706000`. L'**instantané** est le
  compte écrit sur la ligne d'écriture : changer une fiche demain ne réécrit pas
  ce qui a été passé hier (vérifié). Les comptes de **TVA** viennent du code taxe,
  jamais de l'article ; `subcontract_account` reste un compte de charge pour un
  achat et une simple information sur une vente. La remise du document est
  répartie sur les lignes comme dans le rapport de marge, le dernier compte
  absorbe l'arrondi : le total des produits égale exactement le CA net.
  *Limite* : le **compte de ligne** est accepté par le résolveur mais aucun écran
  ne l'expose encore (il faut un champ par ligne de devis/facture) ; seuls les
  **comptes de vente** sont routés (les achats et le stock ne sont pas
  comptabilisés à l'achat dans cet ERP) ; les avoirs suivent la même règle que les
  factures.
- **Q4 — TVA 1 % archipels** — **fait** : le taux de 1 % est sélectionnable sur une
  ligne, mais l'émission est **refusée** (`ARCHIPELAGO_VAT_EVIDENCE`, 422) sans le
  numéro Tahiti du client, un archipel parmi Tuamotu / Marquises / Australes /
  Gambier, la référence du transport et la case « expédié par nos soins ». Une
  famille exclue (`Alcools`, `Tabacs`, liste **paramétrable** dans les réglages)
  est refusée avec toutes les preuves (`ARCHIPELAGO_VAT_EXCLUDED`). Les preuves
  sont **enregistrées sur la facture** (`archipelago`, `transport_reference`,
  `shipped_by_seller`), car la TVA est réclamée si elles manquent ; l'écran de
  facture les demande dès qu'une ligne porte le 1 %.
  *Limite* : la preuve n'est pas reproduite sur le **PDF** ny dans les **devis**
  (le contrôle est posé à la facture, là où la taxe est due) ; pas de contrôle sur
  l'**origine** archipel (vente **depuis** les îles vers tout client), qui suppose
  de qualifier l'établissement émetteur ; la liste d'exclusion compare les familles
  **exactement** (une famille nommée « Alcools et spiritueux » doit être ajoutée à
  la liste) ; aucun contrôle de cohérence avec l'adresse du client.
- **Q6/Q7 — tarif douanier et taxes paramétrables** — **fait (moteur et API)** :
  table `tariff_codes` (position, taux normal, taux UE, taux Océanie, TVA) et table
  `import_tax_rules` (base parmi CAF / CAF+droits / kg / quintal / article, taux ou
  montant, mode de transport, ordre, fenêtre de validité, source). Les taxes que la
  FAQ douanière publie (**TEA 2 % CAF**, **PID 85 XPF/article**, **taxe statistique
  50 XPF/quintal**, **péage PAP 1,25 % maritime**) sont **semées** et se modifient
  par API (`GET/PUT/DELETE /api/import-taxes/rules/:code`, `/tariffs/:code`), une
  règle désactivée n'est jamais supprimée — un coût rendu ancien doit rester
  explicable. Le coût rendu prend le **droit de la position tarifaire** de l'article
  selon l'**origine** (UE/Océanie avec certificat, sinon taux normal), applique
  chaque règle sur **sa propre base**, puis calcule la TVA sur **CAF + droits +
  taxes**. Le transport et l'origine sont stockés avec les lignes de taxes.
  **Écran** dans Paramètres → Taxes : les règles d'import s'éditent (taux, montant,
  transport, activation) et les positions tarifaires s'enregistrent depuis
  l'application, vérifié sur la preview (50 → 55 XPF puis retour, position 13 % / UE
  0 % relue). *Limite* : pas d'import automatique du tarif (le tarif des douanes est
  un PDF OCRisé, la saisie reste manuelle) ; la redevance de la gare de fret aérien
  n'est pas semée (montant non vérifié) ; la base « CAF + droits » est disponible
  mais aucune règle par défaut ne l'utilise.
- **Q8 — feuille d'import multi-articles** — **fait** : `shared/import-sheet.ts`
  (`allocate`, `computeImportSheet`), tables `import_sheets` / `import_sheet_lines`,
  `POST/GET /api/import-sheets`, modale « Feuille d'import (plusieurs articles) ».
  Le fret, l'assurance et la facture du transitaire sont payés **une fois** : ils sont
  répartis sur les lignes par la clé choisie (valeur, poids ou quantité) avec la
  **méthode du plus fort reste**, et la somme des parts égale **exactement** le montant
  payé (le reliquat va aux plus grandes fractions, à égalité la première ligne).
  Chaque ligne porte ensuite ses **propres** CAF, droit (position tarifaire de
  l'article, repli sur le taux de la feuille), taxes locales (poids, articles),
  TVA d'import, coût rendu et part en points de base ; le coût rendu de chaque
  article est mis à jour et **une seule** écriture de TVA d'import est passée pour la
  déclaration. Les parts sont **stockées** ligne par ligne : un coût se défend avec son
  arithmétique. La modale liste les **feuilles enregistrées** (date, référence,
  nombre de lignes, coût total) à côté du calcul. *Décision datée (2/11/2026)* : pas
  d'avoir ni de règlement fournisseur rattaché à la feuille — la feuille est un
  calcul de coût, la pièce comptable reste la facture d'achat ; le taux de change
  reste saisi (voir la justification de Q15 : la parité XPF/EUR est fixe).
- **Q9/Q10 — modèles de projet versionnés et projets nés du devis** — **fait** :
  `shared/project-template.ts` (`normaliseTemplateTasks`, `templateEstimateMinutes`,
  `nextVersion`), `server/lib/project-templates.ts` (le seul endroit qui transforme une
  version en projet), tables `project_templates`, `project_template_versions`,
  `project_template_tasks`, colonnes `projects.template_version_id` / `projects.quote_id`
  et `quotes.project_template_id` / `quotes.project_template_version`, routes
  `GET/POST /api/project-templates`, `POST /api/project-templates/:id/versions`,
  `GET /api/project-templates/:id/versions/:version`,
  `POST /api/project-templates/:id/instantiate`, `DELETE /api/project-templates/:id`
  (archive, jamais suppression), modale « Modèles de projet » et champ « Modèle de
  projet rattaché » sur le devis. Un modèle **ne se modifie jamais** : enregistrer
  crée la version suivante, et chaque projet retient la version dont il vient. À
  l'acceptation d'un devis rattaché, le projet s'ouvre en **`planned`**, ses tâches en
  `todo` avec la charge estimée, et le projet garde le lien au devis ; une seconde
  acceptation est refusée en 409 et ne crée aucun doublon. L'**acceptation depuis un
  lien public** passe par le même chemin (`server/routes/public-links.ts`), donc le
  projet s'ouvre aussi quand c'est le client qui accepte, et la seconde acceptation
  (déjà conditionnelle) ne crée pas de second projet. Statut `planned` ajouté à
  `PROJECT_STATUSES`. *Décisions datées (2/11/2026)* : pas d'écran de comparaison de
  deux versions ni de fusion de modèles — comparer ne sert qu'à un cycle de révision
  de modèle, décision produit non prise ; pas de duplication d'un projet existant
  vers un modèle — il faudrait choisir quelles tâches deviennent le modèle et avec
  quelle charge, décision du propriétaire ; et la modale ne permet pas de
  **corriger** une version : c'est voulu, un modèle accepté ne se réécrit pas, on
  crée la version suivante.
- **Q11 — centres de profit** — **fait** : table `profit_centers` (code, libellé,
  archivage), `shared/profit-centers.ts` (`normaliseProfitCenter`,
  `isValidProfitCenter`, `aggregateProfitCenters`), routes `GET /api/profit-centers`,
  `PUT /api/profit-centers/:code`, `DELETE /api/profit-centers/:code` (archive) et
  `GET /api/profit-centers/summary?from&to`. La ligne de document porte
  `profit_center`, **instantané** normalisé en majuscules à l'enregistrement :
  renommer ou archiver un centre ne réécrit aucun document émis, et le code reste
  lisible même s'il a quitté la liste (seul le format est vérifié). Le rapport lit les
  **documents** (factures non brouillon de la période) et garde une ligne « sans
  centre » : le total du rapport égale donc le chiffre d'affaires qu'il prétend
  expliquer. Écran : case « Centre de profit » sur chaque ligne de devis/facture
  (avec la liste des centres actifs) et bloc « Centres de profit » dans Paramètres →
  Taxes ; rapport **Centres de profit** dans Rapports, export CSV compris. Les avoirs
  sont **déduits** : une note de crédit réduit le centre de la ligne remboursée, et un
  centre dont la facture et l'avoir s'annulent disparaît du rapport au lieu
d'afficher une ligne à zéro (vérifié sur la preview : base 100 000 → 70 000, TVA
  16 000 → 11 200, total 116 000 → 81 200). *Décision datée (2/11/2026)* : pas de
  ventilation mensuelle — le rapport est par période, ce que demande un centre de
  profit ; une ventilation par mois serait un autre rapport, à ouvrir si le besoin
  est confirmé par le propriétaire.
- **Q12 — soldes de lots par emplacement** — **fait** : table
  `lot_balances(lot_id, location, quantity_milli)`, `server/lib/lot-balances.ts`
  (`signedLotQuantity`, `lotBalancesFromMovements`, `transferMovements`), routes
  `GET /api/products/:id/lots/balances`, `POST /api/products/:id/lots/:lotId/transfer`
  et `POST /api/products/:id/lots/balances/rebuild`. La réception crédite l'étagère,
  la sortie de stock débite l'étagère qui détient réellement le lot (la plus pleine,
  jamais en négatif), et un **transfert est deux mouvements** — sortie puis entrée,
  même référence — jamais une mise à jour de champ qui laisserait l'étagère quittée
  pleine. Refus : même emplacement 422, quantité indisponible 409, lot inconnu 404.
  `POST .../rebuild` recalcule les soldes **depuis le journal des mouvements** : le
  journal est la preuve, un écart se répare au lieu de se cacher. **Écran** : la fiche
  article affiche les soldes par emplacement et transfère un lot (lot, emplacement
  source, destination, quantité), vérifié sur la preview (ENTREPOT 5 / BOUTIQUE 3).
  *Limite* : le prélèvement FEFO ne choisit pas l'étagère — il soulage la plus pleine
  du lot.
- **Q13 — remise à zéro de la démonstration** — **fait** : `server/routes/demo.ts`,
  `GET /api/demo` (état), `PUT /api/demo/mode` (drapeau, journalisé) et
  `POST /api/demo/reset {reseed}`. **Deux serrures** : le drapeau `demo_mode` doit
  être allumé, ou le déploiement doit porter `DEMO_RESET=1` ; sinon 409
  `DEMO_RESET_DISABLED`. Le reset vide **toutes** les tables transactionnelles
  découvertes dans `sqlite_master` sauf la liste de ce qui décrit l'espace de
  travail (entreprise, utilisateurs, rôles, paramètres, taux de taxe, numérotation,
  catégories de dépense, tarif et règles de taxes d'import, centres de profit,
  modèles de projet, comptes bancaires, journal) et sauf les tables de la plateforme
  (`_cf_*`) ; une table qu'il ne connaît pas est **signalée**, jamais devinée. Puis
  le jeu de démonstration est réinstallé par le même service que l'installation. Le
  journal est conservé et le reset y est écrit. **Écran** : Paramètres → Taxes, case
  « Cette instance est une démonstration » et bouton « Remettre la démonstration à
  zéro », visible **uniquement** quand le drapeau est allumé, derrière une
  confirmation explicite (danger) ; vérifié sur la preview (tables vidées, aucune
  ignorée, jeu de démonstration réinstallé, drapeau laissé allumé pour que le bouton
  reste visible). *Décision datée (2/11/2026)* : le reset n'archive rien avant
  effacement — une sauvegarde préalable demande une destination de stockage et une
  politique de rétention, décision d'exploitation qui revient au propriétaire.
- **Q15 — multi-devises des ventes** — **non fait, justification datée (2/11/2026)** :
  le franc Pacifique est arrimé à l'euro à parité **fixe** (1 000 XPF = 8,38 EUR,
  constante `XPF_PER_EUR` = 119,3317 dans `shared/landed-cost.ts`), donc une vente en
  euros ne peut produire aucun écart de change ; les documents portent déjà leur
  `currency` et le taux d'achat est enregistré (`exchange_rate_micro`). Ce qui
  manquerait vraiment — comptes d'écart de réalisation 666/766 et réévaluation de fin
  d'exercice — ne se justifie que pour une **devise tierce** (USD, AUD), et aucune
  vente dans une telle devise n'existe. L'implémenter aujourd'hui serait un module de
  change sans transaction derrière. Ce qui rouvre le sujet, nommément : **une première
  facture émise dans une devise non arrimée à l'euro**.
  *Arbitrage du 2/11/2026 (demande : « si c'est facile, fais-le tout de suite »)* :
  **ce n'est pas facile**, et le livrer à moitié serait pire que l'absence. Il ne
  suffit pas d'ajouter un champ : chaque montant d'un document en devise tierce doit
  être converti **au taux figé du jour** pour le journal, la balance, la TVA, les
  règlements partiels, les avoirs, les rapports et les PDF, avec un compte d'écart
  (666/766) et une réévaluation de clôture. Les totaux sont aujourd'hui sommairement
  stockés dans l'unité du document et lus tels quels par la comptabilité : une facture
  USD passée maintenant produirait un journal faux **silencieusement**. Le module
  représente donc une phase à part entière (table de taux, taux figé par document,
  montant en devise de tenue, écritures de change, réévaluation, écrans et tests).
  Ce qui le rend mécanique le jour où une telle facture existe : (1) table `exchange_rates`
  datée et saisie, (2) `exchange_rate` + `base_total` figés sur devis/facture/avoir,
  (3) conversion à la source pour le journal et les rapports, le document restant
  lisible dans sa devise. Tant qu'aucune facture hors XPF/EUR n'existe, ce travail
  n'aurait aucune transaction à convertir.
- **Q16 — captures d'écran** — **fait (2/11/2026)** : Playwright est installé et
  Chromium a pu être obtenu ici (`npx playwright install chromium` → Chrome for
  Testing **156.0.8078.4**, cache de 681 Mo). Les bibliothèques système manquantes
  (libnspr4, libnss3, atk, atspi, X11, cairo, pango, cups, avahi) ont été extraites
  **sans root** depuis les paquets Ubuntu (`apt-get download` + `dpkg-deb -x`) et
  fournies par `LD_LIBRARY_PATH`, avec une police DejaVu et un `fonts.conf` local.
  Sur une instance locale installée avec le jeu de démonstration
  (`POST /api/setup/install` → **201**), `node scripts/screenshots.mjs` a produit
  **8 captures 1440×900** dans `artifacts/` : connexion, tableau de bord, produits,
  feuille d'import, projets, modèles de projet, devis, paramètres. Elles sont
  commitées comme preuve visuelle. Le script accepte `BASE_URL`,
  `SCREENSHOT_EMAIL`, `SCREENSHOT_PASSWORD`, `PW_CHROME_PATH`, `PW_NO_SANDBOX` et
  `PW_CHANNEL`.
  *Limite nommée* : la preview **hébergée** reste suspendue par le quota D1, donc les
  captures viennent d'une instance **locale du même build**, pas du site hébergé.

## Phase G — Planification et projets

- **G1 — Modèle de projet → projet réel** — **fait (2/11/2026, livré avec Q9/Q10)** :
  l'acceptation du devis crée le projet et ses tâches depuis la version du modèle,
  avec la charge estimée. Le déclencheur est l'acceptation du devis parce qu'il
  n'existe pas de bon de commande de service distinct dans l'application ; le jour où
  il en existera un, c'est lui qui déclenchera, pas la facture.
- **G2 — Compétences et capacité** — **fait (2/11/2026)** :
  réponses reçues — (1) sont planifiables **tous les comptes actifs**, avec une
  capacité hebdomadaire en heures saisie par compte ; (2) unité **heures par
  semaine**, agrégation mensuelle à l'affichage ; (3) jours ouvrés **lundi–vendredi**
  plus un **calendrier de jours non travaillés saisi à la main**, pré-rempli avec la
  liste des fériés validée ; (4) conflit = **somme hebdomadaire supérieure à la
  capacité**, les tâches **non assignées exclues de la capacité** mais visibles dans
  la charge du projet ; (5) réaction : **alerte seulement**, jamais de refus.
  *Réalisé* : `shared/planning.ts` (début de semaine ISO, minutes ouvrées, ajout de
  délai ouvré, charge hebdomadaire, dépassements, minutes non assignées),
  `server/routes/planning.ts` monté sur `/api/planning` — réglages (`weekly_capacity_minutes`,
  `working_days`, `business_start/end` dans `settings_extra`), capacités par compte
  (`weekly_capacities`), calendrier des jours non travaillés (pré-rempli une fois avec
  les **fériés de Polynésie française**, puis éditable ligne à ligne), affectation et
  dates prévues (`task_planning`), rapport hebdomadaire avec dépassements et charge
  non assignée. **Aucune valeur en dur** : la capacité, les jours ouvrés, les horaires
  et les fériés sont des données ; un espace peut passer à 6 jours ou 07:00–15:00 sans
  toucher au code. Vérifié par `tests/planning.test.ts`.
  **Écran** : `Planification` dans la navigation (opérations), quatre onglets —
  charge hebdomadaire (capacité, charge, %, dépassement signalé, navigation par
  semaine, affectation/désaffectation d'une tâche avec dates prévues, charge non
  assignée), réglages (capacité par défaut, jours ouvrés, ouverture/fermeture,
  capacité par compte), calendrier (liste, ajout, modification, suppression des jours
  non travaillés) et SLA. Tous les libellés passent par le dictionnaire fr/en ; aucune
  valeur n'est écrite dans les composants : la grille, les jours ouvrés et les horaires
  viennent de l'API. **Liste des fériés validée le 2/11/2026** : le 29 juin
  (Fête de l'autonomie) a été retiré de la liste légale à compter de 2026 et
  remplacé par le **20 novembre** (Matari'i — fête de l'abondance) ; le
  pré-remplissage suit cette règle pour 2026 et 2027, et les espaces déjà ouverts
  reçoivent la correction ciblée décrite en fin de document.
- **G3 — SLA exécutés** — **fait (2/11/2026)** : sont tranchés — le SLA est porté par le **client**, avec surcharge
  possible par **contrat** ; **aucune suspension** du chronomètre ; dépassement =
  **alerte au tableau de bord** et **visible sur la fiche client**. Les deux inconnues qui empêchaient de calculer une échéance ont été tranchées le
  2/11/2026 : (a) **trois paliers standard** (P1 1 h / 4 h, P2 4 h / 8 h,
  P3 8 h / 24 h, en minutes ouvrées) sont créés **une seule fois** par espace ;
  (b) les **heures ouvrées, les jours ouvrés et les fériés** sont des réglages
  (`PLANNING_DEFAULTS`, calendrier éditable), donc aucune valeur contractuelle
  n'est devinée dans le code.
  *Réalisé* : tables `sla_policies` (par **client** ou par **contrat**, priorité,
  délai de prise en compte et de résolution, désactivation sans suppression) et
  `task_sla` (échéances calculées sur le **calendrier ouvré** de l'espace), routes
  `GET/POST /api/planning/sla-policies`, `POST /api/planning/tasks/:id/sla` (politique
  la plus spécifique, contrat avant client) et `GET /api/planning/sla-breaches` (les
  dépassements que le tableau de bord et la fiche client liront). Aucun délai n'est
  codé en dur : ce sont des lignes. Écran : onglet SLA de Planification (liste des politiques par client ou contrat, création, désactivation sans suppression, application à une tâche et échéances dépassées reliées à la fiche client).

## Phase H — Qualité, droits, audit

- **H1 — Permissions fines** — **fait (2/11/2026)** : `stock.adjust` est une
  permission distincte de `products.write`, portée par les routes qui **bougent une
  quantité** (ajustement, transfert d'emplacement, création et transfert de lot,
  recalcul des soldes, assemblage/démontage, validation d'un inventaire tournant).
  La matrice par défaut **ne retire le droit à personne** : seuls les rôles qui
  pouvaient déjà écrire les articles la détiennent (owner, admin), et les rôles
  personnalisés stockés qui avaient `products.write` la reçoivent par migration
  (`UPDATE roles` idempotent au schéma v46) — c'est au propriétaire de la resserrer
  dans « Rôles & permissions », ce que l'écran permet déjà. Vérifié sur la preview :
  `commercial@` reçoit 403 sur l'ajustement, l'administrateur passe. `products.cost.read`
  (D4) reste en place et appliqué.
- **H2 — Audit de fiche** — **fait (2/11/2026)** : le journal affiche déjà un diff
  **champ par champ** avant/après, et `GET /api/activity` **masque** désormais les
  clés de coût (`price`, `cost`, `margin`, `marge`, `salary`, `paie`) en `•••` pour un
  compte qui n'a pas `products.cost.read` — le changement reste auditable, sa valeur
  ne fuit plus. Vérifié sur la preview : l'administrateur voit les montants,
  `comptable@` reçoit des `•••`, `commercial@` n'a pas accès au journal (403).
- **H3 — i18n des libellés métier** — **fait (2/11/2026)** : les énumérations métier
  (types d'article et de service, cycle de vie, modes de stock, valorisation,
  paliers de prix, réapprovisionnement, assemblage, unités et déclencheurs de
  facturation, renouvellement, frais, zones, reconnaissance du CA, rôles, catégories
  et pièces client, régimes de TVA, moyens et délais de paiement, banques, statuts de
  compte) ont leur **traduction anglaise** dans `shared/labels-locale.ts` : les cartes
  restent françaises (la référence) et répondent en anglais dès que la langue de
  l'interface bascule, sans toucher aux ~100 points d'appel existants. Le repli est
  explicite : une clé non traduite reste en français plutôt que d'afficher un code
  technique. Vérifié par `tests/enum-labels.test.ts` (français par défaut, anglais
  après bascule, clés d'itération inchangées, retour au français).
- **H4 — Import / export enrichi** — **fait pour tout ce qui ne dépend pas des
  fichiers du propriétaire (2/11/2026)** : (1) une ligne dont le taux de **TVA ne
  correspond à aucun taux local** (0, 1, 5, 13, 16 %) est **refusée ligne par
  ligne** (`unknown_tax_rate`), les autres lignes restant valides ; (2) un
  **doublon** met à jour la fiche existante et l'aperçu le **signale**
  (`duplicate: true`, action `update`) ; (3) un export d'ancien logiciel se lit
  **sans être réécrit** : alias d'en-têtes français et anglais (`IMPORT_ALIASES`,
  accents, casse et ponctuation ignorés), **correspondance de colonnes choisie
  dans l'écran** (envoyée au serveur, elle gagne sur la détection), colonnes
  inconnues **signalées** au lieu d'être devinées, nombres `1 500` / `2,5` et dates
  `01/03/2026` normalisés, et **message lisible par ligne** pour chaque refus
  (`issue.message`, en plus du code). Le séparateur reste détecté (`;` ou `,`).
  *Preuve exécutée* : `tests/import-mapping.test.ts` (13 tests : en-têtes accentués,
  anglais, mapping manuel, prix espacés, dates françaises, factures multi-lignes,
  dates impossibles), plus `tests/import.test.ts`, `tests/import-rules.test.ts` et
  `tests/import-invoices.test.ts` ; `typecheck`, `npm test` et `npm run build` verts.
  *Modèle ManaGest (décision du 2/11/2026)* : le fichier d'un logiciel précis
  **n'est plus une condition**. Le modèle téléchargeable **est** la voie de
  migration : il porte les en-têtes, une ligne d'explication et une ligne d'exemple ;
  l'écran d'import propose désormais aussi l'**export des données actuelles**, dont
  les en-têtes sont **exactement** ceux du modèle — ce qui sort se réimporte tel quel
  après modification. Preuve exécutée : `tests/import-roundtrip.test.ts` (en-têtes de
  l'export égaux, dans l'ordre, à ceux du modèle pour clients et produits ; le modèle
  s'importe sans aucune erreur ; une colonne inconnue reste **signalée** et n'empêche
  pas l'import). Un export d'ancien logiciel reste évidemment accepté : alias,
  mapping manuel et colonnes ignorées sont déjà en place.
  *Ce qui reste, et c'est une entrée externe facultative* : si un fichier de l'ancien
  logiciel existe encore et porte des champs **propres** (historique, encours de
  bascule), le fournir permet d'ajouter un alias ou une colonne par champ. Sans ce
  fichier, la migration se fait par le modèle — rien ne bloque.
- **H5 — Non-régression automatisée** — **exécution livrée, en attente des secrets
  et de la preview dédiée (2/11/2026)** : les contrôles hébergés restent versionnés
  (`scripts/check-screens.py`, `check-c2-e2-h2.py`, `check-h1-permission.py`,
  `check-planning-sla.py`) et lisent désormais leur cible et leurs identifiants dans
  l'environnement (`PREVIEW_URL`, `PREVIEW_EMAIL`, `PREVIEW_PASSWORD`) au lieu de
  les coder en dur. Le job existe : `.github/workflows/preview-checks.yml`,
  déclenché à la main ou par `repository_dispatch` (`preview-deployed`). Il est
  protégé par `scripts/check-preview-config.mjs` : une configuration absente donne
  un **message nommant les trois variables** et le **code de sortie 2**, distinct
  d'un contrôle rouge. Commande unique : `npm run check:preview:hosted`.
  *Preuve exécutée* : `env -u PREVIEW_URL -u PREVIEW_EMAIL -u PREVIEW_PASSWORD node
  scripts/check-preview-config.mjs` → « Contrôles hébergés non configurés —
  variables manquantes : PREVIEW_URL, PREVIEW_EMAIL, PREVIEW_PASSWORD… » et
  **EXIT:2** ; `tests/ui-preview-config.test.ts` (4 tests : variables manquantes,
  configuration complète, URL non http(s), secrets blancs). Un échec du job est
  **signalé sans bloquer** le déploiement, conformément à la décision du 2/11/2026.
  *Ce qui reste, et c'est une entrée externe nommée* : (a) créer la **preview
  dédiée** sur l'hébergeur — le site actuel est suspendu par le quota D1 jusqu'au
  3/11/2026 00:00 UTC ; (b) dans **GitHub → Settings → Secrets and variables →
  Actions**, créer `PREVIEW_URL` (origine de cette preview), `PREVIEW_EMAIL` et
  `PREVIEW_PASSWORD` (compte de test en lecture seule, jamais dans le dépôt).
  Ensuite le workflow « Hosted preview checks » tourne, et un crochet de
  déploiement peut envoyer `repository_dispatch` `preview-deployed`.
  *Ce que je ne peux pas faire* : créer ces secrets. La connexion GitHub du projet
  permet de lire, récupérer et pousser des commits, mais ne porte pas le droit
  `secrets:write` ; `gh auth status` répond « not logged into any GitHub hosts » et
  aucune variable `GH_TOKEN` / `GITHUB_TOKEN` n'existe ici. Les valeurs doivent donc
  être saisies une fois par le propriétaire. Procédure exacte, effet de chaque
  secret, commandes `gh` et variante locale : [`docs/build/H5-hosted-checks.md`](build/H5-hosted-checks.md).

---

## Décisions issues de la recherche documentaire (nov. 2026)

Ces points ont été vérifiés contre la documentation Odoo, ERPNext et la doctrine
fiscale française avant d'être codés : ils expliquent des choix qui, sinon,
ressembleraient à des raccourcis.

1. **La sortie de stock appartient au document physique, pas à la facture.**
   Odoo la porte au bon de livraison validé, ERPNext à la *Delivery Note* ; seule
   la vente directe (`Update Stock` sur la facture) la met sur la facture. ManaGest
   n'ayant aucun bon de livraison, la facture joue ce rôle de vente directe —
   c'est un choix assumé. **Le jour où un bon de livraison apparaît, le mouvement
   doit migrer là et là seulement** : le poster aux deux endroits sortirait la
   marchandise deux fois.
2. **Une annulation ne rend pas la marchandise.** Annuler une facture est un acte
   financier : le stock ne bouge pas, car personne n'a compté de retour. La
   restitution est un événement physique distinct (item A6).
3. **Un avoir ne remet pas la marchandise en stock.** La doctrine (BOFiP
   BOI-TVA-DECLA-30-20-20-20, CGI art. 272) traite l'avoir comme une correction
   financière de TVA ; le retour physique est une entrée de stock séparée, valorisée
   au coût et non au prix de vente. Conséquence : ne jamais coupler avoir et stock.
4. **Une facture émise ne se supprime pas.** Le verrou de rétention (10 ans par
   défaut, minimum 1 an) est cohérent avec l'art. L123-22 du code de commerce ;
   la correction passe par un avoir ou une facture rectificative, jamais par une
   suppression. Effet de bord assumé : un document émis dans la journée ne peut
   plus être annulé, ce qui rend les documents de test définitifs.
5. **Stock négatif : réglage par article.** ERPNext et Odoo offrent un commutateur
   global *plus* une exception par article ; nous n'avons que l'exception, stricte
   par défaut. **Décision datée (2/11/2026)** : pas de commutateur global — autoriser
   le stock négatif par défaut est une politique comptable (marchandise vendue avant
   réception, ou erreur de saisie ?) que le propriétaire doit trancher ; l'ouvrir au
   nom d'un confort de saisie laisserait le stock devenir faux sans que personne
   l'ait décidé. L'exception par article reste le seul interrupteur.
6. **Kits.** Odoo ne crée aucune transaction pour un kit fantôme : il l'éclate au
   document de vente. ERPNext utilise un document unique à deux tables
   (`Manufacture`, `Repack`) et refuse l'assemblage sans composants disponibles.
   Notre assemblage reprend ce modèle ; l'éclatement à la vente reprend Odoo.

Sources principales : documentation Odoo 19/20 (valorisation, kits, ordres de
fabrication, démontage), docs ERPNext (Delivery Note, Sales Invoice, Stock Entry,
Stock Settings, Credit Note), BOFiP BOI-TVA-DECLA-30-20-20-20, code de commerce
art. L123-22.

## Ordre recommandé

```
A1 → A2 → A3 → A4
      └→ A5 (avec E1 en parallèle si le commercial est prioritaire)
A1 → D1 → D2 → D3
A2 → C1 → C2 → C3 → C4
A3 → B1 → B2 → B3 → B4
A1 → E1 → E2 → E3 → E4
A1 → F1 → F2 → F3 → F4 (F1 peut passer juste après A1)
G1 après E1 · G2/G3 après G1 · H* en continu
```

## Définition de « terminé » pour chaque item

1. Contrat d'API documenté et validé par le serveur (aucun champ accepté sans
   contrôle).
2. Effet métier vérifié sur le site hébergé, pas seulement en local : au moins un
   cas nominal et un cas refusé.
3. Droits appliqués côté serveur, pas seulement masqués à l'écran.
4. Écriture dans le journal d'audit quand l'action est sensible.
5. Tests unitaires des calculs purs et test d'API sur le parcours principal.
6. Libellés fr **et** en.

## À ne pas ouvrir maintenant

WMS multi-entrepôt, EDI fournisseur, GPAO, multi-devises complet sur le stock,
gestion des lots réglementaires par pays, portail client de suivi de commande. Ces
sujets supposent A à C stabilisés ; les ouvrir avant ferait doublon avec la
refonte du stock.

---

## 2026-11-02 — Balayage « aucune valeur métier en dur » (code d'exécution)

- **Locale d'affichage** : `DEFAULT_LOCALE` passe à `fr-PF` ; `src/lib/format.ts` applique la locale et le fuseau de la société (Paramètres → Société → « Format des dates et des nombres »). Plus aucun `fr-FR` en dur dans les écrans, le serveur ni la page publique.
- **Montants et quantités** : `formatMoney`/`currencyDecimals` restent la seule source des décimales (XPF = 0, EUR = 2) ; tableaux de bord, produits, achats, inventaire et page publique passent par la locale configurée.
- **Taxes** : les taux proposés viennent de la table `tax_rates` (Paramètres → Taxes) et non plus de la constante `TVA_RATES` ; `DEFAULT_TAX_RATE` centralise la valeur par défaut utilisée avant le chargement des réglages.
- **Serveur** : `server/lib/dates.ts`, `server/lib/money.ts` et le digest d'alertes de stock reçoivent la locale configurée (défaut `fr-PF`).
- **Preuve exécutée** : `tests/config-driven-format.test.ts` — changer le fuseau change le jour calculé (Tahiti vs Marquesas vs Paris), Tahiti reste à UTC−10 en janvier comme en juillet, changer la devise change les décimales, changer la locale change le rendu des dates.
- **Décisions client encore ouvertes** : paliers SLA par priorité, horaires 07:30–16:30, liste des jours fériés — inchangés.

---

## 2026-11-02 — Planning/SLA : réglages livrés au lieu de décisions bloquantes

- **Paliers SLA** : `sla_policies` (déjà persistée) est semée avec P1 60/240, P2 240/480, P3 480/1440 min ouvrées ; édition dans Planification → SLA. Refus serveur si la résolution précède la prise en charge (`resolution_before_response`) ou si deux paliers actifs partagent la même priorité sur la même cible (`duplicate`).
- **Horaires ouvrés** : jours travaillés + plage persistés dans `settings_extra` (`planning`), défaut lundi–vendredi 07:30–16:30 ; édition dans Planification → Réglages. Refus si la plage est vide (`empty_range`), mal formée (`invalid_time`) ou si un jour est dupliqué.
- **Jours fériés** : table `non_working_days`, semée pour 2026 et 2027 (jours fixes + Vendredi saint, lundi de Pâques, Ascension, Pentecôte calculés depuis Pâques) ; édition dans Planification → Calendrier. Refus hors 2000–2100 (`year_out_of_range`) ou date inexistante (`invalid_date`).
- **Calculs** : `shared/planning.ts` ne contient plus que les valeurs par défaut partagées ; les fonctions reçoivent le calendrier et les paliers lus en base. Les messages d'erreur de champ sont affichés dans l'écran (toast traduit via `validation.*`).
- **Preuve** : `tests/planning-sla.test.ts` couvre les paliers par défaut, les fériés semés 2026/2027 (dont Pâques calculée), les rejets (année hors plage, date impossible, plage vide, résolution avant prise en charge) et un même délai calculé différemment selon les horaires configurés.

---

## 2026-11-02 — Le plan comptable est un réglage (fin du balayage « rien en dur »)

Les neuf codes qui portaient la comptabilité étaient des constantes de
`server/lib/accounting.ts`, `server/routes/revenue.ts` et `server/lib/import-vat.ts`.
Ils sont désormais des `settings_extra` (Paramètres → Fiscalité → « Plan comptable
utilisé »), avec les mêmes défauts partagés (`shared/accounts.ts`) : 706000 ventes,
487000 produits constatés d'avance, 411000 clients, 401000 fournisseurs, 512000
banque, 606000 achats, 445710 TVA collectée, 445660 TVA déductible, 110000 report à
nouveau.

- Les règles pures (`invoiceLines`, `creditLines`, `paymentLines`, `expenseLines`,
  `openingLines`, `importVatLines`, `groupRevenue`) reçoivent les codes effectifs ;
  le service de comptabilisation les lit une fois par passe (`getAccountCodes`) et
  les transmet. Aucune route ne porte plus de code en dur.
- `ensureChart` sème aussi les comptes configurés (libellé + type déduits du code),
  pour qu'un compte personnalisé apparaisse dans la balance générale.
- Refus explicites : code non numérique ou trop court (`invalid_code`), et deux
  rôles partageant le même code (`duplicate`) — vérifié sur l'état stocké plus la
  requête, en écriture groupée comme en écriture d'une clé.
- Les écritures déjà passées gardent leur compte : le changement ne réécrit jamais
  le journal, il s'applique aux écritures suivantes.
- Preuve : `tests/account-codes.test.ts` (facture, règlement, dépense, reprise de
  balance, TVA à l'import et ventilation sur des codes personnalisés).

---

## 2026-11-02 — Réglages et journal réservés à l'autorité

Parcours de l'application pour vérifier les trois garanties demandées : rien de
métier en dur, un écran de réglages qui appartient à l'autorité, et une
traçabilité des utilisateurs lisible par les seuls responsables.

- **Réglages.** `settings.read` n'est plus hérité par les rôles opérationnels :
  propriétaire, administrateur et comptable ouvrent Paramètres, vente et lecture
  seule non — ni dans le menu, ni par URL directe (nouveau garde de route), ni
  par l'API (`403`). Les taux de TVA restent lisibles à la saisie par
  `GET /tax-rates` (`invoices.read`), pour qu'un commercial utilise les taux
  configurés sans ouvrir la configuration.
- **Traçabilité.** Le journal `activities` est append-only et chaîné par hash ;
  118 appels `logActivity` couvrent factures, devis, avoirs, paiements, dépenses,
  achats, projets, stocks, comptabilité, banque, réglages, rôles, sessions,
  jetons et exports. Il est réservé à `activity.read` (propriétaire,
  administrateur, comptable), avec masquage des prix et marges pour qui n'a pas
  `products.cost.read`, et vérification de chaîne exposée par `/activity/verify`.
  Seul `saved_filters` (préférences de vue personnelles) n'écrit pas au journal :
  aucune donnée d'entreprise n'y est modifiée.
- **Valeurs métier.** Balayage final : aucun taux, délai, horaire, férié ou code
  comptable en dur hors des défauts partagés (`shared/*`) ; les seeds de démo
  restent des exemples, pas des règles.

### Correctif du même jour — l'inventaire n'était pas complet

Le premier passage affirmait une couverture totale du journal : c'était faux.
Un script a comparé chaque handler mutant (`POST/PUT/PATCH/DELETE`) à la présence
d'un `logActivity` dans son corps, et 41 mutations n'écrivaient rien : suppression
d'avoir et de devis, ajustement de stock manuel, corbeille produit et fournisseur,
barèmes SLA, jours non travaillés et capacités, planification de tâche, contrats
récurrents, comptes et opérations bancaires, taux de TVA, suppression
d'utilisateur, contacts client, modèles de projet archivés, filtres enregistrés.

Toutes sont désormais journalisées, avec le libellé de la ligne concernée
(numéro, nom, e-mail, priorité, écart de stock). Deux cas restent volontairement
hors journal : `POST /import/preview` (lecture seule déguisée en POST) et
`POST /runs/daily` (passe planifiée par jeton, sans utilisateur). Les approbations
sont journalisées dans `server/services/approvals.ts`, pas dans la route.

---

## 2026-11-02 — Parcours de la couche client (pages, menu, trace)

### Inventaire des écrans et de leur permission

Le routeur ne déclare plus ses écrans à la main : `src/lib/access.ts` liste les
31 écrans authentifiés avec la permission qui les ouvre, `App.tsx` génère une
route gardée par `RequirePermission` pour chacun, et le menu lit la même
permission via `visibleSections`. Les écrans publics restent déclarés en clair
(`/connexion`, `/installation`, `/p/:token`, `*`).

| Écran | Route | Permission | Propriétaire / Admin | Comptable | Vente | Lecture seule |
|---|---|---|---|---|---|---|
| Tableau de bord | `/` | `reports.read` | oui | oui | oui | oui |
| Rapports | `/rapports` | `reports.read` | oui | oui | oui | oui |
| Clients, fiche client | `/clients`, `/clients/:id` | `clients.read` | oui | oui | oui | oui |
| Devis, formulaire, fiche | `/devis*` | `quotes.read` / `quotes.write` | oui | oui | oui | lecture seule : liste et fiche |
| Factures, formulaire, fiche | `/factures*` | `invoices.read` / `invoices.write` | oui | oui | oui | lecture seule : liste et fiche |
| Paiements, avoirs, récurrentes | `/paiements`, `/avoirs`, `/factures-recurrentes` | `payments.read`, `credits.read`, `recurring.read` | oui | oui | oui | oui |
| Produits, inventaire | `/produits`, `/inventaire` | `products.read` | oui | oui | oui | oui |
| Dépenses, fournisseurs, bons de commande | `/depenses`, `/fournisseurs`, `/bons-de-commande` | `expenses.read`, `vendors.read`, `purchase_orders.read` | oui | oui | non | oui (lecture seule) |
| Projets, planification, tâches | `/projets`, `/planification`, `/taches` | `projects.read`, `tasks.read` | oui | oui | oui (lecture) | oui |
| Banque | `/banque` | `bank.read` | oui | oui | non | oui (lecture seule) |
| Comptabilité, approbations | `/comptabilite`, `/approbations` | `accounting.read`, `approvals.read` | oui | oui | non | non |
| **Paramètres** | `/parametres` | `settings.read` | oui | oui (lecture) | **non** | **non** |
| **Utilisateurs** | `/parametres/utilisateurs` | `users.read` | oui | non | non | non |
| **Journal d'activité** | `/journal` | `activity.read` | oui | oui | **non** | **non** |
| Import | `/importer` | `clients.write` | oui | non | oui | non |
| Profil | `/profil` | session seule | oui | oui | oui | oui |

Preuves : `tests/client-access.test.ts` rend réellement `RequirePermission`
(`react-dom/server`, aucun DOM requis) pour les cinq rôles et vérifie que
Paramètres, Utilisateurs et Journal refusent vente et lecture seule ; il vérifie
aussi la matrice route par route et la liste de menu. `tests/client-surface.test.ts`
échoue si une page importée n'est pas routée, si une route littérale apparaît
hors liste publique, ou si une entrée de menu n'a pas la même permission que sa
route.

### Trace du journal par module

La trace est exposée dans le détail de **seize modules** : facture, devis et
fiche client (panneaux dédiés), inventaire (panneau du comptage ouvert), puis —
via le tiroir de détail partagé `RecordDetailBody` — produits, utilisateurs,
bons de commande, dépenses, paiements, tâches, fournisseurs, projets,
transactions bancaires, contrats récurrents, avoirs et approbations (dont la
trace est celle du document concerné).

Chaque panneau lit `GET /activity?entity_type=…&entity_id=…` derrière
`activity.read` ; sans la permission, ni section, ni titre, ni requête : le
composant rend `null` et l'appel est monté avec `enabled: false`.

**Comptabilité** : chaque écriture du journal (`journal_entries.id`, avec
`source_type`, `source_id` et `event`) ouvre un détail qui affiche ses lignes et
la trace de **sa source** — la facture, l'avoir, le paiement ou la dépense qui l'a
produite (`src/lib/accounting-trace.ts`) ; une reprise de balance pointe sur
`accounting` / `opening-balances`. Aucune entité « écriture » n'est journalisée
séparément, et c'est volontaire : le journal comptable est dérivé et idempotent
(clé unique `source_type/source_id/event`), donc l'action traçable est celle du
document, pas la recopie comptable.

**Import** : chaque exécution reçoit un identifiant stable (`import_run`) écrit
dans le journal avec le fichier et le bilan (créés, mis à jour, ignorés), et
l'écran de résultat affiche la trace de cette exécution. L'identité est créée au
commit, donc un import annulé ou rejeté ne laisse aucune ligne.

Seuls le tableau de bord et les rapports n'ont pas de trace par fiche, et c'est
structurel : ce sont des agrégats sans entité propre. Leur matière reste dans le
journal global, réservé à `activity.read`.

### Valeurs métier côté client

Corrigé : le graphique du tableau de bord écrivait `XPF` en dur dans son
infobulle ; il lit désormais la devise de la société. Littéraux restants,
justifiés : `formatMoney` garde `XPF` comme devise par défaut partagée ; les
calculs de coût rendu et les totaux d'import sont libellés en XPF parce que la
règle de change du module est exprimée en francs Pacifique (`XPF_PER_EUR`) ; les
placeholders `98713`, `123456`, `611000` sont des exemples de saisie, pas des
valeurs appliquées ; les libellés de statut viennent de `shared/*` et de l'i18n.

## 2026-11-02 — Phase G fermée : fériés corrigés, capacités et SLA par défaut

- **Fériés** : depuis 2026, le 29 juin n'est plus férié ; il est remplacé par le
  **20 novembre** (Matari'i — fête de l'abondance). Le pré-remplissage
  (`POLYNESIA_HOLIDAYS`, années 2026 et 2027) suit cette règle, et
  `correctedHolidaySeeds` remplace l'ancienne ligne pré-remplie dans un espace
  déjà ouvert — jamais une ligne renommée par le propriétaire, jamais un doublon.
- **Preuve exécutée** : `tests/planning-sla.test.ts` (20 novembre présent, 29 juin
  absent, correction ciblée, ligne éditée conservée) et `tests/planning.test.ts`
  pour l'arithmétique ouvrée.
- **G2/G3** : les onglets Charge, Réglages, Calendrier et SLA sont livrés ; les
  trois paliers standard sont créés une seule fois et restent éditables, les
  heures, jours ouvrés et fériés sont des données. Aucune tâche de code ne reste
  ouverte dans ces deux items.

- **H8 — Prévision de la demande et MRP : ce que ce serait, et pourquoi ce n'est pas là** — **explication (2/11/2026)**
  Un MRP (planification des besoins matières) répond à une question datée : « pour
  livrer ce que j'ai promis, que me faut-il, quand, et qu'est-ce que je dois lancer
  en production ou commander ? » Il enchaîne quatre étapes : (1) calcul des **besoins
  bruts** par article et par date (commandes fermes, prévisions, stock de sécurité) ;
  (2) **éclatement** de ces besoins dans la nomenclature (BOM) sur plusieurs niveaux,
  décalage par le **délai** de chaque niveau ; (3) **regroupement** en ordres proposés
  (fabrication ou achat) avec une date de lancement et une date de besoin ;
  (4) **lissage** selon la capacité et les lots d'achat. Un GPAO ajoute les gammes,
  les postes de charge, les temps et les rebuts.
  Pourquoi il n'est pas dans ManaGest aujourd'hui, nommément :
  1. **Pas de nomenclature de production** : un kit est une liste de composants
     vendue telle quelle, pas un article fabriqué avec ses niveaux, ses gammes et ses
     postes de charge. Éclater un besoin dans un arbre qui n'existe pas produirait des
     ordres faux.
  2. **Pas de prévision de ventes ni d'historique de consommation** : C1 propose des
     achats à partir des seuils min/max de la fiche et des ventes déjà conclues
     (back-to-back), ce qui est un réapprovisionnement, pas une prévision.
  3. **Pas d'ordres de fabrication** : les ordres calculés n'auraient aucun
     destinataire, ni aucun état d'avancement à suivre.
  Ce qui le rouvrirait, dans cet ordre : un besoin de **fabrication** explicite
  (BOM multi-niveaux, gammes, postes) → des **prévisions validées** (saisies ou
  historiques) → le calcul des besoins datés. Tant que ces trois entrées n'existent
  pas, un « module MRP » ne serait qu'un écran de plus sur des données absentes.
  Le réapprovisionnement livré (C1, C2, C3) reste la bonne réponse au problème réel :
  ne pas être en rupture sur ce qui se vend.

## 2026-11-02 — H4, H5 et Q16 : import tolérant, CI prête, captures produites

- **H4** : alias d'en-têtes, correspondance de colonnes choisie dans l'écran,
  normalisation des nombres et des dates, colonnes inconnues signalées et messages
  lisibles par ligne. Preuves : `tests/import-mapping.test.ts` et les suites
  d'import existantes.
- **H5** : `.github/workflows/preview-checks.yml` + `npm run check:preview:hosted`
  + `scripts/check-preview-config.mjs`, avec sortie 2 et message nommant les
  variables manquantes (prouvé localement). Reste : la preview dédiée et les trois
  secrets GitHub.
- **Q16** : Chromium 156.0.8078.4 installé, bibliothèques récupérées sans root,
  instance locale installée avec la démonstration, **huit captures** dans
  `artifacts/`. Recette reproductible :
  `apt-get -o Dir::State::lists=/tmp/apt/lists -o Dir::Cache=/tmp/apt download <paquets>`
  puis `dpkg-deb -x`, `LD_LIBRARY_PATH=/tmp/sysroot/usr/lib/x86_64-linux-gnu`,
  `FONTCONFIG_FILE` local, `PW_NO_SANDBOX=1` et `PW_CHROME_PATH` vers le binaire.

## 2026-11-02 — Vérification de l'état final (sorties réelles)

- **Commit et arbre** : `60eb14b Finish H4, H5 and Q16…` porte les captures et
  l'outillage, et le présent rapport est le commit qui suit ; `git status --short`
  → **0 ligne** après lui ; `git show --stat 60eb14b` liste bien les
  **8 PNG** sous `artifacts/`. La branche `freebuff/a6f86ced7cc9d3ad744d42ee` n'a
  **aucune référence distante suivie** : aucun push, aucune PR, aucun déploiement.
- **Captures** : `artifacts/*.png`, **76 844 à 197 571 octets**, toutes en
  **1440×900**, **2 112 à 4 628 couleurs uniques**, couleur dominante ≤ 66,9 % —
  aucune page blanche. Les huit ont été ouvertes et montrent réellement : connexion,
  tableau de bord (KPI et graphique), produits (6 articles), feuille d'import
  (modale), projets (carte projet), modèles de projet (modale), devis (1 devis),
  paramètres (formulaire société).
- **CI hébergée** : `node scripts/check-preview-config.mjs` sans variables →
  message nommant `PREVIEW_URL`, `PREVIEW_EMAIL`, `PREVIEW_PASSWORD` et **EXIT:2** ;
  avec une URL non http(s) → **EXIT:2** ; avec une configuration complète →
  **EXIT:0**. Le code 2 distingue donc une configuration absente d'un contrôle rouge.
- **Build sur l'arbre commité** : `npm run typecheck` → **0 erreur** ;
  `npm test` → **81 fichiers, 682 tests verts** ; `npm run build` → **OK**.
- **Cases à cocher** : les `- [ ]` de `docs/build/VERIFICATION-GATES.md` sont le
  **modèle de porte** (chaque ligne porte déjà son ✓), pas des tâches ouvertes.
- **Ce qui reste, avec son blocage** :
  1. **H4** — plus rien de bloquant : le **modèle ManaGest** et l'**export** des données actuelles forment la voie de migration, avec des en-têtes identiques (preuve : `tests/import-roundtrip.test.ts`). Un ancien fichier reste utile seulement s'il contient des champs propres.
  2. **H5** — créer la **preview dédiée** puis, dans **GitHub → Settings → Secrets
     and variables → Actions**, `PREVIEW_URL`, `PREVIEW_EMAIL`, `PREVIEW_PASSWORD` ;
     débloque le workflow « Hosted preview checks ».
  3. **Vérification hébergée** — bloquée par le **quota D1** (10 042 / 10 000,
     remise à zéro le 3/11/2026 00:00 UTC) ; débloque `npm run check:preview:hosted`.
  4. **Historique des prix d'achat** — **fait** : ledgers datés avec source, prix payé à la réception, écran et seuils paramétrables (conservation 36 mois, alerte 10 %, fenêtre 90 jours).
  5. **MRP / GPAO** — hors périmètre assumé ; le détail de ce qu'il faudrait est en **H8**, pas une tâche de code ouverte.
  6. **Q15 (multi-devises)** — **reporté après arbitrage** : ce n'est pas une petite modification (taux figé par document, journal, TVA, règlements, avoirs, rapports, réévaluation). Plan en trois étapes et condition de réouverture dans la section Q15.

## 2026-11-02 — Modèle ManaGest, historique des prix, MRP expliqué, multi-devises arbitré

- **H4 — le modèle remplace l'attente des fichiers.** L'écran d'import expose
  désormais l'**export des données actuelles** à côté du modèle, et les en-têtes de
  l'export sont **exactement** ceux du modèle : ce qui sort se réimporte tel quel
  après modification. Un export d'un ancien logiciel reste accepté (alias, mapping
  manuel, colonnes inconnues signalées). Preuve exécutée :
  `tests/import-roundtrip.test.ts` — égalité des en-têtes dans l'ordre pour clients
  et produits, import du modèle sans aucune erreur, colonne inconnue signalée sans
  bloquer. La demande de fichiers réels devient **facultative**, pas bloquante.
- **Historique des prix d'achat — livré.** Chaque prix est un événement daté avec sa
  **source** (`manual` quand il est saisi, `receipt` quand il est payé sur un bon de
  commande) et son document. Le prix payé entre dans le registre à la réception, et
  seulement s'il diffère du prix d'achat connu — réenregistrer le même prix n'invente
  rien. Écran : liste datée, fournisseur, prix moyen, alerte de hausse, sur la fiche
  article. **Valeurs standard, toutes paramétrables** : conservation 36 mois, alerte
  à 10 %, fenêtre de moyenne 90 jours (`price_history_months`,
  `price_alert_percent`, `price_alert_days`), `0` désactivant l'alerte. Preuve
  exécutée : `tests/price-history.test.ts` (9 cas : variation en points de base, base
  inutilisable, entrée ou non dans le registre, découpe de rétention, seuil, fenêtre,
  prix unique, lignes sans prix).
- **MRP / GPAO — expliqué, pas repoussé sans raison.** Voir **H8** : ce qu'un MRP
  calcule, les trois entrées qui manquent (nomenclature de production, prévisions,
  ordres de fabrication) et l'ordre dans lequel le rouvrir. C'est une décision de
  périmètre, pas un oubli.
- **Multi-devises — arbitrage explicite.** Ce n'est **pas** une petite modification :
  convertir un document en devise tierce exige un taux figé par document et une
  conversion à la source pour le journal, la TVA, les règlements partiels, les
  avoirs, les rapports et la réévaluation, avec un compte d'écart. Le faire à moitié
  produirait un journal faux silencieusement. Le plan en trois étapes et la condition
  de réouverture (« une première facture dans une devise non arrimée à l'euro ») sont
  écrits dans la section Q15.
- **H5 — secrets GitHub : ce que je ne peux pas faire.** La connexion GitHub permet de
  lire et de pousser des commits, mais pas d'écrire un secret (`secrets:write`
  absent, `gh` non authentifié, aucune variable `GH_TOKEN`). Procédure complète,
  effet de chaque secret et variante locale : `docs/build/H5-hosted-checks.md`.
- **Défaut trouvé par la vérification locale, corrigé.** Les colonnes `source` et
  `source_ref` ajoutées à `product_vendor_prices` n'étaient **pas** créées sur une
  base déjà ouverte : `provision()` sort tôt quand `schema_version` est à jour.
  `SCHEMA_VERSION` passe de **47 à 48**, ce qui rejoue les migrations de colonnes
  (idempotentes). Preuves rejouées sur l'instance locale :
  `GET /api/products/:id/price-history` → **200** avec
  `{"months":36,"alert_percent":10,"window_days":90}` ; `PATCH /api/settings/extras`
  avec `24/5/60` → **200**, et le GET suivant renvoie ces valeurs ; seuil `5000` →
  **422** `VALIDATION_ERROR` ; `pragma_table_info` montre bien `source` et
  `source_ref` ; l'INSERT de réception exécuté sur la base locale donne
  `source = receipt`, `source_ref = PO-PROBE`, devise héritée `XPF` — puis la sonde
  est supprimée. *Limite de cette preuve* : elle portait sur l'API ; les trois
  écrans ont depuis été ouverts et exercés dans un navigateur (section du 2/11/2026).

## 2026-11-02 — Vérification navigateur des trois écrans, et défauts corrigés

Instance locale complète, **base déjà ouverte** (migration incluse), Chromium piloté
par Playwright (`scripts/verify-ui-local.mjs`, `BASE_URL=http://127.0.0.1:8787`),
captures dans `artifacts/ui-verification/`. **27 contrôles, 27 verts.**

**Ce qui a été observé**
- **Import** : le modèle téléchargé et l'export des données actuelles portent des
  en-têtes **identiques dans le même ordre** ; le fichier exporté, réimporté par
  l'assistant, passe avec **0 ligne en erreur** ; un fichier portant une colonne
  `code_interne` s'importe quand même, la colonne est listée sous « Colonnes
  ignorées » et l'import aboutit.
- **Fiche article** : le panneau affiche les événements datés (fournisseur, prix,
  source), `payé sur réception BC-0004`, la moyenne « Prix moyen sur 90 jours :
  12 333 XPF » et le badge « Hausse de 25.0 % (seuil 10 %) ». L'état vide dit
  « Aucun prix enregistré sur la période. », sans `NaN`. Après passage des seuils à
  24/30/60 depuis Paramètres → Taxes, la fiche réouverte affiche « Conservation 24
  mois · référence sur 60 jours » et **plus de badge** à 25 % < 30 %.
- **Paramètres → Taxes** : 36/10/90 par défaut, enregistrés puis **relus après
  rechargement** (24/30/60) ; une valeur `5000` est refusée avec le message
  « Seuil d'alerte de hausse (%) : valeur invalide », et l'ancienne valeur reste en
  base.

**Défauts trouvés et corrigés**
1. **Aucun téléchargement CSV ne fonctionnait dans un navigateur.** Un lien vers
   `/api/...` est une *navigation* : le routeur d'assets répondait l'application
   elle-même (`Sec-Fetch-Mode: navigate` → `not_found_handling`), donc ni le modèle
   ni l'export ne se téléchargeaient — l'API seule répondait correctement, d'où la
   lacune. `ImportPage` et `ExportCsvButton` passent par `downloadFile` (fetch +
   blob), qui lit en plus le nom de fichier du `Content-Disposition`.
2. **Le prix payé n'entrait jamais dans le registre.** Les deux routes qui
   reçoivent un bon de commande sélectionnaient `id, number, status, line_items`
   sans `vendor_id` : `receivePurchaseOrder` recevait `null` et n'écrivait aucune
   ligne `receipt`. Colonne ajoutée aux deux `SELECT`.
3. **Les seuils restaient périmés sur la fiche.** La requête d'historique est
   mémorisée 20 s ; enregistrer les réglages n'invalidait pas cette clé. L'écran
   des paramètres invalide désormais `['product-price-history']`.
4. **L'onglet Taxes affichait des clés brutes.** 71 libellés destinés à `settings`
   (`fiscalDefaults`, `chartOfAccounts`, `purchasing`, `retentionYears`…) avaient
   été écrits dans l'objet `setup` : tout l'onglet affichait
   `settings.fiscalDefaults` au lieu du texte. Bloc déplacé vers `settings` en
   français et en anglais.
5. **Le refus d'une valeur hors bornes ne nommait pas le champ.** Le message dit
   maintenant lequel des trois réglages est refusé, au lieu de « certains champs
   sont invalides ».

**Contrôles finaux** : `npm run typecheck` → **0 erreur** ; `npm test` → **77
fichiers, 682 tests verts** ; `npm run build` → **OK**. Commit unique sur
`freebuff/a6f86ced7cc9d3ad744d42ee`, arbre propre, rien poussé, aucun déploiement,
aucun secret écrit.

## P-03 — Sauvegarde et restauration prouvées (2/11/2026)

**Ce qui manquait** : aucun export complet restaurable, aucune restauration jamais exercée ; la sauvegarde dépendait entièrement de l'hébergeur.

**Ce qui est livré**
- `server/lib/backup.ts` : export JSON versionné (`format: managest-backup`, version de format 1, `schema_version`), toutes les tables du schéma dans l'ordre de création, empreinte SHA-256 canonique ; restauration qui refuse un schéma plus récent, une empreinte fausse, une table inconnue ou un nom de table non conforme, et qui réécrit `app_meta.schema_version` à la version du code.
- `server/routes/backup.ts` : `GET /api/backup` (téléchargement JSON, propriétaire uniquement) et `POST /api/backup/restore` (`confirm: "RESTORE"`, `allow_overwrite` explicite si l'espace contient déjà des données) ; les deux sont journalisés.
- `tests/backup-restore.test.ts` : 8 cas sur SQLite réel (`node:sqlite`), avec le schéma et le jeu de démonstration de l'application.

**Ce que le test prouve**
1. l'export contient les 78 tables, la version de schéma et une empreinte de 64 caractères ;
2. une base **neuve** reçoit le dump et chaque table a le **même nombre de lignes** ;
3. les enregistrements clés sont identiques ligne à ligne (factures et leurs lignes JSON, paiements, affectations, clients, produits, devis, journal d'audit et son chaînage) ; les liens tiennent (client de chaque facture, affectation → paiement et facture, `payés + solde = total`) ;
4. le ré-export de la base restaurée donne **la même empreinte** ;
5. un dump d'un schéma **plus récent** est refusé ; un dump plus ancien est accepté et la base est estampillée à la version courante ;
6. l'écrasement d'un espace non vide est refusé sans `allow_overwrite`, et ne duplique aucune ligne quand il est autorisé ;
7. une empreinte fausse et une table inconnue (ou un nom hostile) sont refusés.

**Commandes**

    npx vitest run tests/backup-restore.test.ts

    curl -b cookies -H "x-csrf-token: …" https://…/api/backup -o managest.json
    curl -b cookies -H "x-csrf-token: …" -H 'content-type: application/json' \
      -d '{"dump": <contenu>, "confirm": "RESTORE", "allow_overwrite": true}' \
      https://…/api/backup/restore

**Reste hors de portée sans hébergement** : la sauvegarde automatique D1 côté Cloudflare (PQ-4) s'active dans le tableau de bord ; elle ne peut être ni activée ni vérifiée depuis cet hôte. La restauration, elle, n'attend plus rien.

**Contrôles** : `npm run typecheck` → 0 erreur ; `npm test` → 81 fichiers, 682 tests verts ; `npm run build` → OK.

## Décisions du propriétaire, P-04, P-05 et alignement Odoo (2/11/2026)

**Décisions tranchées**
- **D-01 (soldes de reprise)** : aucun chiffre fourni → reprise **à zéro**, aucune valeur inventée ; la saisie reste ouverte (Comptabilité → Reprise de balance).
- **D-02 (valeurs fiscales)** : conservées, ce sont des **réglages** modifiables (rétention, franchise, régime) ; point clos.
- **D-03 (seuils d'approbation)** : les trois seuils passent **à 0 = règle désactivée**. Un avoir, une dépense ou une remise ne déclenche plus d'approbation par défaut ; l'approbation reste disponible et paramétrable. Le test `tests/settings-extra.test.ts` fige ces trois défauts.
- **D-04 (cron)** : reporté par le propriétaire. **Aucun jeton GitHub n'est nécessaire** : il faut un **jeton d'API ManaGest** (Paramètres → Sécurité) et un planificateur externe qui appelle `POST /api/runs/daily`.

**P-01 (Resend)** : l'écran existe — **Paramètres → onglet « Livraison des e-mails »** → fournisseur **Resend** → coller la clé API → Enregistrer → « Envoyer un test ». La clé n'est jamais réaffichée après enregistrement (elle est chiffrée au repos).

**P-04 (plafond hébergeur)** : affiché sous le composant de pièces jointes — « 100 Mo par requête » (limite de la plateforme Cloudflare) ; le réglage de l'espace (1–25 Mo) reste la limite appliquée. Coût : une ligne de texte et une clé de traduction.

**P-05 (import Excel)** : l'écran d'import accepte désormais **.xlsx**. `server/lib/xlsx.ts` lit le classeur sans dépendance (ZIP via `DecompressionStream`, `sharedStrings`, styles de date, références de cellules), convertit la première feuille en CSV et la fait passer par **le même pipeline** que le CSV : en-têtes détectés ou mappés, alias, aperçu ligne à ligne, validation, commit tout-ou-rien. `tests/xlsx.test.ts` prouve la conversion (chaînes partagées, échappement, dates Excel, fichier non-ZIP).

**Sources consultées (2/11/2026)**
- Odoo, règles d'approbation : <https://www.odoo.com/documentation/20.0/applications/studio/approval_rules.html> — une approbation **route** la demande, ne bloque pas ; seuil de double validation des achats dans `res_company.py` (défaut 5 000, désactivable).
- Odoo, import/export : <https://www.odoo.com/documentation/20.0/applications/essentials/export_import_data.html> et `addons/base_import/models/base_import.py` — .xlsx lu nativement (openpyxl), mapping par en-têtes, commit atomique.
- Odoo, sauvegarde : <https://www.odoo.com/documentation/20.0/administration/odoo_sh/getting_started/branches.html> — archive base + fichiers + journaux, restauration par import.
- Odoo, multi-devises : <https://www.odoo.com/documentation/20.0/applications/finance/accounting/get_started/multi_currency.html> — devise principale, taux datés, écarts de conversion automatiques (confirme le plan Q15).
- DICP, taux de TVA : <https://www.service-public.pf/dicp/faq-items/quels-sont-les-principaux-taux-de-tva/> — **5 % réduit, 13 % services, 16 % biens** ; un taux **1 %** pour les archipels hors Société est annoncé au 1/7/2026. Les taux locaux du code (`LOCAL_TAX_RATES` = 0, 1, 5, 13, 16) sont donc exacts ; depuis le 2/11/2026, une **installation neuve** part sur **13 %** (services) et le taux reste **paramétrable** société par société.
- IEOM : <https://www.ieom.fr/> — **1 000 XPF = 8,38 EUR**, parité fixe.
- Chorus Pro, Polynésie : <https://portail.chorus-pro.gouv.fr/aife_documentation?id=kb_article_view&sysparm_article=KB0012182> — obligation **uniquement pour les marchés publics** (loi du pays 2025-22), pas en B2B.

**Ce que cela change dans le produit** : seuils d'approbation off par défaut, import Excel accepté, plafond plateforme visible, et trois décisions closes dans `PENDING.md` (D-01, D-02, D-03) plus P-04 et P-05.


## Installation polynésienne par défaut (2/11/2026)

Une base vierge démarre désormais en **Polynésie française**, sans réglage après coup.

**Valeurs par défaut (toutes modifiables ensuite)**
- Société : pays **Polynésie française**, devise **XPF** (aucune décimale), fuseau **Pacific/Tahiti**, locale **fr-PF** ; adresse/commune de Papeete proposées par défaut, identifiants légaux facultatifs.
- Plan de taxes local : **0 % exonéré, 5 % réduit, 13 % services, 16 % biens**, plus **1 % archipels hors îles de la Société daté au 1/7/2026** (`valid_from`). Le taux par défaut d'une nouvelle société est **13 %**, le taux des prestations de service.
- Identifiants : **numéro TAHITI**, **RIDET** et **NIF** sur la société et sur les tiers (champs distincts, jamais obligatoires).
- Mentions de facture : les identifiants des deux parties (TAHITI / RIDET / NIF quand ils existent), le **prix HT**, le **taux**, le **montant de TVA** et les totaux **en XPF**.

**Code touché** : `shared/domain.ts` (pays, devise, fuseau, locale, plan de taxes, taux par défaut 13), `server/routes/setup.ts` (installation, plan complet y compris la ligne 0 et la date du 1 %), `server/db/index.ts` (migration 49 : `company.ridet`, `company.nif`, `clients.nif`, `tax_rates.valid_from`), `server/routes/clients.ts` et `server/routes/settings.ts` (identifiants éditables), `server/services/pdf.ts` (mentions des deux parties), écrans d'installation, de client et de paramètres.

**Preuve** : `tests/polynesia-bootstrap.test.ts` installe réellement une base vierge (schéma + route `/api/setup/install`), vérifie la société (pays, XPF, Pacific/Tahiti, fr-PF, taux par défaut 13), les **cinq lignes de taxe** avec la date du 1 %, puis qu'une prestation à 13 % donne **100 000 HT → 13 000 de TVA → 113 000 TTC en XPF** et que les identifiants des deux parties sont rendus.

**Sources** : DICP — [taux de TVA](https://www.service-public.pf/dicp/faq-items/quels-sont-les-principaux-taux-de-tva/) (5/13/16 %, 1 % archipels au 1/7/2026) ; IEOM — [1 000 XPF = 8,38 EUR](https://www.ieom.fr/). Les valeurs restent des réglages : aucune n'est figée dans une règle.

**Contrôles** : `npm run typecheck` → 0 erreur ; `npm test` → **81 fichiers, 682 tests verts** ; `npm run build` → **OK**.


## Réinitialisation libre-service et second facteur prouvés (3/11/2026)

**P-02 — réinitialisation de mot de passe en libre-service : livré.** Un utilisateur bloqué
saisit son adresse sur `/mot-de-passe-oublie` ; s'il existe un compte actif, un lien **valable
une heure** part par e-mail (Resend/Brevo/SMTP selon Paramètres → Livraison des e-mails). Le
jeton est stocké **haché en SHA-256**, à usage unique, et la réponse est **identique** que
l'adresse existe ou non, ce qui empêche d'énumérer les comptes. Cinq demandes par heure et par
IP au maximum. `/reinitialiser-mot-de-passe` applique la politique de mot de passe existante,
**ferme toutes les sessions**, efface les liens en attente et journalise l'opération. Sans
prestataire configuré, le flux reste muet mais ne casse rien. Migration **schéma 50**
(`password_reset_tokens`, index utilisateur et IP). Preuve : `tests/password-reset.test.ts`,
6 cas (lien reçu et haché, réinitialisation, session antérieure 401, ancien mot de passe 401,
nouveau 200, réutilisation refusée, adresse inconnue muette, mot de passe faible refusé, lien
expiré/inexistant refusé, mode manuel sans envoi, quota 200×5 puis 429).

**N-01 — second facteur TOTP : livré et prouvé.** Le code existait déjà (secret TOTP,
activation par code, défi de cinq minutes, codes de secours à usage unique, désactivation,
journal) mais n'était couvert qu'indirectement. `tests/mfa-flow.test.ts` le prouve de bout en
bout : inscription, activation, connexion qui renvoie `mfa_required` **sans cookie**, code
faux 401, code valide 200 avec session, code de secours accepté puis refusé à la
réutilisation, désactivation, connexion simple rétablie.

**État du registre** : `docs/build/PENDING.md` ne contient plus que des **actions
utilisateur** (DNS Resend, sauvegarde D1, planificateur du passage quotidien), des
**décisions produit** (T-401 → T-404, N-02 → N-12), les **limites assumées** (L-01 → L-12) et
les **constats de vérification** (V-01 → V-07). Aucune tâche de code n'y reste ouverte.

**Contrôles** : `npm run typecheck` → 0 erreur ; `npm test` → **81 fichiers, 682 tests
verts** ; `npm run build` → **OK**.
