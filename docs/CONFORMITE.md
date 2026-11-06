# Conformité polynésienne

Ce document récapitule les règles locales retenues dans ManaGest et leurs sources.
Il ne remplace pas l'avis d'un comptable.

## 1. Devise

- **Franc Pacifique (XPF)**, code ISO `XPF`, **zéro décimale**.
- Les montants sont stockés en francs entiers.
- L'arrondi des espèces à 5 F ne s'applique qu'aux paiements en liquide ; il ne modifie
  pas les montants facturés par virement, chèque ou carte.

## 2. TVA

| Taux | Usage |
|---|---|
| **16 %** | Taux normal : **biens** et opérations non soumises aux autres taux |
| **13 %** | Taux **des prestations de service** ; c'est le défaut d'une installation neuve |
| **5 %** | Taux réduit : produits alimentaires, transport de personnes, électricité, hôtellerie |
| **1 %** | Archipels hors îles de la Société, **à compter du 1/7/2026** (ligne datée, non appliquée avant) |
| **Exonéré** | Opérations expressément exonérées (santé, export, fret inter-îles, etc.) |

La **franchise en base** dispense de TVA en dessous du seuil légal (généralement
10 millions de F CFP de chiffre d'affaires). La mention
« TVA non applicable, franchise en base » est alors ajoutée automatiquement en pied
de document.

Une installation neuve crée les cinq lignes ci-dessus, avec **13 %** marqué par défaut ;
chaque société peut ensuite changer son taux par défaut et ses lignes.

ManaGest permet de saisir un taux par ligne, de cumuler plusieurs taux sur un même
document et d'exonérer un client. Le détail par taux figure sur la facture et dans
le rapport de TVA.

## 3. Identifiants

- **Numéro TAHITI** : identifiant fiscal polynésien, généralement une lettre suivie de
  cinq chiffres (`T12345`). Format contrôlé à la saisie.
- **RCS** : immatriculation au registre du commerce de Papeete.
- Le **RIDET** concerne la Nouvelle-Calédonie et n'est pas utilisé ici.
- Le capital social est stocké comme information légale de la société.

## 4. Mentions portées sur les documents

ManaGest compose le pied de facture avec les informations disponibles :

- raison sociale, adresse, numéro TAHITI, RCS, capital ;
- date et numéro de facture, date d'échéance ;
- désignation, quantité, prix unitaire HT, taux et montant de TVA ;
- total HT, total TTC, remise éventuelle, montant déjà réglé et solde ;
- conditions de paiement (pénalité de retard de 10 % et indemnité forfaitaire de
  5 000 F CFP par défaut, modifiables) ;
- coordonnées bancaires ;
- mention de franchise en base le cas échéant.

Ces mentions sont paramétrables dans **Paramètres → Mentions légales** et
**Facturation**.

## 5. Facturation électronique

Les entreprises établies en Polynésie française ne sont **pas** soumises au mandat
métropolitain de facturation électronique (Factur-X / PPF) pour leurs opérations
locales, la TVA polynésienne étant un régime distinct.

En revanche, des obligations françaises de **e-reporting** peuvent s'appliquer à des
opérations situées en France et soumises à la TVA française. Ce cas transfrontalier
n'est pas couvert par cette version et doit être traité comme un module séparé.

## 6. Fuseau et dates

- Fuseau par défaut : `Pacific/Tahiti` (UTC−10).
- Les autres archipels sont disponibles : Marquesas (UTC−9:30), Gambier (UTC−9).
- Les horodatages sont stockés en UTC et affichés à l'heure locale.
- Les dates métier sont stockées au format ISO `AAAA-MM-JJ`.

## 7. Sources

- DICP — taux et régimes de TVA : <https://www.service-public.pf/dicp/professionnels/vos-impots/taxe-sur-la-valeur-ajoutee/>
- DICP — principaux taux : <https://www.service-public.pf/dicp/faq-items/quels-sont-les-principaux-taux-de-tva/>
- ISPF — numéro TAHITI : <https://www.ispf.pf/rte>
- DICP — identifiant fiscal : <https://www.service-public.pf/dicp/faq-items/quest-ce-que-mon-identifiant-fiscal-2/>
- OPH — mentions des factures : <https://www.oph.pf/p/mentions-factures>
- CCISM — facturation électronique : <https://www.ccism.pf/infos-entreprises-une-enquete-sur-la-facturation-electronique-destination-des-professionnels>
- IEOM — monnaie et arrondis : <https://www.ieom.fr/Les-pieces-et-billets-en-circulation?lang=en>

## 8. Valeurs de règle et où les changer

Tout seuil qui décide d'un refus est un réglage d'espace de travail (A-29), livré avec le
comportement historique. La colonne « réglage » est la clé utilisée par
`GET/PUT /api/settings/extras` et par Paramètres → Sécurité.

| Valeur | Défaut | Source | Réglage |
|---|---|---|---|
| Fenêtre des échecs de connexion | 15 minutes | Pratique usuelle de verrouillage progressif (A-20) | `login_window_minutes` |
| Échecs avant blocage d'un compte | 8 | Idem : bloque un verrouillage ciblé sans bloquer une faute de frappe | `login_max_per_account` |
| Échecs avant blocage d'une adresse IP | 50 | Idem : arrête l'aspersion de nombreux comptes depuis un hôte | `login_max_per_ip` |
| Conservation des tentatives échouées | 90 jours | Politique de rétention A-20/A-24 | `login_attempt_retention_days` |
| Fenêtre d'installation / récupération | 15 minutes | A-23, même fenêtre que la connexion | `setup_window_minutes` |
| Tentatives d'installation par IP | 5 | A-23 : `install` et `recover-owner` sont à usage unique | `setup_max_attempts_per_ip` |

Les autres réglages (TVA, comptes, approbations, tarifs, rétention, pièces jointes) sont
décrits dans leurs sections et dans `docs/build/PENDING.md`. Un **garde-fou technique** n'est
pas un réglage : le plafond de 200 lignes d'un document (`server/lib/validation.ts`) et les
100 paramètres liés de D1 (C-3) restent des constantes commentées.
