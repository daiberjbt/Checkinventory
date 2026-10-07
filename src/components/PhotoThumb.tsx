import React, { useState, useEffect } from 'react';
import { Photo } from '../types';
import { getPhotoBlob } from '../lib/offlinePhotoDb';
import { Image as ImageIcon, Loader2, CloudUpload } from 'lucide-react';

export async function getPhotoDisplayUrl(photo: Photo): Promise<string> {
  if (photo.url) return photo.url;
  if (photo.dataUrl) return photo.dataUrl;
  if (photo.localBlobId) {
    try {
      const blob = await getPhotoBlob(photo.localBlobId);
      if (blob) return URL.createObjectURL(blob);
    } catch (e) {
      console.warn('[PhotoThumb] Error fetching blob for display URL:', e);
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
}

export const PhotoThumb: React.FC<PhotoThumbProps> = ({
  photo,
  alt = 'Foto',
  className = '',
  onClick,
  showSyncBadge = true
}) => {
  const [src, setSrc] = useState<string>(() => {
    return photo.url || photo.dataUrl || '';
  });
  const [loading, setLoading] = useState<boolean>(!src);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    if (photo.url) {
      setSrc(photo.url);
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
          console.warn('[PhotoThumb] Could not load blob from IndexedDB:', err);
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
  }, [photo.url, photo.dataUrl, photo.localBlobId]);

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
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="flex items-center justify-center w-full h-full text-neutral-300">
          <ImageIcon size={20} />
        </div>
      )}

      {showSyncBadge && (photo.syncStatus === 'pending' || photo.syncStatus === 'uploading') && (
        <div 
          className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-xs text-white text-[9px] font-bold flex items-center gap-1 shadow-sm pointer-events-none"
          title={photo.syncStatus === 'uploading' ? 'Sincronizando foto...' : 'Foto guardada localmente (pendiente de sincronización)'}
        >
          <CloudUpload size={10} className={photo.syncStatus === 'uploading' ? 'animate-bounce' : 'opacity-80'} />
          <span className="text-[8px] uppercase">{photo.syncStatus === 'uploading' ? 'Subiendo' : 'Local'}</span>
        </div>
      )}
    </div>
  );
};
