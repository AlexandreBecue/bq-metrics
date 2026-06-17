# bq-metrics

**bq-metrics** est une console d'analyse personnelle, locale et offline-first permettant de centraliser et d'explorer vos données et métriques du quotidien (consommation de carburant, dépenses financières, séances de sport, recettes, gestion de stocks, tenues, etc.).

L'application est entièrement construite sur une architecture **offline-first** : toutes vos données restent dans votre navigateur grâce à **IndexedDB** et sont accessibles sans connexion internet via sa configuration **PWA** (Progressive Web App).

---

## Stack technique

- **Framework :** Vue 3 (Composition API, `<script setup>`, TypeScript)
- **Bundler :** Vite
- **Base de Données Locale :** Dexie.js (wrapper IndexedDB performant et transactionnel)
- **Visualisations :** Chart.js & vue-chartjs
- **Icônes :** Lucide Vue
- **Styles :** SASS / SCSS (Vanilla CSS modernisé, pas de Tailwind)

---

## Fonctionnalités actuelles

1. **Tableau de Bord (`DashboardView.vue`) :** Raccourcis de saisie rapide par fiche, vue d'ensemble du nombre d'enregistrements et du statut de la base locale.
2. **Explorateur de Données (`DataExplorerView.vue`) :** Tableur interactif permettant d'ajouter, modifier et supprimer des enregistrements. Supporte la pagination, les filtres logiques avancés, les formules de calcul dynamique en temps réel, l'export/import CSV/JSON.
   - **Nouveau :** Résolution dynamique des liaisons inter-fiches dans le tableau (affichage des libellés au lieu des IDs techniques bruts).
   - **Nouveau :** Formulaire de saisie intelligent des relations (liste déroulante pour les liaisons 1-N, grille de cases à cocher moderne de style glassmorphism pour les liaisons multiples N-N).
3. **Constructeur de Modèles (`CollectionsManagerView.vue`) :** Gestion des fiches et de leurs attributs (types de champs : texte, nombre, date, tags, booléen, liste de sélection, formules calculées et **liaisons/relations inter-fiches**).
   - **Nouveau : Moteur de validation des formules en temps réel** (valide la syntaxe JS des formules, vérifie l'existence des champs référencés, bloque les auto-références subissant des calculs et détecte intelligemment les cycles complexes).
   - **Nouveau : Analyse de cycles conditionnelle.** Le validateur détecte si une dépendance croisée est "protégée" par des conditions exclusives (comme un choix d'estimation `{estimation} ? ... : {champ}`). Dans ce cas, elle est acceptée comme un avertissement jaune (non-bloquant) pour libérer toute la puissance des modèles complexes.
4. **Graphiques (`CollectionChartsView.vue`) :** Visualisation des indicateurs clés via des graphiques en barres, en lignes ou camemberts.
5. **Synchronisation Google Drive (`SettingsView.vue` / `db/google-drive.ts`) :** Synchronisation cloud multi-appareil transparente et sans serveur tiers (architecture 100% souveraine et client-side).
   - **Confidentialité & Sécurité maximales :** Utilise Google Identity Services (GIS) côté client avec la portée restreinte (`drive.file`) : l'application n'a accès qu'au seul fichier qu'elle crée (`bq-metrics-sync.json`), sans pouvoir lire le reste de votre Drive.
   - **Moteur de Fusion Intelligent (Smart Merge) :** Synchronisation bidirectionnelle automatique. En cas d'enregistrements concurrents, le moteur résout intelligemment les conflits en comparant les horodatages de mise à jour (`updatedAt || createdAt`).
   - **Offline-First & Auto-Sync :** Une fois connecté, l'application synchronise vos données de manière transparente en arrière-plan au démarrage et après chaque modification locale.
6. **Sauvegarde et Restauration (`SettingsView.vue`) :** Sauvegardes manuelles au format JSON et possibilité de charger des données de démonstration.

---

## Pistes d'améliorations futures (TODO)

Voici les axes d'amélioration identifiés pour enrichir l'application en fonction des besoins utilisateurs :

### 1. Graphiques avancés
* **Description :** Offrir la possibilité de créer des graphiques plus complexes dans `CollectionChartsView.vue`.
* **Idées de conception :**
  - **Superposition multi-séries :** Comparer plusieurs périodes sur un même tracé.
  - **Double Axe Y :** Afficher simultanément deux variables d'unités différentes (ex: kilomètres cumulés vs. vitesse moyenne).

### 2. Indicateurs de tendance (trends) sur le tableau de bord
* **Description :** Ajouter sur le tableau d'accueil des indicateurs calculés montrant les variations (ex: `+5%` ou `-2€`) sur des périodes données.
* **Note :** Idée de réflexion à creuser ultérieurement pour évaluer sa valeur d'usage réelle.
