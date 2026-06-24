import Dexie, { type Table } from 'dexie';
import { ref } from 'vue';
import { evaluateFormula } from './queries';

export type DBStatus = 'ready' | 'loading' | 'saving' | 'error';
export const dbStatus = ref<DBStatus>('ready');

// Define Field types
export type FieldType = 'text' | 'number' | 'date' | 'tags' | 'boolean' | 'select' | 'relation';

export interface FieldConfig {
  id: string;
  name: string;              // E.g., "Prix au Litre", "Titre"
  key: string;               // E.g., "pricePerLiter", "title"
  type: FieldType;
  required: boolean;
  options?: string[];        // For 'select' type
  unit?: string;             // Custom unit for numeric fields, e.g., "€", "L / km"
  relatedCollectionId?: string; // For 'relation' type (cross-referencing other collections)
  isMultiple?: boolean;      // For 'relation' type (allow selecting multiple related records)
  isCalculated?: boolean;    // Is this field dynamically calculated via formula?
  formula?: string;          // Calculation formula e.g. "SPEED({distance}, TIME_TO_SEC({temps}))"
}

// Collection Schema (Data Model)
export interface CollectionSchema {
  id: string;                // UUID/Unique ID
  name: string;              // E.g., "Consommation Gazole"
  description?: string;
  fields: FieldConfig[];
  primaryFieldKey: string;   // The field used as the "label" or "title" for this record
  createdAt: number;
  updatedAt?: number;        // Tracked for sync
  deletedAt?: number;        // Soft delete tombstone
}

// Record (Actual dynamic entry)
export interface RecordEntry {
  id?: string;               // Auto-incremented / UUID in string
  collectionId: string;      // Links to collection.id
  data: Record<string, any>; // Dynamic fields data e.g. { title: 'Dune', players: 4 }
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;        // Soft delete tombstone
}

// Saved Filter Definition
export interface SavedFilter {
  fieldKey: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'not_contains' | 'in_tags' | 'is_empty' | 'is_not_empty';
  value: any;
  isInteractive?: boolean;
}

// Saved View (Filters, sorting, and charts configurations)
export interface SavedView {
  id: string;
  collectionId: string;
  name: string;              // E.g., "Jeux jouables à 3"
  filters: SavedFilter[];
  logicalOperator: 'and' | 'or';
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  chartType: 'none' | 'bar' | 'pie' | 'line' | 'doughnut';
  chartConfig?: {
    xAxisKey: string;        // Field key for X axis
    yAxisKey: string;        // Field key for Y axis, or "count"
    aggregate: 'sum' | 'avg' | 'count' | 'monthly_avg' | 'balance' | 'moving_avg' | 'monthly_sum' | 'monthly_count' | 'usage_since_reset';
    tooltipFields?: string[]; // Field keys to display in chart hover tooltip
  };
  createdAt: number;
  updatedAt?: number;        // Tracked for sync
  deletedAt?: number;        // Soft delete tombstone
}

// Record Template Definition
export interface RecordTemplate {
  id: string;                // UUID/Unique ID
  collectionId: string;      // Links to collection.id
  name: string;              // E.g., "Loyer Mensuel", "Plein Essence"
  data: Record<string, any>; // Dynamic prefilled fields data e.g. { category: 'Loyer', payment: 'Prélèvement' }
  isAutomated: boolean;      // True if automated alert is enabled
  recurrence?: 'monthly' | 'yearly';
  recurrenceDay?: number;    // Day of month (1 to 31)
  recurrenceMonth?: number;  // Month of year (1 to 12), for yearly recurrence
  lastGeneratedPeriod?: string; // Track e.g. "2026-06" or "2026" to avoid multiple triggers per period
  createdAt: number;
  updatedAt?: number;        // Tracked for sync
  deletedAt?: number;        // Soft delete tombstone
}

// BQMetrics Offline-First Dexie Database
export class BQMetricsDatabase extends Dexie {
  collections!: Table<CollectionSchema, string>;
  records!: Table<RecordEntry, string>;
  views!: Table<SavedView, string>;
  templates!: Table<RecordTemplate, string>;

