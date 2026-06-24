<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { exportDatabase, importDatabase, seedDatabaseIfEmpty, db } from '../db';
import { 
  isDriveConnected, 
  lastSyncTime, 
  syncStatusMsg, 
  isSyncing, 
  loadGoogleScript, 
  initializeGisClient, 
  connectGoogleDrive, 
  disconnectGoogleDrive, 
  checkSavedConnectionState, 
  triggerGoogleDriveSync 
} from '../db/google-drive';
import { Download, Upload, Play, Trash2, Check, AlertTriangle, FileJson, Cloud, RefreshCw, LogOut } from '@lucide/vue';

const emit = defineEmits(['data-updated']);

const isImporting = ref(false);
const statusMessage = ref('');
const isError = ref(false);
const showConfirmClear = ref(false);

const isDbEmpty = ref(true);

const checkDbStatus = async () => {
  const rawCols = await db.collections.toArray();
  const activeCols = rawCols.filter(c => !c.deletedAt);
  isDbEmpty.value = activeCols.length === 0;
};

onMounted(async () => {
  checkSavedConnectionState();
  await checkDbStatus();
  try {
    await loadGoogleScript();
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (clientId) {
      initializeGisClient(clientId, async (token) => {
        const success = await triggerGoogleDriveSync(token);
        if (success) {
          emit('data-updated');
          await checkDbStatus();
        }
      });
    } else {
      console.warn("Client ID Google non configuré dans .env");
    }
  } catch (err) {
    console.error("Échec du chargement du script Google GIS:", err);
  }
});

const handleSyncNow = async () => {
  const success = await triggerGoogleDriveSync();
  if (success) {
    emit('data-updated');
    await checkDbStatus();
  }
};

