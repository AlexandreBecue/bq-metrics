<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from 'vue';
import { dbStatus } from './db';
import DashboardView from './components/DashboardView.vue';
import DataExplorerView from './components/DataExplorerView.vue';
import CollectionChartsView from './components/CollectionChartsView.vue';
import CollectionsManagerView from './components/CollectionsManagerView.vue';
import SettingsView from './components/SettingsView.vue';
import { 
  LayoutDashboard, TableProperties, Database, Settings, Flame, Menu, X, BarChart3
} from '@lucide/vue';
import { 
  checkSavedConnectionState 
} from './db/google-drive';

// Navigation State
const activeTab = ref<string>('dashboard');
const isMobileSidebarOpen = ref(false);

// Reactive update key to force re-render views on change
const dashboardKey = ref(0);
const explorerKey = ref(0);
const collectionsKey = ref(0);

// Explorer Template Ref for express entry pass-through
const explorerRef = ref<any>(null);
const chartsRef = ref<any>(null);

const dbStatusText = computed(() => {
  switch (dbStatus.value) {
    case 'loading': return 'Chargement...';
    case 'saving': return 'Sauvegarde...';
    case 'error': return 'Erreur en base de données';
    default: return 'Base de données locale';
  }
});

// Initialize DB seeding on mount
onMounted(async () => {
  checkSavedConnectionState();
  handleDataUpdated();
});

const handleDataUpdated = () => {
  dashboardKey.value++;
  explorerKey.value++;
  collectionsKey.value++;
};

// Navigates and triggers dynamic actions
const handleNavigate = async (tab: string, colId?: string) => {
  activeTab.value = tab;
  isMobileSidebarOpen.value = false;
  
  if (tab === 'explorer' && colId) {
    await nextTick();
    if (explorerRef.value) {
      explorerRef.value.selectedCollectionId = colId;
    }
  }
};

const handleAddRecordExpress = async (colId: string) => {
  activeTab.value = 'explorer';
  isMobileSidebarOpen.value = false;
  
  // Wait for tab to mount/update, then trigger modal
  await nextTick();
  if (explorerRef.value) {
    explorerRef.value.openAddModalFor(colId);
  }
};

const handleOpenCharts = async (colId: string) => {
  activeTab.value = 'charts';
  isMobileSidebarOpen.value = false;
  
  // Wait for tab to mount/update, then trigger charts load
  await nextTick();
  if (chartsRef.value) {
    chartsRef.value.openChartsFor(colId);
  }
};
</script>

