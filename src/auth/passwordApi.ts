// Password reset endpoints. Both go through the unauthenticated
// /auth-api proxy — these calls happen before the user has a valid
// session.
//
// IMPORTANT: this backend reports many failures as HTTP 200 with an
// envelope of {data, errors, meta} — e.g. a rejected password policy
// comes back as 200 + errors[]. Treating res.ok as success silently
// swallows those, so every response body must be checked for errors.

const FORGOT_URL = "/auth-api/IncomacAuthentication/ForgotPassword";
const SET_NEW_URL = "/auth-api/User/SetNewForgottenPassword";

type ErrorEnvelope = {
  errors?: { title?: string; message?: string }[];
  message?: string;
  error?: string;
  error_description?: string;
};

// "policy" = the backend rejected the new password against its password
// rules — the UI should show the policy requirements, not a generic
// failure.
export class PasswordResetError extends Error {
  code: "policy" | "generic";
  constructor(code: "policy" | "generic", detail?: string) {
    super(detail ?? `Password reset failed (${code})`);
    this.name = "PasswordResetError";
    this.code = code;
  }
}

async function readBody(res: Response): Promise<ErrorEnvelope | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as ErrorEnvelope;
    } catch {
      return { message: text.trim() };
    }
  } catch {
    return null;
  }
}

function envelopeErrors(
  body: ErrorEnvelope | null,
): { title?: string; message?: string }[] {
  return body?.errors ?? [];
}

function detailMessage(body: ErrorEnvelope | null): string | null {
  if (!body) return null;
  const fromEnvelope = envelopeErrors(body)
    .map((e) => e.message)
    .filter(Boolean)
    .join(" ");
  return (
    fromEnvelope ||
    body.error_description ||
    body.message ||
    body.error ||
    null
  );
}

export async function requestPasswordReset(
  email: string,
  resetUrl: string,
): Promise<void> {
  const res = await fetch(FORGOT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, resetUrl }),
  });
  const body = await readBody(res);
  if (!res.ok || envelopeErrors(body).length > 0) {
    throw new Error(
      detailMessage(body) ?? `Forgot-password request failed (${res.status})`,
    );
  }
}

export async function setNewPassword(args: {
  token: string;
  email: string;
  newPassword: string;
}): Promise<void> {
  const res = await fetch(SET_NEW_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await readBody(res);
  const errors = envelopeErrors(body);
  if (!res.ok || errors.length > 0) {
    // The policy rejection arrives titled after the offending field.
    const isPolicy = errors.some((e) => e.title === "newPassword");
    throw new PasswordResetError(
      isPolicy ? "policy" : "generic",
      detailMessage(body) ?? `Password reset failed (${res.status})`,
    );
  }
}
