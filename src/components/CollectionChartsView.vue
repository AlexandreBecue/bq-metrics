<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { db, type CollectionSchema, type RecordEntry, type SavedView } from '../db';
import { evaluateFilters, aggregateData, formatToFrenchDate } from '../db/queries';
import { 
  Bar as BarChart, 
  Line as LineChart, 
  Pie as PieChart 
} from 'vue-chartjs';
import { 
  Chart as ChartJS, 
  Title, 
  Tooltip, 
  Legend, 
  BarElement, 
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  ArcElement,
  type ChartOptions
} from 'chart.js';
import { 
  LayoutDashboard, HelpCircle
} from '@lucide/vue';

// Register Chart.js components
ChartJS.register(
  Title, 
  Tooltip, 
  Legend, 
  BarElement, 
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  ArcElement
);

const emit = defineEmits(['navigate']);

const collections = ref<CollectionSchema[]>([]);
const selectedCollectionId = ref<string>(localStorage.getItem('bq-metrics-active-collection-id') || '');
const widgets = ref<SavedView[]>([]);
const widgetData = ref<Record<string, { labels: string[]; values: number[]; values2?: number[]; tooltips?: string[][] }>>({});

const formatValue = (val: any, fieldConfig?: any) => {
  if (val === undefined || val === null) return '';
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
  return String(val);
};

const activeCollection = computed(() => {
  return collections.value.find(c => c.id === selectedCollectionId.value);
});

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
    await loadChartsData();
  }
};

const loadChartsData = async () => {
  if (!selectedCollectionId.value) return;
  
  // Load saved views configured as widgets/charts for the selected collection
  const views = await db.views.where('collectionId').equals(selectedCollectionId.value).toArray();
  const filteredWidgets = views.filter((v: SavedView) => v.chartType && v.chartType !== 'none' && !v.deletedAt);
  widgets.value = filteredWidgets.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  
  // Fetch and prepare data for each widget
  const tempWidgetData: Record<string, { labels: string[]; values: number[]; values2?: number[]; tooltips?: string[][] }> = {};
  
  for (const widget of widgets.value) {
    // 1. Get raw records for this collection
    const rawRecords = await db.records.where('collectionId').equals(widget.collectionId).toArray();
    const activeRecords = rawRecords.filter(r => !r.deletedAt);
    
    // 2. Filter records
    const filteredRecords = activeRecords.filter((rec: RecordEntry) => evaluateFilters(rec, widget.filters, widget.logicalOperator));
    
    // 3. Aggregate data
    if (widget.chartConfig) {
      // Resolve relation IDs to names for the X-axis key if it's a relation field
      let idToNameMap: Record<string, string> | undefined = undefined;
      const xAxisField = activeCollection.value?.fields.find(f => f.key === widget.chartConfig!.xAxisKey);
      
      if (xAxisField?.type === 'relation' && xAxisField.relatedCollectionId) {
        const relatedRecords = await db.records.where('collectionId').equals(xAxisField.relatedCollectionId).toArray();
        const activeRelatedRecords = relatedRecords.filter(r => !r.deletedAt);
        const targetCol = await db.collections.get(xAxisField.relatedCollectionId);
        const primaryKey = targetCol?.primaryFieldKey || 'title';
        
        idToNameMap = {};
        for (const r of activeRelatedRecords) {
          idToNameMap[r.id!] = String(r.data[primaryKey] || r.id);
        }
      }

      // If aggregateType is usage_since_reset, we load records from the related collection pointing to us
      let extraRecords: RecordEntry[] | undefined = undefined;
      if (widget.chartConfig.aggregate === 'usage_since_reset') {
        const currentCollectionId = widget.collectionId;
        const allCols = await db.collections.toArray();
        // Find a collection that has a relation field pointing to our current collection
        const relatedColSchema = allCols.find(c => 
          !c.deletedAt && c.fields.some(f => f.type === 'relation' && f.relatedCollectionId === currentCollectionId)
        );
        
        if (relatedColSchema) {
          const logRecords = await db.records.where('collectionId').equals(relatedColSchema.id).toArray();
          extraRecords = logRecords.filter(r => !r.deletedAt);
        }
      }

      const aggResult = aggregateData(
        filteredRecords,
        widget.chartConfig.xAxisKey,
        widget.chartConfig.yAxisKey,
        widget.chartConfig.aggregate,
        idToNameMap,
        extraRecords
      );
      
      // Build custom tooltips for each label/point
      const tooltips: string[][] = [];
      const tooltipFields = widget.chartConfig.tooltipFields || [];
      
      if (tooltipFields.length > 0 && activeCollection.value) {
        aggResult.forEach(item => {
          // Find records contributing to this aggregated group/point
          const matchingRecs = filteredRecords.filter(rec => {
            const rawXVal = rec.data[widget.chartConfig!.xAxisKey];
            if (rawXVal !== undefined && rawXVal !== null) {
              if (Array.isArray(rawXVal)) {
                const resolvedNames = rawXVal.map(id => idToNameMap?.[id] || id);
                return resolvedNames.includes(item.label) || resolvedNames.join(', ') === item.label;
              } else {
                const resolvedName = idToNameMap?.[rawXVal] || String(rawXVal);
                return resolvedName === item.label;
              }
            }
            return item.label === 'N/A';
          });
          
          const pointTooltipLines: string[] = [];
          
          tooltipFields.forEach(fieldKey => {
            // Find field configuration
            const f = activeCollection.value?.fields.find(field => field.key === fieldKey);
            if (!f) return;
            
            // Collect unique formatted values across matching records
            const uniqueVals = new Set<string>();
            matchingRecs.forEach(rec => {
              const val = rec.data[fieldKey];
              if (val !== undefined && val !== null && val !== '') {
                uniqueVals.add(formatValue(val, f));
              }
            });
            
            if (uniqueVals.size > 0) {
              const valsArray = Array.from(uniqueVals);
              let joinedVals;
              if (valsArray.length > 5) {
                joinedVals = valsArray.slice(0, 5).join(', ') + `... (+${valsArray.length - 5} autres)`;
              } else {
                joinedVals = valsArray.join(', ');
              }
              pointTooltipLines.push(`${f.name} : ${joinedVals}`);
            }
          });
          
          tooltips.push(pointTooltipLines);
        });
      } else {
        aggResult.forEach(() => tooltips.push([]));
      }
      
      tempWidgetData[widget.id] = {
        labels: aggResult.map(r => r.label),
        values: aggResult.map(r => r.value),
        values2: aggResult.map(r => r.value2 || 0),
        tooltips
      };
    }
  }
  
  widgetData.value = tempWidgetData;
};

