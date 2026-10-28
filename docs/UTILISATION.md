# Guide d'utilisation

## 1. Première installation

1. Ouvrez ManaGest : l'assistant d'installation s'affiche si aucun espace n'existe.
2. **Votre entreprise** : nom commercial, raison sociale, numéro TAHITI, RCS, adresse,
   régime de TVA et taux par défaut.
3. **Votre compte** : nom, adresse e-mail et mot de passe de 12 caractères minimum.
4. **Préférences** : délai de paiement, pied de facture et possibilité de charger un
   jeu de données de démonstration.
5. Connectez-vous avec le compte administrateur.

Le jeu de démonstration contient des clients polynésiens, des factures réparties sur
plusieurs mois, des dépenses, un fournisseur, un projet et un abonnement : il permet de
parcourir tous les écrans immédiatement. Supprimez-le avant la mise en production.

## 2. Tableau de bord

Quatre indicateurs principaux : facturé du mois, encaissé du mois, encours clients et
retards. Le graphique compare facturation et encaissements sur six mois. À droite :
échéances à venir, meilleurs clients et activité récente.

## 3. Clients

- **Créer** : bouton « Nouveau client ». Le numéro est attribué automatiquement.
- **Consulter** : cliquez sur le nom pour ouvrir la fiche (encours, factures, devis,
  paiements, relevé de compte).
- **Facturer** : depuis la fiche, « Nouvelle facture » préselectionne le client.
- Un client avec des factures impayées ne peut pas être supprimé.

## 4. Factures

1. **Nouvelle facture** : choisissez le client, la date et les lignes.
2. Ajoutez des lignes ; sélectionnez un produit pour préremplir prix et TVA.
3. Une remise globale en pourcentage ou en montant est répartie au prorata.
4. Le panneau de droite affiche le détail de TVA et le total TTC en temps réel.
5. Enregistrez : la facture est en **brouillon** avec un numéro définitif.
6. Depuis la fiche : « Marquer comme envoyée », « Encaisser le solde », PDF,
   duplication, annulation.

Le statut évolue automatiquement selon les paiements : envoyée, partielle, payée.
Une facture dont l'échéance est dépassée est signalée « En retard ».

## 5. Paiements

« Enregistrer un paiement » : choisissez le client, le montant, la date et le moyen.
L'affectation automatique règle les factures ouvertes les plus anciennes ; sinon,
l'affectation est explicite. Annuler un paiement restaure les soldes des factures.

## 6. Devis

Créez un devis, marquez-le envoyé, puis accepté ou refusé. « Convertir en facture »
génère un brouillon reprenant les lignes et le client. Un devis converti ou refusé
n'est plus modifiable.

## 7. Avoirs

Un avoir se crée comme une facture, puis s'applique à une facture ouverte du même
client. Le solde disponible est suivi et affiché.

## 8. Abonnements

Un abonnement récurrent définit un client, une fréquence, une date de prochaine
génération et des lignes. « Générer maintenant » crée la facture et avance l'échéance.
Le nombre de cycles restants peut être limité ou illimité.

## 9. Produits, dépenses, fournisseurs

- **Produits** : prix HT, coût, TVA, suivi de stock facultatif.
- **Dépenses** : catégorie, montant, TVA, fournisseur, caractère refacturable.
- **Fournisseurs** et **bons de commande** : cycle brouillon → envoyé → validé → réceptionné.

## 10. Projets et tâches

Un projet regroupe des tâches, un budget et une échéance. Les tâches portent une durée,
un taux horaire et un indicateur facturable ; le temps total est visible sur la fiche
projet.

## 11. Banque

1. Ajoutez un compte (nom, banque, IBAN, solde d'ouverture).
2. Importez un relevé CSV : `date;libellé;montant;référence`, une ligne par opération.
3. Pour un encaissement, « Rapprocher » permet de choisir la facture à régler :
   le paiement est créé et affecté automatiquement.
4. Les opérations sans objet peuvent être ignorées.

## 12. Rapports

Choisissez le rapport et la période, puis exportez en CSV :

- chiffre d'affaires et résultat mensuel ;
- TVA collectée par taux ;
- balance âgée (non échu, 1–30, 31–60, 61–90, plus de 90 jours) ;
- ventes par client ;
- dépenses par catégorie.

## 13. Paramètres et équipe

- **Entreprise** : identité, adresse, coordonnées, fuseau, devise.
- **Facturation** : régime de TVA, taux par défaut, délai de paiement, modèle de numérotation.
- **Taxes** : taux personnalisés et compteurs de numérotation.
- **Sécurité** : inactivité et durée maximale de session.
- **Mentions légales** : mentions de pied de document et coordonnées bancaires.
- **Utilisateurs** : rôles, activation, réinitialisation de mot de passe.
- **Journal d'activité** : traçabilité des actions.

## 14. Bonnes pratiques

- Renseignez le numéro TAHITI et le RCS avant la première facture.
- Vérifiez les mentions de franchise en base si vous êtes dans ce régime.
- Sauvegardez régulièrement la base de données.
- Créez un utilisateur par personne, avec le rôle minimal nécessaire.
- En cas de doute sur un taux de TVA, consultez la DICP ou votre comptable.
