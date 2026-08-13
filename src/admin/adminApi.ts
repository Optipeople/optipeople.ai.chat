import { fetchWithAuth } from "@/auth/authApi";
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
import type {
  AutoOrganizeApplyResponse,
  AutoOrganizePreviewResponse,
} from "@/app/api/admin/machines/[id]/auto-organize/route";
import type {
  AutoOrganizeMove,
  AutoOrganizeProposal,
  StandardFolder,
} from "@/lib/autoOrganize";

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
  AutoOrganizeMove,
  AutoOrganizeProposal,
  StandardFolder,
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

export async function updateAdminDocumentOperatorVisible(
  id: string,
  operatorVisible: boolean,
): Promise<void> {
  const res = await fetchWithAuth(`/api/admin/documents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operatorVisible }),
  });
  if (!res.ok) {
    throw new Error(`Kunne ikke opdatere synlighed (${res.status})`);
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Long ingests span multiple server calls: the pipeline checkpoints its
// work and answers 202 { done: false } when its per-invocation time
// budget runs out; POSTing again resumes from the checkpoint. This
// helper loops until the server reports done (endpoints that never
// return done:false — images, generic files — exit on the first pass).
//
// Continuation calls (resume=true) also retry transient failures: if a
// server invocation gets reaped at the platform limit mid-batch, the
// work done so far is persisted and calling again is safe. A 504 with
// code "timeout" is NOT transient — the server already marked the
// document failed — so it surfaces immediately, as does any failure on
// the very first call.
async function postJsonUntilDone<T>(
  url: string,
  makeBody: (resume: boolean) => Record<string, unknown>,
  errorLabel: string,
): Promise<T> {
  // Runaway guard: each continuation represents ~3.5 min of server-side
  // work, so 200 calls is far beyond any realistic document.
  const MAX_CALLS = 200;
  const MAX_CONSECUTIVE_FAILURES = 3;
  let resume = false;
  let failures = 0;
  for (let call = 0; call < MAX_CALLS; call++) {
    let res: Response;
    try {
      res = await fetchWithAuth(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeBody(resume)),
      });
    } catch (err) {
      if (!resume || ++failures > MAX_CONSECUTIVE_FAILURES) throw err;
      await sleep(5_000);
      continue;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      const transient = res.status >= 500 && body.code !== "timeout";
      if (resume && transient && ++failures <= MAX_CONSECUTIVE_FAILURES) {
        await sleep(5_000);
        continue;
      }
      throw new Error(body.error ?? `${errorLabel} (${res.status})`);
    }
    failures = 0;
    const body = (await res.json()) as { done?: boolean } & T;
    if (body.done === false) {
      resume = true;
      continue;
    }
    return body as T;
  }
  throw new Error(errorLabel);
}

export async function reprocessAdminDocument(
  id: string,
  force: "ocr" | "pdf-parse" = "ocr",
): Promise<ReprocessResult> {
  return postJsonUntilDone<ReprocessResult>(
    `/api/admin/documents/${id}/reprocess`,
    (resume) => ({ force, resume }),
    "Reprocess fejlede",
  );
}

export async function deleteAdminDocument(id: string): Promise<void> {
  const res = await fetchWithAuth(`/api/admin/documents/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`Kunne ikke slette dokument (${res.status})`);
  }
}

// Uploads go direct-to-Storage: the client asks /api/admin/ingest/sign
// for a signed Supabase upload URL, PUTs the file straight there, then
// calls the finalize endpoint with the documentId to run the pipeline.
// This bypasses Vercel's ~4.5 MB function request-body limit, which used
// to reject anything bigger with a 413 before the request reached us.
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
  return directUpload<UploadResult>({
    kind: "pdf",
    finalizeUrl: "/api/admin/ingest",
    ...args,
  });
}

export type ImageUploadResult = {
  documentId: string;
  assetId: string;
  caption: string;
  altText: string;
  byteSize: number;
  storagePath: string;
};

export async function uploadAdminImage(args: {
  machineId: string;
  file: File;
  summary?: string;
  folderPath?: string | null;
  onProgress?: UploadProgress;
}): Promise<ImageUploadResult> {
  return directUpload<ImageUploadResult>({
    kind: "image",
    finalizeUrl: "/api/admin/ingest/image",
    ...args,
  });
}

export type FileUploadResult = {
  documentId: string;
  chunkCount: number;
  byteSize: number;
  storagePath: string;
  textIngested: boolean;
};