  constructor() {
    super('BQMetricsDatabase');
    this.version(2).stores({
      collections: 'id, name, createdAt',
      records: 'id, collectionId, createdAt, updatedAt',
      views: 'id, collectionId, name, createdAt',
      templates: 'id, collectionId, isAutomated, createdAt'
    });
  }
}

export const db = new BQMetricsDatabase();

// Helper to generate unique IDs
export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

// --- Backup & Restore (JSON Import/Export) ---
export interface DatabaseBackup {
  version: number;
  collections: CollectionSchema[];
  records: RecordEntry[];
  views: SavedView[];
  templates?: RecordTemplate[];
  exportedAt: number;
}

export async function exportDatabase(): Promise<string> {
  const collections = await db.collections.toArray();
  const records = await db.records.toArray();
  const views = await db.views.toArray();
  const templates = await db.templates.toArray();

  const backup: DatabaseBackup = {
    version: 2,
    collections,
    records,
    views,
    templates,
    exportedAt: Date.now()
  };

  return JSON.stringify(backup, null, 2);
}

export interface ImportResult {
  success: boolean;
  error?: string;
  merged?: boolean;
}

export async function importDatabase(jsonString: string): Promise<ImportResult> {
  dbStatus.value = 'loading';
  try {
    let backup: any;
    try {
      backup = JSON.parse(jsonString);
    } catch (e) {
      dbStatus.value = 'ready';
      return { success: false, error: 'JSON malformé : Vérifie que le fichier a bien été copié en entier.' };
    }

    // Support flexible / partial schemas (fallback to empty arrays if missing)
    const collections = backup.collections || [];
    const records = backup.records || [];
    const views = backup.views || [];
    const templates = backup.templates || [];

    if (!Array.isArray(collections) || !Array.isArray(records) || !Array.isArray(views) || !Array.isArray(templates)) {
      dbStatus.value = 'ready';
      return { success: false, error: 'Structure invalide : collections, records, views et templates doivent être des listes.' };
    }

    if (collections.length === 0 && records.length === 0) {
      dbStatus.value = 'ready';
      return { success: false, error: 'Aucune donnée (modèle ou ligne) trouvée dans le fichier.' };
    }

    // Smart Merge (Fusion intelligente) : Upsert collections/views and append records
    await db.transaction('rw', [db.collections, db.records, db.views, db.templates], async () => {
      // 1. Upsert collections
      for (const col of collections) {
        await db.collections.put(col);
      }
      
      // 2. Append records with safe unique IDs
      for (const rec of records) {
        // Normalize boolean fields and automatically evaluate calculated fields on import
        const col = collections.find(c => c.id === rec.collectionId);
        if (col) {
          col.fields.forEach((f: FieldConfig) => {
            if (f.type === 'boolean') {
              const val = rec.data[f.key];
              if (typeof val === 'string') {
                rec.data[f.key] = (val.toUpperCase() === 'TRUE');
              }
            }
          });

          col.fields.forEach((f: FieldConfig) => {
            if (f.isCalculated && f.formula) {
              const val = rec.data[f.key];
              if (val === undefined || val === null || val === '') {
                const computedVal = evaluateFormula(f.formula, rec.data);
                if (computedVal !== undefined && computedVal !== null && computedVal !== '') {
                  rec.data[f.key] = computedVal;
                }
              }
            }
          });
        }

        if (rec.id) {
          const existing = await db.records.get(rec.id);
          if (existing) {
            // Re-generate ID to avoid overwriting existing records when merging sheets
            rec.id = `rec-${generateId()}`;
          }
        } else {
          rec.id = `rec-${generateId()}`;
        }
        await db.records.put(rec);
      }
      
      // 3. Upsert saved views
      for (const view of views) {
        await db.views.put(view);
      }

      // 4. Upsert templates
      for (const temp of templates) {
        await db.templates.put(temp);
      }
    });

    dbStatus.value = 'ready';
    return { success: true, merged: true };
  } catch (err: any) {
    dbStatus.value = 'error';
    console.error('Erreur lors de l\'importation de la base de données:', err);
    return { success: false, error: err.message || 'Erreur d\'écriture de la base de données' };
  }
}

