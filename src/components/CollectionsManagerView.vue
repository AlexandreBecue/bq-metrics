<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { db, generateId, type CollectionSchema, type FieldConfig, type FieldType } from '../db';
import { Plus, Trash2, Edit2, Check, X, FileText, Settings, ChevronUp, ChevronDown, GripVertical } from '@lucide/vue';

const emit = defineEmits(['data-updated']);

const collections = ref<CollectionSchema[]>([]);
const isEditing = ref(false);
const editingCollection = ref<CollectionSchema | null>(null);

// Form States
const formName = ref('');
const formDesc = ref('');
const formFields = ref<FieldConfig[]>([]);
const formPrimaryFieldKey = ref('');

const isDraggingEnabled = ref(false);
const draggedIndex = ref<number | null>(null);

const moveFieldUp = (index: number) => {
  if (index <= 0) return;
  const fields = [...formFields.value];
  const [moved] = fields.splice(index, 1);
  fields.splice(index - 1, 0, moved);
  formFields.value = fields;
};

const moveFieldDown = (index: number) => {
  if (index >= formFields.value.length - 1) return;
  const fields = [...formFields.value];
  const [moved] = fields.splice(index, 1);
  fields.splice(index + 1, 0, moved);
  formFields.value = fields;
};

const onDragStart = (event: DragEvent, index: number) => {
  draggedIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', index.toString());
  }
};

const onDragOver = (event: DragEvent) => {
  event.preventDefault();
};

const onDragEnter = (index: number) => {
  if (draggedIndex.value !== null && draggedIndex.value !== index) {
    const fields = [...formFields.value];
    const [moved] = fields.splice(draggedIndex.value, 1);
    fields.splice(index, 0, moved);
    formFields.value = fields;
    draggedIndex.value = index;
  }
};

const onDragEnd = () => {
  draggedIndex.value = null;
  isDraggingEnabled.value = false;
};

// Field editor temp states
const fieldTypes: { value: FieldType; label: string }[] = [
  { value: 'number', label: 'Nombre' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Case à cocher (Oui/Non)' },
  { value: 'select', label: 'Liste de choix (Menu déroulant)' },
  { value: 'text', label: 'Texte libre' },
  { value: 'tags', label: 'Tags / Mots-clés (Multi-sélection)' },
  { value: 'relation', label: 'Liaison vers une autre fiche (Relation)' }
];

const loadCollections = async () => {
  const rawCols = await db.collections.toArray();
  collections.value = rawCols
    .filter(c => !c.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
};

onMounted(() => {
  loadCollections();
});

const startCreate = () => {
  editingCollection.value = null;
  formName.value = '';
  formDesc.value = '';
  formFields.value = [
    { id: generateId(), name: 'Date', key: 'date', type: 'date', required: true }
  ];
  formPrimaryFieldKey.value = 'date';
  isEditing.value = true;
};

const startEdit = (col: CollectionSchema) => {
  editingCollection.value = col;
  formName.value = col.name;
  formDesc.value = col.description || '';
  // Clone fields to avoid mutating live DB object
  const clonedFields: FieldConfig[] = JSON.parse(JSON.stringify(col.fields));
  clonedFields.forEach(f => {
    if (f.type === 'select') {
      (f as any)._optionsText = f.options ? f.options.join(', ') : '';
    }
  });
  formFields.value = clonedFields;
  formPrimaryFieldKey.value = col.primaryFieldKey;
  isEditing.value = true;
};

const addField = () => {
  const newId = generateId();
  formFields.value.push({
    id: newId,
    name: 'Nouveau champ',
    key: `field_${newId}`,
    type: 'text',
    required: false
  });
};

const removeField = (index: number) => {
  formFields.value.splice(index, 1);
};

// Auto-generates keys from field name (slugify)
const updateFieldKey = (field: FieldConfig) => {
  field.key = field.name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9_]/g, '_')     // replace spaces/chars with underscores
    .replace(/__+/g, '_')            // collapse duplicates
    .replace(/^_+|_+$/g, '');        // trim underscores
};

const updateFieldOptionsText = (field: FieldConfig) => {
  if (field.type === 'select') {
    const rawText = (field as any)._optionsText || '';
    field.options = rawText
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
  }
};

