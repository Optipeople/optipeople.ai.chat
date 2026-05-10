// QR session storage. Lives in sessionStorage (per-tab) so refreshing
// the chat keeps the operator anchored to the same machine, but a new
// tab requires a fresh scan. The token itself flows through the URL
// once on first load, then is stripped — sessionStorage carries it
// from that point on.

const QR_TOKEN_KEY = "optiai_qr_token";
const QR_MACHINE_KEY = "optiai_qr_machine";

export type QrMachineInfo = {
  id: string;
  accountId: string;
  name: string | null;
};

export function getQrToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(QR_TOKEN_KEY);
}

export function getQrMachine(): QrMachineInfo | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(QR_MACHINE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as QrMachineInfo;
  } catch {
    return null;
  }
}

export function saveQrSession(token: string, machine: QrMachineInfo): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(QR_TOKEN_KEY, token);
  window.sessionStorage.setItem(QR_MACHINE_KEY, JSON.stringify(machine));
}

export function clearQrSession(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(QR_TOKEN_KEY);
  window.sessionStorage.removeItem(QR_MACHINE_KEY);
}
