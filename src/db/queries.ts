import { type RecordEntry, type SavedFilter } from './index';

/**
 * Evaluates whether a record matches a list of filters based on the logical operator (AND / OR).
 */
export function evaluateFilters(
  record: RecordEntry,
  filters: SavedFilter[],
  logicalOperator: 'and' | 'or' = 'and'
): boolean {
  if (filters.length === 0) return true;

  const results = filters.map(filter => {
    const value = record.data[filter.fieldKey];
    let target = filter.value;

    // Resolve relative date terms for chronological filtering
    if (typeof target === 'string') {
      const today = new Date();
      const format = (d: Date) => d.toISOString().split('T')[0];
      
      if (target === 'TODAY') {
        target = format(today);
      } else if (target === 'CURRENT_YEAR_START') {
        target = `${today.getFullYear()}-01-01`;
      } else if (target === 'CURRENT_MONTH_START') {
        const m = String(today.getMonth() + 1).padStart(2, '0');
        target = `${today.getFullYear()}-${m}-01`;
      } else if (target === 'LAST_30_DAYS') {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        target = format(d);
      } else if (target === 'LAST_7_DAYS') {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        target = format(d);
      }
    }

    switch (filter.operator) {
      case 'eq':
        return String(value).toLowerCase() === String(target).toLowerCase();
      case 'neq':
        return String(value).toLowerCase() !== String(target).toLowerCase();
      case 'gt':
        if (!isNaN(Number(value)) && !isNaN(Number(target)) && value !== '' && target !== '') {
          return Number(value) > Number(target);
        }
        return String(value) > String(target);
      case 'gte':
        if (!isNaN(Number(value)) && !isNaN(Number(target)) && value !== '' && target !== '') {
          return Number(value) >= Number(target);
        }
        return String(value) >= String(target);
      case 'lt':
        if (!isNaN(Number(value)) && !isNaN(Number(target)) && value !== '' && target !== '') {
          return Number(value) < Number(target);
        }
        return String(value) < String(target);
      case 'lte':
        if (!isNaN(Number(value)) && !isNaN(Number(target)) && value !== '' && target !== '') {
          return Number(value) <= Number(target);
        }
        return String(value) <= String(target);
      case 'contains':
        return String(value || '').toLowerCase().includes(String(target).toLowerCase());
      case 'not_contains':
        return !String(value || '').toLowerCase().includes(String(target).toLowerCase());
      case 'in_tags':
        if (Array.isArray(value)) {
          return value.some(tag => String(tag).toLowerCase() === String(target).toLowerCase());
        }
        if (typeof value === 'string') {
          return value.toLowerCase().includes(String(target).toLowerCase());
        }
        return false;
      case 'is_empty':
        return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
      case 'is_not_empty':
        return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
      default:
        return true;
    }
  });

  if (logicalOperator === 'or') {
    return results.some(r => r === true);
  } else {
    return results.every(r => r === true);
  }
}

/**
 * Performs custom in-memory aggregation for charting.
 * Groups records by a given X axis key, and aggregates a Y axis key.
 */
export function aggregateData(
  records: RecordEntry[],
  xAxisKey: string,
  yAxisKey: string,
  aggregateType: 'sum' | 'avg' | 'count' | 'monthly_avg' | 'balance'
): { label: string; value: number }[] {
  if (aggregateType === 'balance') {
    // Specialized financial double-entry bookkeeping balance aggregator
    const groups: Record<string, number> = {};

    records.forEach(rec => {
      const type = rec.data.type; // "Entrée", "Sortie", "Interne"
      const yVal = Number(rec.data[yAxisKey]);
      const validYVal = isNaN(yVal) ? 0 : yVal;
      
      const label = String(rec.data[xAxisKey] || 'N/A');

      if (!groups[label]) {
        groups[label] = 0;
      }

      if (type === 'Entrée') {
        groups[label] += validYVal;
      } else if (type === 'Sortie') {
        groups[label] -= validYVal;
      } else if (type === 'Interne') {
        // Source account loses funds
        groups[label] -= validYVal;

        // Destination account gains funds
        const destination = String(rec.data.partenaire || '');
        if (destination && destination !== 'N/A') {
          if (!groups[destination]) {
            groups[destination] = 0;
          }
          groups[destination] += validYVal;
        }
      } else {
        // Fallback standard aggregation behavior (add up)
        groups[label] += validYVal;
      }
    });

    return Object.entries(groups).map(([label, value]) => ({
      label,
      value: Math.round(value * 100) / 100
    }));
  }

  const groups: Record<string, number[]> = {};

  // If monthly_avg, count the unique months (YYYY-MM) present in the entire filtered records list
  const uniqueMonths = new Set<string>();
  if (aggregateType === 'monthly_avg') {
    records.forEach(rec => {
      Object.values(rec.data).forEach(val => {
        if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
          uniqueMonths.add(val.substring(0, 7)); // extracts "YYYY-MM"
        }
      });
    });
  }
  const monthCount = Math.max(1, uniqueMonths.size);

  // Group values
  records.forEach(rec => {
    const rawXVal = rec.data[xAxisKey];
    // Formatter for dates or tags to look nice as X labels
    let label = 'N/A';
    if (rawXVal !== undefined && rawXVal !== null) {
      if (Array.isArray(rawXVal)) {
        label = rawXVal.join(', ');
      } else {
        label = String(rawXVal);
      }
    }

    const yVal = Number(rec.data[yAxisKey]);
    const validYVal = isNaN(yVal) ? 0 : yVal;

    if (!groups[label]) {
      groups[label] = [];
    }
    groups[label].push(validYVal);
  });

  // Aggregate groups
  const result = Object.entries(groups).map(([label, values]) => {
    let value = 0;
    if (aggregateType === 'count') {
      value = values.length;
    } else if (aggregateType === 'sum') {
      value = values.reduce((sum, v) => sum + v, 0);
    } else if (aggregateType === 'avg') {
      const sum = values.reduce((sum, v) => sum + v, 0);
      value = values.length > 0 ? sum / values.length : 0;
    } else if (aggregateType === 'monthly_avg') {
      const sum = values.reduce((sum, v) => sum + v, 0);
      value = sum / monthCount;
    }

    // Round to 2 decimals
    value = Math.round(value * 100) / 100;

    return { label, value };
  });

  // Sort result chronologically for ISO dates, alphabetically/numerically for other labels
  const dateRegex = /^\d{4}-\d{2}(-\d{2})?$/;
  result.sort((a, b) => {
    if (dateRegex.test(a.label) && dateRegex.test(b.label)) {
      return a.label.localeCompare(b.label);
    }
    return a.label.localeCompare(b.label, 'fr', { numeric: true, sensitivity: 'base' });
  });

  return result;
}

