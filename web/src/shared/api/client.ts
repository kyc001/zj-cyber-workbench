import type { CommonResponsePayload } from "./types";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

type RawRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  headers?: HeadersInit;
  body?: BodyInit;
};

export class ApiError extends Error {
  readonly status: number;
  readonly response?: CommonResponsePayload;

  constructor(status: number, response?: CommonResponsePayload) {
    super(response?.message || "请求失败");
    this.name = "ApiError";
    this.status = status;
    this.response = response;
  }
}

function isCommonResponsePayload(value: unknown): value is CommonResponsePayload {
  return typeof value === "object" && value !== null && "message" in value;
}

async function parseJsonResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return undefined;
  }
  return response.json() as Promise<unknown>;
}

function parseCommonResponseError(response: Response, parsed: unknown) {
  const payload = isCommonResponsePayload(parsed) ? parsed : undefined;
  const payloadCode = typeof payload?.code === "number" ? payload.code : response.status;
  if (!response.ok || payloadCode >= 400) {
    throw new ApiError(response.status, payload);
  }
}

export async function apiRequest<ResponsePayload>(path: string, options: RequestOptions = {}) {
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    throw new ApiError(0, {
      code: 0,
      message: error instanceof Error ? error.message : "网络请求失败",
    });
  }

  const parsed = await parseJsonResponse(response);
  parseCommonResponseError(response, parsed);
  return parsed as ResponsePayload;
}

export function apiGet<ResponsePayload>(path: string) {
  return apiRequest<ResponsePayload>(path);
}

export function apiPost<ResponsePayload>(path: string, body?: unknown) {
  return apiRequest<ResponsePayload>(path, { method: "POST", body });
}

export function apiPatch<ResponsePayload>(path: string, body: unknown) {
  return apiRequest<ResponsePayload>(path, { method: "PATCH", body });
}

export function apiDelete<ResponsePayload>(path: string) {
  return apiRequest<ResponsePayload>(path, { method: "DELETE" });
}

async function rawApiRequest(path: string, options: RawRequestOptions = {}) {
  const headers = new Headers(options.headers);
  try {
    return await fetch(path, {
      method: options.method || "GET",
      headers,
      body: options.body,
    });
  } catch (error) {
    throw new ApiError(0, {
      code: 0,
      message: error instanceof Error ? error.message : "网络请求失败",
    });
  }
}

export async function apiForm<ResponsePayload>(path: string, body: FormData) {
  const response = await rawApiRequest(path, {
    method: "POST",
    headers: { Accept: "application/json" },
    body,
  });
  const parsed = await parseJsonResponse(response);
  parseCommonResponseError(response, parsed);
  return parsed as ResponsePayload;
}

export async function apiBlob(path: string) {
  const response = await rawApiRequest(path);
  if (!response.ok) {
    const parsed = await parseJsonResponse(response);
    parseCommonResponseError(response, parsed);
    throw new ApiError(response.status);
  }
  return {
    blob: await response.blob(),
    filename: parseContentDispositionFilename(response.headers.get("content-disposition")),
  };
}

export function buildWebSocketUrl(path: string) {
  const wsScheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${wsScheme}://${window.location.host}${path}`;
}

function parseContentDispositionFilename(header: string | null) {
  if (!header) return "下载文件";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded?.[1]) return decodeURIComponent(encoded[1]);
  const quoted = /filename="([^"]+)"/i.exec(header);
  if (quoted?.[1]) return quoted[1];
  return "下载文件";
}
