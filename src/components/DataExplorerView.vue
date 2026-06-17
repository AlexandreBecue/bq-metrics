<script setup lang="ts">
import { ref, watch, onMounted, computed, shallowRef } from 'vue';
import { db, generateId, dbStatus, type CollectionSchema, type RecordEntry, type SavedFilter, type SavedView, type RecordTemplate } from '../db';
import { evaluateFilters, formatToFrenchDate, evaluateFormula } from '../db/queries';
import { 
  Plus, Trash2, Edit2, Search, SlidersHorizontal, Filter, Save, 
  X, Check, AlertCircle, LayoutDashboard, Sparkles, Bell
} from '@lucide/vue';

const emit = defineEmits(['data-updated', 'open-charts']);

const collections = ref<CollectionSchema[]>([]);
const selectedCollectionId = ref<string>(localStorage.getItem('bq-metrics-active-collection-id') || '');
const records = shallowRef<RecordEntry[]>([]);
const savedViews = ref<SavedView[]>([]);

// Cache for related collections' records
const relatedRecordsCache = ref<Record<string, RecordEntry[]>>({});

// Filter and View States
const activeViewId = ref<string>('all'); // 'all' or custom savedView.id
const searchQuery = ref('');
const showFiltersPanel = ref(false);
const currentFilters = ref<SavedFilter[]>([]);
const logicalOperator = ref<'and' | 'or'>('and');
const sortByField = ref<string>('');
const sortOrder = ref<'asc' | 'desc'>('desc');

// Pagination States
const currentPage = ref(1);
const pageSize = ref(50);

// New View Save state
const showSaveViewModal = ref(false);
const newViewName = ref('');
const chartType = ref<'none' | 'bar' | 'pie' | 'line'>('none');
const xAxisKey = ref('');
const yAxisKey = ref('');
const aggregateType = ref<'sum' | 'avg' | 'count' | 'monthly_avg' | 'balance'>('sum');
const tooltipFields = ref<string[]>([]);

const openSaveViewModal = () => {
  if (activeViewId.value !== 'all') {
    const view = savedViews.value.find(v => v.id === activeViewId.value);
    if (view) {
      newViewName.value = view.name;
      chartType.value = view.chartType;
      if (view.chartConfig) {
        xAxisKey.value = view.chartConfig.xAxisKey;
        yAxisKey.value = view.chartConfig.yAxisKey;
        aggregateType.value = view.chartConfig.aggregate;
        tooltipFields.value = [...(view.chartConfig.tooltipFields || [])];
      } else {
        xAxisKey.value = activeCollection.value?.fields[0]?.key || '';
        yAxisKey.value = 'count';
        aggregateType.value = 'sum';
        tooltipFields.value = [];
      }
    }
  } else {
    newViewName.value = '';
    chartType.value = 'none';
    xAxisKey.value = activeCollection.value?.fields[0]?.key || '';
    yAxisKey.value = 'count';
    aggregateType.value = 'sum';
    tooltipFields.value = [];
  }
  showSaveViewModal.value = true;
};

// Reset tooltip fields when chart type is changed to pie or none
watch(chartType, (newVal) => {
  if (newVal === 'pie' || newVal === 'none') {
    tooltipFields.value = [];
  }
});

// Form/Modal States for Add/Edit Record
const showFormModal = ref(false);
const editingRecordId = ref<string | null>(null);
const recordFormData = ref<Record<string, any>>({});
const tempTagInputs = ref<Record<string, string>>({}); // holds typing tags
const shouldOpenAddModalOnLoad = ref(false); // queue flag for async express entry loading

// Templates & Automation States
interface TemplateNotification {
  template: RecordTemplate;
  period: string; // "2026-06" or "2026"
  message: string;
}

const templates = ref<RecordTemplate[]>([]);
const activeNotification = ref<TemplateNotification | null>(null);
const pendingNotificationTrigger = ref<TemplateNotification | null>(null);

// Save template sub-modal states
const showSaveTemplateModal = ref(false);
const templateFormName = ref('');
const templateFormIsAutomated = ref(false);
const templateFormRecurrence = ref<'monthly' | 'yearly'>('monthly');
const templateFormRecurrenceDay = ref<number>(1);
const templateFormRecurrenceMonth = ref<number>(1);

// Manage templates modal state
const showManageTemplatesModal = ref(false);

const activeCollection = computed(() => {
  return collections.value.find(c => c.id === selectedCollectionId.value);
});

