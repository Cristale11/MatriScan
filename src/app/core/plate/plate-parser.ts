/**
 * Extracción y validación de matrículas españolas a partir de texto OCR.
 *
 * Soporta todos los formatos históricos y especiales:
 *   - Moderna (desde sept. 2000): NNNN LLL (4 dígitos + 3 consonantes)
 *   - Ciclomotor (desde 1999): C NNNN LLL (prefijo C + 4 dígitos + 3 consonantes)
 *   - Provincial (1971–2000): PP NNNN LL (provincia + 4 dígitos + 1-2 letras)
 *   - Antigua (antes de 1971): PP NNNNNN (provincia + 4-6 dígitos)
 *   - Especial (remolques, históricos): R/H NNNN LLL (prefijo + moderna)
 *
 * Sin dependencias de Angular ni de Capacitor a propósito: es TypeScript puro,
 * así que se puede testear sin levantar nada.
 */

/** Letras válidas en matrículas modernas: sin vocales, sin Ñ y sin Q. */
export const VALID_LETTERS = 'BCDFGHJKLMNPRSTVWXYZ';

/** Códigos provinciales usados en el formato anterior a septiembre de 2000. */
const PROVINCE_CODES = new Set([
  'A', 'AB', 'AL', 'AV', 'B', 'BA', 'BI', 'BU', 'C', 'CA', 'CC', 'CE', 'CO',
  'CR', 'CS', 'CU', 'GC', 'GE', 'GI', 'GR', 'GU', 'H', 'HU', 'IB', 'J', 'L',
  'LE', 'LO', 'LU', 'M', 'MA', 'ML', 'MU', 'NA', 'O', 'OR', 'OU', 'P', 'PM',
  'PO', 'S', 'SA', 'SE', 'SG', 'SO', 'SS', 'T', 'TE', 'TF', 'TO', 'V', 'VA',
  'VI', 'Z', 'ZA',
]);

/**
 * Prefijos de una letra para matrículas con formato prefijo + moderna.
 * C: ciclomotor, R: remolque, H: histórico.
 */
const PREFIXED_LETTERS = new Set(['C', 'R', 'H']);

const TO_DIGIT: Record<string, string> = {
  O: '0', D: '0', Q: '0',
  I: '1', L: '1',
  T: '7',
  S: '5',
  B: '8',
  Z: '2',
  G: '6',
  A: '4',
};

const TO_LETTER: Record<string, string> = {
  '0': 'D',
  O: 'D',
  Q: 'D',
  '5': 'S',
  '8': 'B',
  '2': 'Z',
  '6': 'G',
  U: 'V',
};

const MOPED_DIGIT_TO_LETTER: Record<string, string> = {
  '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '6': 'G', '8': 'B',
};

export type PlateFormat = 'modern' | 'moped' | 'legacy' | 'old' | 'special';

export const FORMAT_LABELS: Record<PlateFormat, string> = {
  modern: 'Moderna',
  moped: 'Ciclomotor',
  legacy: 'Provincial',
  old: 'Antigua',
  special: 'Especial',
};

export interface PlateMatch {
  /** Matrícula normalizada y sin separadores. Ej: "1234BCD" */
  value: string;
  /** Igual pero formateada, para mostrar en pantalla. Ej: "1234 BCD" */
  display: string;
  format: PlateFormat;
  corrections: number;
}

interface ScoredMatch extends PlateMatch {}

export interface ParseOptions {
  /**
   * Si true, solo detecta el formato moderno (NNNN LLL).
   * Por defecto detecta todos los formatos españoles.
   */
  modernOnly?: boolean;
}

