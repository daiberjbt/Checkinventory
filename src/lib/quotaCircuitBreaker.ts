/**
 * Circuit Breaker y detección de cuota agotada (resource-exhausted) para Firestore y Storage.
 * Mantiene dos interruptores completamente independientes con ventana de 30 minutos,
 * sincronizados a través de localStorage y BroadcastChannel.
 */

const FIRESTORE_COOLDOWN_KEY = 'checkinventory_firestore_quota_cooldown_until';
const STORAGE_COOLDOWN_KEY = 'checkinventory_storage_quota_cooldown_until';
const COOLDOWN_DURATION_MS = 30 * 60 * 1000; // 30 minutos

export function isFirestoreQuotaError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as any;
  const code = String(anyErr?.code || '').toLowerCase();
  const message = String(anyErr?.message || anyErr || '').toLowerCase();

  // Si es un error explícito de Firebase Storage, pertenece al breaker de Storage
  if (code.startsWith('storage/')) {
    return false;
  }

  if (code === 'resource-exhausted' || code === 'functions/resource-exhausted') {
    return true;
  }

  // Comprobar mensaje de Firestore
  if (message.includes('quota') || message.includes('resource-exhausted') || message.includes('quota exceeded') || message.includes('daily limit')) {
    return true;
  }

  return false;
}

export function isStorageQuotaError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as any;
  const code = String(anyErr?.code || '').toLowerCase();
  const message = String(anyErr?.message || anyErr || '').toLowerCase();

  if (code.startsWith('storage/')) {
    if (code === 'storage/quota-exceeded' || code === 'storage/retry-limit-exceeded' || message.includes('quota') || message.includes('limit')) {
      return true;
    }
  }

  // Detección complementaria por mensaje en contexto de subida
  if ((message.includes('storage') || code.includes('storage')) && (message.includes('quota') || message.includes('exceeded'))) {
    return true;
  }

  return false;
}

export function isQuotaError(err: unknown): boolean {
  return isFirestoreQuotaError(err) || isStorageQuotaError(err);
}

// ==========================================
// Interruptor Independiente de FIRESTORE
// ==========================================

type BreakerListener = (active: boolean) => void;
const firestoreListeners = new Set<BreakerListener>();
let firestoreExpiryTimer: any = null;