// Load everything
const loadInitialData = async () => {
  const rawCols = await db.collections.toArray();
  collections.value = rawCols
    .filter(c => !c.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  
  // Validate current collection ID or select first available
  const isCurrentIdValid = collections.value.some(c => c.id === selectedCollectionId.value);
  if (!isCurrentIdValid && collections.value.length > 0) {
    selectedCollectionId.value = collections.value[0].id;
  } else if (collections.value.length === 0) {
    selectedCollectionId.value = '';
  }

  if (selectedCollectionId.value) {
    await loadRecords();
    await loadSavedViews();
    await loadTemplates();
    setupDefaultSorting();
    
    // If there is a pending request to open the add modal, trigger it once collections are ready
    if (shouldOpenAddModalOnLoad.value) {
      shouldOpenAddModalOnLoad.value = false;
      openAddModal();
    }
  }
};

const setupDefaultSorting = () => {
  if (activeCollection.value) {
    const dateField = activeCollection.value.fields.find(f => f.type === 'date');
    if (dateField) {
      sortByField.value = dateField.key;
      sortOrder.value = 'desc'; // Le plus récent en premier
    } else {
      sortByField.value = '';
      sortOrder.value = 'desc';
    }
  }
};

const loadRelatedRecords = async () => {
  if (!activeCollection.value) return;
  
  const cache: Record<string, RecordEntry[]> = {};
  
  for (const field of activeCollection.value.fields) {
    if (field.type === 'relation' && field.relatedCollectionId) {
      try {
        const relatedRecs = await db.records.where('collectionId').equals(field.relatedCollectionId).toArray();
        const activeRecs = relatedRecs.filter(r => !r.deletedAt);
        
        // Find target collection and its primaryFieldKey
        const targetCol = collections.value.find(c => c.id === field.relatedCollectionId);
        const primaryKey = targetCol?.primaryFieldKey || 'title';
        
        // Sort active records alphabetically by their primary field value
        activeRecs.sort((a, b) => {
          const valA = String(a.data[primaryKey] || '').trim();
          const valB = String(b.data[primaryKey] || '').trim();
          return valA.localeCompare(valB, 'fr', { sensitivity: 'base' });
        });
        
        cache[field.relatedCollectionId] = activeRecs;
      } catch (err) {
        console.error(`Erreur de chargement du cache de relation pour ${field.relatedCollectionId}:`, err);
      }
    }
  }
  
  relatedRecordsCache.value = cache;
};

const loadRecords = async () => {
  if (!selectedCollectionId.value) return;
  dbStatus.value = 'loading';
  try {
    const rawRecords = await db.records.where('collectionId').equals(selectedCollectionId.value).toArray();
    records.value = rawRecords.filter(r => !r.deletedAt);
    await loadRelatedRecords();
    dbStatus.value = 'ready';
  } catch (e) {
    dbStatus.value = 'error';
    console.error('Erreur lors du chargement des enregistrements:', e);
  }
};

const loadSavedViews = async () => {
  if (!selectedCollectionId.value) return;
  const rawViews = await db.views.where('collectionId').equals(selectedCollectionId.value).toArray();
  savedViews.value = rawViews.filter(v => !v.deletedAt).sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
};

onMounted(() => {
  loadInitialData();
});

// Watch collection changes to reset filters, view, and load records
watch(selectedCollectionId, async (newVal) => {
  if (newVal) {
    localStorage.setItem('bq-metrics-active-collection-id', newVal);
    activeViewId.value = 'all';
    searchQuery.value = '';
    currentFilters.value = [];
    showFiltersPanel.value = false;
    await loadRecords();
    await loadSavedViews();
    await loadTemplates();
    setupDefaultSorting();
  }
});

// Watch form data changes to dynamically evaluate formulas in real-time
watch(recordFormData, (newVal) => {
  if (!activeCollection.value) return;
  activeCollection.value.fields.forEach(f => {
    if (f.isCalculated && f.formula) {
      const computedVal = evaluateFormula(f.formula, newVal);
      if (newVal[f.key] !== computedVal) {
        newVal[f.key] = computedVal;
      }
    }
  });
}, { deep: true });

// Apply filters and sorting
const processedRecords = computed(() => {
  let result = [...records.value];

  // 1. Apply global search query (across primary field or all fields)
  if (searchQuery.value.trim() && activeCollection.value) {
    const q = searchQuery.value.toLowerCase().trim();
    result = result.filter(rec => {
      return Object.values(rec.data).some(val => {
        if (Array.isArray(val)) {
          return val.some(v => String(v).toLowerCase().includes(q));
        }
        return String(val || '').toLowerCase().includes(q);
      });
    });
  }

  // 2. Apply Custom Query Filters (currentFilters)
  if (currentFilters.value.length > 0) {
    result = result.filter(rec => evaluateFilters(rec, currentFilters.value, logicalOperator.value));
  }

  // 3. Apply sorting
  if (sortByField.value && activeCollection.value) {
    const fieldKey = sortByField.value;
    const isDesc = sortOrder.value === 'desc';
    const fieldConfig = activeCollection.value.fields.find(f => f.key === fieldKey);
    const isNum = fieldConfig?.type === 'number';

    result.sort((a, b) => {
      let valA = a.data[fieldKey];
      let valB = b.data[fieldKey];

      if (valA === undefined || valA === null) return isDesc ? 1 : -1;
      if (valB === undefined || valB === null) return isDesc ? -1 : 1;

      if (isNum) {
        return isDesc ? Number(valB) - Number(valA) : Number(valA) - Number(valB);
      } else {
        return isDesc 
          ? String(valB).localeCompare(String(valA))
          : String(valA).localeCompare(String(valB));
      }
    });
  } else {
    // Default sort by createdAt descending
    result.sort((a, b) => b.createdAt - a.createdAt);
  }

  return result;
});

// Pagination computed properties
const paginatedRecords = computed(() => {
  const startIndex = (currentPage.value - 1) * pageSize.value;
  return processedRecords.value.slice(startIndex, startIndex + pageSize.value);
});

const totalPages = computed(() => {
  return Math.ceil(processedRecords.value.length / pageSize.value);
});

// Watch any filter, search, or selection changes to reset page to 1
watch(
  [selectedCollectionId, searchQuery, currentFilters, logicalOperator, sortByField, sortOrder],
  () => {
    currentPage.value = 1;
  },
  { deep: true }
);

// Saved View selection
const selectView = (viewId: string) => {
  activeViewId.value = viewId;
  if (viewId === 'all') {
    currentFilters.value = [];
    sortByField.value = '';
    sortOrder.value = 'desc';
  } else {
    const view = savedViews.value.find(v => v.id === viewId);
    if (view) {
      currentFilters.value = [...view.filters];
      logicalOperator.value = view.logicalOperator;
      sortByField.value = view.sortBy || '';
      sortOrder.value = view.sortOrder || 'desc';
    }
  }
};

// Filter panel controls
const addFilterRow = () => {
  if (!activeCollection.value || activeCollection.value.fields.length === 0) return;
  const firstField = activeCollection.value.fields[0];
  currentFilters.value.push({
    fieldKey: firstField.key,
    operator: firstField.type === 'number' ? 'gte' : 'contains',
    value: ''
  });
};

const removeFilterRow = (index: number) => {
  currentFilters.value.splice(index, 1);
};

const handleFilterFieldChange = (index: number) => {
  const filter = currentFilters.value[index];
  const field = activeCollection.value?.fields.find(f => f.key === filter.fieldKey);
  if (field) {
    // set safe default operator based on field type
    if (field.type === 'number') filter.operator = 'gte';
    else if (field.type === 'tags') filter.operator = 'in_tags';
    else if (field.type === 'boolean') filter.operator = 'eq';
    else filter.operator = 'contains';
    filter.value = '';
  }
};

// CRUD modal operations
const openAddModal = () => {
  if (!activeCollection.value) return;
  editingRecordId.value = null;
  pendingNotificationTrigger.value = null;
  
  // Set up blank dynamic form data with default values
  const freshData: Record<string, any> = {};
  activeCollection.value.fields.forEach(f => {
    if (f.type === 'boolean') {
      freshData[f.key] = false;
    } else if (f.type === 'tags') {
      freshData[f.key] = [];
    } else if (f.type === 'number') {
      freshData[f.key] = undefined;
    } else if (f.type === 'date') {
      freshData[f.key] = new Date().toISOString().split('T')[0]; // today
    } else if (f.type === 'relation') {
      freshData[f.key] = f.isMultiple ? [] : '';
    } else {
      freshData[f.key] = '';
    }
  });

  recordFormData.value = freshData;
  tempTagInputs.value = {};
  showFormModal.value = true;
};

const openEditModal = (rec: RecordEntry) => {
  if (!activeCollection.value) return;
  editingRecordId.value = rec.id || null;
  pendingNotificationTrigger.value = null;
  // Clone data to form
  recordFormData.value = JSON.parse(JSON.stringify(rec.data));
  tempTagInputs.value = {};
  showFormModal.value = true;
};

const handleSaveRecord = async () => {
  if (!activeCollection.value) return;

  // Form Validation
  for (const f of activeCollection.value.fields) {
    if (f.required && (recordFormData.value[f.key] === undefined || recordFormData.value[f.key] === null || recordFormData.value[f.key] === '')) {
      alert(`Le champ "${f.name}" est obligatoire.`);
      return;
    }
  }

  const recordEntry: RecordEntry = {
    id: editingRecordId.value || `rec-${generateId()}`,
    collectionId: selectedCollectionId.value,
    data: recordFormData.value,
    createdAt: editingRecordId.value ? (records.value.find(r => r.id === editingRecordId.value)?.createdAt || Date.now()) : Date.now(),
    updatedAt: Date.now()
  };

  try {
    dbStatus.value = 'saving';
    const rawRecordEntry = JSON.parse(JSON.stringify(recordEntry));
    if (editingRecordId.value) {
      await db.records.put(rawRecordEntry);
    } else {
      await db.records.add(rawRecordEntry);
    }
    
    // If saved successfully and triggered via automated template notification, mark the template as generated
    if (pendingNotificationTrigger.value) {
      const { template, period } = pendingNotificationTrigger.value;
      await db.templates.update(template.id, { lastGeneratedPeriod: period });
      pendingNotificationTrigger.value = null;
      activeNotification.value = null;
      await loadTemplates();
    }

    dbStatus.value = 'ready';
    showFormModal.value = false;
    await loadRecords();
    emit('data-updated');
  } catch (err) {
    dbStatus.value = 'error';
    console.error('Erreur lors de la sauvegarde du record:', err);
  }
};

const handleDeleteRecord = async (id: string) => {
  if (!confirm('Es-tu sûr de vouloir supprimer cet enregistrement ?')) return;
  try {
    const rec = await db.records.get(id);
    if (rec) {
      rec.deletedAt = Date.now();
      rec.updatedAt = Date.now();
      await db.records.put(rec);
    }
    await loadRecords();
    emit('data-updated');
  } catch (err) {
    console.error('Erreur lors de la suppression du record:', err);
  }
};

// Tag helper functions
const addTag = (fieldKey: string) => {
  const rawTag = tempTagInputs.value[fieldKey]?.trim();
  if (!rawTag) return;
  
  if (!recordFormData.value[fieldKey]) {
    recordFormData.value[fieldKey] = [];
  }
  
  const tagsList = recordFormData.value[fieldKey] as string[];
  if (!tagsList.includes(rawTag)) {
    tagsList.push(rawTag);
  }
  
  tempTagInputs.value[fieldKey] = '';
};

const removeTag = (fieldKey: string, tagIndex: number) => {
  const tagsList = recordFormData.value[fieldKey] as string[];
  tagsList.splice(tagIndex, 1);
};

// Saved View saving / updating
const saveCurrentView = async (isUpdate = false) => {
  if (!newViewName.value.trim() || !activeCollection.value) return;

  const viewId = isUpdate ? activeViewId.value : `view-${generateId()}`;

  const newView: SavedView = {
    id: viewId,
    collectionId: selectedCollectionId.value,
    name: newViewName.value.trim(),
    filters: JSON.parse(JSON.stringify(currentFilters.value)),
    logicalOperator: logicalOperator.value,
    sortBy: sortByField.value,
    sortOrder: sortOrder.value,
    chartType: chartType.value,
    createdAt: isUpdate 
      ? (savedViews.value.find(v => v.id === activeViewId.value)?.createdAt || Date.now())
      : Date.now(),
    updatedAt: Date.now(),
    chartConfig: chartType.value !== 'none' ? {
      xAxisKey: xAxisKey.value,
      yAxisKey: yAxisKey.value || 'count',
      aggregate: aggregateType.value,
      tooltipFields: tooltipFields.value
    } : undefined
  };

  try {
    const rawNewView = JSON.parse(JSON.stringify(newView));
    if (isUpdate) {
      await db.views.put(rawNewView);
    } else {
      await db.views.add(rawNewView);
    }
    showSaveViewModal.value = false;
    newViewName.value = '';
    chartType.value = 'none';
    await loadSavedViews();
    activeViewId.value = newView.id;
  } catch (err) {
    console.error('Erreur lors de la sauvegarde de la vue:', err);
  }
};

const deleteSavedView = async (viewId: string) => {
  if (!confirm('Es-tu sûr de vouloir supprimer cette vue filtrée ?')) return;
  try {
    const view = await db.views.get(viewId);
    if (view) {
      view.deletedAt = Date.now();
      view.updatedAt = Date.now();
      await db.views.put(view);
    }
    activeViewId.value = 'all';
    await loadSavedViews();
  } catch (err) {
    console.error('Erreur lors de la suppression de la vue:', err);
  }
};

const getFieldTypeOfFilter = (fieldKey: string) => {
  return activeCollection.value?.fields.find(f => f.key === fieldKey)?.type;
};

// Value Formatter for nice layout
const formatValue = (val: any, fieldConfig?: any) => {
  if (val === undefined || val === null || val === '') return '';
  if (fieldConfig?.type === 'boolean') {
    return val ? '✅ Oui' : '❌ Non';
  }
  if (fieldConfig?.type === 'tags') {
    return Array.isArray(val) ? val.join(', ') : String(val);
  }
  if (fieldConfig?.type === 'date') {
    return formatToFrenchDate(String(val));
  }
  if (fieldConfig?.type === 'number' && fieldConfig?.unit) {
    return `${val} ${fieldConfig.unit}`;
  }
  if (fieldConfig?.type === 'relation' && fieldConfig?.relatedCollectionId) {
    const targetColId = fieldConfig.relatedCollectionId;
    const targetCol = collections.value.find(c => c.id === targetColId);
    const relatedRecs = relatedRecordsCache.value[targetColId] || [];
    
    if (targetCol && relatedRecs.length > 0) {
      const primaryKey = targetCol.primaryFieldKey;
      
      const getRecordName = (id: string) => {
        const found = relatedRecs.find(r => r.id === id);
        return found ? String(found.data[primaryKey] || id) : id;
      };
      
      if (Array.isArray(val)) {
        const names = val.map(getRecordName);
        names.sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
        return names.join(', ');
      } else {
        return getRecordName(String(val));
      }
    }
  }
  return String(val);
};

const isFieldDisabled = (f: any) => {
  if (!f.isCalculated) return false;
  if (!f.formula) return true;
  // If the formula contains a self-reference to the field's key (e.g. "{conso}"), it is a bidirectional formula. Do not disable!
  return !f.formula.includes('{' + f.key + '}');
};

// --- Record Templates & Automation UI Helpers ---

const loadTemplates = async () => {
  if (!selectedCollectionId.value) return;
  try {
    const rawTemps = await db.templates.where('collectionId').equals(selectedCollectionId.value).toArray();
    templates.value = rawTemps.filter(t => !t.deletedAt);
    checkAutomatedTemplates();
  } catch (err) {
    console.error('Erreur lors du chargement des modèles:', err);
  }
};

const checkAutomatedTemplates = () => {
  activeNotification.value = null;
  if (!activeCollection.value || templates.value.length === 0) return;

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth(); // 0-11
  
  for (const t of templates.value) {
    if (!t.isAutomated) continue;

    let targetDate: Date | null = null;
    let period = '';

    if (t.recurrence === 'monthly' && t.recurrenceDay) {
      // Safe day selection (cap at 28 to avoid month overflow check issues)
      const day = Math.min(t.recurrenceDay, 28);
      targetDate = new Date(currentYear, currentMonth, day);
      const mm = String(currentMonth + 1).padStart(2, '0');
      period = `${currentYear}-${mm}`;
    } else if (t.recurrence === 'yearly' && t.recurrenceDay && t.recurrenceMonth) {
      targetDate = new Date(currentYear, t.recurrenceMonth - 1, t.recurrenceDay);
      period = `${currentYear}`;
    }

    if (targetDate && period) {
      const diffTime = Math.abs(today.getTime() - targetDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 10) {
        if (t.lastGeneratedPeriod !== period) {
          const monthNames = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
          const periodName = t.recurrence === 'monthly' 
            ? `${monthNames[currentMonth]} ${currentYear}`
            : `${currentYear}`;
            
          activeNotification.value = {
            template: t,
            period,
            message: `Rappel automatique : Ton modèle de ligne "${t.name}" est prêt à être inséré pour ${periodName}.`
          };
          break; // Show one alert at a time
        }
      }
    }
  }
};

const triggerAutomatedTemplate = (notif: TemplateNotification) => {
  const freshData = JSON.parse(JSON.stringify(notif.template.data));
  activeCollection.value?.fields.forEach(f => {
    if (f.type === 'date') {
      freshData[f.key] = new Date().toISOString().split('T')[0];
    } else if (freshData[f.key] === undefined) {
      if (f.type === 'boolean') freshData[f.key] = false;
      else if (f.type === 'tags') freshData[f.key] = [];
      else if (f.type === 'number') freshData[f.key] = undefined;
      else if (f.type === 'relation') freshData[f.key] = f.isMultiple ? [] : '';
      else freshData[f.key] = '';
    }
  });
  
  recordFormData.value = freshData;
  tempTagInputs.value = {};
  pendingNotificationTrigger.value = notif;
  editingRecordId.value = null;
  showFormModal.value = true;
};

const dismissNotification = async (notif: TemplateNotification) => {
  try {
    await db.templates.update(notif.template.id, { lastGeneratedPeriod: notif.period });
    activeNotification.value = null;
  } catch (err) {
    console.error('Erreur lors du masquage du rappel:', err);
  }
};

const applyTemplate = (event: Event) => {
  const target = event.target as HTMLSelectElement;
  const templateId = target.value;
  if (!templateId) return;
  const t = templates.value.find(temp => temp.id === templateId);
  if (t) {
    const clonedData = JSON.parse(JSON.stringify(t.data));
    activeCollection.value?.fields.forEach(f => {
      if (clonedData[f.key] === undefined) {
        if (f.type === 'boolean') clonedData[f.key] = false;
        else if (f.type === 'tags') clonedData[f.key] = [];
        else if (f.type === 'number') clonedData[f.key] = undefined;
        else if (f.type === 'date') clonedData[f.key] = new Date().toISOString().split('T')[0];
        else if (f.type === 'relation') clonedData[f.key] = f.isMultiple ? [] : '';
        else clonedData[f.key] = '';
      }
    });
    recordFormData.value = clonedData;
  }
  target.value = ''; // reset select
};

const openSaveTemplateModal = () => {
  templateFormName.value = '';
  templateFormIsAutomated.value = false;
  templateFormRecurrence.value = 'monthly';
  templateFormRecurrenceDay.value = new Date().getDate();
  templateFormRecurrenceMonth.value = new Date().getMonth() + 1;
  showSaveTemplateModal.value = true;
};

const handleSaveTemplate = async () => {
  if (!templateFormName.value.trim() || !activeCollection.value) return;
  
  const template: RecordTemplate = {
    id: `temp-${generateId()}`,
    collectionId: activeCollection.value.id,
    name: templateFormName.value.trim(),
    data: JSON.parse(JSON.stringify(recordFormData.value)),
    isAutomated: templateFormIsAutomated.value,
    recurrence: templateFormIsAutomated.value ? templateFormRecurrence.value : undefined,
    recurrenceDay: templateFormIsAutomated.value ? templateFormRecurrenceDay.value : undefined,
    recurrenceMonth: (templateFormIsAutomated.value && templateFormRecurrence.value === 'yearly') ? templateFormRecurrenceMonth.value : undefined,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  try {
    await db.templates.add(template);
    showSaveTemplateModal.value = false;
    await loadTemplates();
  } catch (err) {
    console.error('Erreur lors de la sauvegarde du modèle:', err);
  }
};

const deleteTemplate = async (id: string) => {
  if (confirm('Es-tu sûr de vouloir supprimer ce modèle ?')) {
    try {
      const temp = await db.templates.get(id);
      if (temp) {
        temp.deletedAt = Date.now();
        temp.updatedAt = Date.now();
        await db.templates.put(temp);
      }
      await loadTemplates();
    } catch (err) {
      console.error('Erreur lors de la suppression du modèle:', err);
    }
  }
};

const openAddModalFor = async (colId: string) => {
  selectedCollectionId.value = colId;
  // If collections are already loaded from Dexie, trigger modal immediately
  if (collections.value.length > 0) {
    openAddModal();
  } else {
    // Otherwise queue it up for loadInitialData
    shouldOpenAddModalOnLoad.value = true;
  }
};

// Expose states and methods to parent components (like App.vue for Express Entry)
defineExpose({
  selectedCollectionId,
  openAddModal,
  openAddModalFor
});
</script>

<template>
  <div class="data-explorer fade-in">
    <!-- Quick sidebar / Header for collection selection -->
    <div class="explorer-header">
      <div class="collection-select-wrapper">
        <label for="collectionSelector">Fiche active :</label>
        <select id="collectionSelector" v-model="selectedCollectionId" class="collection-picker">
          <option v-for="col in collections" :key="col.id" :value="col.id">
            📁 {{ col.name }}
          </option>
        </select>
      </div>

      <div class="header-actions">
        <button v-if="activeCollection" @click="emit('open-charts', activeCollection.id)" class="btn btn-secondary">
          <LayoutDashboard class="btn-icon" /> Voir les graphiques
        </button>
        <button v-if="activeCollection" @click="openAddModal" class="btn btn-primary">
          <Plus class="btn-icon" /> Ajouter une ligne
        </button>
      </div>
    </div>

    <!-- If no collections -->
    <div v-if="collections.length === 0" class="empty-state-card card glass text-center">
      <AlertCircle class="empty-icon" />
      <h3>Aucun modèle de données disponible</h3>
      <p>Vas dans l'onglet "Modèles" pour créer ta première collection (ex: Repas, Séances de sport, etc.).</p>
    </div>

    <div v-else-if="activeCollection" class="explorer-content">
      <!-- Automated Template Reminder Banner -->
      <Transition name="fade">
        <div v-if="activeNotification" class="automated-reminder-banner card glass">
          <div class="reminder-content">
            <Bell class="reminder-icon animate-bounce" />
            <div class="reminder-text">
              <h4>{{ activeNotification.message }}</h4>
              <p>Le modèle est configuré avec tes valeurs habituelles. Tu pourras les ajuster avant d'enregistrer.</p>
            </div>
          </div>
          <div class="reminder-actions">
            <button @click="triggerAutomatedTemplate(activeNotification)" class="btn btn-primary btn-sm">
              <Sparkles class="btn-icon" /> Remplir & Ajouter
            </button>
            <button @click="dismissNotification(activeNotification)" class="btn btn-secondary btn-sm">
              Ignorer
            </button>
          </div>
        </div>
      </Transition>

      <!-- Views / Filters Navbar Tabs -->
      <div class="views-navbar">
        <button 
          @click="selectView('all')" 
          :class="['view-tab', activeViewId === 'all' ? 'active' : '']"
        >
          Toutes les données
        </button>
        
        <div v-for="view in savedViews" :key="view.id" class="saved-view-tab-wrapper">
          <button 
            @click="selectView(view.id)" 
            :class="['view-tab', activeViewId === view.id ? 'active' : '']"
          >
            🔍 {{ view.name }}
          </button>
          <button @click.stop="deleteSavedView(view.id)" class="btn-delete-view" title="Supprimer la vue">
            <X class="view-delete-icon" />
          </button>
        </div>

        <button 
          @click="showFiltersPanel = !showFiltersPanel" 
          :class="['btn btn-secondary btn-sm filter-toggle', showFiltersPanel || currentFilters.length > 0 ? 'active' : '']"
        >
          <SlidersHorizontal class="btn-icon" />
          Filtres avancés
          <span v-if="currentFilters.length > 0" class="badge-count">{{ currentFilters.length }}</span>
        </button>
      </div>

      <!-- Advanced Query Builder Panel -->
      <div v-show="showFiltersPanel" class="card glass filters-panel-card fade-in">
        <div class="filters-panel-header">
          <div class="panel-title">
            <Filter class="panel-icon" />
            <h3>Builder de requêtes dynamiques</h3>
          </div>
          <div class="logical-toggle">
            <span>Combiner par :</span>
            <label class="toggle-btn">
              <input type="radio" value="and" v-model="logicalOperator" />
              <span class="radio-label">ET (toutes)</span>
            </label>
            <label class="toggle-btn">
              <input type="radio" value="or" v-model="logicalOperator" />
              <span class="radio-label">OU (une seule)</span>
            </label>
          </div>
        </div>

        <!-- Filter Rows List -->
        <div class="filters-list">
          <div v-if="currentFilters.length === 0" class="empty-filters-text">
            Aucun filtre appliqué. Ajoute des conditions pour cibler précisément tes données.
          </div>
          
          <div v-for="(filter, index) in currentFilters" :key="index" class="filter-row">
            <!-- Select Field -->
            <select v-model="filter.fieldKey" @change="handleFilterFieldChange(index)" class="form-control btn-sm filter-input">
              <option v-for="f in activeCollection.fields" :key="f.id" :value="f.key">{{ f.name }}</option>
            </select>

            <!-- Select Operator -->
            <select v-model="filter.operator" class="form-control btn-sm filter-input">
              <!-- Operators for dynamic types -->
              <option value="eq">égal à</option>
              <option value="neq">différent de</option>
              <option value="gt">plus grand que</option>
              <option value="gte">supérieur ou égal</option>
              <option value="lt">plus petit que</option>
              <option value="lte">inférieur ou égal</option>
              <option value="contains">contient le texte</option>
              <option value="not_contains">ne contient pas</option>
              <option value="in_tags">contient le tag</option>
              <option value="is_empty">est vide</option>
              <option value="is_not_empty">n'est pas vide</option>
            </select>

            <!-- Value Input (conditional input box matching target filter config) -->
            <template v-if="filter.operator !== 'is_empty' && filter.operator !== 'is_not_empty'">
              <!-- If it's a date field, show dropdown of relative dates + custom option -->
              <div v-if="getFieldTypeOfFilter(filter.fieldKey) === 'date'" class="filter-date-wrapper">
                <select 
                  :value="['CURRENT_MONTH_START', 'CURRENT_YEAR_START', 'LAST_30_DAYS', 'LAST_7_DAYS', 'TODAY'].includes(filter.value) ? filter.value : 'custom'"
                  @change="e => { 
                    const val = (e.target as HTMLSelectElement).value; 
                    filter.value = val === 'custom' ? '' : val; 
                  }" 
                  class="form-control btn-sm filter-input"
                >
                  <option value="CURRENT_MONTH_START">📅 Début du mois en cours</option>
                  <option value="CURRENT_YEAR_START">📅 Début de l'année en cours</option>
                  <option value="LAST_30_DAYS">📅 30 derniers jours</option>
                  <option value="LAST_7_DAYS">📅 7 derniers jours</option>
                  <option value="TODAY">📅 Aujourd'hui</option>
                  <option value="custom">✍️ Saisir une date spécifique...</option>
                </select>
                <!-- If Custom is selected, show standard date picker -->
                <input 
                  v-if="!['CURRENT_MONTH_START', 'CURRENT_YEAR_START', 'LAST_30_DAYS', 'LAST_7_DAYS', 'TODAY'].includes(filter.value)"
                  v-model="filter.value" 
                  type="date" 
                  class="form-control btn-sm filter-input mt-1" 
                />
              </div>

              <!-- If regular field, show text input -->
              <input 
                v-else
                v-model="filter.value" 
                type="text" 
                class="form-control btn-sm filter-input" 
                placeholder="Valeur recherchée..." 
              />
            </template>

            <!-- Remove Filter -->
            <button @click="removeFilterRow(index)" class="btn-remove-row" title="Supprimer la condition">
              <X class="btn-row-x" />
            </button>
          </div>
        </div>

        <!-- Filter Actions -->
        <div class="filters-actions">
          <button @click="addFilterRow" class="btn btn-secondary btn-sm">
            <Plus class="btn-icon" /> Ajouter une condition
          </button>
          
          <div class="save-actions">
            <button 
              v-if="currentFilters.length > 0 || activeViewId !== 'all'" 
              @click="openSaveViewModal" 
              class="btn btn-accent btn-sm"
            >
              <Save class="btn-icon" />
              {{ activeViewId !== 'all' ? 'Modifier cette vue / graphique' : 'Sauvegarder cette vue / graphique' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Main Data Table & Toolbar -->
      <div class="card glass data-grid-card">
        <div class="grid-toolbar">
          <!-- Search Bar -->
          <div class="search-input-wrapper">
            <Search class="search-icon" />
            <input v-model="searchQuery" type="text" class="form-control toolbar-search" placeholder="Rechercher partout dans ce tableau..." />
          </div>

          <!-- Sort Column config -->
          <div class="sort-config">
            <label>Trier par :</label>
            <select v-model="sortByField" class="form-control btn-sm toolbar-select">
              <option value="">(Date de création)</option>
              <option v-for="f in activeCollection.fields" :key="f.id" :value="f.key">{{ f.name }}</option>
            </select>
            <button @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'" class="btn btn-secondary btn-sm sort-order-toggle">
              {{ sortOrder === 'asc' ? '⬆️ Asc' : '⬇️ Desc' }}
            </button>
          </div>
        </div>

        <!-- Scrollable Table -->
        <div class="table-container">
          <table class="metrics-table">
            <thead>
              <tr>
                <th v-for="f in activeCollection.fields" :key="f.id" :class="['col-' + f.type, f.key]">{{ f.name }}</th>
                <th class="text-right actions-column">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="processedRecords.length === 0">
                <td :colspan="activeCollection.fields.length + 1" class="empty-table-cell">
                  Aucun enregistrement trouvé correspondant à tes filtres de recherche.
                </td>
              </tr>
              <tr v-else v-for="rec in paginatedRecords" :key="rec.id">
                <td v-for="f in activeCollection.fields" :key="f.id" :class="['cell-' + f.type, f.key]">
                  <!-- Handle Tags styling nicely -->
                  <div v-if="f.type === 'tags' && Array.isArray(rec.data[f.key])" class="row-tags">
                    <span v-for="tag in rec.data[f.key]" :key="tag" class="tag-chip">
                      {{ tag }}
                    </span>
                  </div>
                  <!-- Handle Checkbox/Boolean beautifully -->
                  <span v-else-if="f.type === 'boolean'">
                    <span v-if="rec.data[f.key]" class="boolean-badge true">Oui</span>
                    <span v-else class="boolean-badge false">Non</span>
                  </span>
                  <!-- Regular text / number values -->
                  <span v-else class="cell-text">
                    {{ formatValue(rec.data[f.key], f) }}
                  </span>
                </td>
                <td class="text-right actions-column">
                  <div class="cell-actions">
                    <button @click="openEditModal(rec)" class="btn-action-round edit" title="Modifier">
                      <Edit2 class="action-icon" />
                    </button>
                    <button @click="handleDeleteRecord(rec.id!)" class="btn-action-round delete" title="Supprimer">
                      <Trash2 class="action-icon" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination Controls -->
        <div v-if="totalPages > 1" class="pagination-container">
          <button 
            @click="currentPage--" 
            :disabled="currentPage === 1" 
            class="btn btn-secondary btn-sm"
          >
            ◀ Précédent
          </button>
          
          <span class="pagination-info">
            Page {{ currentPage }} sur {{ totalPages }}
            <span class="total-count">({{ processedRecords.length }} lignes)</span>
          </span>
          
          <button 
            @click="currentPage++" 
            :disabled="currentPage === totalPages" 
            class="btn btn-secondary btn-sm"
          >
            Suivant ▶
          </button>
        </div>
      </div>
    </div>

    <!-- Sliding Modal / Dialog for Adding / Editing Record -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showFormModal" class="modal-overlay" @click.self="showFormModal = false">
          <div class="modal-card card glass fade-in">
            <div class="modal-header">
              <h2>{{ editingRecordId ? 'Modifier l\'enregistrement' : 'Ajouter une ligne' }}</h2>
              <button @click="showFormModal = false" class="btn-close-modal"><X /></button>
            </div>

            <div class="modal-body">
              <!-- Model / Template Selection (Only for Add mode) -->
              <div v-if="!editingRecordId" class="form-group template-apply-group">
                <label>Modèle de saisie (pré-remplissage)</label>
                <div class="template-selector-row">
                  <select @change="applyTemplate" class="form-control">
                    <option value="">-- Sélectionner un modèle --</option>
                    <option v-for="t in templates" :key="t.id" :value="t.id">
                      {{ t.name }} {{ t.isAutomated ? '⏰' : '' }}
                    </option>
                  </select>
                  <button type="button" @click="showManageTemplatesModal = true" class="btn btn-secondary">
                    Gérer
                  </button>
                </div>
              </div>

              <form @submit.prevent="handleSaveRecord">
                <div v-for="f in activeCollection?.fields" :key="f.id" class="form-group">
                  <label :for="'form-' + f.key">
                    {{ f.name }} <span v-if="f.required" class="required-star">*</span>
                  </label>

                  <!-- Input Text -->
                  <input 
                    v-if="f.type === 'text'" 
                    :id="'form-' + f.key" 
                    v-model="recordFormData[f.key]" 
                    type="text" 
                    class="form-control" 
                    :required="f.required" 
                    :disabled="isFieldDisabled(f)"
                    :placeholder="isFieldDisabled(f) ? '(Calculé automatiquement)' : ''"
                  />

                  <!-- Input Number -->
                  <div v-else-if="f.type === 'number'" class="input-with-unit-wrapper">
                    <input 
                      :id="'form-' + f.key" 
                      v-model.number="recordFormData[f.key]" 
                      type="number" 
                      step="any" 
                      class="form-control" 
                      :required="f.required" 
                      :disabled="isFieldDisabled(f)"
                      :placeholder="isFieldDisabled(f) ? '(Calculé automatiquement)' : ''"
                    />
                    <span v-if="f.unit" class="field-unit-badge">{{ f.unit }}</span>
                  </div>

                  <!-- Input Date -->
                  <input 
                    v-else-if="f.type === 'date'" 
                    :id="'form-' + f.key" 
                    v-model="recordFormData[f.key]" 
                    type="date" 
                    class="form-control" 
                    :required="f.required" 
                    :disabled="isFieldDisabled(f)"
                  />

                  <!-- Input Boolean -->
                  <div v-else-if="f.type === 'boolean'" class="boolean-toggle-wrapper">
                    <label class="switch-toggle">
                      <input type="checkbox" v-model="recordFormData[f.key]" />
                      <span class="toggle-slider"></span>
                    </label>
                    <span class="toggle-status-label">{{ recordFormData[f.key] ? 'Oui' : 'Non' }}</span>
                  </div>

                  <!-- Input Select / Option -->
                  <select 
                    v-else-if="f.type === 'select'" 
                    :id="'form-' + f.key" 
                    v-model="recordFormData[f.key]" 
                    class="form-control" 
                    :required="f.required"
                    :disabled="isFieldDisabled(f)"
                  >
                    <option value="" disabled>Sélectionne une option...</option>
                    <option v-for="opt in f.options" :key="opt" :value="opt">{{ opt }}</option>
                  </select>

                  <!-- Input Tags / Custom multi chip entry -->
                  <div v-else-if="f.type === 'tags'" class="tags-field-wrapper">
                    <div class="tags-container">
                      <span v-for="(tag, tagIdx) in recordFormData[f.key]" :key="tagIdx" class="form-tag-chip">
                        {{ tag }}
                        <button type="button" @click="removeTag(f.key, Number(tagIdx))" class="btn-remove-tag"><X class="tag-x-icon" /></button>
                      </span>
                      <input 
                        v-model="tempTagInputs[f.key]" 
                        @keydown.enter.prevent="addTag(f.key)"
                        @blur="addTag(f.key)"
                        type="text" 
                        class="tag-input-box" 
                        placeholder="Ajouter un tag..." 
                      />
                    </div>
                    <p class="field-tip">Appuie sur 'Entrée' ou clique en dehors pour ajouter un mot-clé.</p>
                  </div>

                  <!-- Input Relation (Single or Multi-select) -->
                  <div v-else-if="f.type === 'relation' && f.relatedCollectionId" class="relation-field-wrapper">
                    <!-- Single Relation: Select dropdown -->
                    <select
                      v-if="!f.isMultiple"
                      :id="'form-' + f.key"
                      v-model="recordFormData[f.key]"
                      class="form-control"
                      :required="f.required"
                      :disabled="isFieldDisabled(f)"
                    >
                      <option value="">-- Aucun(e) --</option>
                      <option 
                        v-for="recOpt in (relatedRecordsCache[f.relatedCollectionId] || [])" 
                        :key="recOpt.id" 
                        :value="recOpt.id"
                      >
                        {{ recOpt.data[collections.find(c => c.id === f.relatedCollectionId)?.primaryFieldKey || ''] || recOpt.id }}
                      </option>
                    </select>

                    <!-- Multiple Relation: Checkbox Grid -->
                    <div v-else class="relation-checkbox-grid">
                      <div v-if="!(relatedRecordsCache[f.relatedCollectionId] || []).length" class="empty-relation-options">
                        Aucun enregistrement disponible dans la collection cible.
                      </div>
                      <label 
                        v-else 
                        v-for="recOpt in (relatedRecordsCache[f.relatedCollectionId] || [])" 
                        :key="recOpt.id" 
                        class="relation-checkbox-item"
                        :class="{ 'checked': Array.isArray(recordFormData[f.key]) && recordFormData[f.key].includes(recOpt.id) }"
                      >
                        <input 
                          type="checkbox" 
                          :checked="Array.isArray(recordFormData[f.key]) && recordFormData[f.key].includes(recOpt.id)"
                          @change="e => {
                            if (!Array.isArray(recordFormData[f.key])) {
                              recordFormData[f.key] = [];
                            }
                            const checked = (e.target as HTMLInputElement).checked;
                            if (checked) {
                              if (!recordFormData[f.key].includes(recOpt.id)) {
                                recordFormData[f.key].push(recOpt.id);
                              }
                            } else {
                              recordFormData[f.key] = recordFormData[f.key].filter((id: string) => id !== recOpt.id);
                            }
                          }"
                        />
                        <span class="checkbox-label">
                          {{ recOpt.data[collections.find(c => c.id === f.relatedCollectionId)?.primaryFieldKey || ''] || recOpt.id }}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>

                <div class="modal-footer">
                  <button v-if="!editingRecordId" type="button" @click="openSaveTemplateModal" class="btn btn-accent" title="Enregistrer ces valeurs en tant que modèle réutilisable">
                    <Sparkles class="btn-icon" /> Créer un modèle
                  </button>
                  <button type="button" @click="showFormModal = false" class="btn btn-secondary">Annuler</button>
                  <button type="submit" class="btn btn-primary">
                    <Check class="btn-icon" /> {{ editingRecordId ? 'Modifier' : 'Valider' }}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Save View and Chart Modal Dialog -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showSaveViewModal" class="modal-overlay" @click.self="showSaveViewModal = false">
          <div class="modal-card card glass fade-in">
            <div class="modal-header">
              <h2>Sauvegarder la Vue</h2>
              <button @click="showSaveViewModal = false" class="btn-close-modal"><X /></button>
            </div>

            <div class="modal-body">
              <div class="form-group">
                <label for="viewName">Nom de la vue filtrée</label>
                <input id="viewName" v-model="newViewName" type="text" class="form-control" placeholder="Nom de la vue filtrée" />
              </div>

              <div class="form-group">
                <label for="chartSelector">Associer un graphique statistique</label>
                <select id="chartSelector" v-model="chartType" class="form-control">
                  <option value="none">Aucun graphique (tableau uniquement)</option>
                  <option value="bar">Graphique en barres</option>
                  <option value="line">Graphique en lignes (évolution)</option>
                  <option value="pie">Diagramme circulaire (répartition)</option>
                </select>
              </div>

              <!-- Chart axis configurations -->
              <div v-if="chartType !== 'none' && activeCollection" class="chart-config-subgroup">
                <div class="form-group">
                  <label for="xAxis">Axe X (Donnée d'analyse / Étiquette)</label>
                  <select id="xAxis" v-model="xAxisKey" class="form-control">
                    <option v-for="f in activeCollection.fields" :key="f.id" :value="f.key">
                      {{ f.name }} ({{ f.type }})
                    </option>
                  </select>
                </div>

                <div class="form-group">
                  <label for="yAxis">Axe Y (Donnée numérique à mesurer)</label>
                  <select id="yAxis" v-model="yAxisKey" class="form-control">
                    <option value="count">Nombre de lignes (Count)</option>
                    <option v-for="f in activeCollection.fields.filter(f => f.type === 'number')" :key="f.id" :value="f.key">
                      {{ f.name }} ({{ f.type }})
                    </option>
                  </select>
                </div>

                <div class="form-group" v-if="yAxisKey !== 'count'">
                  <label for="aggregate">Calcul d'agrégation</label>
                  <select id="aggregate" v-model="aggregateType" class="form-control">
                    <option value="sum">Somme des valeurs</option>
                    <option value="avg">Moyenne</option>
                    <option value="monthly_avg">Somme Moyenne Mensuelle</option>
                    <option value="balance">Solde financier net (Entrées - Sorties)</option>
                  </select>
                </div>

                <!-- Custom hover tooltip fields selection -->
                <div class="form-group" v-if="chartType !== 'pie'">
                  <label>Afficher d'autres champs au survol :</label>
                  <div class="tooltip-fields-checklist">
                    <label 
                      v-for="f in activeCollection.fields.filter(field => field.key !== xAxisKey && field.key !== yAxisKey)" 
                      :key="f.id" 
                      class="checkbox-label"
                    >
                      <input 
                        type="checkbox" 
                        :value="f.key" 
                        v-model="tooltipFields" 
                      />
                      <span>{{ f.name }}</span>
                    </label>
                  </div>
                </div>
              </div>

              <div class="modal-footer">
                <button type="button" @click="showSaveViewModal = false" class="btn btn-secondary">Annuler</button>
                <template v-if="activeViewId !== 'all'">
                  <button @click="saveCurrentView(true)" class="btn btn-primary" :disabled="!newViewName.trim()">
                    <Check class="btn-icon" /> Mettre à jour
                  </button>
                  <button @click="saveCurrentView(false)" class="btn btn-secondary" :disabled="!newViewName.trim()">
                    Enregistrer sous...
                  </button>
                </template>
                <template v-else>
                  <button @click="saveCurrentView(false)" class="btn btn-primary" :disabled="!newViewName.trim()">
                    <Check class="btn-icon" /> Sauvegarder
                  </button>
                </template>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Save Template Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showSaveTemplateModal" class="modal-overlay" @click.self="showSaveTemplateModal = false">
          <div class="modal-card card glass fade-in modal-sm">
            <div class="modal-header">
              <h2>Créer un modèle de ligne</h2>
              <button @click="showSaveTemplateModal = false" class="btn-close-modal"><X /></button>
            </div>

            <div class="modal-body">
              <div class="form-group">
                <label for="templateName">Nom du modèle (ex: Loyer Mensuel, Plein carburant)</label>
                <input id="templateName" v-model="templateFormName" type="text" class="form-control" placeholder="Ex: Loyer Mensuel" />
              </div>

              <div class="form-group mb-3">
                <label class="checkbox-label">
                  <input type="checkbox" v-model="templateFormIsAutomated" />
                  <span>Activer un rappel automatique</span>
                </label>
                <p class="field-tip mt-1">L'application te proposera d'insérer cette ligne automatiquement selon la récurrence.</p>
              </div>

              <div v-if="templateFormIsAutomated" class="automation-setup-box card mt-2 p-3">
                <div class="form-group">
                  <label for="recurrenceType">Récurrence</label>
                  <select id="recurrenceType" v-model="templateFormRecurrence" class="form-control">
                    <option value="monthly">Tous les mois (Mensuel)</option>
                    <option value="yearly">Tous les ans (Annuel)</option>
                  </select>
                </div>

                <div class="form-group">
                  <label for="recurrenceDay">Jour du déclenchement</label>
                  <input id="recurrenceDay" type="number" min="1" max="31" v-model.number="templateFormRecurrenceDay" class="form-control" placeholder="Ex: 5" />
                  <p class="field-tip mt-1">L'alerte s'affichera à ce jour précis (+/- 10 jours de tolérance).</p>
                </div>

                <div v-if="templateFormRecurrence === 'yearly'" class="form-group">
                  <label for="recurrenceMonth">Mois du déclenchement</label>
                  <select id="recurrenceMonth" v-model.number="templateFormRecurrenceMonth" class="form-control">
                    <option :value="1">Janvier</option>
                    <option :value="2">Février</option>
                    <option :value="3">Mars</option>
                    <option :value="4">Avril</option>
                    <option :value="5">Mai</option>
                    <option :value="6">Juin</option>
                    <option :value="7">Juillet</option>
                    <option :value="8">Août</option>
                    <option :value="9">Septembre</option>
                    <option :value="10">Octobre</option>
                    <option :value="11">Novembre</option>
                    <option :value="12">Décembre</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="modal-footer">
              <button type="button" @click="showSaveTemplateModal = false" class="btn btn-secondary">Annuler</button>
              <button @click="handleSaveTemplate" class="btn btn-primary" :disabled="!templateFormName.trim()">
                <Check class="btn-icon" /> Enregistrer le modèle
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Manage Templates Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showManageTemplatesModal" class="modal-overlay" @click.self="showManageTemplatesModal = false">
          <div class="modal-card card glass fade-in">
            <div class="modal-header">
              <h2>Gérer les modèles de ligne</h2>
              <button @click="showManageTemplatesModal = false" class="btn-close-modal"><X /></button>
            </div>

            <div class="modal-body">
              <div v-if="templates.length === 0" class="empty-templates-list py-4 text-center">
                <p class="text-secondary">Aucun modèle créé pour cette collection.</p>
              </div>
              <div v-else class="templates-manage-list">
                <div v-for="t in templates" :key="t.id" class="template-manage-item card">
                  <div class="template-manage-info">
                    <strong>{{ t.name }}</strong>
                    <div class="template-manage-meta mt-1">
                      <span v-if="t.isAutomated" class="badge-auto">
                        ⏰ Rappel auto ({{ t.recurrence === 'monthly' ? 'Mensuel, le ' + t.recurrenceDay : 'Annuel, le ' + t.recurrenceDay + '/' + t.recurrenceMonth }})
                      </span>
                      <span v-else class="badge-manual">Manuel</span>
                    </div>
                  </div>
                  <button @click="deleteTemplate(t.id)" class="btn-delete-temp btn-action-round delete" title="Supprimer ce modèle">
                    <Trash2 class="action-icon" />
                  </button>
                </div>
              </div>
            </div>

            <div class="modal-footer">
              <button @click="showManageTemplatesModal = false" class="btn btn-secondary">Fermer</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style lang="scss" scoped>
.data-explorer {
  max-width: 1400px;
  margin: 0 auto;
}

.explorer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  gap: 1.5rem;
  
  @media (max-width: 768px) {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }
}

.header-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  
  @media (max-width: 576px) {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    gap: 0.5rem;
    
    .btn {
      width: 100%;
      justify-content: center;
    }
  }
}

.collection-select-wrapper {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  
  label {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  @media (max-width: 576px) {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    
    label {
      font-size: 0.9rem;
    }
  }
}

.collection-picker {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  padding: 0.75rem 1.5rem;
  border-radius: var(--radius-lg);
  font-size: 1.1rem;
  font-weight: 700;
  outline: none;
  cursor: pointer;
  transition: var(--transition);
  max-width: 100%;
  
  &:focus, &:hover {
    border-color: var(--color-primary);
    box-shadow: var(--shadow-glow);
  }
}

.empty-state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 5rem 2rem;
  text-align: center;
  
  .empty-icon {
    width: 64px;
    height: 64px;
    color: var(--text-muted);
    stroke-width: 1.5;
    margin-bottom: 1.5rem;
  }
  
  h3 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }
  
  p {
    color: var(--text-secondary);
    max-width: 450px;
    margin: 0 auto;
    line-height: 1.5;
  }
}