const handleSave = async () => {
  if (!formName.value.trim()) return;
  
  // Guard: Validate all formulas before saving
  for (const f of formFields.value) {
    if (f.isCalculated) {
      const valRes = checkFormula(f.formula, f.key, formFields.value);
      if (valRes.isError) {
        alert(`Impossible d'enregistrer : La formule du champ "${f.name}" comporte une erreur :\n\n${valRes.message}`);
        return;
      }
    }
  }

  const colId = editingCollection.value?.id || `col-${generateId()}`;
  
  // Ensure every field has options array if it's select
  formFields.value.forEach(f => {
    if (f.type === 'select') {
      if ((f as any)._optionsText !== undefined) {
        const rawText = (f as any)._optionsText || '';
        f.options = rawText
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
      }
      if (!f.options || f.options.length === 0) {
        f.options = ['Choix 1', 'Choix 2'];
      }
    }
  });

  const schema: CollectionSchema = {
    id: colId,
    name: formName.value.trim(),
    description: formDesc.value.trim(),
    fields: formFields.value,
    primaryFieldKey: formPrimaryFieldKey.value || formFields.value[0]?.key || 'title',
    createdAt: editingCollection.value?.createdAt || Date.now(),
    updatedAt: Date.now()
  };

  try {
    const rawSchema = JSON.parse(JSON.stringify(schema));
    if (editingCollection.value) {
      await db.collections.put(rawSchema);
    } else {
      await db.collections.add(rawSchema);
    }
    
    isEditing.value = false;
    await loadCollections();
    emit('data-updated');
  } catch (err) {
    console.error('Erreur lors de la sauvegarde du modèle:', err);
  }
};

interface FormulaValidationResult {
  isValid: boolean;
  isError: boolean;
  isWarning?: boolean;
  message: string;
}

