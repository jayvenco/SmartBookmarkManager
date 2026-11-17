import { getConfig } from "./config.js";

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

async function request(serverUrl, path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${serverUrl}/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new ApiError(0, "Cannot reach the server");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, typeof data.detail === "string" ? data.detail : "request_failed");
  return data;
}

export async function apiFetch(path, options = {}) {
  const { serverUrl, token } = await getConfig();
  if (!serverUrl || !token) throw new ApiError(401, "not_configured");
  return request(serverUrl, path, { ...options, token });
}

export function login(serverUrl, username, password, deviceName) {
  return request(serverUrl, "/auth/login", { method: "POST", body: { username, password, device_name: deviceName } });
}

export function changePassword(serverUrl, token, currentPassword, newPassword) {
  return request(serverUrl, "/auth/change-password", {
    method: "POST",
    token,
    body: { current_password: currentPassword, new_password: newPassword },
  });
}