/* Views Navigation Bar */
.views-navbar {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.75rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
  align-items: center;
}

.view-tab {
  background: none;
  border: 1px solid transparent;
  color: var(--text-secondary);
  padding: 0.5rem 1rem;
  border-radius: var(--radius-md);
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: var(--transition);
  white-space: nowrap;
  
  &:hover {
    background-color: rgba(255, 255, 255, 0.03);
    color: var(--text-primary);
  }
  
  &.active {
    background-color: rgba(59, 130, 246, 0.1);
    color: var(--color-primary);
    border-color: rgba(59, 130, 246, 0.2);
  }
}

.saved-view-tab-wrapper {
  display: flex;
  align-items: center;
  background-color: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  transition: var(--transition);
  
  &:hover {
    border-color: rgba(255, 255, 255, 0.15);
  }
  
  .view-tab {
    border: none;
    border-radius: var(--radius-md) 0 0 var(--radius-md);
    padding-right: 0.5rem;
  }
  
  .btn-delete-view {
    background: none;
    border: none;
    padding: 0.5rem;
    cursor: pointer;
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    transition: var(--transition);
    
    &:hover {
      background-color: rgba(239, 68, 68, 0.1);
      color: var(--color-danger);
    }
  }
  
  .view-delete-icon {
    width: 14px;
    height: 14px;
  }
}

