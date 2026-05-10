// Flattens a DataTransferItemList from drag-drop into PDFs paired with
// their relative folder path. Walks recursively so the user can drag a
// whole knowledge-base folder containing nested subfolders.
//
// folderPath shape: slash-separated, no leading slash. A bare PDF
// dragged at the drop root has folderPath = null. A PDF inside
// `Setup/Calibration/foo.pdf` becomes folderPath = "Setup/Calibration".

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

export type DroppedPdf = {
  file: File;
  folderPath: string | null;
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
): Promise<DroppedPdf[]> {
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
    const out: DroppedPdf[] = [];
    for (const child of children) {
      out.push(...(await walk(child, childPath)));
    }
    return out;
  }
  return [];
}

function isPdf(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

export async function filesFromDrop(dt: DataTransfer): Promise<DroppedPdf[]> {
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

  let pdfs: DroppedPdf[];
  if (entries.length > 0) {
    // Files at the drop root (i.e. siblings of any dropped folder) get
    // folderPath=null. Files inside a dropped folder inherit that
    // folder's name as the path.
    const nested = await Promise.all(entries.map((e) => walk(e, null)));
    pdfs = nested.flat();
  } else {
    pdfs = Array.from(dt.files).map((file) => ({ file, folderPath: null }));
  }

  return pdfs.filter((p) => isPdf(p.file));
}
