import React, { useState, useEffect } from 'react';
import { Photo, OfflinePhotoRecord } from '../types';
import { getPhotoBlob, getPendingPhoto } from '../lib/offlinePhotoDb';
import { photoSyncEngine } from '../lib/photoSyncEngine';
import { Image as ImageIcon, Loader2, CloudUpload, AlertCircle } from 'lucide-react';

/**
 * Retorna la URL de alta resolución para visualización ampliada (modal / pantalla completa).
 * Prioriza la imagen completa original (url) antes de la miniatura.
 */
export async function getPhotoDisplayUrl(photo: Photo): Promise<string> {
  if (photo.url) return photo.url;
  if (photo.dataUrl) return photo.dataUrl;
  if (photo.thumbUrl) return photo.thumbUrl;
  if (photo.localBlobId) {
    try {
      const blob = await getPhotoBlob(photo.localBlobId);
      if (blob) return URL.createObjectURL(blob);
    } catch (e) {
      console.warn('[PhotoThumb] Error obteniendo blob para display URL:', e);
    }
  }
  return '';
}

interface PhotoThumbProps {
  photo: Photo;
  alt?: string;
  className?: string;
  onClick?: () => void;
  showSyncBadge?: boolean;
  preferFullResolution?: boolean;
}

export const PhotoThumb: React.FC<PhotoThumbProps> = ({
  photo,
  alt = 'Foto',
  className = '',
  onClick,
  showSyncBadge = true,
  preferFullResolution = false
}) => {
  // En cuadrícula/lista preferir thumbUrl para carga rápida; si no existe, usar url o dataUrl
  const initialSource = preferFullResolution
    ? (photo.url || photo.thumbUrl || photo.dataUrl || '')
    : (photo.thumbUrl || photo.url || photo.dataUrl || '');

  const [src, setSrc] = useState<string>(initialSource);
  const [loading, setLoading] = useState<boolean>(!src);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [offlineRecord, setOfflineRecord] = useState<OfflinePhotoRecord | null>(null);

  useEffect(() => {
    let isMounted = true;
    const targetId = photo.localBlobId || photo.id;
    if (!targetId || photo.url) {
      setOfflineRecord(null);
      return;
    }

    const loadRecord = async () => {
      try {
        const rec = await getPendingPhoto(targetId);
        if (isMounted) setOfflineRecord(rec);
      } catch (e) {
        // Ignorar
      }
    };

    loadRecord();

    const unsub = photoSyncEngine.subscribe((event) => {
      if (event.photoId === targetId || event.type === 'sync_finished') {
        loadRecord();
      }
    });

    const interval = setInterval(loadRecord, 30000);

    return () => {
      isMounted = false;
      unsub();
      clearInterval(interval);
    };
  }, [photo.localBlobId, photo.id, photo.url]);

  useEffect(() => {
    let isMounted = true;

    // Priorizar thumbUrl si es thumbnail y está disponible
    const chosenUrl = preferFullResolution
      ? (photo.url || photo.thumbUrl)
      : (photo.thumbUrl || photo.url);

    if (chosenUrl) {
      setSrc(chosenUrl);
      setLoading(false);
      return;
    }

    if (photo.dataUrl) {
      setSrc(photo.dataUrl);
      setLoading(false);
      return;
    }

    if (photo.localBlobId) {
      setLoading(true);
      getPhotoBlob(photo.localBlobId)
        .then((blob) => {
          if (!isMounted) return;
          if (blob) {
            const url = URL.createObjectURL(blob);
            setObjectUrl(url);
            setSrc(url);
          }
          setLoading(false);
        })
        .catch((err) => {
          console.warn('[PhotoThumb] No se pudo leer blob de IndexedDB:', err);
          if (isMounted) setLoading(false);
        });
    } else {
      setLoading(false);
    }

    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [photo.url, photo.thumbUrl, photo.dataUrl, photo.localBlobId, preferFullResolution]);

  const isFailed = offlineRecord?.status === 'failed';
  const isStalePending = Boolean(
    offlineRecord &&
    offlineRecord.status === 'pending' &&
    typeof navigator !== 'undefined' &&
    navigator.onLine &&
    (Date.now() - offlineRecord.createdAt > 10 * 60 * 1000)
  );

  const hasSyncError = isFailed || isStalePending;
  const syncErrorTooltip = offlineRecord?.lastError || (isStalePending ? 'Más de 10 minutos pendiente de sincronización con conexión activa' : 'Error al sincronizar foto');

  return (
    <div 
      className={`relative w-full h-full overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center ${className}`}
      onClick={onClick}
    >
      {loading ? (
        <div className="flex items-center justify-center w-full h-full text-neutral-400">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="flex items-center justify-center w-full h-full text-neutral-300">
          <ImageIcon size={20} />
        </div>
      )}

      {showSyncBadge && (photo.syncStatus === 'pending' || photo.syncStatus === 'uploading') && (
        hasSyncError ? (
          <div 
            className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-red-600 text-white text-[9px] font-bold flex items-center gap-1 shadow-sm cursor-help pointer-events-auto"
            title={syncErrorTooltip}
          >
            <AlertCircle size={10} className="shrink-0" />
            <span className="text-[8px] uppercase">Error</span>
          </div>
        ) : (
          <div 
            className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-xs text-white text-[9px] font-bold flex items-center gap-1 shadow-sm pointer-events-none"
            title={photo.syncStatus === 'uploading' ? 'Sincronizando foto...' : 'Foto guardada localmente (pendiente de sincronización)'}
          >
            <CloudUpload size={10} className={photo.syncStatus === 'uploading' ? 'animate-bounce' : 'opacity-80'} />
            <span className="text-[8px] uppercase">{photo.syncStatus === 'uploading' ? 'Subiendo' : 'Local'}</span>
          </div>
        )
      )}
    </div>
  );
};
