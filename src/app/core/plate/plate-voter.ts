import { PlateMatch } from './plate-parser';

export interface VoterState {
  /** Candidata que más votos lleva ahora mismo, o null si no hay ninguna. */
  leader: PlateMatch | null;
  /** Votos de la candidata líder. */
  votes: number;
  /** Votos necesarios para confirmar. */
  threshold: number;
}

/**
 * Acumula lecturas de fotogramas consecutivos y solo confirma una matrícula
 * cuando la ha visto igual varias veces.
 *
 * Lecturas limpias (0 correcciones OCR) necesitan menos votos para confirmar,
 * porque es casi imposible que el OCR invente una matrícula válida dos veces
 * seguidas con las mismas letras.
 */
export class PlateVoter {
  private votes = new Map<string, { match: PlateMatch; count: number }>();
  private lastValidRead = 0;

  constructor(
    private readonly threshold = 3,
    private readonly fastThreshold = 2,
    private readonly staleMs = 2000,
  ) {}

  push(match: PlateMatch | null, now: number = Date.now()): PlateMatch | null {
    if (this.lastValidRead && now - this.lastValidRead > this.staleMs) {
      this.reset();
    }

    if (!match) return null;

    this.lastValidRead = now;
    const entry = this.votes.get(match.value) ?? { match, count: 0 };
    entry.count += 1;
    this.votes.set(match.value, entry);

    const needed = match.corrections === 0 ? this.fastThreshold : this.threshold;

    if (entry.count >= needed) {
      this.reset();
      return match;
    }

    return null;
  }

  get state(): VoterState {
    let leader: { match: PlateMatch; count: number } | null = null;
    for (const entry of this.votes.values()) {
      if (!leader || entry.count > leader.count) leader = entry;
    }
    return {
      leader: leader?.match ?? null,
      votes: leader?.count ?? 0,
      threshold: this.threshold,
    };
  }

  reset(): void {
    this.votes.clear();
    this.lastValidRead = 0;
  }
}
