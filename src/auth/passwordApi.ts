// Password reset endpoints. Both go through the unauthenticated
// /auth-api proxy — these calls happen before the user has a valid
// session.

const FORGOT_URL = "/auth-api/IncomacAuthentication/ForgotPassword";
const SET_NEW_URL = "/auth-api/User/SetNewForgottenPassword";

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      const data = JSON.parse(text) as {
        message?: string;
        error?: string;
        error_description?: string;
      };
      return (
        data.error_description ?? data.message ?? data.error ?? text.trim()
      );
    } catch {
      return text.trim();
    }
  } catch {
    return null;
  }
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
  if (!res.ok) {
    const detail = await readErrorMessage(res);
    throw new Error(detail ?? `Forgot-password request failed (${res.status})`);
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
  if (!res.ok) {
    const detail = await readErrorMessage(res);
    throw new Error(detail ?? `Password reset failed (${res.status})`);
  }
}