.filter-toggle {
  margin-left: auto;
  
  &.active {
    background-color: rgba(168, 85, 247, 0.15);
    color: var(--color-accent);
    border-color: rgba(168, 85, 247, 0.3);
  }
}

.badge-count {
  background-color: var(--color-accent);
  color: #ffffff;
  font-size: 0.75rem;
  padding: 0.1rem 0.4rem;
  border-radius: 50px;
  margin-left: 0.35rem;
}

/* Query Builder Panel Styling */
.filters-panel-card {
  margin-bottom: 1.5rem;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  border-color: rgba(168, 85, 247, 0.2);
}

.filters-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
  
  .panel-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    
    .panel-icon {
      color: var(--color-accent);
      width: 20px;
      height: 20px;
    }
    h3 {
      font-size: 1.1rem;
      font-weight: 700;
    }
  }
}

.logical-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
  
  .toggle-btn {
    cursor: pointer;
    input {
      display: none;
    }
    input:checked + .radio-label {
      background-color: var(--color-accent);
      color: #ffffff;
      border-color: var(--color-accent);
    }
  }
  
  .radio-label {
    padding: 0.3rem 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    font-weight: 600;
    display: inline-block;
    transition: var(--transition);
    user-select: none;
  }
}

.filters-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.empty-filters-text {
  font-size: 0.9rem;
  color: var(--text-muted);
  text-align: center;
  padding: 1.5rem;
  background-color: rgba(255, 255, 255, 0.01);
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-color);
}

