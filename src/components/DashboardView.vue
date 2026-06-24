<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { db, type CollectionSchema } from '../db';
import { 
  Activity, Database, LayoutDashboard, Plus, Sparkles
} from '@lucide/vue';

const emit = defineEmits(['navigate', 'add-record', 'open-charts']);

const collections = ref<CollectionSchema[]>([]);
const totalRecordsCount = ref(0);

// Navigation shortcut helpers
const navigateTo = (tab: string) => {
  emit('navigate', tab);
};

const triggerAddRecord = (colId: string) => {
  emit('add-record', colId);
};

const triggerOpenCharts = (colId: string) => {
  emit('open-charts', colId);
};

const loadDashboardData = async () => {
  const rawCols = await db.collections.toArray();
  collections.value = rawCols
    .filter(c => !c.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  
  // Count only non-deleted records
  const rawRecords = await db.records.toArray();
  totalRecordsCount.value = rawRecords.filter(r => !r.deletedAt).length;
};

onMounted(() => {
  loadDashboardData();
});
</script>

<template>
  <div class="dashboard-view fade-in">
    <!-- Onboarding Sparkle Banner -->
    <div class="onboarding-banner card glass">
      <div class="banner-body">
        <div class="banner-icon-container">
          <Sparkles class="banner-sparkle" />
        </div>
        <div class="banner-text">
          <h2>Bienvenue sur bq-metrics</h2>
          <p>La console d'analyse tout-en-un pour centraliser tes données du quotidien. Saisis n'importe quelle donnée et génère de superbes statistiques en temps réel !</p>
        </div>
      </div>
    </div>

    <!-- Quick Stats Cards -->
    <div class="stats-row">
      <div class="stat-card card glass hoverable" @click="navigateTo('collections')">
        <div class="stat-main">
          <p class="stat-title">Fiches actives</p>
          <p class="stat-value">{{ collections.length }}</p>
        </div>
        <div class="stat-icon-wrapper blue">
          <Database class="stat-icon" />
        </div>
      </div>

      <div class="stat-card card glass hoverable" @click="navigateTo('explorer')">
        <div class="stat-main">
          <p class="stat-title">Total enregistrements</p>
          <p class="stat-value">{{ totalRecordsCount }}</p>
        </div>
        <div class="stat-icon-wrapper purple">
          <Activity class="stat-icon" />
        </div>
      </div>
    </div>

    <!-- Quick Actions Launchpad - Express Entry -->
    <div class="card glass launchpad-card">
      <h3>Saisie rapide</h3>
      <p class="section-desc">Ajoute rapidement des lignes à tes fiches existantes.</p>
      
      <div v-if="collections.length === 0" class="empty-launchpad">
        <p>Aucun modèle de données créé. Commence par concevoir un modèle.</p>
        <button @click="navigateTo('collections')" class="btn btn-secondary btn-sm mt-2">
          Créer un modèle
        </button>
      </div>
      
      <div v-else class="launchpad-grid">
        <button 
          v-for="col in collections" 
          :key="'express-' + col.id" 
          @click="triggerAddRecord(col.id)" 
          class="btn btn-secondary btn-launchpad"
        >
          <Plus class="launchpad-plus" />
          <span>{{ col.name }}</span>
        </button>
      </div>
    </div>

    <!-- Quick Actions Launchpad - Dedicated Charts -->
    <div class="card glass launchpad-card">
      <h3>Graphiques & Statistiques</h3>
      <p class="section-desc">Consulte les graphiques et visualisations de tes fiches.</p>
      
      <div v-if="collections.length === 0" class="empty-launchpad">
        <p>Aucun modèle de données créé. Commence par concevoir un modèle.</p>
        <button @click="navigateTo('collections')" class="btn btn-secondary btn-sm mt-2">
          Créer un modèle
        </button>
      </div>
      
      <div v-else class="launchpad-grid">
        <button 
          v-for="col in collections" 
          :key="'charts-launch-' + col.id" 
          @click="triggerOpenCharts(col.id)" 
          class="btn btn-secondary btn-launchpad charts-btn"
        >
          <LayoutDashboard class="launchpad-plus" />
          <span>{{ col.name }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.dashboard-view {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

/* Banner */
.onboarding-banner {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(168, 85, 247, 0.1) 100%);
  border-color: rgba(59, 130, 246, 0.15);
  padding: 1.75rem;
  
  .banner-body {
    display: flex;
    gap: 1.25rem;
    align-items: center;
  }
  
  .banner-icon-container {
    background-color: rgba(168, 85, 247, 0.15);
    color: var(--color-accent);
    width: 48px;
    height: 48px;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  
  .banner-sparkle {
    width: 24px;
    height: 24px;
    animation: pulse 2s infinite ease-in-out;
  }
  
  .banner-text {
    h2 {
      font-size: 1.5rem;
      font-weight: 800;
      margin-bottom: 0.25rem;
    }
    p {
      color: var(--text-secondary);
      font-size: 0.95rem;
      line-height: 1.5;
    }
  }
}

/* Stats Row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1.5rem;
}

.stat-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  
  .stat-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 0.25rem;
  }
  .stat-value {
    font-size: 2rem;
    font-weight: 800;
  }
  
  .stat-icon-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 46px;
    border-radius: var(--radius-md);
    
    &.blue {
      background-color: rgba(59, 130, 246, 0.1);
      color: var(--color-primary);
    }
    &.purple {
      background-color: rgba(168, 85, 247, 0.1);
      color: var(--color-accent);
    }
  }
  
  .stat-icon {
    width: 22px;
    height: 22px;
  }
}

/* Launchpad express entries */
.launchpad-card {
  h3 {
    font-size: 1.15rem;
    font-weight: 700;
    margin-bottom: 0.25rem;
  }
  
  .section-desc {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin-bottom: 1.25rem;
  }
}

.empty-launchpad {
  text-align: center;
  color: var(--text-muted);
  padding: 1rem;
  font-size: 0.9rem;
}

.mt-2 {
  margin-top: 0.5rem;
}

.launchpad-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.btn-launchpad {
  padding: 0.6rem 1rem !important;
  font-size: 0.9rem;
  border-radius: var(--radius-md);
  white-space: normal;
  text-align: left;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  word-break: break-word;
  
  &:hover {
    border-color: var(--color-primary);
    background-color: rgba(59, 130, 246, 0.05);
    color: var(--color-primary);
  }
  
  &.charts-btn:hover {
    border-color: var(--color-accent);
    background-color: rgba(168, 85, 247, 0.05);
    color: var(--color-accent);
  }
  
  .launchpad-plus {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
}

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 0.9; }
  50% { transform: scale(1.08); opacity: 1; }
}
</style>
