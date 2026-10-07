import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ClipboardCheck, 
  Camera, 
  PenTool, 
  FileText, 
  PlusCircle,
  ChevronRight,
  ChevronLeft,
  X,
  Mic
} from 'lucide-react';

interface WelcomeModalProps {
  onClose: () => void;
}

const steps = [
  {
    title: "¡Bienvenido a Checkinventory!",
    description: "Tu plataforma profesional para crear inventarios digitales detallados de cualquier tipo de inmueble.",
    icon: <ClipboardCheck className="w-12 h-12 text-emerald-500" />,
    color: "bg-emerald-50"
  },
  {
    title: "Usa Plantillas Inteligentes",
    description: "Al crear un nuevo inventario, elige entre Apartamento, Oficina o Bodega. La app cargará automáticamente los espacios y elementos estándar para ahorrarte tiempo.",
    icon: <PlusCircle className="w-12 h-12 text-blue-500" />,
    color: "bg-blue-50"
  },
  {
    title: "Dictado por Voz",
    description: "¿Manos ocupadas? Toca el icono del micrófono en cualquier elemento para dictar el estado y los detalles. La app convertirá tu voz en texto automáticamente.",
    icon: <Mic className="w-12 h-12 text-indigo-500" />,
    color: "bg-indigo-50"
  },
  {
    title: "Registro Fotográfico",
    description: "En cada espacio encontrarás un botón de cámara. Toma fotos del estado real; se organizarán solas por habitación dentro de tu reporte final.",
    icon: <Camera className="w-12 h-12 text-purple-500" />,
    color: "bg-purple-50"
  },
  {
    title: "Firmas y Exportación",
    description: "Al terminar, usa el botón 'Finalizar' para recoger las firmas digitales. Luego, genera un PDF profesional o descarga todas las fotos en un archivo ZIP.",
    icon: <FileText className="w-12 h-12 text-rose-500" />,
    color: "bg-rose-50"
  }
];

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ onClose }) => {
  const [currentStep, setCurrentStep] = useState(0);

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onClose();
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl overflow-hidden max-w-lg w-full relative"
      >
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 transition-colors z-10"
        >
          <X className="w-5 h-5 text-gray-400" />
        </button>

        <div className="p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center text-center space-y-6"
            >
              <div className={`p-6 rounded-full ${steps[currentStep].color}`}>
                {steps[currentStep].icon}
              </div>
              
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-gray-900">
                  {steps[currentStep].title}
                </h2>
                <p className="text-gray-600 leading-relaxed">
                  {steps[currentStep].description}
                </p>
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="mt-12 flex items-center justify-between">
            <div className="flex space-x-2">
              {steps.map((_, index) => (
                <div 
                  key={index}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    index === currentStep ? 'w-8 bg-emerald-500' : 'w-2 bg-gray-200'
                  }`}
                />
              ))}
            </div>

            <div className="flex space-x-3">
              {currentStep > 0 && (
                <button
                  onClick={prevStep}
                  className="p-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  <ChevronLeft className="w-6 h-6 text-gray-600" />
                </button>
              )}
              
              <button
                onClick={nextStep}
                className="flex items-center space-x-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium transition-all shadow-lg shadow-emerald-200"
              >
                <span>{currentStep === steps.length - 1 ? 'Empezar' : 'Siguiente'}</span>
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
