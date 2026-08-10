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

import { isCountryCode } from './country-codes';

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

export type PlateFormat = 'modern' | 'moped' | 'legacy' | 'old' | 'special' | 'foreign';

export const FORMAT_LABELS: Record<PlateFormat, string> = {
  modern: 'Moderna',
  moped: 'Ciclomotor',
  legacy: 'Provincial',
  old: 'Antigua',
  special: 'Especial',
  foreign: 'Extranjera',
};

export interface PlateMatch {
  /** Matrícula normalizada y sin separadores. Ej: "1234BCD" */
  value: string;
  /** Igual pero formateada, para mostrar en pantalla. Ej: "1234 BCD" */
  display: string;
  format: PlateFormat;
  corrections: number;
  /**
   * Distintivo de la banda azul en las extranjeras (F, D, P...), cuando el OCR
   * consigue leerlo. Las españolas no lo rellenan: se asume 'E'.
   */
  country?: string;
}

interface ScoredMatch extends PlateMatch {}

export interface ParseOptions {
  /**
   * Si true, solo detecta el formato moderno (NNNN LLL).
   * Por defecto detecta todos los formatos españoles.
   */
  modernOnly?: boolean;
  /**
   * Modo internacional: si ningún formato español encaja, acepta cualquier
   * secuencia con pinta de matrícula. Pensado para usarse con el texto del
   * recorte que devuelve YOLO, que ya viene acotado a la placa física.
   */
  allowForeign?: boolean;
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
 * Los formatos se prueban en este orden, del más específico al más laxo.
 * Provincial y antigua van al final porque "provincia + dígitos" encaja con
 * casi cualquier cosa: si se probaran antes, un "ITV 2025" de un cartel de
 * fondo ganaría a la matrícula real que está en la línea siguiente.
 */
const FORMAT_TIERS = ['prefixed', 'modern', 'legacy', 'old'] as const;
type FormatTier = (typeof FORMAT_TIERS)[number];

/**
 * Tope de correcciones OCR en el formato provincial. Es el más permisivo de
 * todos (provincia + dígitos + serie), así que sin límite convierte palabras
 * corrientes en matrículas. Una placa real mal leída se recupera en el
 * siguiente fotograma; un falso positivo se guarda para siempre.
 */
const MAX_LEGACY_CORRECTIONS = 1;

/**
 * Intenta UN formato sobre un texto ya compactado (sin separadores).
 * Para los formatos con corrección OCR, prueba todas las posiciones de ventana
 * y devuelve la que necesita menos correcciones (así evita falsos positivos
 * por ventana desalineada, como leer 1880GKZ en vez de 8806KZS).
 *
 * `strict` (modo internacional) exige lectura sin correcciones. Junto con
 * saltarse los tiers laxos, evita que la francesa AB-123-CD se guarde como
 * la española A-8123-CD.
 */
function matchTier(compact: string, tier: FormatTier, strict: boolean): PlateMatch | null {
  if (compact.length < 5) return null;

  switch (tier) {
    // Prefijada: C/R/H + 4 dígitos + 3 letras (8 chars)
    case 'prefixed': {
      const hit = bestScored(compact, 8, normalizePrefixed);
      return hit && (!strict || hit.corrections === 0) ? hit : null;
    }

    // Moderna: 4 dígitos + 3 consonantes (7 chars)
    case 'modern': {
      const hit = bestScored(compact, 7, normalizeModern);
      return hit && (!strict || hit.corrections === 0) ? hit : null;
    }

    // Provincial (1971–2000): provincia + 4 dígitos + 1-2 letras de serie
    case 'legacy': {
      // Se queda con la lectura que menos correcciones necesita y descarta las
      // que necesitan más de una: sin ese tope, "SEAT IBIZA" del maletero pasa
      // por SE-4718-IZ convirtiendo A->4, T->7, I->1 y B->8.
      let best: PlateMatch | null = null;
      for (let len = 8; len >= 6; len--) {
        for (let i = 0; i + len <= compact.length; i++) {
          const hit = normalizeLegacy(compact.slice(i, i + len));
          if (!hit || hit.corrections > MAX_LEGACY_CORRECTIONS) continue;
          if (!best || hit.corrections < best.corrections) best = hit;
          if (best.corrections === 0) return best;
        }
      }
      return best;
    }

    // Antigua (pre-1971): provincia + 4-6 dígitos
    case 'old':
      for (let len = 8; len >= 5; len--) {
        for (let i = 0; i + len <= compact.length; i++) {
          const hit = normalizeOld(compact.slice(i, i + len));
          if (hit) return hit;
        }
      }
      return null;
  }
}

/**
 * Busca una matrícula dentro del texto que ha devuelto el OCR.
 *
 * Recorre los formatos de más específico a más laxo, y dentro de cada uno
 * mira primero las líneas sueltas y luego las fusiones de líneas adyacentes
 * (las placas verticales de ciclomotor llegan partidas en 3 líneas, como
 * "C0 / 336 / BBB").
 *
 * El orden importa: agotar un formato en todo el texto antes de pasar al
 * siguiente evita que el ruido de fondo gane a la matrícula real. Con "ITV
 * 2025" en un cartel y "1234 BCD" en la placa, mirar línea por línea daría
 * la falsa "V 2025" como antigua sin llegar a ver la moderna verdadera.
 */
export function extractPlate(rawText: string, options: ParseOptions = {}): PlateMatch | null {
  const compactLines: string[] = [];

  for (const line of clean(rawText).split('\n')) {
    const compact = line.replace(/[^A-Z0-9]/g, '');
    if (compact) compactLines.push(compact);
  }

  const strict = !!options.allowForeign;
  const tiers: readonly FormatTier[] = options.modernOnly
    ? ['modern']
    : strict
      ? ['prefixed', 'modern']
      : FORMAT_TIERS;

  for (const tier of tiers) {
    for (const compact of compactLines) {
      const hit = matchTier(compact, tier, strict);
      if (hit) return hit;
    }

    // Ventanas grandes primero para que ciclomotor (3 líneas: C0/336/BBB)
    // se detecte antes de que una ventana menor genere un falso positivo.
    for (let size = Math.min(4, compactLines.length); size >= 2; size--) {
      for (let start = 0; start + size <= compactLines.length; start++) {
        const merged = compactLines.slice(start, start + size).join('');
        const hit = matchTier(merged, tier, strict);
        if (hit) return hit;
      }
    }
  }

  // Último recurso en modo internacional: cualquier cosa con pinta de placa.
  if (options.allowForeign) {
    return matchForeign(compactLines);
  }

  return null;
}

/** Una secuencia con pinta de matrícula: 5-10 caracteres, con dígito y letra. */
function looksLikePlate(s: string): boolean {
  return s.length >= 5 && s.length <= 10 && /\d/.test(s) && /[A-Z]/.test(s);
}

/**
 * Acepta secuencias alfanuméricas genéricas y, si aparece, lee el distintivo
 * de país de la banda azul. `corrections: 1` a propósito: obliga al votador a
 * confirmar la lectura dos veces, porque aquí no hay formato que valide.
 */
function matchForeign(compactLines: string[]): PlateMatch | null {
  let best: string | null = null;
  let country: string | undefined;

  // La banda azul sale como una línea suelta de 1-3 letras (F, D, NL, IRL...).
  for (const line of compactLines) {
    if (line.length <= 3 && isCountryCode(line)) {
      country = line;
      break;
    }
  }

  for (const line of compactLines) {
    if (line === country) continue;
    if (!looksLikePlate(line)) continue;
    if (!best || line.length > best.length) best = line;
  }

  // Si el OCR pega la banda a la matrícula ("F AB-123-CD" -> "FAB123CD") se
  // deja tal cual a propósito: separar el prefijo sería adivinar. La alemana
  // MAB1234 empieza por el código de Malta, y partirla daría un país inventado.

  // Placas en dos líneas (motos, placas suizas...): probar la fusión.
  if (!best && compactLines.length > 1) {
    const merged = compactLines.filter((l) => l !== country).join('');
    if (looksLikePlate(merged)) best = merged;
  }

  if (!best) return null;
  return { value: best, display: best, format: 'foreign', corrections: 1, country };
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
