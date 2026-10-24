import React from 'react';
import { 
  Cloud, 
  CloudUpload, 
  Check, 
  AlertTriangle, 
  RefreshCw,
  WifiOff
} from 'lucide-react';

export interface SyncStatusChipProps {
  isOnline: boolean;
  isLimitedMode: boolean;
  isReadingFromCache: boolean;
  pendingPhotosCount: number;
  isSyncing: boolean;
  hasQuotaError: boolean;
  hasStorageError: boolean;
  onClick: () => void;
}

export const SyncStatusChip: React.FC<SyncStatusChipProps> = ({
  isOnline,
  isLimitedMode,
  isReadingFromCache,
  pendingPhotosCount,
  isSyncing,
  hasQuotaError,
  hasStorageError,
  onClick,
}) => {
  const isError = hasQuotaError || hasStorageError;
  const isOffline = !isOnline;
  const showDot = isLimitedMode || isReadingFromCache || isOffline;

  // Determinar variante visual del chip (36-40 px)
  let content: React.ReactNode = null;
  let containerStyles = '';
  let tooltipText = '';

  if (isError) {
    // 1. Rojo con "!" (atención requerida)
    containerStyles = 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-900/60 shadow-sm';
    tooltipText = hasQuotaError 
      ? 'Límite de Firebase alcanzado (requiere atención)' 
      : 'Límite de almacenamiento de fotos (requiere atención)';
    content = (
      <div className="relative flex items-center justify-center">
        <Cloud size={18} className="shrink-0" />
        <span className="absolute -top-1 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-600 text-[9px] font-black text-white leading-none shadow-sm animate-pulse">
          !
        </span>
      </div>
    );
  } else if (isSyncing) {
    // 2. Azul con giro mientras sube
    containerStyles = 'bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-900/60 shadow-sm';
    tooltipText = 'Subiendo fotos...';
    content = (
      <div className="relative flex items-center justify-center">
        <Cloud size={18} className="shrink-0 text-blue-500 opacity-60" />
        <RefreshCw size={11} className="absolute inset-0 m-auto text-blue-600 animate-spin" />
      </div>
    );
  } else if (pendingPhotosCount > 0) {
    // 3. Ámbar con número de fotos pendientes
    containerStyles = 'bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900/60 shadow-sm';
    tooltipText = `${pendingPhotosCount} fotos pendientes de subir`;
    content = (
      <div className="relative flex items-center justify-center">
        <CloudUpload size={17} className="shrink-0" />
        <span className="absolute -top-1 -right-2 min-w-[15px] h-[15px] px-1 flex items-center justify-center rounded-full bg-amber-500 text-[9px] font-black text-white leading-none shadow-xs">
          {pendingPhotosCount > 99 ? '99+' : pendingPhotosCount}
        </span>
      </div>
    );
  } else {
    // 4. Gris con check cuando todo está sincronizado
    containerStyles = 'bg-black/5 hover:bg-black/10 text-neutral-500 hover:text-black dark:bg-white/5 dark:hover:bg-white/10 dark:text-neutral-400 dark:hover:text-white border border-transparent';
    tooltipText = 'Todo sincronizado';
    content = (
      <div className="relative flex items-center justify-center">
        <Cloud size={18} className="shrink-0 opacity-70" />
        <Check size={10} className="absolute -bottom-0.5 -right-1 text-emerald-600 dark:text-emerald-400 stroke-[3]" />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltipText}
      aria-label={tooltipText}
      className={`relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0 ${containerStyles}`}
    >
      {content}

      {/* Punto indicador para modo limitado o sin conexión */}
      {showDot && (
        <span 
          className={`absolute bottom-1 right-1 w-2 h-2 rounded-full border border-white dark:border-black ${
            isOffline ? 'bg-neutral-500' : 'bg-amber-500 animate-pulse'
          }`} 
          title={isOffline ? 'Sin conexión a Internet' : 'Modo limitado: datos guardados en el teléfono'}
        />
      )}
    </button>
  );
};