const handleExport = async () => {
  try {
    const backupJson = await exportDatabase();
    const blob = new Blob([backupJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `bq-metrics-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showStatus('Sauvegarde exportée avec succès !', false);
  } catch (err) {
    showStatus('Erreur lors de l\'exportation.', true);
  }
};

const handleImport = (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  
  const file = input.files[0];
  const reader = new FileReader();
  
  isImporting.value = true;
  statusMessage.value = 'Importation en cours...';
  
  reader.onload = async (e) => {
    try {
      const jsonText = e.target?.result as string;
      const result = await importDatabase(jsonText);
      if (result.success) {
        showStatus('Données fusionnées et importées avec succès !', false);
        emit('data-updated');
        await checkDbStatus();
      } else {
        showStatus(result.error || 'Erreur d\'importation.', true);
      }
    } catch (err) {
      showStatus('Erreur de lecture du fichier.', true);
    } finally {
      isImporting.value = false;
      input.value = ''; // Reset file input
    }
  };
  
  reader.readAsText(file);
};

const handleSeed = async () => {
  try {
    // Clear first to force seeding
    await clearAllData();
    await seedDatabaseIfEmpty();
    showStatus('Données de démonstration chargées avec succès !', false);
    emit('data-updated');
    await checkDbStatus();
  } catch (err) {
    showStatus('Erreur lors du chargement des démos.', true);
  }
};

const clearAllData = async () => {
  await db.transaction('rw', [db.collections, db.records, db.views], async () => {
    await db.collections.clear();
    await db.records.clear();
    await db.views.clear();
  });
};

const handleClearDatabase = async () => {
  try {
    await clearAllData();
    // Safely disconnect Google Drive to protect cloud backups from blank states 
    // and avoid immediate auto-restoration of data on the cleared device.
    if (isDriveConnected.value) {
      disconnectGoogleDrive();
    }
    // Clear last sync metadata from memory and storage since database is cleared
    lastSyncTime.value = '';
    localStorage.removeItem('bq_last_sync_time');
    
    showConfirmClear.value = false;
    showStatus('Toutes les données locales ont été effacées.', false);
    emit('data-updated');
    await checkDbStatus();
  } catch (err) {
    showStatus('Erreur lors de la réinitialisation.', true);
  }
};

const showStatus = (msg: string, error = false) => {
  statusMessage.value = msg;
  isError.value = error;
  setTimeout(() => {
    statusMessage.value = '';
  }, 4000);
};
</script>

<template>
  <div class="settings-view fade-in">
    <div class="view-header">
      <h1>Paramètres & Sauvegardes</h1>
      <p class="subtitle">Gère tes données stockées localement en IndexedDB de manière sécurisée.</p>
    </div>

    <div class="settings-grid">
      <!-- Google Drive Sync Card -->
      <div class="card glass">
        <div class="card-header">
          <div class="icon-wrapper info">
            <Cloud class="icon" />
          </div>
          <h2>Synchronisation Cloud</h2>
        </div>
        <p class="card-desc">
          Sauvegarde et synchronise automatiquement ou manuellement tes données sur ton compte Google Drive personnel.
        </p>

        <div v-if="!isDriveConnected">
          <div class="actions-group">
            <button @click="connectGoogleDrive" class="btn btn-primary bg-drive">
              <Cloud class="btn-icon" />
              Se connecter à Google Drive
            </button>
            <p class="field-tip text-center mt-2">Connexion directe et hautement sécurisée (accès restreint uniquement aux fichiers créés par l'application).</p>
          </div>
          
          <div v-if="lastSyncTime" class="drive-status-box">
            <div class="status-row-item">
              <span class="status-label">Statut :</span>
              <span class="status-value text-muted">⚪ Déconnecté</span>
            </div>
            <div class="status-row-item">
              <span class="status-label">Dernière synchro :</span>
              <span class="status-value">{{ lastSyncTime }}</span>
            </div>
            <div class="status-msg-box text-center">
              <p>Connecte-toi pour réactiver la synchronisation automatique de tes données.</p>
            </div>
          </div>
        </div>

        <div v-else class="drive-status-box">
          <div class="status-row-item">
            <span class="status-label">Statut :</span>
            <span class="status-value text-success">🟢 Connecté</span>
          </div>
          <div v-if="lastSyncTime" class="status-row-item">
            <span class="status-label">Dernière synchro :</span>
            <span class="status-value">{{ lastSyncTime }}</span>
          </div>
          <div v-if="syncStatusMsg" class="status-msg-box">
            <p>{{ syncStatusMsg }}</p>
          </div>
          
          <div class="actions-group mt-2">
            <button @click="handleSyncNow" :disabled="isSyncing" class="btn btn-primary">
              <RefreshCw class="btn-icon" :class="{ 'animate-spin': isSyncing }" />
              {{ isSyncing ? 'Synchronisation...' : 'Synchroniser' }}
            </button>
            <button @click="disconnectGoogleDrive" class="btn btn-secondary text-danger">
              <LogOut class="btn-icon text-danger" />
              Déconnecter
            </button>
          </div>
        </div>
      </div>

      <!-- Backup Card -->
      <div class="card glass">
        <div class="card-header">
          <div class="icon-wrapper accent">
            <FileJson class="icon" />
          </div>
          <h2>Sauvegarde locale</h2>
        </div>
        <p class="card-desc">
          <span v-if="!isDriveConnected">
            Toutes tes données sont actuellement stockées <strong>uniquement dans ton navigateur</strong>. Pense à exporter régulièrement tes données sous forme de fichier JSON ou à activer la synchronisation cloud pour ne rien perdre.
          </span>
          <span v-else>
            Tes données locales sont synchronisées et sauvegardées de manière sécurisée sur ton espace <strong>Google Drive</strong> personnel. Tu peux tout de même exporter une sauvegarde JSON locale à tout moment pour plus de sécurité.
          </span>
        </p>
        
        <div class="actions-group">
          <button @click="handleExport" class="btn btn-primary">
            <Download class="btn-icon" />
            Exporter mes données (JSON)
          </button>
          
          <label class="btn btn-secondary cursor-pointer">
            <Upload class="btn-icon" />
            Importer une sauvegarde
            <input type="file" accept=".json" @change="handleImport" class="hidden-input" />
          </label>
        </div>
      </div>

      <!-- Demo Data Card -->
      <div v-if="isDbEmpty" class="card glass">
        <div class="card-header">
          <div class="icon-wrapper info">
            <Play class="icon" />
          </div>
          <h2>Données de démo</h2>
        </div>
        <p class="card-desc">
          Tu veux tester l'application tout de suite ? Charge notre jeu de données complet de démonstration (Consommation de Gazole, Jeux de Société, Dépenses de voiture) contenant des graphiques pré-configurés.
        </p>
        
        <div class="warning-box">
          <AlertTriangle class="warn-icon" />
          <span>Attention : Cela écrasera et remplacera tes données actuelles.</span>
        </div>

        <button @click="handleSeed" class="btn btn-accent">
          <Play class="btn-icon" />
          Charger les données de démo
        </button>
      </div>

      <!-- Danger Zone -->
      <div v-if="!isDbEmpty" class="card glass danger-card">
        <div class="card-header">
          <div class="icon-wrapper danger">
            <Trash2 class="icon" />
          </div>
          <h2>Réinitialisation des données</h2>
        </div>
        <p class="card-desc">
          Cette action supprimera définitivement toutes tes collections, enregistrements et vues sauvegardés sur cet appareil.
        </p>

        <button v-if="!showConfirmClear" @click="showConfirmClear = true" class="btn btn-danger">
          <Trash2 class="btn-icon" />
          Réinitialiser l'application
        </button>

        <div v-else class="confirm-box">
          <p class="confirm-title">Es-tu absolument sûr ?</p>
          <p class="confirm-desc">Toutes tes données locales seront perdues à jamais.</p>
          <div class="confirm-actions">
            <button @click="handleClearDatabase" class="btn btn-danger btn-sm">Oui, tout supprimer</button>
            <button @click="showConfirmClear = false" class="btn btn-secondary btn-sm">Annuler</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Toast Notification -->
    <Transition name="toast">
      <div v-if="statusMessage" :class="['toast-notification', isError ? 'error' : 'success']">
        <Check v-if="!isError" class="toast-icon" />
        <AlertTriangle v-else class="toast-icon" />
        <span>{{ statusMessage }}</span>
      </div>
    </Transition>
  </div>
</template>

<style lang="scss" scoped>
.settings-view {
  max-width: 1000px;
  margin: 0 auto;
}

.view-header {
  margin-bottom: 2.5rem;
  
  h1 {
    font-size: 2.25rem;
    font-weight: 800;
    margin-bottom: 0.5rem;
    background: linear-gradient(135deg, #f8fafc 0%, #94a3b8 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  
  .subtitle {
    color: var(--text-secondary);
    font-size: 1.1rem;
  }
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem;
}

.card {
  display: flex;
  flex-direction: column;
  height: 100%;
  
  .card-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
    
    h2 {
      font-size: 1.25rem;
      font-weight: 700;
    }
  }
  
  .card-desc {
    color: var(--text-secondary);
    font-size: 0.95rem;
    line-height: 1.5;
    margin-bottom: 1.5rem;
    flex-grow: 1;
  }
}

.icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: var(--radius-md);
  
  &.accent {
    background-color: rgba(168, 85, 247, 0.15);
    color: var(--color-accent);
  }
  &.info {
    background-color: rgba(6, 182, 212, 0.15);
    color: var(--color-info);
  }
  &.danger {
    background-color: rgba(239, 68, 68, 0.15);
    color: var(--color-danger);
  }
  
  .icon {
    width: 20px;
    height: 20px;
  }
}

.actions-group {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.hidden-input {
  display: none;
}

.cursor-pointer {
  cursor: pointer;
}

.warning-box {
  display: flex;
  gap: 0.75rem;
  background-color: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.2);
  border-radius: var(--radius-md);
  padding: 0.75rem 1rem;
  font-size: 0.85rem;
  color: var(--color-warning);
  margin-bottom: 1.5rem;
  align-items: flex-start;
  
  .warn-icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    margin-top: 1px;
  }
}

.danger-card {
  border-color: rgba(239, 68, 68, 0.2);
  
  &:hover {
    border-color: var(--color-danger) !important;
    box-shadow: 0 0 20px rgba(239, 68, 68, 0.1) !important;
  }
}

.confirm-box {
  background-color: rgba(239, 68, 68, 0.05);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: var(--radius-md);
  padding: 1rem;
  
  .confirm-title {
    font-weight: 700;
    color: var(--color-danger);
    margin-bottom: 0.25rem;
  }
  
  .confirm-desc {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin-bottom: 1rem;
  }
  
  .confirm-actions {
    display: flex;
    gap: 0.75rem;
  }
}

/* Toast styling */
.toast-notification {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  font-weight: 600;
  z-index: 1000;
  border: 1px solid transparent;
  
  &.success {
    background-color: #064e3b;
    color: #a7f3d0;
    border-color: #059669;
  }
  
  &.error {
    background-color: #7f1d1d;
    color: #fecaca;
    border-color: #dc2626;
  }
  
  .toast-icon {
    width: 20px;
    height: 20px;
  }
  
  @media (max-width: 768px) {
    bottom: 5.5rem;
    right: 1rem;
    left: 1rem;
  }
}

/* Vue Transitions */
.toast-enter-active, .toast-leave-active {
  transition: var(--transition);
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(30px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(30px);
}

.bg-drive {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
  border-color: #059669 !important;
  &:hover {
    background: linear-gradient(135deg, #059669 0%, #047857 100%) !important;
    border-color: #047857 !important;
  }
}

.drive-status-box {
  background-color: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  text-align: left;
  margin-top: 1rem;
}

.status-row-item {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  
  .status-label {
    color: var(--text-secondary);
    font-weight: 500;
  }
  .status-value {
    color: var(--text-primary);
    font-weight: 700;
  }
}

.status-msg-box {
  font-size: 0.85rem;
  color: var(--text-muted);
  border-top: 1px dashed var(--border-color);
  padding-top: 0.5rem;
  margin-top: 0.25rem;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.animate-spin {
  animation: spin 1s linear infinite;
}
</style>