const checkFormula = (formula: string | undefined, currentKey: string, fields: FieldConfig[]): FormulaValidationResult => {
  if (!formula || !formula.trim()) {
    return { isValid: false, isError: false, message: 'La formule est vide.' };
  }

  // 1. Accolades matching check
  const openCount = (formula.match(/\{/g) || []).length;
  const closeCount = (formula.match(/\}/g) || []).length;
  if (openCount !== closeCount) {
    return { isValid: false, isError: true, message: 'Nombre d\'accolades ouvrantes et fermantes asymétrique.' };
  }

  // 2. Extract variables
  const varRegex = /\{([a-zA-Z0-9_]+)\}/g;
  const variables: string[] = [];
  let match;
  while ((match = varRegex.exec(formula)) !== null) {
    variables.push(match[1]);
  }

  // 3. Existence & Self-reference safety check
  for (const v of variables) {
    const targetField = fields.find(f => f.key === v);
    if (!targetField) {
      return { isValid: false, isError: true, message: `Le champ référencé {${v}} n'existe pas dans la structure actuelle.` };
    }
  }

  // If there is a direct self-reference, verify that it does not undergo any math calculation or function calls
  if (variables.includes(currentKey)) {
    const cleanFormula = formula.replace(/\s+/g, '');
    const selfRefToken = `{${currentKey}}`;
    
    // Check for math operations
    const operatorRegex = new RegExp(`[\\+\\-\\*\\/%\\^]${selfRefToken}|${selfRefToken}[\\+\\-\\*\\/%\\^]`);
    if (operatorRegex.test(cleanFormula)) {
      return { 
        isValid: false, 
        isError: true, 
        message: `Dépendance circulaire : Le champ auto-référencé {${currentKey}} ne doit pas subir d'opérations mathématiques (+, -, *, /, %).` 
      };
    }
    
    // Check for function usage
    const funcRegex = new RegExp(`\\b(TIME_TO_SEC|SEC_TO_TIME|SEC_TO_PACE|SPEED)\\([^\\)]*${selfRefToken}[^\\)]*\\)`);
    if (funcRegex.test(cleanFormula)) {
      return { 
        isValid: false, 
        isError: true, 
        message: `Dépendance circulaire : Le champ auto-référencé {${currentKey}} ne doit pas être utilisé comme paramètre de fonction.` 
      };
    }
  }

  // 4. Nested Dependency Check with Conditional Cycle Detection
  const depMap: Record<string, string[]> = {};
  fields.forEach(f => {
    if (f.isCalculated && f.formula) {
      const vars: string[] = [];
      let m;
      const re = /\{([a-zA-Z0-9_]+)\}/g;
      while ((m = re.exec(f.formula)) !== null) {
        vars.push(m[1]);
      }
      depMap[f.key] = vars;
    }
  });

  // Cycle path finding
  const cycleFields: string[] = [];
  const visited = new Set<string>();
  const findCyclePath = (key: string, startKey: string): boolean => {
    if (visited.has(key)) {
      if (key === startKey) return true;
      return false;
    }
    visited.add(key);
    const deps = depMap[key] || [];
    for (const d of deps) {
      if (d !== currentKey) { // Ignore direct self-references as they are handled in step 3
        if (d === startKey || findCyclePath(d, startKey)) {
          cycleFields.push(key);
          return true;
        }
      }
    }
    visited.delete(key);
    return false;
  };

  depMap[currentKey] = variables;
  const hasCycle = findCyclePath(currentKey, currentKey);

  if (hasCycle) {
    // Analyze if the cycle is conditionally safe
    let allConditional = true;
    for (const fKey of cycleFields) {
      const field = fields.find(f => f.key === fKey);
      const fFormula = field?.formula || '';
      const isConditional = fFormula.includes('?') || fFormula.includes('||') || fFormula.includes('??');
      if (!isConditional) {
        allConditional = false;
        break;
      }
    }

    if (allConditional) {
      return { 
        isValid: false, 
        isError: false, // DO NOT block saving!
        isWarning: true, 
        message: '⚠️ Dépendance croisée conditionnelle : Assure-toi que tes conditions d\'estimation s\'excluent mutuellement au runtime pour éviter les boucles de calcul.' 
      };
    } else {
      return { 
        isValid: false, 
        isError: true, // Blocks saving!
        message: 'Dépendance circulaire détectée : Boucle de calcul infinie sans condition d\'échappement.' 
      };
    }
  }

  // 5. Syntax checking via dummy evaluator
  let expr = formula;
  for (const v of variables) {
    const targetField = fields.find(f => f.key === v);
    const dummyVal = targetField?.type === 'number' ? '1' : '"abc"';
    expr = expr.replaceAll(`{${v}}`, dummyVal);
  }

  try {
    const dummyTIME_TO_SEC = () => 1;
    const dummySEC_TO_TIME = () => '00:00:01';
    const dummySEC_TO_PACE = () => '05:00';
    const dummySPEED = () => 12;

    const evaluator = new Function(
      'TIME_TO_SEC', 'SEC_TO_TIME', 'SEC_TO_PACE', 'SPEED',
      `return (${expr});`
    );
    evaluator(dummyTIME_TO_SEC, dummySEC_TO_TIME, dummySEC_TO_PACE, dummySPEED);
  } catch (err: any) {
    return { isValid: false, isError: true, message: `Erreur de syntaxe : ${err.message}` };
  }

  return { isValid: true, isError: false, message: 'Formule valide.' };
};

const getValidationClass = (field: FieldConfig, fields: FieldConfig[]) => {
  const res = checkFormula(field.formula, field.key, fields);
  if (res.isValid) return 'valid';
  if (res.isError) return 'error';
  return 'empty';
};

const getValidationMessage = (field: FieldConfig, fields: FieldConfig[]) => {
  const res = checkFormula(field.formula, field.key, fields);
  return res.message;
};

