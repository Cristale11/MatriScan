/**
 * Códigos de país de la banda azul de las matrículas europeas.
 *
 * Son los distintivos oficiales de la Convención de Viena, que en la UE van
 * impresos en blanco sobre la banda azul de las estrellas. Se incluyen también
 * los del Magreb, habituales en España.
 */

import { PlateFormat } from './plate-parser';

export const COUNTRY_NAMES: Record<string, string> = {
  A: 'Austria',
  AL: 'Albania',
  AND: 'Andorra',
  B: 'Bélgica',
  BG: 'Bulgaria',
  BIH: 'Bosnia y Herzegovina',
  BY: 'Bielorrusia',
  CH: 'Suiza',
  CY: 'Chipre',
  CZ: 'Chequia',
  D: 'Alemania',
  DK: 'Dinamarca',
  DZ: 'Argelia',
  E: 'España',
  EST: 'Estonia',
  F: 'Francia',
  FIN: 'Finlandia',
  FL: 'Liechtenstein',
  GB: 'Reino Unido',
  GBZ: 'Gibraltar',
  GR: 'Grecia',
  H: 'Hungría',
  HR: 'Croacia',
  I: 'Italia',
  IRL: 'Irlanda',
  IS: 'Islandia',
  L: 'Luxemburgo',
  LT: 'Lituania',
  LV: 'Letonia',
  M: 'Malta',
  MA: 'Marruecos',
  MC: 'Mónaco',
  MD: 'Moldavia',
  MK: 'Macedonia del Norte',
  MNE: 'Montenegro',
  N: 'Noruega',
  NL: 'Países Bajos',
  P: 'Portugal',
  PL: 'Polonia',
  RO: 'Rumanía',
  RSM: 'San Marino',
  RUS: 'Rusia',
  S: 'Suecia',
  SK: 'Eslovaquia',
  SLO: 'Eslovenia',
  SRB: 'Serbia',
  TN: 'Túnez',
  TR: 'Turquía',
  UA: 'Ucrania',
};

/** true si el texto es un distintivo de país conocido. */
export function isCountryCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(COUNTRY_NAMES, code);
}

/** Nombre del país, o null si el código no está en la tabla. */
export function countryName(code: string | undefined): string | null {
  return code ? COUNTRY_NAMES[code] ?? null : null;
}

/**
 * Letra que va en la banda azul al pintar la placa.
 * Las españolas llevan 'E'; las extranjeras, su código si se ha leído.
 * Las anteriores a 1971 no llevan banda.
 */
export function bandCode(format: PlateFormat, country?: string): string | null {
  if (format === 'old') return null;
  if (format === 'foreign') return country && isCountryCode(country) ? country : null;
  return 'E';
}
