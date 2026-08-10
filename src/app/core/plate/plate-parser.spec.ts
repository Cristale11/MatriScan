import { extractPlate, isValidPlate } from './plate-parser';

describe('extractPlate', () => {
  // --- Formato moderno (NNNN LLL) ---

  it('lee una matrícula moderna limpia', () => {
    expect(extractPlate('1234 BCD')?.value).toBe('1234BCD');
  });

  it('ignora la banda europea que ML Kit pega delante', () => {
    expect(extractPlate('E\n4821 KGN\nESP')?.value).toBe('4821KGN');
  });

  it('corrige letras leídas donde debe haber dígitos', () => {
    expect(extractPlate('OI58 KGN')?.value).toBe('0158KGN');
  });

  it('corrige dígitos leídos donde debe haber letras', () => {
    expect(extractPlate('4821 805')?.value).toBe('4821BDS');
  });

  it('rechaza matrículas con vocales (no son formato válido)', () => {
    expect(extractPlate('1234 ABC')).toBeNull();
  });

  it('rechaza texto suelto de la escena', () => {
    expect(extractPlate('CALLE MAYOR 12\nFARMACIA')).toBeNull();
  });

  it('encuentra la matrícula aunque venga pegada a otro texto', () => {
    expect(extractPlate('TAXI1234BCDMADRID')?.value).toBe('1234BCD');
  });

  it('prefiere la lectura con menos correcciones OCR', () => {
    expect(extractPlate('18806KZS3')?.value).toBe('8806KZS');
  });

  it('devuelve la versión con espacio para mostrar', () => {
    expect(extractPlate('1234BCD')?.display).toBe('1234 BCD');
  });

  // --- Formato ciclomotor (C NNNN LLL) ---

  it('detecta ciclomotor en una sola línea', () => {
    const result = extractPlate('C 0336 BBB');
    expect(result?.value).toBe('C0336BBB');
    expect(result?.format).toBe('moped');
    expect(result?.display).toBe('C 0336 BBB');
  });

  it('detecta ciclomotor cuando OCR lee el 0 como O', () => {
    expect(extractPlate('CO336BBB')?.value).toBe('C0336BBB');
  });

  it('detecta ciclomotor con placa vertical partida en 3 líneas', () => {
    const result = extractPlate('C0\n336\nBBB');
    expect(result?.value).toBe('C0336BBB');
    expect(result?.format).toBe('moped');
  });

  it('detecta ciclomotor con OCR que lee CO en primera línea', () => {
    const result = extractPlate('CO\n336\nBBB');
    expect(result?.value).toBe('C0336BBB');
    expect(result?.format).toBe('moped');
  });

  it('corrige dígitos leídos como letras en el sufijo del ciclomotor', () => {
    expect(extractPlate('C0336BB8')?.value).toBe('C0336BBB');
  });

  it('detecta ciclomotor en placa horizontal (cuadriciclo)', () => {
    const result = extractPlate('C 1234 BCD');
    expect(result?.value).toBe('C1234BCD');
    expect(result?.format).toBe('moped');
  });

  it('no detecta ciclomotor si se pide modernOnly', () => {
    expect(extractPlate('C 0336 BBB', { modernOnly: true })?.format).toBe('modern');
  });

  // --- Formato provincial / legacy (PP-NNNN-LL) ---

  it('detecta formato provincial por defecto', () => {
    const result = extractPlate('AL-1234-BC');
    expect(result?.value).toBe('AL1234BC');
    expect(result?.format).toBe('legacy');
    expect(result?.display).toBe('AL-1234-BC');
  });

  it('detecta provincial con provincia de una letra', () => {
    const result = extractPlate('M 5678 XY');
    expect(result?.value).toBe('M5678XY');
    expect(result?.format).toBe('legacy');
  });

  it('detecta provincial con una sola letra de serie', () => {
    const result = extractPlate('BA-4567-Z');
    expect(result?.value).toBe('BA4567Z');
    expect(result?.format).toBe('legacy');
  });

  it('corrige OCR en los dígitos del formato provincial', () => {
    expect(extractPlate('M-OI58-BC')?.value).toBe('M0158BC');
  });

  it('rechaza códigos de provincia inventados', () => {
    expect(extractPlate('XX-1234-BC')).toBeNull();
  });

  it('no detecta provincial si se pide modernOnly', () => {
    expect(extractPlate('AL-1234-BC', { modernOnly: true })).toBeNull();
  });

  // --- Formato antiguo / pre-1971 (PP NNNNNN) ---

  it('detecta formato antiguo con 6 dígitos', () => {
    const result = extractPlate('M-123456');
    expect(result?.value).toBe('M123456');
    expect(result?.format).toBe('old');
    expect(result?.display).toBe('M 123456');
  });

  it('detecta formato antiguo con 4 dígitos', () => {
    const result = extractPlate('B 1234');
    expect(result?.value).toBe('B1234');
    expect(result?.format).toBe('old');
  });

  it('detecta formato antiguo con provincia de dos letras', () => {
    const result = extractPlate('GC-54321');
    expect(result?.value).toBe('GC54321');
    expect(result?.format).toBe('old');
  });

  it('no detecta antiguo si se pide modernOnly', () => {
    expect(extractPlate('M-123456', { modernOnly: true })).toBeNull();
  });

  // --- Formato especial con prefijo (R/H + NNNN LLL) ---

  it('detecta matrícula de remolque con prefijo R', () => {
    const result = extractPlate('R 4821 KGN');
    expect(result?.value).toBe('R4821KGN');
    expect(result?.format).toBe('special');
    expect(result?.display).toBe('R 4821 KGN');
  });

  it('detecta matrícula histórica con prefijo H', () => {
    const result = extractPlate('H-1234-BCD');
    expect(result?.value).toBe('H1234BCD');
    expect(result?.format).toBe('special');
  });

  it('con modernOnly, ignora el prefijo especial y detecta solo la moderna', () => {
    const result = extractPlate('R-4821-KGN', { modernOnly: true });
    expect(result?.value).toBe('4821KGN');
    expect(result?.format).toBe('modern');
  });

  // --- Prioridad de formatos ---

  it('prefiere moderna sobre provincial cuando ambas podrían encajar', () => {
    expect(extractPlate('1234BCD')?.format).toBe('modern');
  });

  it('prefiere ciclomotor sobre provincial para C + moderna', () => {
    expect(extractPlate('C1234BCD')?.format).toBe('moped');
  });
});

describe('isValidPlate', () => {
  it('valida formato moderno', () => {
    expect(isValidPlate('1234 BCD')).toBe(true);
    expect(isValidPlate('1234-bcd')).toBe(true);
    expect(isValidPlate('123 BCD')).toBe(false);
  });

  it('valida formato ciclomotor', () => {
    expect(isValidPlate('C1234BCD')).toBe(true);
    expect(isValidPlate('C-0336-BBB')).toBe(true);
  });

  it('valida formato provincial', () => {
    expect(isValidPlate('M1234BC')).toBe(true);
    expect(isValidPlate('AL-1234-BC')).toBe(true);
  });

  it('valida formato antiguo', () => {
    expect(isValidPlate('M123456')).toBe(true);
    expect(isValidPlate('GC-54321')).toBe(true);
  });

  it('valida formato especial', () => {
    expect(isValidPlate('R1234BCD')).toBe(true);
    expect(isValidPlate('H1234BCD')).toBe(true);
  });

  it('rechaza texto aleatorio', () => {
    expect(isValidPlate('HOLA')).toBe(false);
    expect(isValidPlate('12345')).toBe(false);
    expect(isValidPlate('1234 ABC')).toBe(false);
  });
});