const handleDelete = async (colId: string) => {
  if (!confirm('Attention : Supprimer ce modèle supprimera définitivement toutes les données saisies associées. Confirmer ?')) {
    return;
  }
  
  try {
    await db.transaction('rw', [db.collections, db.records, db.views, db.templates], async () => {
      const now = Date.now();
      
      // 1. Soft delete the collection schema
      const col = await db.collections.get(colId);
      if (col) {
        col.deletedAt = now;
        col.updatedAt = now;
        await db.collections.put(col);
      }
      
      // 2. Soft delete all records of this collection
      const recs = await db.records.where('collectionId').equals(colId).toArray();
      for (const r of recs) {
        r.deletedAt = now;
        r.updatedAt = now;
        await db.records.put(r);
      }
      
      // 3. Soft delete all views of this collection
      const vws = await db.views.where('collectionId').equals(colId).toArray();
      for (const v of vws) {
        v.deletedAt = now;
        v.updatedAt = now;
        await db.views.put(v);
      }

      // 4. Soft delete all templates of this collection
      const temps = await db.templates.where('collectionId').equals(colId).toArray();
      for (const t of temps) {
        t.deletedAt = now;
        t.updatedAt = now;
        await db.templates.put(t);
      }
    });
    
    await loadCollections();
    emit('data-updated');
  } catch (err) {
    console.error('Erreur lors de la suppression:', err);
  }
};
</script>

