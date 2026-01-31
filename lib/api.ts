import { PublishState } from '../types';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '';

function getToken(): string {
  return localStorage.getItem('chronos_admin_token') || '';
}

export function setToken(token: string) {
  localStorage.setItem('chronos_admin_token', token);
}

export function clearToken() {
  localStorage.removeItem('chronos_admin_token');
}

export function hasToken(): boolean {
  return !!getToken();
}

async function request<T>(path: string, opts: RequestInit = {}, auth = false): Promise<T> {
  const headers: Record<string, string> = {
    ...(opts.headers as any),
  };

  if (!headers['Content-Type'] && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err: any = new Error(data?.error || 'REQUEST_FAILED');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

export async function login(password: string): Promise<void> {
  const { token } = await request<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  }, false);
  setToken(token);
}

export async function fetchPublicItems() {
  const { items } = await request<{ items: any[] }>('/api/items', { method: 'GET' }, false);
  return items;
}

export async function fetchAllItems() {
  const { items } = await request<{ items: any[] }>('/api/items', { method: 'GET' }, true);
  return items;
}

export async function fetchItem(id: string, admin = false) {
  const { item } = await request<{ item: any }>(`/api/item/${encodeURIComponent(id)}`, { method: 'GET' }, admin);
  return item;
}

export async function patchItem(id: string, patch: Partial<{ publishStatus: PublishState; titleBoutique: string; description: string; score: number }>) {
  const { item } = await request<{ item: any }>(`/api/item/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }, true);
  return item;
}

export async function runIngest() {
  return await request<{ ok: boolean; discovered: number; upserted: number }>('/api/jobs/ingest', {
    method: 'POST',
    body: JSON.stringify({}),
  }, true);
}

export async function runCurate(id: string) {
  const { item } = await request<{ ok: boolean; item: any }>('/api/jobs/curate', {
    method: 'POST',
    body: JSON.stringify({ id }),
  }, true);
  return item;
}

export async function fetchSettings() {
  const { settings } = await request<{ settings: any }>('/api/settings', { method: 'GET' }, true);
  return settings;
}

export async function saveSettings(settings: any) {
  return await request<{ ok: boolean }>('/api/settings', { method: 'PUT', body: JSON.stringify({ settings }) }, true);
}

export async function fetchLogs(limit = 50) {
  const { logs } = await request<{ logs: any[] }>(`/api/logs?limit=${limit}`, { method: 'GET' }, true);
  return logs;
}