<template>
  <div class="app-layout">
    <!-- Desktop Sidebar Navigation -->
    <aside class="sidebar glass">
      <div class="sidebar-brand">
        <div class="brand-logo">
          <Flame class="brand-icon animate-glow" />
        </div>
        <div class="brand-text">
          <span class="brand-bq">bq</span>-metrics
        </div>
      </div>

      <nav class="sidebar-nav">
        <button 
          @click="handleNavigate('dashboard')" 
          :class="['nav-link', activeTab === 'dashboard' ? 'active' : '']"
        >
          <LayoutDashboard class="nav-icon" />
          <span>Tableau de bord</span>
        </button>

        <button 
          @click="handleNavigate('explorer')" 
          :class="['nav-link', activeTab === 'explorer' ? 'active' : '']"
        >
          <TableProperties class="nav-icon" />
          <span>Données</span>
        </button>

        <button 
          @click="handleNavigate('charts')" 
          :class="['nav-link', activeTab === 'charts' ? 'active' : '']"
        >
          <BarChart3 class="nav-icon" />
          <span>Graphiques</span>
        </button>

        <button 
          @click="handleNavigate('collections')" 
          :class="['nav-link', activeTab === 'collections' ? 'active' : '']"
        >
          <Database class="nav-icon" />
          <span>Modèles</span>
        </button>

        <button 
          @click="handleNavigate('settings')" 
          :class="['nav-link', activeTab === 'settings' ? 'active' : '']"
        >
          <Settings class="nav-icon" />
          <span>Paramètres</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="offline-badge" :class="dbStatus">
          <span class="pulse-indicator"></span>
          <span>{{ dbStatusText }}</span>
        </div>
        <p class="app-ver">v1.1.0 (PWA)</p>
      </div>
    </aside>

    <!-- Mobile Header -->
    <header class="mobile-header glass">
      <button @click="isMobileSidebarOpen = !isMobileSidebarOpen" class="btn-menu">
        <Menu v-if="!isMobileSidebarOpen" />
        <X v-else />
      </button>
      <div class="brand-text">
        <span class="brand-bq">bq</span>-metrics
      </div>
      <div class="ghost-spacer"></div>
    </header>

    <!-- Mobile Drawer Sidebar overlay -->
    <Transition name="drawer">
      <div v-if="isMobileSidebarOpen" class="mobile-drawer-overlay" @click.self="isMobileSidebarOpen = false">
        <div class="mobile-drawer glass">
          <div class="drawer-header">
            <div class="brand-text">
              <span class="brand-bq">bq</span>-metrics
            </div>
            <button @click="isMobileSidebarOpen = false" class="btn-close-drawer"><X /></button>
          </div>
          
          <nav class="drawer-nav">
            <button 
              @click="handleNavigate('dashboard')" 
              :class="['drawer-link', activeTab === 'dashboard' ? 'active' : '']"
            >
              <LayoutDashboard class="nav-icon" />
              <span>Tableau de bord</span>
            </button>

            <button 
              @click="handleNavigate('explorer')" 
              :class="['drawer-link', activeTab === 'explorer' ? 'active' : '']"
            >
              <TableProperties class="nav-icon" />
              <span>Données</span>
            </button>

            <button 
              @click="handleNavigate('charts')" 
              :class="['drawer-link', activeTab === 'charts' ? 'active' : '']"
            >
              <BarChart3 class="nav-icon" />
              <span>Graphiques</span>
            </button>

            <button 
              @click="handleNavigate('collections')" 
              :class="['drawer-link', activeTab === 'collections' ? 'active' : '']"
            >
              <Database class="nav-icon" />
              <span>Modèles</span>
            </button>

            <button 
              @click="handleNavigate('settings')" 
              :class="['drawer-link', activeTab === 'settings' ? 'active' : '']"
            >
              <Settings class="nav-icon" />
              <span>Paramètres</span>
            </button>
          </nav>
        </div>
      </div>
    </Transition>

    <!-- Main Dynamic Workspace View -->
    <main class="main-content-area">
      <div class="container-wide">
        <!-- Render views with caching dynamic updates -->
        <DashboardView 
          v-if="activeTab === 'dashboard'" 
          :key="'dash-' + dashboardKey"
          @navigate="handleNavigate"
          @add-record="handleAddRecordExpress"
          @open-charts="handleOpenCharts"
        />
        
        <DataExplorerView 
          v-else-if="activeTab === 'explorer'" 
          ref="explorerRef"
          :key="'exp-' + explorerKey"
          @data-updated="handleDataUpdated"
          @open-charts="handleOpenCharts"
        />

        <CollectionChartsView 
          v-else-if="activeTab === 'charts'" 
          ref="chartsRef"
          :key="'charts-' + collectionsKey"
          @navigate="handleNavigate"
        />
        
        <CollectionsManagerView 
          v-else-if="activeTab === 'collections'" 
          :key="'col-' + collectionsKey"
          @data-updated="handleDataUpdated"
        />
        
        <SettingsView 
          v-else-if="activeTab === 'settings'" 
          @data-updated="handleDataUpdated"
        />
      </div>
    </main>

    <!-- Mobile Bottom Navigation Bar (True Native PWA feel) -->
    <nav class="mobile-bottom-bar glass">
      <button 
        @click="handleNavigate('dashboard')" 
        :class="['bottom-link', activeTab === 'dashboard' ? 'active' : '']"
      >
        <LayoutDashboard class="bottom-icon" />
        <span>Dashboard</span>
      </button>

      <button 
        @click="handleNavigate('explorer')" 
        :class="['bottom-link', activeTab === 'explorer' ? 'active' : '']"
      >
        <TableProperties class="bottom-icon" />
        <span>Données</span>
      </button>

      <button 
        @click="handleNavigate('charts')" 
        :class="['bottom-link', activeTab === 'charts' ? 'active' : '']"
      >
        <BarChart3 class="bottom-icon" />
        <span>Stats</span>
      </button>

      <button 
        @click="handleNavigate('collections')" 
        :class="['bottom-link', activeTab === 'collections' ? 'active' : '']"
      >
        <Database class="bottom-icon" />
        <span>Modèles</span>
      </button>

      <button 
        @click="handleNavigate('settings')" 
        :class="['bottom-link', activeTab === 'settings' ? 'active' : '']"
      >
        <Settings class="bottom-icon" />
        <span>Params</span>
      </button>
    </nav>
  </div>
