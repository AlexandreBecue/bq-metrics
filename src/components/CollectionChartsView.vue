<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { db, type CollectionSchema, type RecordEntry, type SavedView } from '../db';
import { evaluateFilters, aggregateData, formatToFrenchDate, backfillCalculatedFields } from '../db/queries';
import { 
  Bar as BarChart, 
  Line as LineChart, 
  Pie as PieChart,
  Doughnut as DoughnutChart
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

// Local zoom filters for date-based charts: { [widgetId]: { start: '', end: '' } }
const chartZoomFilters = ref<Record<string, { start: string; end: string }>>({});
// Controls whether the zoom panel is expanded: { [widgetId]: boolean }
const showZoomControls = ref<Record<string, boolean>>({});
// Controls whether the HTML legend is expanded: { [widgetId]: boolean }
const showLegends = ref<Record<string, boolean>>({});
// Controls whether the widget title is expanded to wrap on mobile: { [widgetId]: boolean }
const expandedTitles = ref<Record<string, boolean>>({});

const toggleZoomControls = (widgetId: string) => {
  showZoomControls.value[widgetId] = !showZoomControls.value[widgetId];
};

const toggleLegend = (widgetId: string) => {
  showLegends.value[widgetId] = !showLegends.value[widgetId];
};

const toggleTitle = (widgetId: string) => {
  expandedTitles.value[widgetId] = !expandedTitles.value[widgetId];
};

const getOrCreateZoom = (widgetId: string) => {
  if (!chartZoomFilters.value[widgetId]) {
    chartZoomFilters.value[widgetId] = { start: '', end: '' };
  }
  return chartZoomFilters.value[widgetId];
};

// Local interactive filter values: { [widgetId]: { [fieldKey]: value } }
const interactiveValues = ref<Record<string, Record<string, any>>>({});

const getInteractiveValue = (widgetId: string, fieldKey: string, defaultValue: any) => {
  if (!interactiveValues.value[widgetId]) {
    interactiveValues.value[widgetId] = {};
  }
  if (interactiveValues.value[widgetId][fieldKey] === undefined) {
    interactiveValues.value[widgetId][fieldKey] = defaultValue;
  }
  return interactiveValues.value[widgetId][fieldKey];
};

const setInteractiveValue = async (widgetId: string, fieldKey: string, value: any) => {
  if (!interactiveValues.value[widgetId]) {
    interactiveValues.value[widgetId] = {};
  }
  interactiveValues.value[widgetId][fieldKey] = value;
  await loadChartsData();
};

const resetZoom = async (widgetId: string) => {
  if (chartZoomFilters.value[widgetId]) {
    chartZoomFilters.value[widgetId] = { start: '', end: '' };
  }
  
  if (interactiveValues.value[widgetId]) {
    const widget = widgets.value.find(w => w.id === widgetId);
    if (widget) {
      widget.filters.forEach(f => {
        if (f.isInteractive && f.fieldKey) {
          interactiveValues.value[widgetId][f.fieldKey] = f.value;
        }
      });
    }
  }
  
  await loadChartsData();
};

const getDateFieldOfCollection = (widget: SavedView) => {
  if (!widget.chartConfig || !activeCollection.value) return undefined;
  
  // 1. In priority, check if the X axis is a date
  const xAxisField = activeCollection.value.fields.find(f => f.key === widget.chartConfig?.xAxisKey);
  if (xAxisField?.type === 'date') return xAxisField;
  
  // 2. Otherwise, find the first available date field in the collection
  return activeCollection.value.fields.find(f => f.type === 'date');
};

const hasDateField = (widget: SavedView) => {
  return getDateFieldOfCollection(widget) !== undefined;
};

const getFieldUnit = (widget: SavedView) => {
  const yField = activeCollection.value?.fields.find(f => f.key === widget.chartConfig?.yAxisKey);
  return yField?.unit ? ` ${yField.unit}` : '';
};

const hasControls = (widget: SavedView) => {
  return hasDateField(widget) || widget.filters.some(f => f.isInteractive);
};

const hasActiveFilters = (widget: SavedView) => {
  const datesActive = chartZoomFilters.value[widget.id]?.start || chartZoomFilters.value[widget.id]?.end;
  if (datesActive) return true;

  const localOverrides = interactiveValues.value[widget.id];
  if (localOverrides) {
    return Object.keys(localOverrides).some(key => {
      const filter = widget.filters.find(f => f.fieldKey === key);
      return filter && localOverrides[key] !== filter.value;
    });
  }
  return false;
};

const getFieldConfig = (fieldKey: string) => {
  return activeCollection.value?.fields.find(f => f.key === fieldKey);
};

const getOperatorLabel = (operator: string) => {
  switch (operator) {
    case 'eq': return 'égal';
    case 'neq': return 'différent';
    case 'gt': return 'supérieur';
    case 'gte': return '≥';
    case 'lt': return 'inférieur';
    case 'lte': return '≤';
    case 'contains': return 'contient';
    case 'not_contains': return 'sans';
    case 'in_tags': return 'tag';
    default: return '';
  }
};

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
    
    // Auto-backfill calculated fields if any are missing or outdated
    if (activeCollection.value) {
      await backfillCalculatedFields(activeRecords, activeCollection.value, db);
    }
    
    // 2. Filter records (applying local overrides for interactive filters)
    const activeFilters = widget.filters.map(f => {
      if (f.isInteractive && f.fieldKey) {
        const localVal = interactiveValues.value[widget.id]?.[f.fieldKey];
        if (localVal !== undefined) {
          return { ...f, value: localVal };
        }
      }
      return f;
    });

    let filteredRecords = activeRecords.filter((rec: RecordEntry) => evaluateFilters(rec, activeFilters, widget.logicalOperator));
    
    // Zoom/Filter by local start/end dates if collection has a date field
    if (widget.chartConfig) {
      const dateField = getDateFieldOfCollection(widget);
      if (dateField) {
        const zoom = chartZoomFilters.value[widget.id];
        if (zoom) {
          if (zoom.start) {
            filteredRecords = filteredRecords.filter(r => {
              const val = r.data[dateField.key];
              return val && String(val) >= zoom.start;
            });
          }
          if (zoom.end) {
            filteredRecords = filteredRecords.filter(r => {
              const val = r.data[dateField.key];
              return val && String(val) <= zoom.end;
            });
          }
        }
      }
    }
    
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
              let joinedVals = '';
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
    chartZoomFilters.value = {}; // Reset local zoom filters when switching collections
    showZoomControls.value = {}; // Reset zoom panel expansions when switching collections
    showLegends.value = {}; // Reset local HTML legend toggles when switching collections
    expandedTitles.value = {}; // Reset local title expansions when switching collections
    interactiveValues.value = {}; // Reset local interactive filters when switching collections
    await loadChartsData();
  }
});

