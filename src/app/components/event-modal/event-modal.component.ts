import { Component, inject, output, input, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EventStore } from '../../core/storage/event-store.service';
import { PlateStore } from '../../core/storage/plate-store.service';

@Component({
  selector: 'app-event-modal',
  standalone: true,
  imports: [DatePipe, FormsModule],
  templateUrl: './event-modal.component.html',
  styleUrl: './event-modal.component.scss',
})
export class EventModalComponent {
  readonly eventStore = inject(EventStore);
  private readonly plateStore = inject(PlateStore);

  readonly selectedId = input<string>('');
  readonly closed = output<void>();
  readonly selected = output<string>();

  readonly search = signal('');
  readonly creating = signal(false);
  readonly newName = signal('');

  readonly filteredEvents = computed(() => {
    const q = this.search().toUpperCase().trim();
    const list = this.eventStore.events();
    if (!q) return list;
    return list.filter(e => e.name.toUpperCase().includes(q));
  });

  readonly totalPlates = computed(() => this.plateStore.records().length);

  plateCount(eventId: string): number {
    return this.plateStore.records().filter(r => r.eventId === eventId).length;
  }

  pick(id: string): void {
    this.selected.emit(id);
  }

  close(): void {
    this.closed.emit();
  }

  startCreate(): void {
    this.creating.set(true);
    this.newName.set('');
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.event-modal__create input');
      input?.focus();
    });
  }

  async confirmCreate(): Promise<void> {
    const name = this.newName().trim();
    if (!name) return;
    const event = await this.eventStore.add(name);
    this.creating.set(false);
    this.newName.set('');
    this.selected.emit(event.id);
  }

  cancelCreate(): void {
    this.creating.set(false);
    this.newName.set('');
  }

  async delete(id: string, e: Event): Promise<void> {
    e.stopPropagation();
    await this.eventStore.remove(id);
    if (this.selectedId() === id) {
      this.selected.emit('');
    }
  }
}
