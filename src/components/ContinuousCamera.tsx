import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  X, 
  Zap, 
  ZapOff, 
  Undo2, 
  Image as ImageIcon, 
  Camera as CameraIcon, 
  Check, 
  RotateCw 
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

export interface ContinuousCameraProps {
  isOpen: boolean;
  targetTitle: string;
  onClose: () => void;
  onCapturePhoto: (file: File) => Promise<{ id: string; url?: string; localBlobId?: string } | null>;
  onUndoPhoto: (photoId: string) => Promise<void>;
  onOpenGallery: () => void;
  onOpenSystemCamera: () => void;
  onErrorFallback: (errorMsg: string) => void;
}

interface SessionPhoto {
  id: string;
  previewUrl: string;
}

export const ContinuousCamera: React.FC<ContinuousCameraProps> = ({
  isOpen,
  targetTitle,
  onClose,
  onCapturePhoto,
  onUndoPhoto,
  onOpenGallery,
  onOpenSystemCamera,
  onErrorFallback,
}) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [sessionPhotos, setSessionPhotos] = useState<SessionPhoto[]>([]);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const captureQueueRef = useRef<{ file: File; tempUrl: string }[]>([]);
  const isQueueRunningRef = useRef(false);
  const sessionPhotosRef = useRef<SessionPhoto[]>([]);
  const previewUrlsToRevokeRef = useRef<string[]>([]);
  const historyPushedRef = useRef(false);

  // Mantener referencia actualizada de sessionPhotos
  useEffect(() => {
    sessionPhotosRef.current = sessionPhotos;
  }, [sessionPhotos]);

  // Detener todos los tracks de la cámara
  const stopTracks = useCallback(() => {
    if (videoTrackRef.current) {
      try {
        if (isTorchOn) {
          videoTrackRef.current.applyConstraints({
            advanced: [{ torch: false } as any]
          }).catch(() => {});
        }
      } catch (e) {
        // Ignorar error al apagar linterna
      }
      try {
        videoTrackRef.current.stop();
      } catch (e) {}
      videoTrackRef.current = null;
    }
    if (stream) {
      stream.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      setStream(null);
    }
  }, [stream, isTorchOn]);

  // Iniciar stream de getUserMedia
  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      onErrorFallback('Tu dispositivo o navegador no admite acceso directo a la cámara.');
      return;
    }

    setIsInitializing(true);
    try {
      stopTracks();

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      const videoTrack = mediaStream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error('No se detectó pista de video en el dispositivo.');
      }

      videoTrackRef.current = videoTrack;
      setStream(mediaStream);

      // Comprobar soporte de linterna (torch)
      try {
        const capabilities: any = typeof videoTrack.getCapabilities === 'function' 
          ? videoTrack.getCapabilities() 
          : {};
        if (capabilities && capabilities.torch) {
          setHasTorch(true);
        } else {
          setHasTorch(false);
        }
      } catch (capErr) {
        setHasTorch(false);
      }

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play().catch(() => {});
      }
      setIsInitializing(false);
    } catch (err: any) {
      console.error('Error al inicializar cámara continua:', err);
      stopTracks();
      setIsInitializing(false);
      const isPermissionDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      const msg = isPermissionDenied
        ? 'Permiso de cámara denegado. Abriendo cámara del sistema...'
        : 'No se pudo acceder a la cámara continua. Abriendo cámara del sistema...';
      onErrorFallback(msg);
    }
  }, [stopTracks, onErrorFallback]);

  // Alternar linterna
  const toggleTorch = async () => {
    if (!videoTrackRef.current || !hasTorch) return;
    const nextState = !isTorchOn;
    try {
      await videoTrackRef.current.applyConstraints({
        advanced: [{ torch: nextState } as any]
      });
      setIsTorchOn(nextState);
    } catch (err) {
      console.warn('Error alternando linterna:', err);
    }
  };

  // Procesar cola secuencial de fotos capturadas
  const processNextInQueue = useCallback(async () => {
    if (isQueueRunningRef.current || captureQueueRef.current.length === 0) {
      return;
    }

    isQueueRunningRef.current = true;
    setIsProcessing(true);

    const item = captureQueueRef.current.shift();
    if (!item) {
      isQueueRunningRef.current = false;
      setIsProcessing(false);
      return;
    }

    try {
      const result = await onCapturePhoto(item.file);
      if (result) {
        const newPhotoItem: SessionPhoto = {
          id: result.id,
          previewUrl: item.tempUrl
        };
        setSessionPhotos(prev => [...prev, newPhotoItem]);
      } else {
        // En caso de que falle, revocar la URL temporal
        URL.revokeObjectURL(item.tempUrl);
      }
    } catch (err) {
      console.error('Error procesando foto capturada en cola:', err);
      URL.revokeObjectURL(item.tempUrl);
    } finally {
      isQueueRunningRef.current = false;
      if (captureQueueRef.current.length > 0) {
        // Continuar de una en una con la siguiente foto
        processNextInQueue();
      } else {
        setIsProcessing(false);
      }
    }
  }, [onCapturePhoto]);

  // Capturar fotograma de la cámara (ImageCapture o Canvas fallback)
  const captureFrame = async () => {
    if (isInitializing) return;

    // 1. Retroalimentación inmediata: destello y vibración
    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 80);

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(15);
      } catch (e) {}
    }

    let photoBlob: Blob | null = null;

    // A. Intento 1: ImageCapture.takePhoto() si existe en el entorno
    if (videoTrackRef.current && (window as any).ImageCapture) {
      try {
        const imageCapture = new (window as any).ImageCapture(videoTrackRef.current);
        photoBlob = await imageCapture.takePhoto();
      } catch (icErr) {
        console.warn('ImageCapture falló, usando canvas fallback:', icErr);
        photoBlob = null;
      }
    }

    // B. Intento 2: Canvas frame grab
    if (!photoBlob && videoRef.current) {
      const video = videoRef.current;
      const width = video.videoWidth || 1920;
      const height = video.videoHeight || 1080;

      if (width > 0 && height > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, width, height);
          photoBlob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(
              (b) => resolve(b),
              'image/jpeg',
              0.92
            );
          });
        }
      }
    }

    if (!photoBlob) {
      console.warn('No se pudo capturar el fotograma de la cámara');
      return;
    }

    // Crear File y URL de vista previa rápida
    const fileName = `foto_${Date.now()}_${uuidv4().slice(0, 6)}.jpg`;
    const file = new File([photoBlob], fileName, { type: 'image/jpeg' });
    const tempUrl = URL.createObjectURL(photoBlob);
    previewUrlsToRevokeRef.current.push(tempUrl);

    // Encolar y procesar de una en una
    captureQueueRef.current.push({ file, tempUrl });
    processNextInQueue();
  };

  // Deshacer la última foto tomada en esta sesión
  const handleUndoLast = async () => {
    const list = sessionPhotosRef.current;
    if (list.length === 0) return;

    const lastPhoto = list[list.length - 1];
    setSessionPhotos(prev => prev.slice(0, -1));

    try {
      await onUndoPhoto(lastPhoto.id);
    } catch (err) {
      console.warn('Error al deshacer foto:', err);
    } finally {
      URL.revokeObjectURL(lastPhoto.previewUrl);
    }
  };

  // Botón Atrás de Android (Integración con Historial de navegación)
  useEffect(() => {
    if (!isOpen) return;

    // Empujar estado en historial para que el botón atrás cierre la cámara
    window.history.pushState({ continuousCameraOpen: true }, '');
    historyPushedRef.current = true;

    const handlePopState = (e: PopStateEvent) => {
      // Si el usuario presionó Atrás en Android
      historyPushedRef.current = false;
      onClose();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isOpen, onClose]);

  // Manejo de ciclo de vida (visibilidad de pestaña/app en segundo plano)
  useEffect(() => {
    if (!isOpen) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Apagar cámara en segundo plano
        stopTracks();
      } else if (document.visibilityState === 'visible') {
        // Volver a encender al regresar
        startCamera();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isOpen, startCamera, stopTracks]);

  // Montar cámara al abrir
  useEffect(() => {
    if (isOpen) {
      setSessionPhotos([]);
      startCamera();
    } else {
      stopTracks();
      // Revocar URLs de previsualización al cerrar
      previewUrlsToRevokeRef.current.forEach(url => {
        try { URL.revokeObjectURL(url); } catch (e) {}
      });
      previewUrlsToRevokeRef.current = [];
    }

    return () => {
      stopTracks();
    };
  }, [isOpen, startCamera, stopTracks]);

  // Cierre controlado
  const handleClose = () => {
    if (historyPushedRef.current) {
      historyPushedRef.current = false;
      window.history.back();
    }
    stopTracks();
    onClose();
  };

  if (!isOpen) return null;

  const lastPhoto = sessionPhotos[sessionPhotos.length - 1];
  const photoCount = sessionPhotos.length;

  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col justify-between select-none overflow-hidden touch-none">
      {/* Destello blanco en cada disparo */}
      {isFlashing && (
        <div className="absolute inset-0 bg-white/70 z-30 pointer-events-none transition-opacity duration-75" />
      )}

      {/* Video Viewfinder */}
      <div className="absolute inset-0 z-0 flex items-center justify-center bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover"
        />
        {isInitializing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 text-white gap-3">
            <RotateCw size={32} className="animate-spin text-amber-500" />
            <p className="text-xs font-semibold tracking-wide">Iniciando cámara continua...</p>
          </div>
        )}
      </div>

      {/* Barra Superior */}
      <div className="relative z-20 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent text-white pt-[max(env(safe-area-inset-top),12px)]">
        <div className="flex flex-col min-w-0 pr-2">
          <span className="text-xs font-bold truncate tracking-tight text-white/90">
            {targetTitle}
          </span>
          <span className="text-[11px] font-mono text-amber-400 font-bold">
            {photoCount === 0 ? '0 fotos tomadas' : `${photoCount} ${photoCount === 1 ? 'foto tomada' : 'fotos tomadas'}`}
            {isProcessing && <span className="ml-1 text-[10px] text-white/60 animate-pulse">(guardando...)</span>}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasTorch && (
            <button
              type="button"
              onClick={toggleTorch}
              className={`p-2.5 rounded-full backdrop-blur-md transition-all active:scale-95 cursor-pointer ${
                isTorchOn 
                  ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/30' 
                  : 'bg-white/15 hover:bg-white/25 text-white'
              }`}
              title={isTorchOn ? 'Apagar linterna' : 'Encender linterna'}
            >
              {isTorchOn ? <Zap size={18} /> : <ZapOff size={18} />}
            </button>
          )}

          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 active:scale-95 transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
          >
            <Check size={14} className="stroke-[3]" />
            <span>Listo</span>
          </button>
        </div>
      </div>

      {/* Barra Inferior de Controles */}
      <div className="relative z-20 px-4 py-6 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex flex-col gap-4 pb-[max(env(safe-area-inset-bottom),20px)]">
        {/* Fila principal: Miniatura/Deshacer, Obturador y Alternativas */}
        <div className="flex items-center justify-between max-w-md mx-auto w-full px-2">
          {/* Lado izquierdo: Miniatura con Deshacer */}
          <div className="w-16 h-16 flex items-center justify-center">
            {lastPhoto ? (
              <div className="relative group">
                <img
                  src={lastPhoto.previewUrl}
                  alt="Última foto"
                  className="w-13 h-13 rounded-xl object-cover border-2 border-white shadow-md"
                />
                <button
                  type="button"
                  onClick={handleUndoLast}
                  className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg transition-transform active:scale-90 cursor-pointer"
                  title="Deshacer última foto"
                >
                  <Undo2 size={12} className="stroke-[2.5]" />
                </button>
              </div>
            ) : (
              <div className="w-12 h-12 rounded-xl border border-white/20 bg-white/5 flex items-center justify-center text-white/30 text-[9px] font-bold text-center">
                Sin fotos
              </div>
            )}
          </div>

          {/* Centro: Botón de Disparo Grande */}
          <button
            type="button"
            disabled={isInitializing}
            onClick={captureFrame}
            className="relative w-20 h-20 rounded-full border-4 border-white flex items-center justify-center transition-all active:scale-90 hover:opacity-95 shadow-2xl cursor-pointer disabled:opacity-40"
            aria-label="Tomar fotografía"
          >
            <div className="w-16 h-16 rounded-full bg-white transition-all active:bg-amber-400" />
          </button>

          {/* Lado derecho: Accesos Rápidos (Galería y Cámara del sistema) */}
          <div className="w-16 flex flex-col items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                onOpenGallery();
              }}
              className="p-2.5 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 text-white transition-all cursor-pointer"
              title="Abrir galería de fotos"
            >
              <ImageIcon size={18} />
            </button>
            <button
              type="button"
              onClick={() => {
                handleClose();
                setTimeout(() => onOpenSystemCamera(), 100);
              }}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white/80 transition-all cursor-pointer"
              title="Usar cámara del sistema"
            >
              <CameraIcon size={14} />
            </button>
          </div>
        </div>

        {/* Indicación inferior sutil */}
        <p className="text-[11px] text-center text-white/60 font-medium">
          Toca el obturador para capturar fotos seguidas sin interrupción
        </p>
      </div>
    </div>
  );
};
