// Flattens a DataTransferItemList from drag-drop into KB files paired
// with their relative folder path. Walks recursively so the user can
// drag a whole knowledge-base folder containing nested subfolders.
//
// folderPath shape: slash-separated, no leading slash. A bare file
// dragged at the drop root has folderPath = null. A file inside
// `Setup/Calibration/foo.pdf` becomes folderPath = "Setup/Calibration".
//
// Every file is accepted. PDFs and images get their dedicated pipelines
// (text extraction / vision captioning); anything else is classified as
// a generic "file" — stored as-is and best-effort text-embedded.

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      ok: (entries: FileSystemEntryLike[]) => void,
      err: (e: unknown) => void,
    ) => void;
  };
};

export type DroppedKind = "pdf" | "image" | "file";

export type DroppedFile = {
  file: File;
  folderPath: string | null;
  kind: DroppedKind;
};

// Back-compat alias — older call sites can keep importing DroppedPdf.
export type DroppedPdf = DroppedFile;

function readFile(entry: FileSystemEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.file) return reject(new Error("entry.file not available"));
    entry.file(resolve, reject);
  });
}

function readDir(entry: FileSystemEntryLike): Promise<FileSystemEntryLike[]> {
  if (!entry.createReader) return Promise.resolve([]);
  const reader = entry.createReader();
  return new Promise((resolve, reject) => {
    const out: FileSystemEntryLike[] = [];
    function pump() {
      reader.readEntries((entries) => {
        if (entries.length === 0) {
          resolve(out);
          return;
        }
        out.push(...entries);
        pump();
      }, reject);
    }
    pump();
  });
}

async function walk(
  entry: FileSystemEntryLike,
  parentPath: string | null,
): Promise<{ file: File; folderPath: string | null }[]> {
  if (entry.isFile) {
    try {
      const file = await readFile(entry);
      return [{ file, folderPath: parentPath }];
    } catch {
      return [];
    }
  }
  if (entry.isDirectory) {
    const children = await readDir(entry);
    const childPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    const out: { file: File; folderPath: string | null }[] = [];
    for (const child of children) {
      out.push(...(await walk(child, childPath)));
    }
    return out;
  }
  return [];
}

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const IMAGE_EXTS = /\.(png|jpe?g|webp)$/i;

// Returns null only for entries that can't be uploaded at all (a folder
// the browser surfaced as a zero-byte file). Everything with real bytes
// classifies to one of the three kinds.
export function classifyFile(file: File): DroppedKind | null {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (IMAGE_MIMES.has(file.type) || IMAGE_EXTS.test(file.name)) return "image";
  return "file";
}

export async function filesFromDrop(dt: DataTransfer): Promise<DroppedFile[]> {
  const entries: FileSystemEntryLike[] = [];
  if (dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      const entry = (
        item as unknown as {
          webkitGetAsEntry?: () => FileSystemEntryLike | null;
        }
      ).webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
  }

  let pairs: { file: File; folderPath: string | null }[];
  if (entries.length > 0) {
    const nested = await Promise.all(entries.map((e) => walk(e, null)));
    pairs = nested.flat();
  } else {
    pairs = Array.from(dt.files).map((file) => ({ file, folderPath: null }));
  }

  const out: DroppedFile[] = [];
  for (const p of pairs) {
    const kind = classifyFile(p.file);
    if (kind) out.push({ file: p.file, folderPath: p.folderPath, kind });
  }
  return out;
}
