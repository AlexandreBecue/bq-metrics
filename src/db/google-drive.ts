import { db, type CollectionSchema, type RecordEntry, type SavedView, type RecordTemplate } from './index';

// Reactive-like state for UI binding
import { ref } from 'vue';

export const isDriveConnected = ref(false);
export const lastSyncTime = ref<string>('');
export const syncStatusMsg = ref<string>('');
export const isSyncing = ref(false);

const GOOGLE_GIS_URL = 'https://accounts.google.com/gsi/client';
let tokenClient: any = null;
let googleAccessToken = '';

// Load GIS script dynamically
export function loadGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${GOOGLE_GIS_URL}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GOOGLE_GIS_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = (err) => reject(err);
    document.head.appendChild(script);
  });
}

// Initialize GIS Token Client
export function initializeGisClient(clientId: string, onSuccess: (token: string) => void) {
  if (!clientId) {
    console.error('VITE_GOOGLE_CLIENT_ID manquant.');
    return;
  }
  
  // @ts-ignore
  if (typeof google === 'undefined' || !google.accounts) {
    console.error('Google SDK non chargé.');
    return;
  }

  // @ts-ignore
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/drive.file',
    callback: async (resp: any) => {
      if (resp && resp.access_token) {
        googleAccessToken = resp.access_token;
        isDriveConnected.value = true;
        localStorage.setItem('bq_drive_access_token', googleAccessToken);
        localStorage.setItem('bq_drive_connected', 'true');
        onSuccess(googleAccessToken);
      }
    }
  });
}

// Connect to Google Drive (trigger prompt)
export function connectGoogleDrive() {
  if (tokenClient) {
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    console.error('Client GIS non initialisé.');
  }
}

// Disconnect from Google Drive
export function disconnectGoogleDrive() {
  googleAccessToken = '';
  isDriveConnected.value = false;
  localStorage.removeItem('bq_drive_access_token');
  localStorage.setItem('bq_drive_connected', 'false');
  syncStatusMsg.value = 'Déconnecté de Google Drive.';
}

// Load connection state from local storage on mount
export function checkSavedConnectionState() {
  const isConnected = localStorage.getItem('bq_drive_connected') === 'true';
  const savedToken = localStorage.getItem('bq_drive_access_token');
  const savedTime = localStorage.getItem('bq_last_sync_time');
  
  if (isConnected && savedToken) {
    googleAccessToken = savedToken;
    isDriveConnected.value = true;
  }
  if (savedTime) {
    lastSyncTime.value = savedTime;
  }
}

// --- Google Drive REST API Actions via Fetch ---