<template>
  <div class="collections-manager fade-in">
    <!-- View Header -->
    <div class="view-header" v-if="!isEditing">
      <div>
        <h1>Modèles de données</h1>
        <p class="subtitle">Crée, modifie et configure la structure de tes tableurs personnalisés.</p>
      </div>
      <button @click="startCreate" class="btn btn-primary">
        <Plus class="btn-icon" />
        Créer un modèle
      </button>
    </div>

    <!-- Edit/Create Form View -->
    <div class="edit-mode-container" v-else>
      <div class="form-header">
        <h2>{{ editingCollection ? 'Modifier le modèle' : 'Créer un nouveau modèle' }}</h2>
        <div class="form-actions-top">
          <button @click="handleSave" class="btn btn-primary" :disabled="!formName.trim()">
            <Check class="btn-icon" /> Enregistrer le modèle
          </button>
          <button @click="isEditing = false" class="btn btn-secondary">
            <X class="btn-icon" /> Annuler
          </button>
        </div>
      </div>

      <div class="form-grid">
        <!-- Sidebar config -->
        <div class="card glass metadata-card">
          <h3>Infos générales</h3>
          <div class="form-group">
            <label for="colName">Nom du modèle</label>
            <input id="colName" v-model="formName" type="text" class="form-control" placeholder="Ex: Finances" />
          </div>
          <div class="form-group">
            <label for="colDesc">Description</label>
            <textarea id="colDesc" v-model="formDesc" class="form-control" rows="3" placeholder="À quoi sert ce modèle ?"></textarea>
          </div>
          <div class="form-group">
            <label for="colPrimary">Champ titre principal</label>
            <p class="field-tip">Champ utilisé pour identifier chaque ligne dans les menus déroulants et tableaux.</p>
            <select id="colPrimary" v-model="formPrimaryFieldKey" class="form-control">
              <option v-for="f in formFields" :key="f.id" :value="f.key">
                {{ f.name || 'Sans titre' }}
              </option>
            </select>
          </div>
        </div>

        <!-- Field Builder -->
        <div class="card glass fields-builder-card">
          <div class="builder-header">
            <h3>Structure des champs</h3>
            <button @click="addField" class="btn btn-secondary btn-sm">
              <Plus class="btn-icon" /> Ajouter un champ
            </button>
          </div>

          <div class="fields-list">
            <div v-if="formFields.length === 0" class="empty-fields">
              <Settings class="empty-icon" />
              <p>Aucun champ configuré. Ajoute un champ pour démarrer.</p>
            </div>
            
            <div 
              v-for="(field, index) in formFields" 
              :key="field.id" 
              class="field-item"
              :class="{ 'is-dragging': draggedIndex === index }"
              :draggable="isDraggingEnabled"
              @dragstart="onDragStart($event, index)"
              @dragover="onDragOver($event)"
              @dragenter="onDragEnter(index)"
              @dragend="onDragEnd"
            >
              <div class="field-row">
                <!-- Left Order Column -->
                <div class="field-order-controls">
                  <div 
                    class="drag-handle" 
                    title="Glisser pour réordonner"
                    @mousedown="isDraggingEnabled = true"
                    @mouseup="isDraggingEnabled = false"
                  >
                    <GripVertical class="icon-drag" />
                  </div>
                  <div class="divider-order"></div>
                  <button 
                    @click="moveFieldUp(index)" 
                    :disabled="index === 0" 
                    class="btn-order" 
                    title="Monter le champ"
                    type="button"
                  >
                    <ChevronUp class="icon-order" />
                  </button>
                  <button 
                    @click="moveFieldDown(index)" 
                    :disabled="index === formFields.length - 1" 
                    class="btn-order" 
                    title="Descendre le champ"
                    type="button"
                  >
                    <ChevronDown class="icon-order" />
                  </button>
                </div>

                <!-- Main Field Builder Area -->
                <div class="field-main-content">
                  <div class="field-inputs-grid">
                    <!-- Field label name -->
                    <div class="form-group mb-0">
                      <label>Nom du champ</label>
                      <input v-model="field.name" @input="updateFieldKey(field)" type="text" class="form-control" placeholder="Ex: Prix (€), Date" />
                    </div>
                    
                    <!-- Field database key -->
                    <div class="form-group mb-0">
                      <label>Identifiant (clé)</label>
                      <input v-model="field.key" type="text" class="form-control" placeholder="auto-gen" disabled />
                    </div>
                    
                    <!-- Field Type -->
                    <div class="form-group mb-0">
                      <label>Type de donnée</label>
                      <select v-model="field.type" class="form-control">
                        <option v-for="t in fieldTypes" :key="t.value" :value="t.value">{{ t.label }}</option>
                      </select>
                    </div>

                    <!-- Required Switch & Remove -->
                    <div class="field-options-actions">
                      <label class="required-checkbox">
                        <input type="checkbox" v-model="field.required" />
                        <span>Requis</span>
                      </label>
                      <button @click="removeField(index)" class="btn-icon-only text-danger" title="Supprimer ce champ" type="button">
                        <Trash2 class="icon-trash" />
                      </button>
                    </div>
                  </div>

                  <!-- Options Config (Only for 'select' type) -->
                  <div v-if="field.type === 'select'" class="select-options-config">
                    <label>Options disponibles (séparées par des virgules)</label>
                    <input 
                      type="text" 
                      v-model="(field as any)._optionsText"
                      @input="updateFieldOptionsText(field)"
                      class="form-control btn-sm" 
                      placeholder="Ex: Option 1, Option 2, Option 3"
                    />
                  </div>

                  <!-- Unit Config (Only for 'number' type) -->
                  <div v-if="field.type === 'number'" class="unit-config">
                    <label>Unité à afficher après la valeur (optionnelle)</label>
                    <input 
                      v-model="field.unit"
                      type="text" 
                      class="form-control btn-sm" 
                      placeholder="Ex: €, kg, km/h..."
                    />
                  </div>

                  <!-- Relation Config (Only for 'relation' type) -->
                  <div v-if="field.type === 'relation'" class="relation-config">
                    <div class="form-group mb-2">
                      <label>Collection cible</label>
                      <select v-model="field.relatedCollectionId" class="form-control btn-sm">
                        <option value="">-- Sélectionner la collection cible --</option>
                        <option v-for="col in collections" :key="col.id" :value="col.id">
                          {{ col.name }}
                        </option>
                      </select>
                    </div>
                    <div class="mt-2">
                      <label class="required-checkbox">
                        <input type="checkbox" v-model="field.isMultiple" />
                        <span>Sélection multiple (Plusieurs lignes liées / Liaison N-N)</span>
                      </label>
                    </div>
                  </div>

                  <!-- Formula Config (Only for calculated fields) -->
                  <div class="formula-config">
                    <label class="required-checkbox">
                      <input type="checkbox" v-model="field.isCalculated" />
                      <span>Champ calculé (formule automatique)</span>
                    </label>
                    <div v-if="field.isCalculated" class="formula-input-sub mt-2">
                      <input 
                        v-model="field.formula" 
                        type="text" 
                        class="form-control btn-sm" 
                        placeholder="Ex: {id_champ_1} + {id_champ_2}"
                      />
                      
                      <div class="formula-validation" :class="getValidationClass(field, formFields)">
                        <span v-if="getValidationClass(field, formFields) === 'valid'">✅</span>
                        <span v-else-if="getValidationClass(field, formFields) === 'error'">❌</span>
                        <span v-else>ℹ️</span>
                        <span>{{ getValidationMessage(field, formFields) }}</span>
                      </div>

                      <p class="field-tip mt-1">
                        Utilise les clés des champs entre accolades (ex: <code>{id_champ_1}</code>). <br/>
                        Fonctions dispo : <code>SPEED(dist, sec)</code>, <code>TIME_TO_SEC(time)</code>, <code>SEC_TO_PACE(sec, dist)</code>, <code>SEC_TO_TIME(sec)</code>.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Collections Grid (Standard View) -->
    <div class="collections-grid" v-if="!isEditing">
      <div v-if="collections.length === 0" class="empty-state card glass">
        <Database class="empty-icon-main" />
        <h3>Aucun modèle créé</h3>
        <p>Commence par créer un modèle de données pour organiser tes finances, loisirs ou autre.</p>
        <button @click="startCreate" class="btn btn-primary">
          Créer mon premier modèle
        </button>
      </div>

      <div v-else v-for="col in collections" :key="col.id" class="card glass hoverable col-card">
        <div class="col-main">
          <div class="col-icon-container">
            <FileText class="col-icon" />
          </div>
          <div class="col-details">
            <h3>{{ col.name }}</h3>
            <p class="col-desc">{{ col.description || 'Aucune description disponible.' }}</p>
            <div class="col-badge-list">
              <span class="badge badge-primary">
                {{ col.fields.length }} champs
              </span>
            </div>
          </div>
        </div>
        
        <div class="col-actions">
          <button @click="startEdit(col)" class="btn btn-secondary btn-sm">
            <Edit2 class="icon-btn" /> Modifier
          </button>
          <button @click="handleDelete(col.id)" class="btn btn-danger btn-sm">
            <Trash2 class="icon-btn" /> Supprimer
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.collections-manager {
  max-width: 1400px;
  margin: 0 auto;
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2.5rem;
  gap: 1.5rem;
  
  @media (max-width: 768px) {
    flex-direction: column;
    align-items: flex-start;
  }
  
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

/* Edit Mode Layout */
.edit-mode-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 1rem;
  gap: 1.5rem;
  
  @media (max-width: 768px) {
    flex-direction: column;
    align-items: flex-start;
  }
  
  h2 {
    font-size: 1.75rem;
    font-weight: 800;
  }
  
  .form-actions-top {
    display: flex;
    gap: 0.75rem;
  }
}

