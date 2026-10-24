import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface CriticalBlockingBannerProps {
  isVisible: boolean;
  message: string;
  onDismiss?: () => void;
  onAction?: () => void;
  actionLabel?: string;
}

export const CriticalBlockingBanner: React.FC<CriticalBlockingBannerProps> = ({
  isVisible,
  message,
  onDismiss,
  onAction,
  actionLabel = 'Detalles',
}) => {
  const [isDismissed, setIsDismissed] = useState(false);

  if (!isVisible || isDismissed) {
    return null;
  }

  return (
    <div className="h-8 max-h-[32px] bg-red-600 text-white px-3 sm:px-4 flex items-center justify-between text-[11px] font-semibold select-none shadow-xs z-40 overflow-hidden">
      <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
        <AlertTriangle size={13} className="shrink-0 text-white" />
        <span className="truncate whitespace-nowrap">
          {message}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {onAction && (
          <button
            type="button"
            onClick={onAction}
            className="text-[10px] font-bold underline hover:opacity-80 transition-opacity cursor-pointer shrink-0"
          >
            {actionLabel}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setIsDismissed(true);
            if (onDismiss) onDismiss();
          }}
          className="p-1 hover:bg-black/20 rounded-md transition-colors cursor-pointer shrink-0"
          title="Descartar aviso"
          aria-label="Cerrar aviso"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
};
