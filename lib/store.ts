import { PublishState } from '../types';
import type { AppStateItem } from '../api/_lib/db';
import { fetchAllItems, fetchPublicItems } from './api';

class RemoteStore {
  private items: AppStateItem[] = [];
  private listeners: (() => void)[] = [];
  private loaded = false;

  subscribe(listener: () => void) {
    this.listeners.push(listener);
    // Immediately notify once we have data.
    if (this.loaded) listener();
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  getItems() {
    return [...this.items];
  }

  async refresh(opts: { admin: boolean }) {
    const items = opts.admin ? await fetchAllItems() : await fetchPublicItems();
    this.items = items as any;
    this.loaded = true;
    this.notify();
  }

  // Convenience helpers used across the app
  getPublished() {
    return this.items.filter(i => i.publishStatus === PublishState.PUBLISHED);
  }
}

export const globalStore = new RemoteStore();
export type { AppStateItem };
