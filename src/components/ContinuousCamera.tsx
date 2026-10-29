import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { 
  X, 
  Zap, 
  ZapOff, 
  Undo2, 
  Image as ImageIcon, 
  Camera as CameraIcon, 
  Check, 
  AlertTriangle,
  Info
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

export interface ContinuousCameraProps {
  isOpen: boolean;
  target: { type: 'space' | 'annex'; spaceId?: string; spaceTitle?: string };
  onClose: () => void;
  onCapturePhoto: (file: File, capturedAt: number) => Promise<{ id: string; url?: string; localBlobId?: string } | null>;
  onUndoPhoto: (photoId: string) => Promise<void>;
  onOpenGallery: () => void;
  onOpenSystemCamera: () => void;
}

interface SessionPhoto {
  id: string;
  previewUrl: string;
}

interface DiagnosticInfo {
  streamStatus: 'iniciando' | 'lista' | 'error' | 'cerrada';
  resolution: string;
  attemptsCount: number;
  savedCount: number;
  queueLength: number;
  lastError: string;
}

const ContinuousCameraComponent: React.FC<ContinuousCameraProps> = ({
  isOpen,
  target,
  onClose,
  onCapturePhoto,
  onUndoPhoto,
  onOpenGallery,
  onOpenSystemCamera,
}) => {
  const [hasTorch, setHasTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [sessionPhotos, setSessionPhotos] = useState<SessionPhoto[]>([]);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [errorState, setErrorState] = useState<{ hasError: boolean; message: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'info' | 'warning' | 'error' } | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Diagnósticos
  const [diag, setDiag] = useState<DiagnosticInfo>({
    streamStatus: 'cerrada',
    resolution: '0x0',
    attemptsCount: 0,
    savedCount: 0,
    queueLength: 0,
    lastError: 'Ninguno'
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const wakeLockRef = useRef<any>(null);
  const watchdogTimerRef = useRef<any>(null);
  const longPressTimerRef = useRef<any>(null);
  const toastTimerRef = useRef<any>(null);

  // Cola de capturas
  const captureQueueRef = useRef<{ file: File; tempUrl: string; capturedAt: number }[]>([]);
  const isQueueRunningRef = useRef(false);
  const previewUrlsToRevokeRef = useRef<string[]>([]);
  const sessionPhotosRef = useRef<SessionPhoto[]>([]);

  useEffect(() => {
    sessionPhotosRef.current = sessionPhotos;
    setDiag(prev => ({ ...prev, savedCount: sessionPhotos.length }));
  }, [sessionPhotos]);

  const showToast = useCallback((text: string, type: 'info' | 'warning' | 'error' = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage({ text, type });
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3200);
  }, []);

  // Detener todos los tracks de hardware y liberar la cámara
  const stopTracks = useCallback(() => {
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }

    if (videoTrackRef.current) {
      try {
        if (isTorchOn) {
          videoTrackRef.current.applyConstraints({
            advanced: [{ torch: false } as any]
          }).catch(() => {});
        }
      } catch (e) {}
      try {
        videoTrackRef.current.stop();
      } catch (e) {}
      videoTrackRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      streamRef.current = null;
    }

    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch (e) {}
    }

    setIsCameraReady(false);
    setIsTorchOn(false);
    setHasTorch(false);
  }, [isTorchOn]);

  // Liberar WakeLock de pantalla
  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release().catch(() => {});
      } catch (e) {}
      wakeLockRef.current = null;
    }
  }, []);

  // Solicitar WakeLock para evitar suspensión de pantalla
  const requestWakeLock = useCallback(async () => {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && (navigator as any).wakeLock?.request) {
      try {
        const lock = await (navigator as any).wakeLock.request('screen');
        wakeLockRef.current = lock;
      } catch (e) {
        // Silencioso: en baterías bajas o permisos estrictos puede fallar
      }
    }
  }, []);

  // Iniciar la cámara continua
  const startCamera = useCallback(async () => {
    stopTracks();
    setErrorState(null);
    setIsCameraReady(false);
    setDiag(prev => ({ ...prev, streamStatus: 'iniciando' }));

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const msg = 'Tu dispositivo o navegador no admite acceso directo a la cámara.';
      setErrorState({ hasError: true, message: msg });
      setDiag(prev => ({ ...prev, streamStatus: 'error', lastError: msg }));
      return;
    }

    try {
      // 1. Solicitar stream de video
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      // El usuario ya concedió el permiso: AQUÍ empieza el watchdog de 4 segundos
      if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = setTimeout(() => {
        const v = videoRef.current;
        if (!v || v.readyState < 2 || v.videoWidth === 0) {
          console.warn('[ContinuousCamera] Watchdog de 4 s expirado: el sensor no entregó imagen.');
          stopTracks();
          const timeoutMsg = 'El sensor de la cámara no entregó imagen a tiempo (4 s). Puedes abrir la cámara del sistema.';
          setErrorState({ hasError: true, message: timeoutMsg });
          setDiag(prev => ({ ...prev, streamStatus: 'error', lastError: timeoutMsg }));
        }
      }, 4000);

      const videoTrack = mediaStream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error('No se detectó pista de video en el dispositivo.');
      }

      streamRef.current = mediaStream;
      videoTrackRef.current = videoTrack;

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
      } catch (e) {
        setHasTorch(false);
      }

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play().catch(() => {});
      }

      requestWakeLock();
    } catch (err: any) {
      console.error('[ContinuousCamera] Error al iniciar cámara:', err);
      stopTracks();
      const isPermissionDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      const msg = isPermissionDenied
        ? 'Permiso de cámara denegado. Puedes usar la cámara del sistema o la galería.'
        : `No se pudo iniciar la cámara (${err.name || err.message || 'Error desconocido'}).`;
      
      setErrorState({ hasError: true, message: msg });
      setDiag(prev => ({ ...prev, streamStatus: 'error', lastError: msg }));
    }
  }, [stopTracks, requestWakeLock]);

  // Manejador cuando el video ya tiene frames listos para mostrar
  const handleVideoCanPlay = useCallback(() => {
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    const v = videoRef.current;
    if (v && v.videoWidth > 0 && v.videoHeight > 0) {
      setIsCameraReady(true);
      setDiag(prev => ({ 
        ...prev, 
        streamStatus: 'lista', 
        resolution: `${v.videoWidth}x${v.videoHeight}` 
      }));
    }
  }, []);

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

  // Procesador secuencial de capturas (1 en 1)
  const processNextInQueue = useCallback(async () => {
    if (isQueueRunningRef.current || captureQueueRef.current.length === 0) {
      return;
    }

    isQueueRunningRef.current = true;
    setIsProcessing(true);

    const item = captureQueueRef.current.shift();
    setDiag(prev => ({ ...prev, queueLength: captureQueueRef.current.length }));

    if (!item) {
      isQueueRunningRef.current = false;
      setIsProcessing(false);
      return;
    }

    try {
      const result = await onCapturePhoto(item.file, item.capturedAt);
      if (result && result.id) {
        // ÉXITO: Solo aquí se agrega a las fotos de sesión y sube el contador
        setSessionPhotos(prev => [...prev, { id: result.id, previewUrl: item.tempUrl }]);
      } else {
        URL.revokeObjectURL(item.tempUrl);
        showToast('No se pudo guardar la fotografía', 'error');
        setDiag(prev => ({ ...prev, lastError: 'onCapturePhoto devolvió resultado nulo' }));
      }
    } catch (err: any) {
      console.error('[ContinuousCamera] Error guardando foto:', err);
      URL.revokeObjectURL(item.tempUrl);
      const errMsg = err?.message || 'Error al guardar la fotografía';
      showToast(errMsg, 'error');
      setDiag(prev => ({ ...prev, lastError: errMsg }));
    } finally {
      isQueueRunningRef.current = false;
      if (captureQueueRef.current.length > 0) {
        processNextInQueue();
      } else {
        setIsProcessing(false);
      }
    }
  }, [onCapturePhoto, showToast]);

  // Capturar fotograma exacto: UN TOQUE = UNA FOTO
  const captureFrame = async () => {
    const video = videoRef.current;

    // 1. Validar que el video esté listo y tenga dimensiones reales
    if (!video || video.readyState < 2 || video.videoWidth === 0 || !isCameraReady) {
      showToast('La cámara aún no está lista', 'warning');
      return;
    }

    // 2. Comprobar tope de 20 capturas en cola
    if (captureQueueRef.current.length >= 20) {
      showToast('Cola llena (máx. 20 fotos). Espera a que se guarden.', 'warning');
      return;
    }

    // 3. Momento exacto del disparo
    const capturedAt = Date.now();
    setDiag(prev => ({ ...prev, attemptsCount: prev.attemptsCount + 1 }));

    // 4. Captura inmediata vía Canvas (alta velocidad y estabilidad garantizada)
    const width = video.videoWidth;
    const height = video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      showToast('Error al inicializar canvas de captura', 'error');
      return;
    }

    ctx.drawImage(video, 0, 0, width, height);
    const photoBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.90);
    });

    // Validar blob no nulo y tamaño mayor a 0
    if (!photoBlob || photoBlob.size === 0) {
      showToast('La captura generó una imagen vacía', 'error');
      return;
    }

    // 5. Retroalimentación inmediata SOLO si la captura fue válida
    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 90);

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(15);
      } catch (e) {}
    }

    // 6. Crear archivo con timestamp exacto
    const fileName = `foto_${capturedAt}_${uuidv4().slice(0, 6)}.jpg`;
    const file = new File([photoBlob], fileName, { type: 'image/jpeg' });
    const tempUrl = URL.createObjectURL(photoBlob);
    previewUrlsToRevokeRef.current.push(tempUrl);

    // 7. Encolar y procesar secuencialmente
    captureQueueRef.current.push({ file, tempUrl, capturedAt });
    setDiag(prev => ({ ...prev, queueLength: captureQueueRef.current.length }));
    processNextInQueue();
  };

  // Deshacer la última foto tomada en esta sesión (borrado completo)
  const handleUndoLast = async () => {
    const list = sessionPhotosRef.current;
    if (list.length === 0) return;

    const lastPhoto = list[list.length - 1];
    setSessionPhotos(prev => prev.slice(0, -1));

    try {
      await onUndoPhoto(lastPhoto.id);
      showToast('Última fotografía eliminada', 'info');
    } catch (err: any) {
      console.warn('Error al deshacer foto:', err);
      showToast('No se pudo deshacer la fotografía', 'error');
    } finally {
      URL.revokeObjectURL(lastPhoto.previewUrl);
    }
  };

  // Ciclo de vida principal del componente: depende ÚNICAMENTE de isOpen
  useEffect(() => {
    if (!isOpen) {
      stopTracks();
      releaseWakeLock();
      // Revocar URLs temporales
      previewUrlsToRevokeRef.current.forEach(u => URL.revokeObjectURL(u));
      previewUrlsToRevokeRef.current = [];
      setSessionPhotos([]);
      return;
    }

    // Apertura limpia
    setSessionPhotos([]);
    startCamera();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stopTracks();
      } else if (document.visibilityState === 'visible') {
        startCamera();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopTracks();
      releaseWakeLock();
      previewUrlsToRevokeRef.current.forEach(u => URL.revokeObjectURL(u));
      previewUrlsToRevokeRef.current = [];
    };
  }, [isOpen, startCamera, stopTracks, releaseWakeLock]);

  // Manejadores para toque largo en contador (HUD de Diagnóstico)
  const handlePointerDownCounter = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      setShowDiagnostics(prev => !prev);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate(30); } catch (e) {}
      }
    }, 600);
  };

  const handlePointerUpCounter = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  if (!isOpen) return null;

  const targetTitle = target.spaceTitle || (target.type === 'annex' ? 'Anexo' : 'Espacio');
  const lastPhoto = sessionPhotos.length > 0 ? sessionPhotos[sessionPhotos.length - 1] : null;

  return (
    <div className="fixed inset-0 z-[140] bg-black text-white flex flex-col select-none overflow-hidden animate-in fade-in duration-200">
      {/* Destello de obturador */}
      {isFlashing && (
        <div className="absolute inset-0 bg-white z-[160] pointer-events-none opacity-85 transition-opacity" />
      )}

      {/* Toast flotante */}
      {toastMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[170] pointer-events-none max-w-[90vw]">
          <div className={`px-4 py-2 rounded-xl text-xs font-semibold shadow-2xl backdrop-blur-md flex items-center gap-2 ${
            toastMessage.type === 'error' ? 'bg-red-600/90 text-white' :
            toastMessage.type === 'warning' ? 'bg-amber-500/90 text-black' :
            'bg-neutral-800/90 text-white border border-white/10'
          }`}>
            {toastMessage.type === 'error' && <AlertTriangle size={14} />}
            {toastMessage.type === 'warning' && <AlertTriangle size={14} />}
            {toastMessage.type === 'info' && <Info size={14} />}
            <span>{toastMessage.text}</span>
          </div>
        </div>
      )}

      {/* HUD de Diagnóstico (toque largo en contador) */}
      {showDiagnostics && (
        <div className="absolute top-16 right-4 z-[165] bg-black/85 border border-white/20 p-3 rounded-2xl text-[10px] font-mono text-white/90 shadow-2xl backdrop-blur-md space-y-1 w-60">
          <div className="flex items-center justify-between border-b border-white/15 pb-1 mb-1 font-bold">
            <span className="text-amber-400">Diagnóstico de Cámara</span>
            <button 
              onClick={() => setShowDiagnostics(false)} 
              className="p-1 hover:text-white text-white/60"
            >
              <X size={12} />
            </button>
          </div>
          <div><span className="text-white/50">Stream:</span> {diag.streamStatus}</div>
          <div><span className="text-white/50">Resolución:</span> {diag.resolution}</div>
          <div><span className="text-white/50">Disparos:</span> {diag.attemptsCount} intentados</div>
          <div><span className="text-white/50">Guardadas:</span> {sessionPhotos.length} fotos</div>
          <div><span className="text-white/50">En cola:</span> {captureQueueRef.current.length} pendientes</div>
          <div className="truncate"><span className="text-white/50">Error:</span> {diag.lastError}</div>
        </div>
      )}

      {/* Vista de Error / Fallback interactiva */}
      {errorState?.hasError ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-sm mx-auto z-20">
          <div className="w-16 h-16 rounded-3xl bg-amber-500/20 text-amber-400 flex items-center justify-center mb-4">
            <AlertTriangle size={32} />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Cámara Continua no disponible</h3>
          <p className="text-xs text-white/70 leading-relaxed mb-8">{errorState.message}</p>

          <div className="w-full space-y-3">
            {/* Botón táctil directo que activa cameraInputRef sin bloqueo del navegador */}
            <button
              type="button"
              onClick={() => {
                stopTracks();
                onOpenSystemCamera();
                onClose();
              }}
              className="w-full py-4 px-6 rounded-2xl bg-amber-500 hover:bg-amber-400 text-black font-bold flex items-center justify-center gap-3 text-sm shadow-xl active:scale-95 transition-all cursor-pointer"
            >
              <CameraIcon size={20} />
              Abrir cámara del sistema
            </button>

            {/* Botón táctil directo para galería */}
            <button
              type="button"
              onClick={() => {
                stopTracks();
                onOpenGallery();
                onClose();
              }}
              className="w-full py-3.5 px-6 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-bold flex items-center justify-center gap-3 text-sm active:scale-95 transition-all cursor-pointer border border-white/10"
            >
              <ImageIcon size={18} />
              Abrir Galería
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 text-white/60 hover:text-white text-xs font-semibold cursor-pointer"
            >
              Volver al inventario
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Barra Superior */}
          <div className="relative z-30 flex items-center justify-between px-5 py-4 pt-safe bg-gradient-to-b from-black/80 via-black/40 to-transparent">
            <div 
              className="flex flex-col cursor-pointer select-none"
              onPointerDown={handlePointerDownCounter}
              onPointerUp={handlePointerUpCounter}
              onPointerLeave={handlePointerUpCounter}
              title="Mantén presionado para ver diagnóstico"
            >
              <span className="text-xs font-semibold text-white/70 uppercase tracking-wider truncate max-w-[180px]">
                {targetTitle}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">
                  {sessionPhotos.length} {sessionPhotos.length === 1 ? 'foto tomada' : 'fotos tomadas'}
                </span>
                {isProcessing && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" title="Guardando foto" />
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {hasTorch && (
                <button
                  type="button"
                  onClick={toggleTorch}
                  className={`p-2.5 rounded-full transition-all cursor-pointer ${
                    isTorchOn ? 'bg-amber-400 text-black shadow-lg shadow-amber-400/30' : 'bg-white/15 text-white hover:bg-white/25'
                  }`}
                  title={isTorchOn ? 'Apagar linterna' : 'Encender linterna'}
                >
                  {isTorchOn ? <Zap size={18} /> : <ZapOff size={18} />}
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-full bg-white/20 hover:bg-white/30 text-white text-xs font-bold flex items-center gap-1.5 backdrop-blur-md active:scale-95 transition-all cursor-pointer"
              >
                <Check size={14} className="stroke-[3]" />
                Listo
              </button>
            </div>
          </div>

          {/* Visor de Video */}
          <div className="relative flex-1 bg-black overflow-hidden flex items-center justify-center">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              onCanPlay={handleVideoCanPlay}
              onPlaying={handleVideoCanPlay}
              className="w-full h-full object-cover"
            />

            {!isCameraReady && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-white/60 space-y-3 z-10">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span className="text-xs font-medium">Iniciando cámara...</span>
              </div>
            )}
          </div>

          {/* Barra Inferior de Controles */}
          <div className="relative z-30 px-6 py-6 pb-safe bg-gradient-to-t from-black/90 via-black/50 to-transparent flex flex-col items-center gap-3">
            <div className="w-full max-w-xs flex items-center justify-between">
              {/* Lado izquierdo: Miniatura con Deshacer */}
              <div className="w-16 flex flex-col items-center justify-center">
                {lastPhoto ? (
                  <div className="relative group">
                    <img 
                      src={lastPhoto.previewUrl} 
                      alt="Última foto" 
                      className="w-14 h-14 rounded-2xl object-cover border-2 border-white shadow-xl"
                    />
                    <button
                      type="button"
                      onClick={handleUndoLast}
                      className="absolute -bottom-2 -right-2 px-1.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded-lg shadow-md flex items-center gap-1 text-[9px] font-bold active:scale-90 transition-transform cursor-pointer"
                      title="Deshacer última foto"
                    >
                      <Undo2 size={10} className="stroke-[2.5]" />
                      <span>Deshacer</span>
                    </button>
                  </div>
                ) : (
                  <div className="w-14 h-14 rounded-2xl border border-white/15 bg-white/5 flex items-center justify-center text-white/30 text-[9px] font-bold text-center">
                    Sin fotos
                  </div>
                )}
              </div>

              {/* Centro: Botón de Disparo Grande */}
              <button
                type="button"
                disabled={!isCameraReady}
                onClick={captureFrame}
                className="relative w-20 h-20 rounded-full border-4 border-white flex items-center justify-center transition-all active:scale-90 hover:opacity-95 shadow-2xl cursor-pointer disabled:opacity-30"
                aria-label="Tomar fotografía"
              >
                <div className="w-16 h-16 rounded-full bg-white transition-all active:bg-amber-400" />
              </button>

              {/* Lado derecho: Accesos directos a Galería y Cámara Nativa */}
              <div className="w-16 flex flex-col items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    stopTracks();
                    onOpenGallery();
                    onClose();
                  }}
                  className="p-2.5 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 text-white transition-all cursor-pointer"
                  title="Abrir galería de fotos"
                >
                  <ImageIcon size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stopTracks();
                    onOpenSystemCamera();
                    onClose();
                  }}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white/80 transition-all cursor-pointer"
                  title="Usar cámara del sistema"
                >
                  <CameraIcon size={14} />
                </button>
              </div>
            </div>

            <p className="text-[11px] text-center text-white/50 font-medium">
              1 toque = 1 foto &bull; Mantén presionado el contador para diagnóstico
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export const ContinuousCamera = memo(ContinuousCameraComponent);
