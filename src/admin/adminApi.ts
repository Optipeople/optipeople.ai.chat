import { fetchWithAuth } from "@/auth/authApi";
import { getAccessToken } from "@/auth/storage";
import type { AdminMachine } from "@/app/api/admin/machines/route";
import type {
  AdminDocument,
  AdminMachineDetail,
} from "@/app/api/admin/machines/[id]/route";
import type { AdminConversationListItem } from "@/app/api/admin/machines/[id]/conversations/route";
import type { AdminEscalationListItem } from "@/app/api/admin/machines/[id]/escalations/route";
import type {
  AdminChunkRef,
  AdminConversationDetail,
  AdminConversationMessage,
  AdminFeedback,
} from "@/app/api/admin/conversations/[id]/route";
import type { AdminQrTokenResponse } from "@/app/api/admin/machines/[id]/qr/route";
import type {
  AdminEscalationTarget,
  AdminEscalationTargetResponse,
} from "@/app/api/admin/accounts/[accountId]/escalation/route";

export type {
  AdminChunkRef,
  AdminConversationDetail,
  AdminConversationListItem,
  AdminConversationMessage,
  AdminDocument,
  AdminEscalationListItem,
  AdminEscalationTarget,
  AdminFeedback,
  AdminMachine,
  AdminMachineDetail,
  AdminQrTokenResponse,
};

export async function getAdminMachines(): Promise<AdminMachine[]> {
  const res = await fetchWithAuth("/api/admin/machines");
  if (res.status === 401 || res.status === 403) {
    throw new Error("Du har ikke adgang til admin");
  }
  if (!res.ok) {
    throw new Error(`Kunne ikke hente maskiner (${res.status})`);
  }
  const body = (await res.json()) as { machines?: AdminMachine[] };
  return body.machines ?? [];
}

export async function getAdminMachine(id: string): Promise<AdminMachineDetail> {
  const res = await fetchWithAuth(`/api/admin/machines/${id}`);
  if (res.status === 404) {
    throw new Error("Maskinen findes ikke");
  }
  if (!res.ok) {
    throw new Error(`Kunne ikke hente maskine (${res.status})`);
  }
  return (await res.json()) as AdminMachineDetail;
}

export async function updateAdminMachineName(
  id: string,
  displayName: string,
): Promise<void> {
  const res = await fetchWithAuth(`/api/admin/machines/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) {
    throw new Error(`Kunne ikke gemme navn (${res.status})`);
  }
}

export async function createAdminMachine(input: {
  machineId: string;
  accountId: string;
  displayName: string | null;
}): Promise<AdminMachine> {
  const res = await fetchWithAuth(`/api/admin/machines`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Kunne ikke oprette maskine (${res.status})`);
  }
  const out = (await res.json()) as { machine: AdminMachine };
  return out.machine;
}

export async function deleteAdminMachine(id: string): Promise<void> {
  const res = await fetchWithAuth(`/api/admin/machines/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Kunne ikke slette maskine (${res.status})`);
  }
}

export async function updateAdminDocumentSummary(
  id: string,
  summary: string,
): Promise<void> {
  const res = await fetchWithAuth(`/api/admin/documents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ summary }),
  });
  if (!res.ok) {
    throw new Error(`Kunne ikke gemme beskrivelse (${res.status})`);
  }
}

export async function updateAdminDocumentFolder(
  id: string,
  folderPath: string | null,
): Promise<void> {
  const res = await fetchWithAuth(`/api/admin/documents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderPath }),
  });
  if (!res.ok) {
    throw new Error(`Kunne ikke flytte dokument (${res.status})`);
  }
}

export async function getAdminDocumentSignedUrl(
  id: string,
  opts: { download?: boolean } = {},
): Promise<{ url: string; fileName: string }> {
  const qs = opts.download ? "?download=1" : "";
  const res = await fetchWithAuth(`/api/admin/documents/${id}/url${qs}`);
  if (!res.ok) {
    throw new Error(`Kunne ikke hente fil-URL (${res.status})`);
  }
  return (await res.json()) as { url: string; fileName: string };
}

export async function createAdminFolder(
  machineId: string,
  path: string,
): Promise<void> {
  const res = await fetchWithAuth(
    `/api/admin/machines/${machineId}/folders`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Kunne ikke oprette mappe (${res.status})`);
  }
}

export async function deleteAdminFolder(
  machineId: string,
  path: string,
): Promise<void> {
  const res = await fetchWithAuth(
    `/api/admin/machines/${machineId}/folders`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Kunne ikke slette mappe (${res.status})`);
  }
}

export async function listAdminConversations(
  machineId: string,
  page = 0,
  perPage = 25,
): Promise<{
  conversations: AdminConversationListItem[];
  page: number;
  perPage: number;
  hasMore: boolean;
}> {
  const res = await fetchWithAuth(
    `/api/admin/machines/${machineId}/conversations?page=${page}&perPage=${perPage}`,
  );
  if (!res.ok) {
    throw new Error(`Kunne ikke hente samtaler (${res.status})`);
  }
  return (await res.json()) as {
    conversations: AdminConversationListItem[];
    page: number;
    perPage: number;
    hasMore: boolean;
  };
}