.form-grid {
  display: grid;
  grid-template-columns: 350px 1fr;
  gap: 1.5rem;
  align-items: flex-start;
  
  @media (max-width: 992px) {
    grid-template-columns: 1fr;
  }
}

.metadata-card {
  h3 {
    margin-bottom: 1.25rem;
    font-size: 1.1rem;
    font-weight: 700;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 0.5rem;
  }
  
  .field-tip {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-bottom: 0.5rem;
    line-height: 1.3;
  }
}

.fields-builder-card {
  .builder-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 0.5rem;
    
    h3 {
      font-size: 1.1rem;
      font-weight: 700;
    }
  }
}

.fields-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.empty-fields {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  color: var(--text-muted);
  text-align: center;
  
  .empty-icon {
    width: 48px;
    height: 48px;
    stroke-width: 1.5;
    margin-bottom: 1rem;
  }
}

.field-item {
  background-color: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  transition: var(--transition);
  
  &:hover {
    border-color: rgba(255, 255, 255, 0.15);
  }
}

.field-inputs-grid {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1.25fr auto;
  gap: 1rem;
  align-items: flex-end;
  
  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
}

.mb-0 {
  margin-bottom: 0 !important;
}

.field-options-actions {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  height: 2.75rem; /* matches form input height */
  justify-content: flex-end;
  
  @media (max-width: 768px) {
    justify-content: space-between;
    width: 100%;
    margin-top: 0.25rem;
  }
}

.required-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  
  input {
    width: 16px;
    height: 16px;
    accent-color: var(--color-primary);
  }
}

.btn-icon-only {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: var(--radius-sm);
  transition: var(--transition);
  display: flex;
  align-items: center;
  justify-content: center;
  
  &:hover {
    background-color: rgba(239, 68, 68, 0.1);
  }
  
  .icon-trash {
    width: 18px;
    height: 18px;
  }
}