</template>

<style lang="scss">
/* Layout-wide structural styles */
.app-layout {
  display: flex;
  min-height: 100vh;
}

/* Sidebar navigation panels desktop */
.sidebar {
  width: 280px;
  background-color: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  height: 100vh;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 100;
  padding: 1.5rem 1rem;
  
  @media (max-width: 992px) {
    display: none; /* hidden on tablet/mobile */
  }
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 2.5rem;
  padding-left: 0.5rem;
  
  .brand-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border-radius: var(--radius-md);
    background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-accent) 100%);
    color: #ffffff;
    box-shadow: 0 0 15px rgba(59, 130, 246, 0.25);
  }
  
  .brand-icon {
    width: 20px;
    height: 20px;
  }
  
  .brand-text {
    font-size: 1.25rem;
    font-weight: 800;
    letter-spacing: -0.5px;
    
    .brand-bq {
      color: var(--color-primary);
    }
  }
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  flex: 1;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem 1.15rem;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  background: none;
  cursor: pointer;
  text-align: left;
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--text-secondary);
  transition: var(--transition);
  
  &:hover {
    background-color: rgba(255, 255, 255, 0.03);
    color: var(--text-primary);
  }
  
  &.active {
    background-color: rgba(59, 130, 246, 0.1);
    color: var(--color-primary);
    border-color: rgba(59, 130, 246, 0.2);
    box-shadow: var(--shadow-sm);
    
    .nav-icon {
      color: var(--color-primary);
    }
  }
}

.nav-icon {
  width: 18px;
  height: 18px;
  color: var(--text-muted);
  transition: var(--transition);
}

.sidebar-footer {
  border-top: 1px solid var(--border-color);
  padding-top: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.offline-badge {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
  font-weight: 600;
  transition: var(--transition);
  
  .pulse-indicator {
    width: 8px;
    height: 8px;
    background-color: var(--color-success);
    border-radius: 50%;
    box-shadow: 0 0 8px var(--color-success);
    display: inline-block;
    transition: var(--transition);
  }
  
  &.loading {
    color: var(--color-warning);
    .pulse-indicator {
      background-color: var(--color-warning);
      box-shadow: 0 0 8px var(--color-warning);
      animation: dbGlowPulse 1.2s infinite ease-in-out;
    }
  }
  
  &.saving {
    color: var(--color-info);
    .pulse-indicator {
      background-color: var(--color-info);
      box-shadow: 0 0 8px var(--color-info);
      animation: dbGlowPulse 0.6s infinite ease-in-out;
    }
  }
  
  &.error {
    color: var(--color-danger);
    .pulse-indicator {
      background-color: var(--color-danger);
      box-shadow: 0 0 8px var(--color-danger);
    }
  }
}

@keyframes dbGlowPulse {
  0%, 100% { transform: scale(1); opacity: 0.7; }
  50% { transform: scale(1.35); opacity: 1; }
}

.app-ver {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Mobile Header navigation */
.mobile-header {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 60px;
  z-index: 100;
  padding: 0 1rem;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color);
  
  @media (max-width: 992px) {
    display: flex;
  }
  
  .btn-menu {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    border-radius: var(--radius-sm);
  }
  
  .brand-text {
    font-size: 1.15rem;
    font-weight: 800;
    
    .brand-bq {
      color: var(--color-primary);
    }
  }
  
  .ghost-spacer {
    width: 40px; /* balances the menu button visually */
  }
}

/* Mobile drawer sidebar */
.mobile-drawer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  z-index: 1050;
  display: flex;
}