async function findSyncFile(token: string): Promise<string | null> {
  const query = encodeURIComponent("name='bq-metrics-sync.json' and trashed=false");
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`;
  
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (!resp.ok) {
    if (resp.status === 401) {
      disconnectGoogleDrive();
      throw new Error('Session Google expirée. Reconnecte-toi.');
    }
    throw new Error('Impossible d\'interroger Google Drive.');
  }
  
  const data = await resp.json();
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }
  return null;
}

async function downloadCloudData(token: string, fileId: string): Promise<any> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (!resp.ok) {
    throw new Error('Erreur de téléchargement de la sauvegarde.');
  }
  
  return await resp.json();
}

async function uploadCloudData(token: string, backupData: any, fileId?: string): Promise<string> {
  const metadata = {
    name: 'bq-metrics-sync.json',
    mimeType: 'application/json'
  };
  
  const boundary = 'bq_metrics_sync_boundary';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  
  const body = 
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    JSON.stringify(backupData, null, 2) +
    closeDelimiter;

  let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  let method = 'POST';
  
  if (fileId) {
    url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
    method = 'PATCH';
  }
  
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });
  
  if (!resp.ok) {
    throw new Error('Erreur de téléversement vers Google Drive.');
  }
  
  const result = await resp.json();
  return result.id;
}

// --- Smart Merge Engine ---

function mergeLists(localList: any[], cloudList: any[]): any[] {
  const map = new Map<string, any>();
  
  // Insert all local items
  localList.forEach(item => {
    map.set(item.id, item);
  });
  
  // Merge cloud items
  cloudList.forEach(cloudItem => {
    const localItem = map.get(cloudItem.id);
    if (!localItem) {
      // Cloud item doesn't exist locally: accept it
      map.set(cloudItem.id, cloudItem);
    } else {
      // Conflict: compare last update timestamps
      const localTime = localItem.updatedAt || localItem.createdAt || 0;
      const cloudTime = cloudItem.updatedAt || cloudItem.createdAt || 0;
      
      if (cloudTime > localTime) {
        // Cloud item is newer: replace local
        map.set(cloudItem.id, cloudItem);
      }
      // Otherwise keep local item (it is newer or equal)
    }
  });
  
  return Array.from(map.values());
}

export async function syncMergeDatabase(cloudData: any): Promise<boolean> {
  const cloudCollections: CollectionSchema[] = cloudData.collections || [];
  const cloudRecords: RecordEntry[] = cloudData.records || [];
  const cloudViews: SavedView[] = cloudData.views || [];
  const cloudTemplates: RecordTemplate[] = cloudData.templates || [];
  
  // Get all local elements (including soft deleted ones)
  const localCollections: CollectionSchema[] = await db.collections.toArray();
  const localRecords: RecordEntry[] = await db.records.toArray();
  const localViews: SavedView[] = await db.views.toArray();
  const localTemplates: RecordTemplate[] = await db.templates.toArray();
  
  // Merge each table
  const mergedCollections = mergeLists(localCollections, cloudCollections);
  const mergedRecords = mergeLists(localRecords, cloudRecords);
  const mergedViews = mergeLists(localViews, cloudViews);
  const mergedTemplates = mergeLists(localTemplates, cloudTemplates);
  
  // Overwrite local DB in a safe atomic transaction
  await db.transaction('rw', [db.collections, db.records, db.views, db.templates], async () => {
    await db.collections.clear();
    for (const c of mergedCollections) await db.collections.put(c);
    
    await db.records.clear();
    for (const r of mergedRecords) await db.records.put(r);
    
    await db.views.clear();
    for (const v of mergedViews) await db.views.put(v);
    
    await db.templates.clear();
    for (const t of mergedTemplates) await db.templates.put(t);
  });

  return true;
}

// --- Main Synchronize Method ---

export async function triggerGoogleDriveSync(token = googleAccessToken): Promise<boolean> {
  if (!token) {
    syncStatusMsg.value = 'Non connecté à Google Drive.';
    return false;
  }
  
  isSyncing.value = true;
  syncStatusMsg.value = 'Synchronisation en cours...';
  
  try {
    // 1. Find sync file on Drive
    const fileId = await findSyncFile(token);
    
    // Get full state of local database
    const localCollections = await db.collections.toArray();
    const localRecords = await db.records.toArray();
    const localViews = await db.views.toArray();
    const localTemplates = await db.templates.toArray();
    
    const localBackup = {
      version: 2,
      collections: localCollections,
      records: localRecords,
      views: localViews,
      templates: localTemplates,
      exportedAt: Date.now()
    };
    
    if (!fileId) {
      // Scenario A: First sync ever! Simply upload local data to a new file
      syncStatusMsg.value = 'Premier enregistrement sur Google Drive...';
      await uploadCloudData(token, localBackup);
    } else {
      // Scenario B: Sync file exists! Download, merge, and upload result
      syncStatusMsg.value = 'Téléchargement de la version Cloud...';
      const cloudBackup = await downloadCloudData(token, fileId);
      
      syncStatusMsg.value = 'Fusion des données locales et distantes...';
      await syncMergeDatabase(cloudBackup);
      
      // Get the freshly merged database state to save it back to the Cloud
      const mergedCollections = await db.collections.toArray();
      const mergedRecords = await db.records.toArray();
      const mergedViews = await db.views.toArray();
      const mergedTemplates = await db.templates.toArray();
      
      const mergedBackup = {
        version: 2,
        collections: mergedCollections,
        records: mergedRecords,
        views: mergedViews,
        templates: mergedTemplates,
        exportedAt: Date.now()
      };
      
      syncStatusMsg.value = 'Mise à jour du fichier sur Google Drive...';
      await uploadCloudData(token, mergedBackup, fileId);
    }
    
    const dateStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    lastSyncTime.value = dateStr;
    localStorage.setItem('bq_last_sync_time', dateStr);
    
    syncStatusMsg.value = `Synchronisé avec succès à ${dateStr}`;
    isSyncing.value = false;
    return true;
  } catch (err: any) {
    isSyncing.value = false;
    syncStatusMsg.value = err.message || 'Erreur lors de la synchronisation.';
    console.error('Erreur Synchro Drive:', err);
    return false;
  }
}