// Generic upload for anything that isn't a PDF or image. Stores the raw
// bytes and best-effort embeds them when text can be recovered.
export async function uploadAdminFile(args: {
  machineId: string;
  file: File;
  summary?: string;
  folderPath?: string | null;
  onProgress?: UploadProgress;
}): Promise<FileUploadResult> {
  return directUpload<FileUploadResult>({
    kind: "file",
    finalizeUrl: "/api/admin/ingest/file",
    ...args,
  });
}

type SignUploadResponse = {
  documentId: string;
  storagePath: string;
  bucket: string;
  uploadUrl: string;
  token: string;
};

async function directUpload<T>(args: {
  kind: "pdf" | "image" | "file";
  finalizeUrl: string;
  machineId: string;
  file: File;
  summary?: string;
  folderPath?: string | null;
  onProgress?: UploadProgress;
}): Promise<T> {
  // The bucket enforces allowed_mime_types against the uploaded part's
  // content-type, which comes from the File. PDFs occasionally arrive
  // with an empty File.type — force application/pdf so the upload (and
  // the .pdf storage path the sign endpoint mints) stay consistent, just
  // as the old server-side upload did. Images already require a concrete
  // supported type (the sign endpoint rejects otherwise). Generic files
  // are whatever the browser says, falling back to octet-stream —
  // proprietary formats routinely report an empty type.
  const contentType =
    args.kind === "pdf"
      ? "application/pdf"
      : args.kind === "file"
        ? args.file.type || "application/octet-stream"
        : args.file.type;
  const blob =
    args.file.type === contentType
      ? args.file
      : new Blob([args.file], { type: contentType });

  // 1. Mint a signed upload URL (small JSON request — never 413s).
  // fileName rides along because a generic file's storage extension is
  // derived from it; the server sanitises it before use.
  const signRes = await fetchWithAuth("/api/admin/ingest/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      machineId: args.machineId,
      kind: args.kind,
      contentType,
      fileName: args.file.name,
    }),
  });
  if (!signRes.ok) {
    const body = (await signRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Kunne ikke starte upload (${signRes.status})`);
  }
  const sign = (await signRes.json()) as SignUploadResponse;

  // 2. PUT the bytes straight to Supabase Storage.
  await putToSignedUrl({
    uploadUrl: sign.uploadUrl,
    body: blob,
    onProgress: args.onProgress,
  });
  // The server pipeline that follows has no streaming progress, so pin
  // the bar to 100% while it runs (the queue panel switches to the
  // server-side progress rows from here).
  args.onProgress?.(1, 1);

  // 3. Finalize: run extract/caption/embed against the stored object.
  // Big PDFs span several calls — the server checkpoints and answers
  // done:false until the whole document is processed. The ingest
  // endpoint detects continuations by the existing kb_documents row, so
  // the body is identical on every call.
  return postJsonUntilDone<T>(
    args.finalizeUrl,
    () => ({
      machineId: args.machineId,
      documentId: sign.documentId,
      fileName: args.file.name,
      contentType,
      summary: args.summary,
      folderPath: args.folderPath,
    }),
    "Upload failed",
  );
}

// XHR (not fetch) gets us real upload-progress events. No Authorization
// header: the upload token is embedded in the signed URL. supabase-js
// wraps browser File/Blob bodies in multipart form-data (the file under
// the empty key, plus a cacheControl field), so we replicate that shape
// exactly — a raw binary PUT would be rejected by the storage server.
function putToSignedUrl(args: {
  uploadUrl: string;
  body: Blob;
  onProgress?: UploadProgress;
}): Promise<void> {
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", args.body);

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", args.uploadUrl);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && args.onProgress) {
        args.onProgress(e.loaded, e.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else if (xhr.status === 413) {
        reject(new Error("Filen er for stor til at uploade"));
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed (network)"));
    xhr.send(form);
  });
}

export async function previewAutoOrganize(
  machineId: string,
): Promise<AutoOrganizePreviewResponse> {
  const res = await fetchWithAuth(
    `/api/admin/machines/${machineId}/auto-organize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "preview" }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Auto-organisering fejlede (${res.status})`);
  }
  return (await res.json()) as AutoOrganizePreviewResponse;
}

export async function applyAutoOrganize(
  machineId: string,
  moves: AutoOrganizeMove[],
): Promise<AutoOrganizeApplyResponse> {
  const res = await fetchWithAuth(
    `/api/admin/machines/${machineId}/auto-organize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "apply", moves }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Kunne ikke gemme (${res.status})`);
  }
  return (await res.json()) as AutoOrganizeApplyResponse;
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
