import { registerPlugin } from '@capacitor/core';

export interface NativeDetectResult {
  /** true si YOLO encontró una matrícula en el fotograma. */
  found: boolean;
  /** Ruta file:// del recorte de la matrícula, listo para ML Kit. */
  path?: string;
  confidence?: number;
}

export interface NativePlateDetectorPlugin {
  /** Carga el modelo y calienta los kernels. Llamar al abrir la cámara. */
  warmup(): Promise<void>;
  detect(options: { image: string }): Promise<NativeDetectResult>;
}

/**
 * Plugin nativo Android (PlateDetectorPlugin.java): YOLOv11n sobre ONNX
 * Runtime nativo. Detecta la matrícula y devuelve el recorte ya guardado
 * en caché. Solo disponible en plataforma nativa.
 */
export const NativePlateDetector =
  registerPlugin<NativePlateDetectorPlugin>('PlateDetector');