function getStoredTimestamp(key: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(key);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function setStoredTimestamp(key: string, value: number): void {
  if (typeof window === 'undefined') return;
  try {
    if (value > 0) {
      localStorage.setItem(key, String(value));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage quota or access issues
  }
}

function scheduleFirestoreExpiry(remainingMs: number) {
  if (firestoreExpiryTimer) {
    clearTimeout(firestoreExpiryTimer);
    firestoreExpiryTimer = null;
  }
  if (remainingMs > 0) {
    firestoreExpiryTimer = setTimeout(() => {
      setStoredTimestamp(FIRESTORE_COOLDOWN_KEY, 0);
      notifyFirestoreListeners(false);
    }, remainingMs + 50);
  }
}

function notifyFirestoreListeners(active: boolean) {
  firestoreListeners.forEach((listener) => {
    try {
      listener(active);
    } catch (e) {
      console.warn('Error en listener de Firestore Breaker:', e);
    }
  });
}

export function isFirestoreCircuitBreakerActive(): boolean {
  const until = getStoredTimestamp(FIRESTORE_COOLDOWN_KEY);
  const now = Date.now();
  if (until > now) {
    return true;
  }
  if (until > 0 && until <= now) {
    // Ya expiró
    setStoredTimestamp(FIRESTORE_COOLDOWN_KEY, 0);
  }
  return false;
}

export function getFirestoreRemainingCooldownMs(): number {
  const until = getStoredTimestamp(FIRESTORE_COOLDOWN_KEY);
  const now = Date.now();
  return Math.max(0, until - now);
}

export function tripFirestoreCircuitBreaker(err?: unknown): void {
  const now = Date.now();
  const until = now + COOLDOWN_DURATION_MS;
  setStoredTimestamp(FIRESTORE_COOLDOWN_KEY, until);
  console.warn('[CircuitBreaker] Firestore trip activado por 30 minutos. Motivo:', err);
  scheduleFirestoreExpiry(COOLDOWN_DURATION_MS);
  notifyFirestoreListeners(true);
}

export function resetFirestoreCircuitBreaker(): void {
  if (firestoreExpiryTimer) {
    clearTimeout(firestoreExpiryTimer);
    firestoreExpiryTimer = null;
  }
  setStoredTimestamp(FIRESTORE_COOLDOWN_KEY, 0);
  console.log('[CircuitBreaker] Firestore reset manual/reintento ejecutado');
  notifyFirestoreListeners(false);
}

export function onFirestoreCircuitBreakerChange(callback: BreakerListener): () => void {
  firestoreListeners.add(callback);
  // Programar expiración si actualmente está activo
  const remaining = getFirestoreRemainingCooldownMs();
  if (remaining > 0 && !firestoreExpiryTimer) {
    scheduleFirestoreExpiry(remaining);
  }
  return () => {
    firestoreListeners.delete(callback);
  };
}

// ==========================================
// Interruptor Independiente de STORAGE
// ==========================================

const storageListeners = new Set<BreakerListener>();
let storageExpiryTimer: any = null;

function scheduleStorageExpiry(remainingMs: number) {
  if (storageExpiryTimer) {
    clearTimeout(storageExpiryTimer);
    storageExpiryTimer = null;
  }
  if (remainingMs > 0) {
    storageExpiryTimer = setTimeout(() => {
      setStoredTimestamp(STORAGE_COOLDOWN_KEY, 0);
      notifyStorageListeners(false);
    }, remainingMs + 50);
  }
}

function notifyStorageListeners(active: boolean) {
  storageListeners.forEach((listener) => {
    try {
      listener(active);
    } catch (e) {
      console.warn('Error en listener de Storage Breaker:', e);
    }
  });
}

export function isStorageCircuitBreakerActive(): boolean {
  const until = getStoredTimestamp(STORAGE_COOLDOWN_KEY);
  const now = Date.now();
  if (until > now) {
    return true;
  }
  if (until > 0 && until <= now) {
    setStoredTimestamp(STORAGE_COOLDOWN_KEY, 0);
  }
  return false;
}

export function getStorageRemainingCooldownMs(): number {
  const until = getStoredTimestamp(STORAGE_COOLDOWN_KEY);
  const now = Date.now();
  return Math.max(0, until - now);
}

export function tripStorageCircuitBreaker(err?: unknown): void {
  const now = Date.now();
  const until = now + COOLDOWN_DURATION_MS;
  setStoredTimestamp(STORAGE_COOLDOWN_KEY, until);
  console.warn('[CircuitBreaker] Storage trip activado por 30 minutos. Motivo:', err);
  scheduleStorageExpiry(COOLDOWN_DURATION_MS);
  notifyStorageListeners(true);
}

export function resetStorageCircuitBreaker(): void {
  if (storageExpiryTimer) {
    clearTimeout(storageExpiryTimer);
    storageExpiryTimer = null;
  }
  setStoredTimestamp(STORAGE_COOLDOWN_KEY, 0);
  console.log('[CircuitBreaker] Storage reset manual/reintento ejecutado');
  notifyStorageListeners(false);
}

export function onStorageCircuitBreakerChange(callback: BreakerListener): () => void {
  storageListeners.add(callback);
  const remaining = getStorageRemainingCooldownMs();
  if (remaining > 0 && !storageExpiryTimer) {
    scheduleStorageExpiry(remaining);
  }
  return () => {
    storageListeners.delete(callback);
  };
}

// Sincronización entre pestañas (storage event)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === FIRESTORE_COOLDOWN_KEY) {
      const active = isFirestoreCircuitBreakerActive();
      notifyFirestoreListeners(active);
    } else if (e.key === STORAGE_COOLDOWN_KEY) {
      const active = isStorageCircuitBreakerActive();
      notifyStorageListeners(active);
    }
  });
}