/** Quita acentos y pasa a mayúsculas. Los saltos de línea del OCR se conservan. */
function clean(raw: string): string {
  return raw
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function normalizeModern(window: string): ScoredMatch | null {
  let corrections = 0;
  const digits = [...window.slice(0, 4)].map((c) => {
    if (c >= '0' && c <= '9') return c;
    const fix = TO_DIGIT[c];
    if (fix) { corrections++; return fix; }
    return c;
  });
  if (!digits.every((c) => c >= '0' && c <= '9')) return null;

  const letters = [...window.slice(4, 7)].map((c) => {
    if (VALID_LETTERS.includes(c)) return c;
    const fix = TO_LETTER[c];
    if (fix) { corrections++; return fix; }
    return c;
  });
  if (!letters.every((c) => VALID_LETTERS.includes(c))) return null;

  const value = digits.join('') + letters.join('');
  return { value, display: `${value.slice(0, 4)} ${value.slice(4)}`, format: 'modern', corrections };
}

function normalizePrefixed(window: string): ScoredMatch | null {
  const prefix = window[0];
  if (!PREFIXED_LETTERS.has(prefix)) return null;

  if (prefix === 'C') {
    let corrections = 0;
    const digits = [...window.slice(1, 5)].map((c) => {
      if (c >= '0' && c <= '9') return c;
      const fix = TO_DIGIT[c];
      if (fix) { corrections++; return fix; }
      return c;
    });
    if (!digits.every((c) => c >= '0' && c <= '9')) return null;

    const rawLetters = [...window.slice(5, 8)].map((c) => {
      if (c >= 'A' && c <= 'Z') return c;
      const mapped = MOPED_DIGIT_TO_LETTER[c];
      if (mapped) { corrections++; return mapped; }
      return null;
    });
    if (rawLetters.some((c) => c === null)) return null;
    const letters = rawLetters.join('');

    const d = digits.join('');
    const value = 'C' + d + letters;
    return { value, display: `C ${d} ${letters}`, format: 'moped', corrections };
  }

  const modern = normalizeModern(window.slice(1));
  if (!modern) return null;

  const value = prefix + modern.value;
  return { value, display: `${prefix} ${modern.display}`, format: 'special', corrections: modern.corrections };
}

function normalizeLegacy(token: string): PlateMatch | null {
  for (const pLen of [2, 1] as const) {
    const rest = token.length - pLen;
    if (rest < 5 || rest > 6) continue;

    const province = token.slice(0, pLen);
    if (!PROVINCE_CODES.has(province)) continue;

    const rawDigits = token.slice(pLen, pLen + 4);
    const digits = [...rawDigits].map((c) => TO_DIGIT[c] ?? c);
    if (!digits.every((c) => c >= '0' && c <= '9')) continue;

    const series = token.slice(pLen + 4);
    if (!/^[A-Z]+$/.test(series)) continue;

    const d = digits.join('');
    const value = province + d + series;
    const corrections = rawDigits.split('').filter((c, i) => c !== digits[i]).length;
    return { value, display: `${province}-${d}-${series}`, format: 'legacy', corrections };
  }
  return null;
}

function normalizeOld(token: string): PlateMatch | null {
  for (const pLen of [2, 1] as const) {
    const digitsLen = token.length - pLen;
    if (digitsLen < 4 || digitsLen > 6) continue;

    const province = token.slice(0, pLen);
    if (!PROVINCE_CODES.has(province)) continue;

    const rawDigits = token.slice(pLen);
    if (!/^\d+$/.test(rawDigits)) continue;

    const value = province + rawDigits;
    return { value, display: `${province} ${rawDigits}`, format: 'old', corrections: 0 };
  }
  return null;
}

function bestScored<T extends ScoredMatch>(
  compact: string,
  windowLen: number,
  normalize: (w: string) => T | null,
): T | null {
  let best: T | null = null;
  for (let i = 0; i + windowLen <= compact.length; i++) {
    const hit = normalize(compact.slice(i, i + windowLen));
    if (hit && (!best || hit.corrections < best.corrections)) {
      best = hit;
      if (hit.corrections === 0) break;
    }
  }
  return best;
}

/**
 * Intenta todos los formatos sobre un texto ya compactado (sin separadores).
 * Para los formatos con corrección OCR, prueba todas las posiciones de ventana
 * y devuelve la que necesita menos correcciones (así evita falsos positivos
 * por ventana desalineada, como leer 1880GKZ en vez de 8806KZS).
 */
function matchFormats(compact: string, modernOnly: boolean): PlateMatch | null {
  if (compact.length < 5) return null;

  // 1. Prefijada: C/R/H + 4 dígitos + 3 letras (8 chars)
  if (!modernOnly) {
    const hit = bestScored(compact, 8, normalizePrefixed);
    if (hit) return hit;
  }

  // 2. Moderna: 4 dígitos + 3 consonantes (7 chars)
  {
    const hit = bestScored(compact, 7, normalizeModern);
    if (hit) return hit;
  }

  if (modernOnly) return null;

  // 3. Provincial (1971–2000): provincia + 4 dígitos + 1-2 letras de serie
  for (let len = 8; len >= 6; len--) {
    for (let i = 0; i + len <= compact.length; i++) {
      const hit = normalizeLegacy(compact.slice(i, i + len));
      if (hit) return hit;
    }
  }

  // 4. Antigua (pre-1971): provincia + 4-6 dígitos
  for (let len = 8; len >= 5; len--) {
    for (let i = 0; i + len <= compact.length; i++) {
      const hit = normalizeOld(compact.slice(i, i + len));
      if (hit) return hit;
    }
  }

  return null;
}

/**
 * Busca una matrícula dentro del texto que ha devuelto el OCR.
 *
 * Estrategia en dos pasadas:
 *   1.ª Cada línea del OCR se compacta y se analiza por separado.
 *   2.ª Si no hay acierto, se fusionan todas las líneas en un solo texto.
 *       Esto es clave para las placas verticales de ciclomotor, que el OCR
 *       devuelve partidas en 3 líneas (ej. "C0 / 336 / BBB").
 */
export function extractPlate(rawText: string, options: ParseOptions = {}): PlateMatch | null {
  const compactLines: string[] = [];

  for (const line of clean(rawText).split('\n')) {
    const compact = line.replace(/[^A-Z0-9]/g, '');
    if (compact) compactLines.push(compact);
  }

  // 1.ª pasada: cada línea por separado
  for (const compact of compactLines) {
    const hit = matchFormats(compact, !!options.modernOnly);
    if (hit) return hit;
  }

  // 2.ª pasada: ventanas de líneas adyacentes (placas verticales).
  // Ventanas grandes primero para que ciclomotor (3 líneas: C0/336/BBB)
  // se detecte antes de que una ventana menor genere un falso positivo.
  if (compactLines.length > 1) {
    for (let size = Math.min(4, compactLines.length); size >= 2; size--) {
      for (let start = 0; start + size <= compactLines.length; start++) {
        const merged = compactLines.slice(start, start + size).join('');
        const hit = matchFormats(merged, !!options.modernOnly);
        if (hit) return hit;
      }
    }
  }

  return null;
}

/** Valida una matrícula ya escrita (para la corrección manual). */
export function isValidPlate(value: string, options: ParseOptions = {}): boolean {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length === 7 && normalizeModern(compact)) return true;
  if (options.modernOnly) return false;
  if (compact.length === 8 && normalizePrefixed(compact)) return true;
  if (normalizeLegacy(compact)) return true;
  if (normalizeOld(compact)) return true;
  return false;
}
