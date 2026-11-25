export class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

/** Cookie-authenticated JSON calls to /ui/*. The X-SBM header is the CSRF guard. */
export async function api(method, path, body) {
  let res;
  try {
    res = await fetch("/ui" + path, {
      method,
      headers: { "Content-Type": "application/json", "X-SBM": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (_) {
    throw new ApiError(0, "offline");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, typeof data.detail === "string" ? data.detail : "request_failed");
  return data;
}

export const MESSAGES = {
  invalid_credentials: "Wrong username or password.",
  too_many_attempts: "Too many attempts. Try again in a few minutes.",
  wrong_password: "Current password is incorrect.",
  weak_password: "Choose a different password (at least 8 characters, not 'admin').",
  username_taken: "That username is already taken.",
  invalid_username: "Use 2-64 characters: a-z, 0-9, dot, dash or underscore.",
  registration_disabled: "Registration is disabled.",
  offline: "Cannot reach the server.",
};

export const errorText = (e) => MESSAGES[e.detail] || e.detail || e.message || String(e);
