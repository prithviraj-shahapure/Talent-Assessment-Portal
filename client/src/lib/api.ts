export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown, public code?: string) {
    super(message);
  }
}

let csrfToken: string | null = null;
async function ensureCsrf() {
  if (csrfToken) return csrfToken;
  const m = document.cookie.match(/(?:^|; )zv_csrf=([^;]+)/);
  if (m) return (csrfToken = decodeURIComponent(m[1]));
  const r = await fetch("/api/auth/csrf", { credentials: "include" });
  csrfToken = (await r.json()).token as string;
  return csrfToken;
}

type Opts = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal; keepalive?: boolean };

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const isFormData = (opts.form instanceof FormData) || (opts.body instanceof FormData);
  const method = opts.method ?? (opts.body || opts.form ? "POST" : "GET");
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["x-csrf-token"] = await ensureCsrf();
  
  // Never manually set Content-Type for FormData; allow browser to generate boundary
  if (opts.body !== undefined && !isFormData) {
    headers["content-type"] = "application/json";
  }

  const payload = isFormData
    ? (opts.form ?? (opts.body as FormData))
    : (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: "include",
      body: payload,
      signal: opts.signal,
      keepalive: opts.keepalive,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Network error — check your connection");
  }
  if (res.status === 403) {
    const data = await res.clone().json().catch(() => ({}));
    if (data.code === "CSRF" && method !== "GET") {
      csrfToken = null;
      document.cookie = "zv_csrf=; Max-Age=0; path=/";
      return api<T>(path, opts); // retry once with a fresh token
    }
  }
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const d = data as { error?: string; details?: unknown; code?: string };
    let msg = d?.error ?? `Request failed (${res.status})`;
    const fieldErrors = (d?.details as { fieldErrors?: Record<string, string[]> })?.fieldErrors;
    if (fieldErrors && Object.keys(fieldErrors).length) msg = Object.entries(fieldErrors).map(([k, v]) => `${k}: ${v[0]}`).join(" · ");
    const formErrors = (d?.details as { formErrors?: string[] })?.formErrors;
    if (formErrors?.length) msg = formErrors.join(" · ");
    throw new ApiError(res.status, msg, d?.details, d?.code);
  }
  return data as T;
}

/** Downloads a file from an authenticated endpoint. */
export async function download(path: string, fallbackName: string) {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new ApiError(res.status, d.error ?? "Download failed");
  }
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => v !== undefined && v !== null && v !== "" && p.set(k, String(v)));
  const s = p.toString();
  return s ? `?${s}` : "";
};