onMounted(() => {
  loadInitialData();
});

// Watch collection changes to reload charts
watch(selectedCollectionId, async (newVal) => {
  if (newVal) {
    localStorage.setItem('bq-metrics-active-collection-id', newVal);
    await loadChartsData();
  }
});

// Chart.js Style Options per Type to satisfy TypeScript union types
const barChartOptions = computed<ChartOptions<'bar'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom',
      labels: {
        color: '#94a3b8',
        font: {
          family: 'Inter',
          size: 11
        }
      }
    },
    tooltip: {
      backgroundColor: '#1e293b',
      titleColor: '#ffffff',
      bodyColor: '#e2e8f0',
      borderColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      padding: 10,
      callbacks: {
        label: (context: any) => {
          const unit = context.dataset.unit ? ` ${context.dataset.unit}` : '';
          const lines = [` ${context.formattedValue}${unit}`];
          const customTooltip = context.dataset.customTooltips?.[context.dataIndex];
          if (customTooltip && customTooltip.length > 0) {
            lines.push(''); // elegant spacer
            lines.push(...customTooltip);
          }
          return lines;
        }
      }
    }
  },
  scales: {
    x: {
      grid: {
        color: 'rgba(255,255,255,0.04)'
      },
      ticks: {
        color: '#94a3b8',
        font: {
          family: 'Inter',
          size: 10
        }
      }
    },
    y: {
      grid: {
        color: 'rgba(255,255,255,0.04)'
      },
      ticks: {
        color: '#94a3b8',
        font: {
          family: 'Inter',
          size: 10
        }
      }
    }
  }
}));

const lineChartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom',
      labels: {
        color: '#94a3b8',
        font: {
          family: 'Inter',
          size: 11
        }
      }
    },
    tooltip: {
      backgroundColor: '#1e293b',
      titleColor: '#ffffff',
      bodyColor: '#e2e8f0',
      borderColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      padding: 10,
      callbacks: {
        label: (context: any) => {
          const unit = context.dataset.unit ? ` ${context.dataset.unit}` : '';
          const lines = [` ${context.formattedValue}${unit}`];
          const customTooltip = context.dataset.customTooltips?.[context.dataIndex];
          if (customTooltip && customTooltip.length > 0) {
            lines.push(''); // elegant spacer
            lines.push(...customTooltip);
          }
          return lines;
        }
      }
    }
  },
  scales: {
    x: {
      grid: {
        color: 'rgba(255,255,255,0.04)'
      },
      ticks: {
        color: '#94a3b8',
        font: {
          family: 'Inter',
          size: 10
        }
      }
    },
    y: {
      grid: {
        color: 'rgba(255,255,255,0.04)'
      },
      ticks: {
        color: '#94a3b8',
        font: {
          family: 'Inter',
          size: 10
        }
      }
    }
  }
}));

const pieChartThemeOptions = computed<ChartOptions<'pie'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom',
      labels: {
        color: '#94a3b8',
        font: {
          family: 'Inter',
          size: 11
        }
      }
    },
    tooltip: {
      backgroundColor: '#1e293b',
      titleColor: '#ffffff',
      bodyColor: '#e2e8f0',
      borderColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      padding: 10,
      callbacks: {
        title: () => '',
        label: (context: any) => {
          const unit = context.dataset.unit ? ` ${context.dataset.unit}` : '';
          return ` ${context.label} : ${context.formattedValue}${unit}`;
        }
      }
    }
  }
}));

// Palette colors for charts
const chartColors = [
  'rgba(59, 130, 246, 0.7)',  // Primary Blue
  'rgba(168, 85, 247, 0.7)',  // Accent Purple
  'rgba(16, 185, 129, 0.7)',  // Success Emerald
  'rgba(6, 182, 212, 0.7)',   // Info Cyan
  'rgba(245, 158, 11, 0.7)',  // Warning Amber
  'rgba(239, 68, 68, 0.7)',   // Danger Rose
];

const borderColors = [
  '#3b82f6', '#a855f7', '#10b981', '#06b6d4', '#f59e0b', '#ef4444'
];

const getChartData = (widgetId: string, widgetName: string) => {
  const data = widgetData.value[widgetId] || { labels: [], values: [], values2: [], tooltips: [] };
  const widget = widgets.value.find(w => w.id === widgetId);
  const yField = activeCollection.value?.fields.find(f => f.key === widget?.chartConfig?.yAxisKey);
  const unit = yField?.unit || '';

  return {
    labels: data.labels,
    datasets: [
      {
        label: widgetName,
        backgroundColor: chartColors,
        borderColor: borderColors,
        borderWidth: 1,
        hoverOffset: 4,
        data: data.values,
        customTooltips: data.tooltips,
        unit: unit
      }
    ]
  };
};

const getLineChartData = (widgetId: string, widgetName: string) => {
  const data = widgetData.value[widgetId] || { labels: [], values: [], tooltips: [] };
  const widget = widgets.value.find(w => w.id === widgetId);
  const yField = activeCollection.value?.fields.find(f => f.key === widget?.chartConfig?.yAxisKey);
  const unit = yField?.unit || '';

  return {
    labels: data.labels,
    datasets: [
      {
        label: widgetName,
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderColor: '#3b82f6',
        borderWidth: 2,
        pointBackgroundColor: '#a855f7',
        pointBorderColor: '#ffffff',
        pointHoverRadius: 6,
        fill: true,
        tension: 0.3,
        data: data.values,
        customTooltips: data.tooltips,
        unit: unit
      }
    ]
  };
};

const navigateTo = (tab: string) => {
  emit('navigate', tab, selectedCollectionId.value);
};

