// Storage object naming for knowledge-base uploads.
//
// Kept dependency-free and separate from the ingestion pipeline so the
// /api/admin/ingest/sign function (which only mints a path) doesn't pull
// in fflate, Voyage, and the rest of the ingest module graph.
//
// Both /sign and the finalize endpoints derive the object name from the
// same inputs — machineId, a server-generated UUID, and this extension —
// so the finalize side never has to trust a client-supplied path.

// Lowercase extension (no dot) for the storage object name, or "bin"
// when the filename has none. Preserving the real extension means a
// later download attaches a file the operator's tools can actually open.
//
// The regex matches only trailing [A-Za-z0-9]+, so the result can never
// contain a slash, dot, or anything else that would escape the
// `${machineId}/${documentId}.` prefix it gets appended to.
export function extensionForFile(fileName: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(fileName);
  return m ? m[1].toLowerCase() : "bin";
}
