// Flattens DataTransferItemList (drag-drop) into a flat File[] including
// files from any folders the user drags. Falls back to plain dataTransfer.files
// when the FileSystem API isn't available (Firefox older releases, Safari
// quirks). Filters to PDFs since that's what the ingest endpoint accepts.

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

function readFile(entry: FileSystemEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.file) return reject(new Error("entry.file not available"));
    entry.file(resolve, reject);
  });
}

function readDir(entry: FileSystemEntryLike): Promise<FileSystemEntryLike[]> {
  if (!entry.createReader) return Promise.resolve([]);
  const reader = entry.createReader();
  // readEntries returns at most ~100 entries per call — keep calling until empty.
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

async function walk(entry: FileSystemEntryLike): Promise<File[]> {
  if (entry.isFile) {
    try {
      return [await readFile(entry)];
    } catch {
      return [];
    }
  }
  if (entry.isDirectory) {
    const children = await readDir(entry);
    const out: File[] = [];
    for (const child of children) {
      out.push(...(await walk(child)));
    }
    return out;
  }
  return [];
}

export async function filesFromDrop(
  dt: DataTransfer,
): Promise<File[]> {
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

  let files: File[];
  if (entries.length > 0) {
    const nested = await Promise.all(entries.map(walk));
    files = nested.flat();
  } else {
    files = Array.from(dt.files);
  }

  // PDF-only — silently drop other types so dragging a mixed folder works.
  return files.filter(
    (f) =>
      f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
  );
}