.filter-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  
  @media (max-width: 576px) {
    flex-direction: column;
    align-items: stretch;
    background-color: rgba(255, 255, 255, 0.02);
    padding: 0.75rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
  }
}

.filter-input {
  flex: 1;
}

.btn-remove-row {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  transition: var(--transition);
  
  &:hover {
    background-color: rgba(239, 68, 68, 0.1);
    color: var(--color-danger);
  }
  
  .btn-row-x {
    width: 16px;
    height: 16px;
  }
  
  @media (max-width: 576px) {
    align-self: flex-end;
  }
}

.filters-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid var(--border-color);
  padding-top: 0.75rem;
  
  .save-actions {
    display: flex;
    gap: 0.5rem;
  }
}

/* Data Table Grid Toolbar */
.data-grid-card {
  padding: 1.25rem;
}

.grid-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.25rem;
  flex-wrap: wrap;

  @media (max-width: 576px) {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }
}

.search-input-wrapper {
  position: relative;
  flex: 1;
  max-width: 450px;

  @media (max-width: 576px) {
    max-width: 100%;
  }
  
  .search-icon {
    position: absolute;
    left: 0.9rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
    width: 18px;
    height: 18px;
    pointer-events: none;
  }
  
  .toolbar-search {
    padding-left: 2.5rem;
  }
}