.select-options-config {
  background-color: rgba(255, 255, 255, 0.01);
  border-top: 1px dashed var(--border-color);
  padding-top: 0.75rem;
  margin-top: 0.25rem;
  
  label {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 0.35rem;
  }
}

.unit-config, .relation-config {
  background-color: rgba(255, 255, 255, 0.01);
  border-top: 1px dashed var(--border-color);
  padding-top: 0.75rem;
  margin-top: 0.25rem;
  
  label:not(.required-checkbox) {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 0.35rem;
  }
}

/* Reordering & Drag styles */
.field-item {
  transition: transform 0.2s ease, opacity 0.2s ease, border-color 0.2s ease;
  
  &.is-dragging {
    opacity: 0.4;
    border-style: dashed;
    border-color: var(--color-primary);
    background-color: rgba(59, 130, 246, 0.05);
  }
}

.field-row {
  display: flex;
  gap: 1.25rem;
  align-items: stretch;
  width: 100%;
}

.field-order-controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 0.35rem;
  width: 36px;
  flex-shrink: 0;
}

.drag-handle {
  color: var(--text-muted);
  cursor: grab;
  padding: 0.35rem;
  border-radius: var(--radius-xs);
  transition: var(--transition);
  display: flex;
  align-items: center;
  justify-content: center;
  
  &:hover {
    background-color: rgba(255, 255, 255, 0.08);
    color: var(--color-primary);
  }
  
  &:active {
    cursor: grabbing;
  }
}

.icon-drag {
  width: 18px;
  height: 18px;
}

.divider-order {
  width: 100%;
  height: 1px;
  background-color: var(--border-color);
  margin: 0.25rem 0;
}

.btn-order {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0.35rem;
  border-radius: var(--radius-xs);
  transition: var(--transition);
  display: flex;
  align-items: center;
  justify-content: center;
  
  &:hover:not(:disabled) {
    background-color: rgba(255, 255, 255, 0.08);
    color: var(--color-primary);
  }
  
  &:disabled {
    color: var(--text-muted);
    opacity: 0.25;
    cursor: not-allowed;
  }
}

.icon-order {
  width: 16px;
  height: 16px;
}

.field-main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

/* Collections Grid Layout */
.collections-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 1.5rem;
  
  @media (max-width: 480px) {
    grid-template-columns: 1fr;
  }
}

.empty-state {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  text-align: center;
  
  .empty-icon-main {
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
    margin-bottom: 1.5rem;
    max-width: 400px;
  }
}

.col-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 1.5rem;
  
  .col-main {
    display: flex;
    gap: 1.25rem;
  }
  
  .col-icon-container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    border-radius: var(--radius-md);
    background-color: rgba(59, 130, 246, 0.1);
    color: var(--color-primary);
    flex-shrink: 0;
  }
  
  .col-icon {
    width: 24px;
    height: 24px;
  }
  
  .col-details {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    
    h3 {
      font-size: 1.25rem;
      font-weight: 700;
    }
    
    .col-desc {
      font-size: 0.9rem;
      color: var(--text-secondary);
      line-height: 1.4;
    }
    
    .col-badge-list {
      display: flex;
      margin-top: 0.5rem;
    }
  }
  
  .col-actions {
    display: flex;
    gap: 0.75rem;
    border-top: 1px solid var(--border-color);
    padding-top: 1rem;
    justify-content: flex-end;
  }
}

.icon-btn {
  width: 14px;
  height: 14px;
}

.formula-config {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--border-color);
}

.formula-input-sub {
  background-color: rgba(0, 0, 0, 0.15);
  padding: 0.75rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
}

.formula-validation {
  font-size: 0.8rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.6rem;
  border-radius: var(--radius-sm);
  margin-top: 0.5rem;
  line-height: 1.4;
  text-align: left;
  
  &.valid {
    color: var(--color-success);
    background-color: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.15);
  }
  
  &.error {
    color: var(--color-danger);
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.15);
  }
  
  &.empty {
    color: var(--text-muted);
    background-color: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--border-color);
  }
}

.mt-2 {
  margin-top: 0.5rem;
}
.mt-1 {
  margin-top: 0.25rem;
}
</style>
