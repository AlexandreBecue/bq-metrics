<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { RefreshCw, X } from '@lucide/vue'

const {
  offlineReady,
  needRefresh,
  updateServiceWorker,
} = useRegisterSW()

const close = () => {
  offlineReady.value = false
  needRefresh.value = false
}
</script>

<template>
  <Transition name="fade-slide">
    <div v-if="offlineReady || needRefresh" class="pwa-toast glass" role="alert">
      <div class="pwa-toast-content">
        <div class="pwa-toast-icon">
          <RefreshCw class="animate-spin-slow" />
        </div>
        <div class="pwa-toast-message">
          <span v-if="offlineReady">L'application est prête à être utilisée hors-ligne.</span>
          <span v-else>Une mise à jour est disponible pour bq-metrics.</span>
        </div>
      </div>
      <div class="pwa-toast-actions">
        <button v-if="needRefresh" class="btn-update" @click="updateServiceWorker(true)">
          Mettre à jour
        </button>
        <button class="btn-close" @click="close" aria-label="Fermer">
          <X :size="18" />
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
.pwa-toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 1rem 1.25rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  max-width: 420px;

  @media (max-width: 992px) {
    right: 16px;
    left: 16px;
    bottom: 80px; /* Positioned above the mobile bottom navigation bar */
    max-width: calc(100vw - 32px);
    gap: 1rem;
  }
}

.pwa-toast-content {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.pwa-toast-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(59, 130, 246, 0.15);
  color: var(--color-primary);
  flex-shrink: 0;
}

.animate-spin-slow {
  animation: spin 8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.pwa-toast-message {
  font-size: 0.9rem;
  color: var(--text-primary);
  font-weight: 500;
  line-height: 1.4;
}

.pwa-toast-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-update {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  border-radius: var(--radius-md);
  transition: var(--transition);
  cursor: pointer;
  padding: 0.45rem 0.9rem;
  font-size: 0.85rem;
  background: var(--color-primary);
  color: #ffffff;
  border: none;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  white-space: nowrap;
  
  &:hover {
    background: var(--color-primary-hover);
    transform: translateY(-1px);
  }
  
  &:active {
    transform: translateY(0);
  }
}

.btn-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-muted);
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 50%;
  transition: var(--transition);
  cursor: pointer;
  
  &:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-primary);
  }
}

/* Vue Transitions */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}
</style>