const openChartsFor = async (colId: string) => {
  selectedCollectionId.value = colId;
  if (collections.value.length > 0) {
    await loadChartsData();
  }
};

defineExpose({
  selectedCollectionId,
  openChartsFor
});
</script>

<template>
  <div class="collection-charts-view fade-in">
    <!-- Header with Back Button and Picker -->
    <div class="charts-header">
      <div class="header-left">
        <div class="collection-select-wrapper">
          <label for="collectionChartSelector">Fiche active :</label>
          <select id="collectionChartSelector" v-model="selectedCollectionId" class="collection-picker">
            <option v-for="col in collections" :key="col.id" :value="col.id">
              📁 {{ col.name }}
            </option>
          </select>
        </div>
      </div>

      <button @click="navigateTo('explorer')" class="btn btn-primary btn-data">
        <span>Saisie de données</span>
      </button>
    </div>

    <!-- Charts Dashboard Grid -->
    <div class="dashboard-grid">
      <div class="grid-header-title">
        <LayoutDashboard class="grid-header-icon" />
        <h2>Statistiques & Graphiques : {{ activeCollection?.name }}</h2>
      </div>

      <div v-if="widgets.length === 0" class="empty-widgets card glass text-center">
        <HelpCircle class="empty-widgets-icon" />
        <h3>Aucun graphique configuré</h3>
        <p>Rends-toi dans l'onglet <strong>Données</strong> pour la collection <strong>{{ activeCollection?.name }}</strong>, configure des filtres avancés et clique sur <strong>Sauvegarder cette vue / graphique</strong> pour l'ajouter ici.</p>
        <button @click="navigateTo('explorer')" class="btn btn-secondary mt-3">
          Aller aux Données
        </button>
      </div>

      <div v-else class="widgets-grid">
        <div v-for="widget in widgets" :key="widget.id" class="card glass widget-card">
          <div class="widget-header">
            <h4>{{ widget.name }}</h4>
          </div>
          
          <div class="chart-wrapper">
            <BarChart 
              v-if="widget.chartType === 'bar'" 
              :data="getChartData(widget.id, widget.name)" 
              :options="barChartOptions" 
            />
            <PieChart 
              v-else-if="widget.chartType === 'pie'" 
              :data="getChartData(widget.id, widget.name)" 
              :options="pieChartThemeOptions" 
            />
            <LineChart 
              v-else-if="widget.chartType === 'line'" 
              :data="getLineChartData(widget.id, widget.name)" 
              :options="lineChartOptions" 
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.collection-charts-view {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.charts-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1.5rem;
  flex-wrap: wrap;

  @media (max-width: 576px) {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  flex-wrap: wrap;

  @media (max-width: 576px) {
    width: 100%;
  }
}

.btn-back {
  padding: 0.6rem 1rem !important;
  font-size: 0.95rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-data {
  @media (max-width: 576px) {
    width: 100%;
    justify-content: center;
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

.mt-3 {
  margin-top: 1rem;
}

/* Dynamic Charts dashboard grid */
.dashboard-grid {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  
  .grid-header-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    
    .grid-header-icon {
      color: var(--color-primary);
      width: 24px;
      height: 24px;
    }
    
    h2 {
      font-size: 1.5rem;
      font-weight: 800;
    }
  }
}

.empty-widgets {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  
  .empty-widgets-icon {
    width: 52px;
    height: 52px;
    color: var(--text-muted);
    stroke-width: 1.5;
    margin-bottom: 1.25rem;
  }
  
  h3 {
    font-size: 1.25rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }
  
  p {
    color: var(--text-secondary);
    max-width: 500px;
    line-height: 1.5;
    font-size: 0.95rem;
    
    strong {
      color: var(--color-primary);
    }
  }
}

.widgets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
  gap: 1.5rem;
  
  @media (max-width: 576px) {
    grid-template-columns: 1fr;
  }
}

.widget-card {
  display: flex;
  flex-direction: column;
  min-height: 380px;
  
  .widget-header {
    margin-bottom: 1rem;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 0.5rem;
    
    h4 {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--text-primary);
    }
  }
  
  .chart-wrapper {
    position: relative;
    flex: 1;
    min-height: 280px;
  }
}
</style>