.mobile-drawer {
  width: 280px;
  height: 100%;
  background-color: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  padding: 1rem;
  animation: slideInLeft 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  
  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border-color);
    
    .brand-text {
      font-size: 1.15rem;
      font-weight: 800;
      .brand-bq {
        color: var(--color-primary);
      }
    }
    
    .btn-close-drawer {
      background: none;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 0.25rem;
    }
  }
}

.drawer-nav {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.drawer-link {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem 1.15rem;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  background: none;
  cursor: pointer;
  text-align: left;
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--text-secondary);
  transition: var(--transition);
  
  &:hover {
    background-color: rgba(255, 255, 255, 0.03);
    color: var(--text-primary);
  }
  
  &.active {
    background-color: rgba(59, 130, 246, 0.1);
    color: var(--color-primary);
    border-color: rgba(59, 130, 246, 0.2);
    
    .nav-icon {
      color: var(--color-primary);
    }
  }
}

/* Mobile Bottom Navigation Bar (Native style) */
.mobile-bottom-bar {
  display: none;
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 64px;
  background-color: rgba(19, 26, 38, 0.85);
  border-top: 1px solid var(--border-color);
  z-index: 100;
  justify-content: space-around;
  align-items: center;
  padding: 0 0.5rem;
  box-shadow: 0 -4px 10px rgba(0, 0, 0, 0.2);
  
  @media (max-width: 992px) {
    display: flex;
  }
}

.bottom-link {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 0.725rem;
  font-weight: 600;
  flex: 1;
  height: 100%;
  justify-content: center;
  transition: var(--transition);
  
  &:hover {
    color: var(--text-primary);
  }
  
  &.active {
    color: var(--color-primary);
    
    .bottom-icon {
      color: var(--color-primary);
      transform: translateY(-1px);
    }
  }
}

.bottom-icon {
  width: 20px;
  height: 20px;
  color: var(--text-muted);
  transition: var(--transition);
}

/* Main Content area */
.main-content-area {
  flex: 1;
  padding: 2.5rem;
  margin-left: 280px; /* leaves room for desktop sidebar */
  min-height: 100vh;
  max-height: 100vh; /* Lock height on desktop to keep everything inside viewport */
  overflow-y: auto;  /* Scroll internally if needed */
  min-width: 0;      /* Crucial: prevents wide children from pushing content off-screen on the right */
  
  @media (max-width: 992px) {
    margin-left: 0;
    padding: 1.5rem 1rem;
    padding-top: 80px; /* leaves room for mobile header */
    padding-bottom: 100px; /* leaves room for bottom nav */
    max-height: none; /* Let height grow naturally on mobile screens */
    overflow-y: visible;
  }
}

/* CSS Animations list */
@keyframes slideInLeft {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}

.animate-glow {
  animation: glowPulse 2.5s infinite ease-in-out;
}

@keyframes glowPulse {
  0%, 100% { filter: drop-shadow(0 0 2px rgba(59, 130, 246, 0.4)); }
  50% { filter: drop-shadow(0 0 8px rgba(168, 85, 247, 0.8)); }
}
</style>