.sort-config {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  
  label {
    font-size: 0.85rem;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  
  .toolbar-select {
    width: 180px;

    @media (max-width: 576px) {
      flex: 1;
      width: auto;
      min-width: 0;
    }
  }
  
  .sort-order-toggle {
    white-space: nowrap;
  }

  @media (max-width: 576px) {
    width: 100%;
  }
}

/* Responsive Table with Sticky Header, Zebra-striping and vertical scroll */
.table-container {
  overflow-x: auto;
  overflow-y: auto;
  max-height: 60vh; /* Limits table height to keep search bar & pagination visible */
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  background-color: rgba(15, 23, 42, 0.3);
  -webkit-overflow-scrolling: touch;

  /* Custom, subtle, elegant scrollbar styling */
  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--border-color);
    border-radius: 4px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background: var(--text-muted);
  }
}

.metrics-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 0.9rem;
  
  th {
    position: sticky;
    top: 0;
    z-index: 10;
    background-color: var(--bg-tertiary); /* solid background color for sticky effect */
    color: var(--text-secondary);
    font-weight: 700;
    padding: 0.9rem 1.25rem;
    border-bottom: 2px solid var(--border-color); /* slightly bolder border for sticky boundary */
    white-space: nowrap;
  }
  
  td {
    padding: 0.9rem 1.25rem;
    border-bottom: 1px solid var(--border-color);
    vertical-align: middle;
    color: var(--text-primary);
    white-space: nowrap; /* prevents squishing of numeric and short fields */
  }
  
  tr:last-child td {
    border-bottom: none;
  }
  
  /* Zebra striping for readability */
  tr:nth-child(even) {
    background-color: rgba(255, 255, 255, 0.015);
  }
  tr:nth-child(odd) {
    background-color: transparent;
  }
  
  tr:hover {
    background-color: rgba(255, 255, 255, 0.04) !important; /* highlight row on hover, overriding zebra colors */
  }

  /* Specific column properties by field type */
  td.cell-text {
    white-space: normal; /* allow wrapping for comments and long text */
    min-width: 220px;    /* protect from being squeezed excessively */
    max-width: 400px;    /* prevent from taking too much horizontal space */
    line-height: 1.4;
  }

  td.cell-tags {
    min-width: 150px;
  }
}