// --- Seed Data Helper ---
export async function seedDatabaseIfEmpty() {
  const count = await db.collections.count();
  if (count > 0) return; // DB already seeded

  dbStatus.value = 'loading';
  console.log('Database empty, seeding default collections and records...');

  // 1. Seed Collection: Consommation Gazole
  const fuelCollectionId = 'col-gazole';
  const fuelCollection: CollectionSchema = {
    id: fuelCollectionId,
    name: 'Consommation Gazole',
    description: 'Suivi de la consommation de carburant de ma voiture',
    createdAt: Date.now(),
    primaryFieldKey: 'date',
    fields: [
      { id: 'f-date', name: 'Date', key: 'date', type: 'date', required: true },
      { id: 'f-price-l', name: 'Prix au Litre (€)', key: 'price_per_l', type: 'number', required: true },
      { id: 'f-total-price', name: 'Montant total (€)', key: 'total_price', type: 'number', required: true },
      { id: 'f-mileage', name: 'Kilométrage (km)', key: 'mileage', type: 'number', required: true },
      { id: 'f-full', name: 'Plein complet', key: 'full_tank', type: 'boolean', required: false },
      { id: 'f-tags', name: 'Tags', key: 'tags', type: 'tags', required: false }
    ]
  };

  // 2. Seed Collection: Jeux de Société
  const boardGamesId = 'col-jeux-societe';
  const boardGamesCollection: CollectionSchema = {
    id: boardGamesId,
    name: 'Jeux de Société',
    description: 'Collection de jeux de société et configurations de joueurs',
    createdAt: Date.now() - 1000,
    primaryFieldKey: 'title',
    fields: [
      { id: 'bg-title', name: 'Titre', key: 'title', type: 'text', required: true },
      { id: 'bg-min-players', name: 'Joueurs Min', key: 'min_players', type: 'number', required: true },
      { id: 'bg-max-players', name: 'Joueurs Max', key: 'max_players', type: 'number', required: true },
      { id: 'bg-playtime', name: 'Durée moyenne (min)', key: 'playtime', type: 'number', required: false },
      { id: 'bg-difficulty', name: 'Difficulté', key: 'difficulty', type: 'select', required: false, options: ['Facile', 'Moyen', 'Expert'] },
      { id: 'bg-tags', name: 'Mécaniques / Tags', key: 'tags', type: 'tags', required: false }
    ]
  };

  // 3. Seed Collection: Dépenses Voiture
  const carExpensesId = 'col-depenses-voiture';
  const carExpensesCollection: CollectionSchema = {
    id: carExpensesId,
    name: 'Dépenses Voiture',
    description: 'Suivi des frais annexes liés aux voitures (assurance, entretien, gazole, etc.)',
    createdAt: Date.now() - 2000,
    primaryFieldKey: 'description',
    fields: [
      { id: 'ce-date', name: 'Date', key: 'date', type: 'date', required: true },
      { id: 'ce-desc', name: 'Description', key: 'description', type: 'text', required: true },
      { id: 'ce-category', name: 'Catégorie', key: 'category', type: 'select', required: true, options: ['Entretien', 'Assurance', 'Péage/Parking', 'Carburant', 'Autre'] },
      { id: 'ce-amount', name: 'Montant (€)', key: 'amount', type: 'number', required: true }
    ]
  };

  await db.collections.bulkAdd([fuelCollection, boardGamesCollection, carExpensesCollection]);

  // Seed Records
  const records: RecordEntry[] = [
    // Fuel Records
    {
      collectionId: fuelCollectionId,
      createdAt: Date.now() - 30 * 24 * 3600 * 1000,
      updatedAt: Date.now() - 30 * 24 * 3600 * 1000,
      data: {
        date: '2026-05-01',
        price_per_l: 1.82,
        total_price: 81.9,
        mileage: 142350,
        full_tank: true,
        tags: ['Gazole', 'Total']
      }
    },
    {
      collectionId: fuelCollectionId,
      createdAt: Date.now() - 15 * 24 * 3600 * 1000,
      updatedAt: Date.now() - 15 * 24 * 3600 * 1000,
      data: {
        date: '2026-05-16',
        price_per_l: 1.79,
        total_price: 78.76,
        mileage: 143120,
        full_tank: true,
        tags: ['Gazole', 'Carrefour']
      }
    },
    {
      collectionId: fuelCollectionId,
      createdAt: Date.now() - 2 * 24 * 3600 * 1000,
      updatedAt: Date.now() - 2 * 24 * 3600 * 1000,
      data: {
        date: '2026-05-30',
        price_per_l: 1.81,
        total_price: 83.26,
        mileage: 143910,
        full_tank: true,
        tags: ['Gazole', 'Total']
      }
    },

    // Board Games Records
    {
      collectionId: boardGamesId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: {
        title: '7 Wonders Duo',
        min_players: 2,
        max_players: 2,
        playtime: 30,
        difficulty: 'Moyen',
        tags: ['Cartes', 'Draft', 'Stratégie', '2 joueurs']
      }
    },
    {
      collectionId: boardGamesId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: {
        title: 'Carcassonne',
        min_players: 2,
        max_players: 5,
        playtime: 45,
        difficulty: 'Facile',
        tags: ['Tuiles', 'Meeples', 'Familial']
      }
    },
    {
      collectionId: boardGamesId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: {
        title: 'Terraforming Mars',
        min_players: 1,
        max_players: 5,
        playtime: 120,
        difficulty: 'Expert',
        tags: ['Espace', 'Cartes', 'Gestion de ressources']
      }
    },

    // Car Expenses Records
    {
      collectionId: carExpensesId,
      createdAt: Date.now() - 28 * 24 * 3600 * 1000,
      updatedAt: Date.now() - 28 * 24 * 3600 * 1000,
      data: {
        date: '2026-05-03',
        description: 'Assurance mensuelle',
        category: 'Assurance',
        amount: 54.90
      }
    },
    {
      collectionId: carExpensesId,
      createdAt: Date.now() - 12 * 24 * 3600 * 1000,
      updatedAt: Date.now() - 12 * 24 * 3600 * 1000,
      data: {
        date: '2026-05-18',
        description: 'Plein Gazole Carrefour',
        category: 'Carburant',
        amount: 78.76
      }
    },
    {
      collectionId: carExpensesId,
      createdAt: Date.now() - 5 * 24 * 3600 * 1000,
      updatedAt: Date.now() - 5 * 24 * 3600 * 1000,
      data: {
        date: '2026-05-25',
        description: 'Remplacement Essuie-glaces',
        category: 'Entretien',
        amount: 34.50
      }
    }
  ];

  for (const rec of records) {
    await db.records.add(rec);
  }

  // Seed default saved views
  const views: SavedView[] = [
    {
      id: 'view-games-3',
      collectionId: boardGamesId,
      name: 'Jeux jouables à 3',
      logicalOperator: 'and',
      createdAt: Date.now(),
      filters: [
        { fieldKey: 'min_players', operator: 'lte', value: 3 },
        { fieldKey: 'max_players', operator: 'gte', value: 3 }
      ],
      chartType: 'none'
    },
    {
      id: 'view-car-expenses-pie',
      collectionId: carExpensesId,
      name: 'Répartition des dépenses de voiture',
      logicalOperator: 'and',
      createdAt: Date.now() - 500,
      filters: [],
      chartType: 'pie',
      chartConfig: {
        xAxisKey: 'category',
        yAxisKey: 'amount',
        aggregate: 'sum'
      }
    },
    {
      id: 'view-fuel-evolution',
      collectionId: fuelCollectionId,
      name: 'Évolution du prix du gazole',
      logicalOperator: 'and',
      createdAt: Date.now() - 600,
      filters: [],
      sortBy: 'date',
      sortOrder: 'asc',
      chartType: 'line',
      chartConfig: {
        xAxisKey: 'date',
        yAxisKey: 'price_per_l',
        aggregate: 'avg' // or just plot actual
      }
    }
  ];

  await db.views.bulkAdd(views);
  dbStatus.value = 'ready';
  console.log('Database successfully seeded!');
}
