import { PublishState } from "../types";
import type { PricingQuote } from "../api/_lib/pricing";
import type {
  Operation,
  OperationState,
  RefundReason,
  SourceCheck,
} from "../api/_lib/order-operations";
import type { WatchPhoto } from "./watch-photos";

const TOKEN_KEY = "chronos_admin_token";
const AUTH_CHANGE = "mvw-admin-auth-change";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "";

export function studioRequest<T = any>(
  method: "GET" | "POST",
  body?: unknown,
): Promise<T> {
  return request<T>(
    "/api/studio",
    { method, ...(body ? { body: JSON.stringify(body) } : {}) },
    true,
  );
}

// Binary PNG avoids base64 inflating a lossless photograph beyond serverless response limits.
export async function studioRender(
  body: Record<string, unknown>,
): Promise<{ imageDataUrl: string; manifest: Record<string, any> }> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/studio`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ...body, responseFormat: "png" }),
  });
  if (!res.ok) {
    if (res.status === 401 && token === getToken()) clearToken();
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "REQUEST_FAILED");
  }
  const manifest = JSON.parse(
    decodeURIComponent(res.headers.get("X-Studio-Manifest") || "{}"),
  );
  const blob = await res.blob();
  const imageDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return { imageDataUrl, manifest };
}

function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
  window.dispatchEvent(new Event(AUTH_CHANGE));
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event(AUTH_CHANGE));
}

export function hasToken(): boolean {
  return !!getToken();
}

export function subscribeAdminAuth(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === TOKEN_KEY || event.key === null) onChange();
  };
  window.addEventListener(AUTH_CHANGE, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(AUTH_CHANGE, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

async function request<T>(
  path: string,
  opts: RequestInit = {},
  auth = false,
): Promise<T> {
  const headers: Record<string, string> = {
    ...(opts.headers as any),
  };

  if (!headers["Content-Type"] && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const token = auth ? getToken() : "";
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    if (res.status === 401 && token && token === getToken()) clearToken();
    const err: any = new Error(data?.error || "REQUEST_FAILED");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

export async function login(password: string): Promise<void> {
  const { token } = await request<{ token: string }>(
    "/api/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ password }),
    },
    false,
  );
  setToken(token);
}

export async function fetchPublicItems() {
  const { items } = await request<{ items: any[] }>(
    "/api/items",
    { method: "GET" },
    false,
  );
  return items;
}

export async function fetchAllItems() {
  const { items } = await request<{ items: any[] }>(
    "/api/items",
    { method: "GET" },
    true,
  );
  return items;
}

export async function fetchItem(id: string, admin = false) {
  const { item } = await request<{ item: any }>(
    `/api/item/${encodeURIComponent(id)}`,
    { method: "GET" },
    admin,
  );
  return item;
}

export async function patchItem(
  id: string,
  patch: Partial<{
    publishStatus: PublishState;
    titleBoutique: string;
    description: string;
    score: number;
    photoReview: WatchPhoto[];
  }>,
) {
  const { item } = await request<{ item: any }>(
    `/api/item/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
    true,
  );
  return item;
}

export async function runIngest() {
  return await request<{ ok: boolean; discovered: number; upserted: number }>(
    "/api/jobs/ingest",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    true,
  );
}

export async function runCurate(id: string) {
  const { item } = await request<{ ok: boolean; item: any }>(
    "/api/jobs/curate",
    {
      method: "POST",
      body: JSON.stringify({ id }),
    },
    true,
  );
  return item;
}

export async function fetchSettings() {
  const { settings } = await request<{ settings: any }>(
    "/api/settings",
    { method: "GET" },
    true,
  );
  return settings;
}

export async function saveSettings(settings: any) {
  return await request<{ ok: boolean }>(
    "/api/settings",
    { method: "PUT", body: JSON.stringify({ settings }) },
    true,
  );
}

export async function fetchLogs(limit = 50) {
  const { logs } = await request<{ logs: any[] }>(
    `/api/logs?limit=${limit}`,
    { method: "GET" },
    true,
  );
  return logs;
}

export interface AdminOrderSummary {
  id: string;
  status: string;
  totalPence: number;
  currency: string;
  createdAt: string;
  stripeSessionId: string | null;
  operation: Operation | null;
  lines: Array<{
    itemId: string;
    title: string;
    amountPence: number;
    sourceUrl: string;
    ebayItemId: string;
    pricing?: PricingQuote | null;
  }>;
}

export async function fetchOrders(): Promise<AdminOrderSummary[]> {
  const { orders } = await request<{ orders: AdminOrderSummary[] }>(
    "/api/orders",
    { method: "GET" },
    true,
  );
  return orders;
}

type OrderAction =
  | { action: "check_source"; itemId: string }
  | { action: "refund_requested"; revision: number; reason: RefundReason }
  | {
      action:
        | Exclude<OperationState, "refunded" | "refund_requested">
        | "check_refund";
      revision: number;
    };

export async function manageOrder(orderId: string, action: OrderAction) {
  return request<{
    source?: SourceCheck;
    operation?: Operation;
    refund?: {
      succeededPence: number;
      pending: boolean;
      needsAttention: boolean;
      complete: boolean;
    };
  }>(
    "/api/orders",
    { method: "POST", body: JSON.stringify({ orderId, ...action }) },
    true,
  );
}
