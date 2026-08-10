/**
 * Geometría del marco de puntería, en fracciones de la pantalla.
 *
 * Estos valores tienen que ir a la par con `.frame` en scanner.page.scss: el
 * usuario apunta con lo que ve pintado, y el filtro de texto usa estos números
 * para decidir qué se queda fuera. Si se cambia uno, hay que cambiar el otro.
 */
export const SCAN_FRAME = {
  /** left: 8% */
  x: 0.08,
  /** top: 26% */
  y: 0.26,
  /** left 8% + right 8% */
  width: 0.84,
  /** aspect-ratio: 2.2 / 1 */
  aspectRatio: 2.2,
} as const;

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * El marco en fracciones de pantalla (0-1). La altura sale del aspect-ratio,
 * así que depende de la relación de aspecto del dispositivo.
 */
export function frameRect(screenW: number, screenH: number): FrameRect {
  const widthPx = SCAN_FRAME.width * screenW;
  const heightPx = widthPx / SCAN_FRAME.aspectRatio;
  return {
    x: SCAN_FRAME.x,
    y: SCAN_FRAME.y,
    w: SCAN_FRAME.width,
    h: screenH > 0 ? heightPx / screenH : 0,
  };
}