// Chart.js Style Options per Type to satisfy TypeScript union types
const barChartOptions = computed<ChartOptions<'bar'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false
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
      display: false
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
      display: false
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

const doughnutOptions = computed<ChartOptions<'doughnut'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  cutout: '70%',
  plugins: {
    legend: {
      display: false
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

const centerTextPlugin = {
  id: 'centerText',
  beforeDraw: (chart: any) => {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    
    ctx.save();
    
    const dataset = chart.data.datasets[0];
    if (!dataset || !dataset.data) {
      ctx.restore();
      return;
    }
    const total = dataset.data.reduce((sum: number, val: number) => sum + (Number(val) || 0), 0);
    const unit = dataset.unit ? ` ${dataset.unit}` : '';
    
    // Compute geometric center of the actual doughnut chart area
    const centerX = (chartArea.left + chartArea.right) / 2;
    const centerY = (chartArea.top + chartArea.bottom) / 2;
    const chartHeight = chartArea.bottom - chartArea.top;
    
    // Scale font relatively to chart height
    const fontSize = (chartHeight / 165).toFixed(2);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    
    // Draw "TOTAL" label - shifted slightly higher and made larger
    ctx.fillStyle = '#94a3b8';
    ctx.font = `600 ${Number(fontSize) * 0.52}em 'Inter', system-ui, sans-serif`;
    ctx.fillText('TOTAL', centerX, centerY - (chartHeight * 0.08));
    
    // Draw total value - made slightly larger and balanced vertically
    ctx.fillStyle = '#f8fafc';
    ctx.font = `800 ${Number(fontSize) * 0.8}em 'Inter', system-ui, sans-serif`;
    const formattedTotal = Math.round(total * 100) / 100;
    ctx.fillText(`${formattedTotal}${unit}`, centerX, centerY + (chartHeight * 0.06));
    
    ctx.restore();
  }
};

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
        unit: unit,
        radius: 120 // Lock outer radius of pie/doughnut circle for geometric sizing consistency
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
        <div 
          v-for="widget in widgets" 
          :key="widget.id" 
          :class="['card glass widget-card', ['pie', 'doughnut'].includes(widget.chartType) ? 'circular-chart-card' : '']"
        >
          <div class="widget-header">
            <h4 
              :title="widget.name" 
              @click="toggleTitle(widget.id)"
              :class="['widget-title', expandedTitles[widget.id] ? 'expanded' : '']"
            >
              {{ widget.name }}
            </h4>
            
            <div class="widget-header-actions">
              <!-- Legend Toggle Button -->
              <button 
                v-if="widgetData[widget.id]?.labels?.length > 0" 
                @click="toggleLegend(widget.id)" 
                :class="['btn-toggle-legend', showLegends[widget.id] ? 'active' : '']"
                title="Afficher/Masquer la légende"
              >
                Légende
              </button>

              <!-- Zoom Toggle Button -->
              <button 
                v-if="hasControls(widget)" 
                @click="toggleZoomControls(widget.id)" 
                :class="['btn-toggle-zoom', showZoomControls[widget.id] || hasActiveFilters(widget) ? 'active' : '']"
                title="Filtrer et ajuster les contrôles"
              >
                Filtrer <span v-if="hasActiveFilters(widget)" class="zoom-badge-dot"></span>
              </button>
            </div>
          </div>

          <!-- Collapsible Date Zoom and Interactive Controls Panel -->
          <div v-if="hasControls(widget) && showZoomControls[widget.id]" class="chart-zoom-panel fade-in">
            <!-- 1. Global Date Zoom (if date field exists) -->
            <div v-if="hasDateField(widget)" class="control-row date-zoom-row">
              <span class="zoom-label">
                Période 
                <span class="operator-suffix">({{ getDateFieldOfCollection(widget)?.name }})</span> :
              </span>
              <div class="zoom-inputs-group">
                <input 
                  type="date" 
                  v-model="getOrCreateZoom(widget.id).start" 
                  @change="loadChartsData" 
                  class="zoom-input" 
                  title="Date de début"
                />
                <span class="zoom-separator">au</span>
                <input 
                  type="date" 
                  v-model="getOrCreateZoom(widget.id).end" 
                  @change="loadChartsData" 
                  class="zoom-input" 
                  title="Date de fin"
                />
              </div>
            </div>

            <!-- 2. Dynamic Interactive Filters -->
            <div 
              v-for="filter in widget.filters.filter(f => f.isInteractive)" 
              :key="filter.fieldKey" 
              class="control-row interactive-filter-row"
            >
              <span class="zoom-label">
                {{ getFieldConfig(filter.fieldKey)?.name || filter.fieldKey }} 
                <span class="operator-suffix">({{ getOperatorLabel(filter.operator) }})</span> :
              </span>
              
              <!-- If select field -->
              <select 
                v-if="getFieldConfig(filter.fieldKey)?.type === 'select'" 
                :value="getInteractiveValue(widget.id, filter.fieldKey, filter.value)"
                @change="e => setInteractiveValue(widget.id, filter.fieldKey, (e.target as HTMLSelectElement).value)"
                class="zoom-input select-input"
              >
                <option v-for="opt in getFieldConfig(filter.fieldKey)?.options" :key="opt" :value="opt">
                  {{ opt }}
                </option>
              </select>

              <!-- If boolean field -->
              <select 
                v-else-if="getFieldConfig(filter.fieldKey)?.type === 'boolean'" 
                :value="getInteractiveValue(widget.id, filter.fieldKey, filter.value)"
                @change="e => {
                  const val = (e.target as HTMLSelectElement).value;
                  setInteractiveValue(widget.id, filter.fieldKey, val === 'true' ? true : val === 'false' ? false : val);
                }"
                class="zoom-input select-input"
              >
                <option :value="true">✅ Oui</option>
                <option :value="false">❌ Non</option>
              </select>

              <!-- If number field -->
              <input 
                v-else-if="getFieldConfig(filter.fieldKey)?.type === 'number'" 
                type="number"
                :value="getInteractiveValue(widget.id, filter.fieldKey, filter.value)"
                @input="e => setInteractiveValue(widget.id, filter.fieldKey, Number((e.target as HTMLInputElement).value))"
                class="zoom-input text-input"
              />

              <!-- If date field -->
              <input 
                v-else-if="getFieldConfig(filter.fieldKey)?.type === 'date'" 
                type="date"
                :value="getInteractiveValue(widget.id, filter.fieldKey, filter.value)"
                @change="e => setInteractiveValue(widget.id, filter.fieldKey, (e.target as HTMLInputElement).value)"
                class="zoom-input date-input"
              />

              <!-- Default: text field -->
              <input 
                v-else 
                type="text"
                :value="getInteractiveValue(widget.id, filter.fieldKey, filter.value)"
                @input="e => setInteractiveValue(widget.id, filter.fieldKey, (e.target as HTMLInputElement).value)"
                class="zoom-input text-input"
                placeholder="Filtrer..."
              />
            </div>

            <!-- Clear/Reset Controls button -->
            <button 
              v-if="hasActiveFilters(widget)" 
              @click="resetZoom(widget.id)" 
              class="btn-reset-zoom"
              title="Réinitialiser tous les filtres"
            >
              Effacer
            </button>
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
            <DoughnutChart 
              v-else-if="widget.chartType === 'doughnut'" 
              :data="getChartData(widget.id, widget.name)" 
              :options="doughnutOptions" 
              :plugins="[centerTextPlugin]"
            />
            <LineChart 
              v-else-if="widget.chartType === 'line'" 
              :data="getLineChartData(widget.id, widget.name)" 
              :options="lineChartOptions" 
            />
          </div>

          <!-- HTML Legend for All Charts (Bar, Line, Pie & Doughnut) - Collapsible and hidden by default -->
          <div v-if="widgetData[widget.id]?.labels?.length > 0 && showLegends[widget.id]" class="chart-html-legend fade-in">
            <div 
              v-for="(label, idx) in widgetData[widget.id]?.labels || []" 
              :key="idx" 
              class="legend-item"
            >
              <span class="legend-color-box" :style="{ backgroundColor: chartColors[idx % chartColors.length] }"></span>
              <span class="legend-label-text">{{ label }} :</span>
              <span class="legend-value-text">{{ widgetData[widget.id]?.values[idx] }}{{ getFieldUnit(widget) }}</span>
            </div>
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
  min-width: 0; /* Prevent horizontal container expansion */
  width: 100%;  /* Fill the grid column width exactly */

  &.circular-chart-card {
    .chart-wrapper {
      height: 260px; /* Locked height of 260px since HTML legend sits below it */
    }
  }
  
  .widget-header {
    margin-bottom: 1rem;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 0.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    
    .widget-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
      margin-right: 0.25rem;
      cursor: pointer;
      user-select: none;
      transition: var(--transition);

      &:hover {
        color: var(--color-primary);
      }

      &.expanded {
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
      }
    }

    .widget-header-actions {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-shrink: 0; /* Keeps buttons side-by-side without squeezing */
    }
  }
  
  .chart-wrapper {
    position: relative;
    height: 280px; /* Locked height to prevent vertical accumulation */
    width: 100%;   /* Constrain canvas width precisely inside card content */
    min-width: 0;  /* Allow shrink */
    overflow: hidden;
  }
}

