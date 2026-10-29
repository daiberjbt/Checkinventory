import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, Edit3, Save, Trash2, X } from 'lucide-react';

export interface ExitDraftDialogProps {
  isOpen: boolean;
  photoCount: number;
  onContinueEditing: () => void;
  onSaveDraft: () => void;
  onDiscard: () => void;
}

export const ExitDraftDialog: React.FC<ExitDraftDialogProps> = ({
  isOpen,
  photoCount,
  onContinueEditing,
  onSaveDraft,
  onDiscard,
}) => {
  if (!isOpen) return null;

  const photoText = photoCount > 0 
    ? `${photoCount} ${photoCount === 1 ? 'foto' : 'fotos'} y ` 
    : '';

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 select-none">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onContinueEditing}
          className="absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
        />

        {/* Dialog Card */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="relative w-full max-w-md bg-white dark:bg-neutral-900 rounded-3xl shadow-2xl border border-black/10 dark:border-white/10 p-6 sm:p-7 space-y-6 z-10"
        >
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-200 dark:border-amber-800">
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-black dark:text-white leading-tight">
                  Inventario no guardado
                </h3>
                <p className="text-xs text-muted font-medium mt-0.5">
                  Cambios pendientes de guardar
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onContinueEditing}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 text-muted hover:text-black dark:hover:text-white transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body message */}
          <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">
            Este inventario aún no se ha guardado. Si sales ahora perderás <strong className="font-bold text-black dark:text-white">{photoText}</strong>los datos ingresados.
          </p>

          {/* Action buttons */}
          <div className="space-y-2.5 pt-1">
            {/* 1. Seguir editando (botón principal) */}
            <button
              type="button"
              onClick={onContinueEditing}
              className="w-full py-3.5 px-4 rounded-2xl bg-black dark:bg-white text-white dark:text-black font-bold text-xs hover:bg-neutral-800 dark:hover:bg-neutral-200 active:scale-[0.98] transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <Edit3 size={15} />
              <span>Seguir editando</span>
            </button>

            {/* 2. Guardar borrador */}
            <button
              type="button"
              onClick={onSaveDraft}
              className="w-full py-3 px-4 rounded-2xl bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 text-black dark:text-white font-bold text-xs active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer border border-black/5 dark:border-white/5"
            >
              <Save size={15} />
              <span>Guardar borrador</span>
            </button>

            {/* 3. Descartar (rojo) */}
            <button
              type="button"
              onClick={onDiscard}
              className="w-full py-3 px-4 rounded-2xl bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50 text-red-600 dark:text-red-400 font-bold text-xs active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer border border-red-200 dark:border-red-900/50"
            >
              <Trash2 size={15} />
              <span>Descartar</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
