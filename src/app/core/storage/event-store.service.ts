import { Injectable, signal, computed } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

export interface PlateEvent {
  id: string;
  name: string;
  createdAt: string;
}

const EVENTS_KEY = 'events';
const ACTIVE_KEY = 'active_event';

@Injectable({ providedIn: 'root' })
export class EventStore {
  readonly events = signal<PlateEvent[]>([]);
  readonly activeId = signal<string | null>(null);
  readonly loaded = signal(false);

  readonly active = computed(() => {
    const id = this.activeId();
    return id ? this.events().find(e => e.id === id) ?? null : null;
  });

  async load(): Promise<void> {
    if (this.loaded()) return;
    const [evts, active] = await Promise.all([
      Preferences.get({ key: EVENTS_KEY }),
      Preferences.get({ key: ACTIVE_KEY }),
    ]);
    try {
      this.events.set(evts.value ? (JSON.parse(evts.value) as PlateEvent[]) : []);
    } catch {
      this.events.set([]);
    }
    const savedId = active.value ?? null;
    if (savedId && this.events().some(e => e.id === savedId)) {
      this.activeId.set(savedId);
    }
    this.loaded.set(true);
  }

  async add(name: string): Promise<PlateEvent> {
    const event: PlateEvent = {
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
    };
    this.events.update(list => [event, ...list]);
    await this.persistEvents();
    return event;
  }

  async remove(id: string): Promise<void> {
    this.events.update(list => list.filter(e => e.id !== id));
    if (this.activeId() === id) {
      this.activeId.set(null);
      await Preferences.remove({ key: ACTIVE_KEY });
    }
    await this.persistEvents();
  }

  async rename(id: string, name: string): Promise<void> {
    this.events.update(list =>
      list.map(e => e.id === id ? { ...e, name: name.trim() } : e),
    );
    await this.persistEvents();
  }

  async setActive(id: string | null): Promise<void> {
    this.activeId.set(id);
    if (id) {
      await Preferences.set({ key: ACTIVE_KEY, value: id });
    } else {
      await Preferences.remove({ key: ACTIVE_KEY });
    }
  }

  private persistEvents(): Promise<void> {
    return Preferences.set({ key: EVENTS_KEY, value: JSON.stringify(this.events()) });
  }
}