.btn-toggle-zoom, .btn-toggle-legend {
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  padding: 0.35rem 0.75rem;
  font-size: 0.8rem;
  font-weight: 600;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  transition: var(--transition);
  position: relative;

  &:hover {
    border-color: var(--color-primary);
    color: var(--text-primary);
    background-color: rgba(59, 130, 246, 0.05);
  }

  &.active {
    background-color: rgba(168, 85, 247, 0.1);
    color: var(--color-accent);
    border-color: rgba(168, 85, 247, 0.3);
  }
}

.zoom-badge-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 8px;
  height: 8px;
  background-color: var(--color-danger);
  border-radius: 50%;
  box-shadow: 0 0 6px var(--color-danger);
}

.chart-zoom-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
  background-color: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border-color);
  padding: 0.75rem 1rem;
  border-radius: var(--radius-sm);
  margin-bottom: 1rem;
  animation: fadeIn 0.2s ease-out;

  .control-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    
    &.date-zoom-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.4rem;
      
      .zoom-inputs-group {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
      }
    }
  }

  .zoom-label {
    font-weight: 600;
    min-width: 140px;
    text-align: left;
    
    .operator-suffix {
      font-size: 0.75rem;
      font-weight: normal;
      color: var(--text-muted);
      font-style: italic;
    }
  }

  .zoom-input {
    padding: 0.25rem 0.5rem;
    font-size: 0.8rem;
    border-radius: var(--radius-sm);
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    width: 180px;
    color-scheme: dark;
    outline: none;
    transition: var(--transition);

    &:focus {
      border-color: var(--color-primary);
    }

    &.select-input {
      cursor: pointer;
    }
  }

  .zoom-separator {
    color: var(--text-muted);
  }

  .btn-reset-zoom {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: var(--color-danger);
    padding: 0.35rem 0.8rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    transition: var(--transition);
    align-self: flex-end;
    margin-top: 0.25rem;

    &:hover {
      background-color: var(--color-danger);
      color: #ffffff;
    }
  }

  @media (max-width: 576px) {
    padding: 0.75rem;
    gap: 0.6rem;

    .control-row {
      flex-direction: column;
      align-items: stretch;
      gap: 0.35rem;
      
      &.date-zoom-row {
        .zoom-inputs-group {
          flex-direction: column;
          align-items: stretch;
          gap: 0.35rem;
        }
      }
    }

    .zoom-label {
      min-width: 100%;
    }

    .zoom-separator {
      display: none;
    }

    .zoom-input {
      width: 100%;
      padding: 0.35rem 0.5rem;
    }

    .btn-reset-zoom {
      width: 100%;
      height: 34px;
      margin-top: 0.25rem;
      align-self: stretch;
    }
  }
}

.chart-html-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem 0.75rem;
  padding: 0.5rem;
  margin-top: 0.5rem;
  max-height: 120px;
  overflow-y: auto;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding-top: 0.75rem;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background-color: var(--border-color);
    border-radius: 4px;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
    color: var(--text-secondary);
    background-color: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.04);
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-sm);
    
    .legend-color-box {
      width: 10px;
      height: 10px;
      border-radius: 3px;
      flex-shrink: 0;
    }

    .legend-label-text {
      font-weight: 500;
    }

    .legend-value-text {
      font-weight: 700;
      color: var(--text-primary);
      margin-left: 0.15rem;
    }
  }
}
</style>