.empty-table-cell {
  padding: 3rem !important;
  text-align: center;
  color: var(--text-muted);
  font-style: italic;
}

/* Custom table row inputs styling */
.row-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.tag-chip {
  background-color: rgba(6, 182, 212, 0.1);
  color: var(--color-info);
  border: 1px solid rgba(6, 182, 212, 0.2);
  padding: 0.15rem 0.5rem;
  border-radius: 50px;
  font-size: 0.75rem;
  font-weight: 600;
}

.boolean-badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 700;
  
  &.true {
    background-color: rgba(16, 185, 129, 0.15);
    color: var(--color-success);
    border: 1px solid rgba(16, 185, 129, 0.25);
  }
  
  &.false {
    background-color: rgba(239, 68, 68, 0.1);
    color: var(--color-danger);
    border: 1px solid rgba(239, 68, 68, 0.15);
  }
}

.cell-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.btn-action-round {
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  cursor: pointer;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition: var(--transition);
  
  &:hover {
    color: #ffffff;
  }
  
  &.edit:hover {
    background-color: rgba(59, 130, 246, 0.15);
    border-color: var(--color-primary);
  }
  
  &.delete:hover {
    background-color: rgba(239, 68, 68, 0.15);
    border-color: var(--color-danger);
    color: var(--color-danger);
  }
  
  .action-icon {
    width: 14px;
    height: 14px;
  }
}

