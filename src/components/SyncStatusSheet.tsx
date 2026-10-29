import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Wifi, 
  WifiOff, 
  Cloud, 
  CloudUpload, 
  AlertTriangle, 
  Clock, 
  RotateCw, 
  Images, 
  Database,
  CheckCircle2,
  HardDrive,
  Trash2
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export interface OrphanPhotoGroup {
  inventoryId: string;
  count: number;
  oldestTimestamp: number;
}

export interface SyncStatusSheetProps {
  isOpen: boolean;
  onClose: () => void;
  isOnline: boolean;
  isLimitedMode: boolean;
  isReadingFromCache: boolean;
  pendingPhotosCount: number;
  lastErrorReason?: string | null;
  lastAttemptTimestamp?: number | null;
  hasFirestoreQuotaError: boolean;
  hasStorageQuotaError: boolean;
  onRetryNow: () => void;
  onViewPendingPhotos: () => void;
  isRetrying?: boolean;
  orphanPhotoGroups?: OrphanPhotoGroup[];
  onDiscardOrphanGroup?: (inventoryId: string) => void;
}

export const SyncStatusSheet: React.FC<SyncStatusSheetProps> = ({
  isOpen,
  onClose,
  isOnline,
  isLimitedMode,
  isReadingFromCache,
  pendingPhotosCount,
  lastErrorReason,
  lastAttemptTimestamp,
  hasFirestoreQuotaError,
  hasStorageQuotaError,
  onRetryNow,
  onViewPendingPhotos,
  isRetrying = false,
  orphanPhotoGroups = [],
  onDiscardOrphanGroup,
}) => {
  const [confirmingOrphanId, setConfirmingOrphanId] = useState<string | null>(null);

  if (!isOpen) return null;

  const formattedLastAttempt = lastAttemptTimestamp
    ? format(new Date(lastAttemptTimestamp), 'HH:mm:ss (dd/MM)', { locale: es })
    : null;

  // Motivo de error claro
  let resolvedError: string | null = null;
  if (hasFirestoreQuotaError) {
    resolvedError = 'Límite diario de Firebase alcanzado: la app sigue guardando en el teléfono y sincronizará después.';
  } else if (hasStorageQuotaError) {
    resolvedError = 'Límite de almacenamiento de fotos alcanzado: las fotos se guardan en el teléfono y se subirán después.';
  } else if (!isOnline) {
    resolvedError = 'Sin conexión a Internet: esperando reconexión.';
  } else if (lastErrorReason) {
    resolvedError = lastErrorReason;
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[120] flex items-end justify-center select-none">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
        />

        {/* Bottom Sheet Modal */}
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          className="relative w-full max-w-lg bg-white dark:bg-neutral-900 rounded-t-[2.5rem] shadow-2xl border-t border-black/10 dark:border-white/10 p-6 sm:p-8 space-y-6 z-10 max-h-[85vh] overflow-y-auto"
        >
          {/* Grab Handle */}
          <div className="w-12 h-1.5 bg-black/15 dark:bg-white/20 rounded-full mx-auto -mt-2 mb-2" />

          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-black/5 dark:border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-black/5 dark:bg-white/5 flex items-center justify-center text-black dark:text-white">
                <Cloud size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-black dark:text-white leading-tight">
                  Estado de Sincronización
                </h3>
                <p className="text-[11px] text-muted font-medium">
                  Información y respaldo en tu teléfono
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 text-muted hover:text-black dark:hover:text-white transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Estado de la Conexión y Base de Datos */}
          <div className="grid grid-cols-2 gap-3">
            {/* Conexión */}
            <div className={`p-4 rounded-2xl border flex flex-col justify-between ${
              isOnline 
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-300' 
                : 'bg-amber-50/70 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">Conexión</span>
                {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
              </div>
              <p className="text-xs font-bold">
                {isOnline ? 'En línea' : 'Sin conexión'}
              </p>
            </div>

            {/* Base de datos / Almacenamiento */}
            <div className={`p-4 rounded-2xl border flex flex-col justify-between ${
              hasFirestoreQuotaError || isLimitedMode || isReadingFromCache
                ? 'bg-amber-50/70 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300'
                : 'bg-neutral-50 border-neutral-200 text-neutral-800 dark:bg-neutral-800/60 dark:border-neutral-700 dark:text-neutral-200'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">Almacenamiento</span>
                {isLimitedMode || isReadingFromCache ? <HardDrive size={16} /> : <Database size={16} />}
              </div>
              <p className="text-xs font-bold leading-tight">
                {isLimitedMode ? 'Modo limitado' : isReadingFromCache ? 'Datos locales' : 'Base conectada'}
              </p>
            </div>
          </div>

          {/* Fotos pendientes */}
          <div className="bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/80 rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-black dark:text-white font-bold text-sm">
                <CloudUpload size={17} className={pendingPhotosCount > 0 ? 'text-amber-600' : 'text-emerald-600'} />
                <span>
                  {pendingPhotosCount === 0 
                    ? 'Todas las fotos sincronizadas' 
                    : `${pendingPhotosCount} ${pendingPhotosCount === 1 ? 'foto pendiente' : 'fotos pendientes'}`}
                </span>
              </div>
              {pendingPhotosCount === 0 && (
                <CheckCircle2 size={16} className="text-emerald-600" />
              )}
            </div>
            <p className="text-xs text-muted leading-relaxed">
              {pendingPhotosCount > 0 
                ? 'Se subirán cuando abras la app con conexión.' 
                : 'Tus fotos están resguardadas de manera segura.'}
            </p>
          </div>

          {/* Fotos sin inventario (huérfanas) */}
          {orphanPhotoGroups.length > 0 && (
            <div className="bg-red-50/70 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-red-900 dark:text-red-200 font-bold text-xs uppercase tracking-wider">
                  <Trash2 size={15} className="text-red-600" />
                  <span>Fotos sin inventario</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300">
                  {orphanPhotoGroups.reduce((acc, g) => acc + g.count, 0)} fotos
                </span>
              </div>
              <p className="text-xs text-red-800/80 dark:text-red-300/80 leading-relaxed">
                Fotografías en cola de inventarios descartados o que no existen en la base de datos.
              </p>
              <div className="space-y-2 pt-1">
                {orphanPhotoGroups.map((group) => {
                  const dateStr = format(new Date(group.oldestTimestamp), 'dd/MM/yyyy HH:mm', { locale: es });
                  const isConfirming = confirmingOrphanId === group.inventoryId;

                  return (
                    <div 
                      key={group.inventoryId}
                      className="bg-white dark:bg-neutral-900 border border-red-100 dark:border-red-900/30 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-xs"
                    >
                      <div>
                        <p className="text-xs font-bold text-black dark:text-white">
                          {group.count} {group.count === 1 ? 'foto huérfana' : 'fotos huérfanas'}
                        </p>
                        <p className="text-[10px] text-muted">
                          Tomadas el {dateStr}
                        </p>
                      </div>

                      {isConfirming ? (
                        <div className="flex items-center gap-1.5 self-end sm:self-auto">
                          <button
                            type="button"
                            onClick={() => setConfirmingOrphanId(null)}
                            className="px-2.5 py-1 text-[11px] font-semibold text-muted hover:text-black dark:hover:text-white rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (onDiscardOrphanGroup) {
                                onDiscardOrphanGroup(group.inventoryId);
                              }
                              setConfirmingOrphanId(null);
                            }}
                            className="px-2.5 py-1 text-[11px] font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
                          >
                            Confirmar descarte
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingOrphanId(group.inventoryId)}
                          className="self-end sm:self-auto px-2.5 py-1 text-[11px] font-bold text-red-600 dark:text-red-400 hover:bg-red-100/60 dark:hover:bg-red-900/30 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 size={12} />
                          <span>Descartar</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Último Error (si existe) */}
          {resolvedError && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800 text-amber-900 dark:text-amber-200 space-y-1">
              <div className="flex items-center gap-2 font-bold text-xs">
                <AlertTriangle size={15} className="shrink-0 text-amber-600" />
                <span>Estado de alerta</span>
              </div>
              <p className="text-xs font-medium leading-relaxed opacity-90 pl-5">
                {resolvedError}
              </p>
            </div>
          )}

          {/* Hora del último intento */}
          {formattedLastAttempt && (
            <div className="flex items-center gap-2 text-[11px] text-muted justify-center font-medium">
              <Clock size={13} />
              <span>Último intento: {formattedLastAttempt}</span>
            </div>
          )}

          {/* Botones de Acción */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              disabled={isRetrying}
              onClick={() => {
                onRetryNow();
              }}
              className="flex-1 py-3.5 px-4 rounded-2xl bg-black dark:bg-white text-white dark:text-black font-bold text-xs hover:bg-black/90 active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <RotateCw size={14} className={isRetrying ? 'animate-spin' : ''} />
              <span>{isRetrying ? 'Reintentando...' : 'Reintentar ahora'}</span>
            </button>

            {pendingPhotosCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onViewPendingPhotos();
                }}
                className="py-3.5 px-4 rounded-2xl bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 text-black dark:text-white font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Images size={14} />
                <span>Ver fotos pendientes</span>
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