/**
 * Formats an ISO Date (YYYY-MM-DD) into a friendly French textual date (e.g. "samedi 25 octobre 2014")
 */
export function formatToFrenchDate(dateStr: string): string {
  if (!dateStr) return '';
  // Check if it matches YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  
  try {
    const parsed = new Date(dateStr + 'T00:00:00'); // Force local timezone
    if (isNaN(parsed.getTime())) return dateStr;
    
    const formatted = parsed.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    
    // Capitalize first letter (e.g. "Samedi 25 octobre 2014")
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  } catch (e) {
    return dateStr;
  }
}

/**
 * Evaluates a math or running formula in real-time based on current fields.
 */
export function evaluateFormula(formula: string, data: Record<string, any>): any {
  if (!formula) return '';
  
  let expr = formula;
  const varRegex = /\{([a-zA-Z0-9_]+)\}/g;
  let match;
  
  // 1. Replace variables with actual values
  while ((match = varRegex.exec(formula)) !== null) {
    const key = match[1];
    const val = data[key];
    const replacement = val !== undefined && val !== null ? (typeof val === 'string' ? `"${val}"` : val) : '0';
    expr = expr.replaceAll(`{${key}}`, String(replacement));
  }

  // 2. Predefined runners and calculator helpers
  const TIME_TO_SEC = (timeStr: any) => {
    if (!timeStr) return 0;
    const parts = String(timeStr).split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  };

  const SEC_TO_TIME = (secVal: any) => {
    const sec = Math.round(Number(secVal) || 0);
    if (sec <= 0) return '00:00:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
  };

  const SEC_TO_PACE = (secVal: any, distVal: any) => {
    const sec = Number(secVal) || 0;
    const dist = Number(distVal) || 0;
    if (dist <= 0 || sec <= 0) return '--:--';
    const totalMin = sec / 60;
    const paceDec = totalMin / dist;
    const paceMin = Math.floor(paceDec);
    const paceSec = Math.round((paceDec - paceMin) * 60);
    return `${String(paceMin).padStart(2, '0')}:${String(paceSec).padStart(2, '0')}`;
  };

  const SPEED = (distVal: any, secVal: any) => {
    const dist = Number(distVal) || 0;
    const sec = Number(secVal) || 0;
    if (sec <= 0 || dist <= 0) return 0;
    const hrs = sec / 3600;
    const speedVal = dist / hrs;
    return Math.round(speedVal * 100) / 100;
  };

  // 3. Sandboxed dynamic execution
  try {
    const evaluator = new Function(
      'TIME_TO_SEC', 'SEC_TO_TIME', 'SEC_TO_PACE', 'SPEED',
      `try { return (${expr}); } catch(e) { return ''; }`
    );
    const result = evaluator(TIME_TO_SEC, SEC_TO_TIME, SEC_TO_PACE, SPEED);
    
    // Round numeric results to 2 decimal places automatically
    if (typeof result === 'number' && !isNaN(result)) {
      return Math.round(result * 100) / 100;
    }
    return result;
  } catch (err) {
    return '';
  }
}