.actions-column {
  width: 100px;
}

.text-right {
  text-align: right;
}

/* Modals & Sliding Panels Dialog overlays */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.modal-card {
  width: 100%;
  max-width: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-color: var(--border-hover);
  box-shadow: var(--shadow-lg), var(--shadow-glow);
  animation: fadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  
  &.custom-modal-sm {
    max-width: 480px;
  }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-color);
  
  h2 {
    font-size: 1.25rem;
    font-weight: 700;
  }
}

.btn-close-modal {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 0.35rem;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: var(--transition);
  
  &:hover {
    background-color: rgba(255, 255, 255, 0.05);
    color: var(--text-primary);
  }
}

.modal-body {
  padding: 1.5rem;
  overflow-y: auto;
  flex: 1;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  border-top: 1px solid var(--border-color);
  padding-top: 1.25rem;
  margin-top: 1.5rem;
  flex-wrap: wrap;
}

/* Dynamic Forms components styling */
.required-star {
  color: var(--color-danger);
}

.field-tip {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 0.25rem;
}

.boolean-toggle-wrapper {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.switch-toggle {
  position: relative;
  display: inline-block;
  width: 46px;
  height: 24px;
  cursor: pointer;
  
  input {
    opacity: 0;
    width: 0;
    height: 0;
  }
}

.toggle-slider {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 34px;
  transition: .3s;
  
  &:before {
    position: absolute;
    content: "";
    height: 16px;
    width: 16px;
    left: 3px;
    bottom: 3px;
    background-color: var(--text-secondary);
    border-radius: 50%;
    transition: .3s;
  }
}

.switch-toggle input:checked + .toggle-slider {
  background-color: rgba(59, 130, 246, 0.15);
  border-color: var(--color-primary);
  
  &:before {
    transform: translateX(22px);
    background-color: var(--color-primary);
  }
}

.toggle-status-label {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
}

/* Tags dynamic forms tagger component */
.tags-field-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.form-tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background-color: rgba(168, 85, 247, 0.15);
  color: var(--color-accent);
  border: 1px solid rgba(168, 85, 247, 0.25);
  padding: 0.15rem 0.5rem;
  border-radius: 50px;
  font-size: 0.8rem;
  font-weight: 600;
}

.btn-remove-tag {
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-accent);
  padding: 0.1rem;
  border-radius: 50%;
  
  &:hover {
    background-color: rgba(168, 85, 247, 0.3);
  }
  
  .tag-x-icon {
    width: 10px;
    height: 10px;
  }
}

.tag-input-box {
  background: none;
  border: none;
  outline: none;
  color: var(--text-primary);
  flex: 1;
  min-width: 100px;
  font-size: 0.9rem;
  
  &::placeholder {
    color: var(--text-muted);
  }
}

/* Chart config modal details style */
.chart-config-subgroup {
  background-color: rgba(255, 255, 255, 0.01);
  border: 1px dashed var(--border-color);
  padding: 1rem;
  border-radius: var(--radius-md);
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

/* Transitions animation */
.modal-enter-active, .modal-leave-active {
  transition: opacity 0.25s ease;
}
.modal-enter-from, .modal-leave-to {
  opacity: 0;
}

/* Pagination Styles */
.pagination-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 1.25rem;
  margin-top: 1.25rem;
  border-top: 1px solid var(--border-color);
  
  .pagination-info {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-secondary);
    
    .total-count {
      color: var(--text-muted);
      font-weight: normal;
      margin-left: 0.25rem;
    }
  }

  @media (max-width: 576px) {
    flex-direction: column;
    gap: 1rem;
    text-align: center;
  }
}

.tooltip-fields-checklist {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
  background-color: rgba(255, 255, 255, 0.01);
  border: 1px solid var(--border-color);
  padding: 0.75rem;
  border-radius: var(--radius-sm);
  max-height: 150px;
  overflow-y: auto;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
  user-select: none;
  color: var(--text-secondary);
  
  input {
    cursor: pointer;
  }
  
  &:hover {
    color: var(--text-primary);
  }
}

.input-with-unit-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;

  .form-control {
    padding-right: 3rem !important;
  }

  .field-unit-badge {
    position: absolute;
    right: 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-muted);
    pointer-events: none;
    user-select: none;
  }
}

.automated-reminder-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem;
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.12) 0%, rgba(59, 130, 246, 0.12) 100%);
  border: 1px solid rgba(168, 85, 247, 0.25);
  border-radius: var(--radius-md);
  gap: 1.5rem;
  margin-bottom: 2.5rem; /* Generous spacing below the reminder banner */
  animation: pulse-border 3s infinite alternate;

  .reminder-content {
    display: flex;
    align-items: center;
    gap: 1rem;
    
    .reminder-icon {
      color: var(--color-accent);
      width: 24px;
      height: 24px;
      flex-shrink: 0;
    }

    .reminder-text {
      text-align: left;
      
      h4 {
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 0.25rem;
      }
      p {
        font-size: 0.8rem;
        color: var(--text-secondary);
        margin: 0;
      }
    }
  }

  .reminder-actions {
    display: flex;
    gap: 0.75rem;
    flex-shrink: 0;
  }

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
    
    .reminder-actions {
      width: 100%;
      justify-content: flex-end;
    }
  }
}

.template-apply-group {
  margin-bottom: 2.25rem !important;
}

.template-selector-row {
  display: flex;
  gap: 0.5rem;
  width: 100%;

  .form-control {
    flex: 1;
  }

  .btn {
    padding: 0.75rem 1.25rem;
    font-size: 0.9rem;
    flex-shrink: 0;
  }
}

.templates-manage-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 350px;
  overflow-y: auto;
  padding-right: 0.25rem;
  text-align: left;
}

.template-manage-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem !important;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  margin-bottom: 0;

  .template-manage-info {
    display: flex;
    flex-direction: column;
    text-align: left;
    
    strong {
      color: var(--text-primary);
      font-size: 0.95rem;
    }
  }
  
  .btn-delete-temp {
    flex-shrink: 0;
  }
}

.badge-auto {
  display: inline-flex;
  align-items: center;
  font-size: 0.725rem;
  font-weight: 600;
  color: var(--color-accent);
  background-color: rgba(168, 85, 247, 0.1);
  padding: 0.15rem 0.5rem;
  border-radius: 10px;
  border: 1px solid rgba(168, 85, 247, 0.15);
}

.badge-manual {
  display: inline-flex;
  align-items: center;
  font-size: 0.725rem;
  font-weight: 600;
  color: var(--text-muted);
  background-color: rgba(255, 255, 255, 0.02);
  padding: 0.15rem 0.5rem;
  border-radius: 10px;
  border: 1px solid var(--border-color);
}

.automation-setup-box {
  background-color: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--border-color);
  text-align: left;
}

.btn-link {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  padding: 0;
  transition: var(--transition);
  text-decoration: underline;

  &:hover {
    color: var(--color-primary-hover);
  }
}

.modal-card.modal-sm {
  max-width: 500px;
}

@keyframes pulse-border {
  from {
    border-color: rgba(168, 85, 247, 0.25);
  }
  to {
    border-color: rgba(168, 85, 247, 0.5);
    box-shadow: 0 0 10px rgba(168, 85, 247, 0.12);
  }
}

.relation-field-wrapper {
  margin-top: 0.25rem;
}

.relation-checkbox-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.75rem;
  max-height: 250px;
  overflow-y: auto;
  padding: 0.25rem;
  text-align: left;
}

.relation-checkbox-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  background-color: var(--bg-tertiary);
  cursor: pointer;
  transition: var(--transition);
  user-select: none;
  
  input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: var(--color-primary);
    cursor: pointer;
    flex-shrink: 0;
  }
  
  .checkbox-label {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  &:hover {
    border-color: var(--border-hover);
    background-color: rgba(255, 255, 255, 0.02);
  }
  
  &.checked {
    border-color: var(--color-primary);
    background-color: rgba(59, 130, 246, 0.08);
    
    .checkbox-label {
      color: var(--text-primary);
      font-weight: 600;
    }
  }
}

.empty-relation-options {
  grid-column: 1 / -1;
  color: var(--text-muted);
  font-size: 0.85rem;
  font-style: italic;
  padding: 1rem 0;
  text-align: center;
}
</style>