export async function listAdminEscalations(
  machineId: string,
  page = 0,
  perPage = 25,
): Promise<{
  escalations: AdminEscalationListItem[];
  page: number;
  perPage: number;
  hasMore: boolean;
}> {
  const res = await fetchWithAuth(
    `/api/admin/machines/${machineId}/escalations?page=${page}&perPage=${perPage}`,
  );
  if (!res.ok) {
    throw new Error(`Kunne ikke hente eskaleringer (${res.status})`);
  }
  return (await res.json()) as {
    escalations: AdminEscalationListItem[];
    page: number;
    perPage: number;
    hasMore: boolean;
  };
}

export async function getAdminConversation(
  id: string,
): Promise<AdminConversationDetail> {
  const res = await fetchWithAuth(`/api/admin/conversations/${id}`);
  if (res.status === 404) throw new Error("Samtalen findes ikke");
  if (!res.ok) {
    throw new Error(`Kunne ikke hente samtale (${res.status})`);
  }
  return (await res.json()) as AdminConversationDetail;
}

export type ReprocessResult = {
  documentId: string;
  chunkCount: number;
  pageCount: number;
  extractionSource: "pdf-parse" | "claude-ocr";
};

export async function reprocessAdminDocument(
  id: string,
  force: "ocr" | "pdf-parse" = "ocr",
): Promise<ReprocessResult> {
  const res = await fetchWithAuth(`/api/admin/documents/${id}/reprocess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Reprocess fejlede (${res.status})`);
  }
  return (await res.json()) as ReprocessResult;
}

export async function deleteAdminDocument(id: string): Promise<void> {
  const res = await fetchWithAuth(`/api/admin/documents/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`Kunne ikke slette dokument (${res.status})`);
  }
}

// Multipart uploads use raw fetch — fetchWithAuth's transparent retry-on-401
// can't replay a streamed FormData body, so we do the auth header
// ourselves. If the token's expired the user just sees an error and can
// retry; the next regular request will trigger the refresh.
export type UploadProgress = (loaded: number, total: number) => void;

export type UploadResult = {
  documentId: string;
  chunkCount: number;
  pageCount: number;
  extractionSource: "pdf-parse" | "claude-ocr";
};

export async function uploadAdminDocument(args: {
  machineId: string;
  file: File;
  summary?: string;
  folderPath?: string | null;
  onProgress?: UploadProgress;
}): Promise<UploadResult> {
  const token = getAccessToken();
  if (!token) throw new Error("Session expired");

  const form = new FormData();
  form.set("machineId", args.machineId);
  form.set("file", args.file);
  if (args.summary) form.set("summary", args.summary);
  if (args.folderPath) form.set("folderPath", args.folderPath);

  // Use XHR so we can track upload progress events. fetch() doesn't
  // expose them yet across browsers.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/ingest");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && args.onProgress) {
        args.onProgress(e.loaded, e.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as UploadResult);
      } else {
        const message =
          (xhr.response as { error?: string } | null)?.error ??
          `Upload fejlede (${xhr.status})`;
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error("Upload fejlede (netværk)"));
    xhr.send(form);
  });
}

export async function generateAdminMachineQr(
  machineId: string,
): Promise<AdminQrTokenResponse> {
  const res = await fetchWithAuth(`/api/admin/machines/${machineId}/qr`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Kunne ikke generere QR-kode (${res.status})`);
  }
  return (await res.json()) as AdminQrTokenResponse;
}

export async function revokeAdminMachineQr(machineId: string): Promise<void> {
  const res = await fetchWithAuth(`/api/admin/machines/${machineId}/qr`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`Kunne ikke inaktivere QR-kode (${res.status})`);
  }
}

export async function getAdminEscalationTarget(
  accountId: string,
): Promise<AdminEscalationTarget | null> {
  const res = await fetchWithAuth(
    `/api/admin/accounts/${encodeURIComponent(accountId)}/escalation`,
  );
  if (!res.ok) {
    throw new Error(`Kunne ikke hente service-target (${res.status})`);
  }
  const body = (await res.json()) as AdminEscalationTargetResponse;
  return body.target;
}

export async function saveAdminEscalationTarget(
  accountId: string,
  input: {
    channel: AdminEscalationTarget["channel"];
    target: string;
    label: string | null;
  },
): Promise<AdminEscalationTarget> {
  const res = await fetchWithAuth(
    `/api/admin/accounts/${encodeURIComponent(accountId)}/escalation`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Kunne ikke gemme target (${res.status})`);
  }
  const out = (await res.json()) as AdminEscalationTargetResponse;
  if (!out.target) throw new Error("Server returnerede tom target");
  return out.target;
}

export async function clearAdminEscalationTarget(
  accountId: string,
): Promise<void> {
  const res = await fetchWithAuth(
    `/api/admin/accounts/${encodeURIComponent(accountId)}/escalation`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    throw new Error(`Kunne ikke fjerne target (${res.status})`);
  }
}
