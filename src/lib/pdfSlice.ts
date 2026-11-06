// Build a smaller PDF containing only selected pages.
//
// Used by the two vision passes so they send a handful of relevant pages
// instead of an entire manual. The page-number remap is the part that
// matters: once pages [12, 40, 77] become a 3-page PDF, the model reports
// them as pages 1, 2 and 3. Anything that writes a page number back to
// the database (figure anchors, "see page N") must translate through
// `originalPages` or the operator gets sent to the wrong page.

import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  type PDFObject,
} from "pdf-lib";

// ---------------------------------------------------------------------------
// Decryption
// ---------------------------------------------------------------------------
//
// Vendor manuals are very often "protected": encrypted with an EMPTY user
// password and an owner password that only restricts printing or copying.
// Every viewer opens them silently, and pdf-parse (pdf.js) decrypts them
// for text. pdf-lib does not. Loaded with `ignoreEncryption` it keeps the
// encrypted bytes, and copyPages writes them into a new, UNencrypted PDF.
// Every page of that slice renders blank. That is how a Finn-Power manual
// (Standard handler, RC4 40-bit) had every table page replaced by
// "[Blank page: no readable text]" at ingest, and why get_page_image showed
// the model empty pages for the G-code table.
//
// So an encrypted source is decrypted in memory before slicing. Only the
// empty user password is tried: a document that really needs a password
// cannot be opened by pdf-parse either, and the slice returns null.

const PASSWORD_PADDING = Buffer.from(
  "28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a",
  "hex",
);

function md5(...parts: Uint8Array[]): Buffer {
  const h = createHash("md5");
  for (const p of parts) h.update(p);
  return h.digest();
}

// RC4 is implemented here rather than taken from node:crypto because
// OpenSSL 3 only ships it in the legacy provider, which Node does not load.
function rc4(key: Uint8Array, data: Uint8Array): Buffer {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
    out[n] = data[n] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

function aesCbcDecrypt(key: Uint8Array, data: Uint8Array): Buffer {
  // The first block is the IV. Anything shorter is not a valid payload;
  // empty strings and streams are legitimately encrypted to just an IV.
  if (data.length < 32) return Buffer.alloc(0);
  const iv = data.subarray(0, 16);
  const body = data.subarray(16);
  const alg = key.length === 32 ? "aes-256-cbc" : "aes-128-cbc";
  try {
    const d = createDecipheriv(alg, key, iv);
    return Buffer.concat([d.update(body), d.final()]);
  } catch {
    // Bad PKCS#5 padding: some writers omit it. Keep the raw blocks.
    const d = createDecipheriv(alg, key, iv);
    d.setAutoPadding(false);
    return Buffer.concat([d.update(body), d.final()]);
  }
}

type CryptMethod = "none" | "rc4" | "aes";

type Decryptor = {
  stream: CryptMethod;
  string: CryptMethod;
  encryptMetadata: boolean;
  objectKey: (ref: PDFRef, method: CryptMethod) => Buffer;
};

function bytesOf(obj: PDFObject | undefined): Buffer | null {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    return Buffer.from(obj.asBytes());
  }
  return null;
}

function numberOf(obj: PDFObject | undefined, fallback: number): number {
  return obj instanceof PDFNumber ? obj.asNumber() : fallback;
}

// ISO 32000-2 algorithm 2.B, the R6 password hash.
function hashR6(password: Buffer, salt: Uint8Array, udata: Uint8Array): Buffer {
  let k = createHash("sha256").update(password).update(salt).update(udata).digest();
  for (let round = 0; ; round++) {
    const k1 = Buffer.concat(
      Array.from({ length: 64 }, () => Buffer.concat([password, k, udata])),
    );
    const enc = createCipheriv("aes-128-cbc", k.subarray(0, 16), k.subarray(16, 32));
    enc.setAutoPadding(false);
    const e = Buffer.concat([enc.update(k1), enc.final()]);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i];
    const alg = ["sha256", "sha384", "sha512"][sum % 3];
    k = createHash(alg).update(e).digest();
    if (round >= 63 && e[e.length - 1] <= round - 31) break;
  }
  return k.subarray(0, 32);
}

/**
 * Builds a decryptor for a Standard security handler document using the
 * empty user password, or null when the document cannot be opened that
 * way (a real user password, or a handler this code does not know).
 */
function buildDecryptor(
  encrypt: PDFDict,
  fileId: Buffer,
): Decryptor | null {
  const filter = encrypt.lookup(PDFName.of("Filter"));
  if (filter !== PDFName.of("Standard")) return null;

  const v = numberOf(encrypt.lookup(PDFName.of("V")), 0);
  const r = numberOf(encrypt.lookup(PDFName.of("R")), 0);
  const o = bytesOf(encrypt.lookup(PDFName.of("O")));
  const u = bytesOf(encrypt.lookup(PDFName.of("U")));
  if (!o || !u) return null;
  const em = encrypt.lookup(PDFName.of("EncryptMetadata"));
  const encryptMetadata = !(em instanceof PDFBool) || em.asBoolean();

  // Which method strings and streams use. V1/V2 are always RC4; V4 and V5
  // name a crypt filter per object class.
  let stream: CryptMethod = "rc4";
  let string: CryptMethod = "rc4";
  if (v >= 4) {
    const cf = encrypt.lookup(PDFName.of("CF"));
    const methodFor = (key: string): CryptMethod => {
      const name = encrypt.lookup(PDFName.of(key));
      if (!(name instanceof PDFName) || name === PDFName.of("Identity")) {
        return "none";
      }
      const filterDict = cf instanceof PDFDict ? cf.lookup(name) : undefined;
      const cfm =
        filterDict instanceof PDFDict
          ? filterDict.lookup(PDFName.of("CFM"))
          : undefined;
      if (cfm === PDFName.of("AESV2") || cfm === PDFName.of("AESV3")) return "aes";
      if (cfm === PDFName.of("V2")) return "rc4";
      return "none";
    };
    stream = methodFor("StmF");
    string = methodFor("StrF");
  }

  if (v === 5) {
    // AES-256 (R5 and R6): one file key, no per-object derivation.
    const ue = bytesOf(encrypt.lookup(PDFName.of("UE")));
    if (!ue || u.length < 48) return null;
    const empty = Buffer.alloc(0);
    const validationSalt = u.subarray(32, 40);
    const keySalt = u.subarray(40, 48);
    const hash = (salt: Uint8Array) =>
      r >= 6
        ? hashR6(empty, salt, empty)
        : createHash("sha256").update(salt).digest();
    if (!hash(validationSalt).equals(u.subarray(0, 32))) return null;
    const d = createDecipheriv("aes-256-cbc", hash(keySalt), Buffer.alloc(16));
    d.setAutoPadding(false);
    const fileKey = Buffer.concat([d.update(ue.subarray(0, 32)), d.final()]);
    return {
      stream,
      string,
      encryptMetadata,
      objectKey: () => fileKey,
    };
  }

  if (v < 1 || v > 4 || r < 2 || r > 4) return null;

  // Algorithm 2: the file key from the (empty) user password.
  const n = r === 2 ? 5 : Math.min(numberOf(encrypt.lookup(PDFName.of("Length")), 40) / 8, 16);
  const p = Buffer.alloc(4);
  p.writeInt32LE(numberOf(encrypt.lookup(PDFName.of("P")), 0) | 0);
  let key = md5(
    PASSWORD_PADDING,
    o.subarray(0, 32),
    p,
    fileId,
    r >= 4 && !encryptMetadata ? Buffer.from([0xff, 0xff, 0xff, 0xff]) : Buffer.alloc(0),
  );
  if (r >= 3) {
    for (let i = 0; i < 50; i++) key = md5(key.subarray(0, n));
  }
  key = key.subarray(0, n);

  // Algorithms 4 and 5: check the empty password really opens it.
  if (r === 2) {
    if (!rc4(key, PASSWORD_PADDING).equals(u.subarray(0, 32))) return null;
  } else {
    let check = rc4(key, md5(PASSWORD_PADDING, fileId));
    for (let i = 1; i <= 19; i++) {
      check = rc4(key.map((b) => b ^ i), check);
    }
    if (!check.subarray(0, 16).equals(u.subarray(0, 16))) return null;
  }

  // Algorithm 1: the per-object key.
  return {
    stream,
    string,
    encryptMetadata,
    objectKey: (ref, method) => {
      const id = Buffer.alloc(5);
      id.writeUIntLE(ref.objectNumber & 0xffffff, 0, 3);
      id.writeUInt16LE(ref.generationNumber & 0xffff, 3);
      const salt = method === "aes" ? Buffer.from("sAlT", "latin1") : Buffer.alloc(0);
      return md5(key, id, salt).subarray(0, Math.min(n + 5, 16));
    },
  };
}

function decryptBytes(
  data: Uint8Array,
  ref: PDFRef,
  method: CryptMethod,
  dec: Decryptor,
): Buffer {
  if (method === "none") return Buffer.from(data);
  const key = dec.objectKey(ref, method);
  return method === "aes" ? aesCbcDecrypt(key, data) : rc4(key, data);
}

// Strings can sit anywhere inside an object's dictionaries and arrays.
function decryptStringsIn(
  obj: PDFObject,
  ref: PDFRef,
  dec: Decryptor,
): PDFObject {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    const plain = decryptBytes(obj.asBytes(), ref, dec.string, dec);
    return PDFHexString.of(plain.toString("hex"));
  }
  if (obj instanceof PDFDict) {
    for (const [k, val] of obj.entries()) obj.set(k, decryptStringsIn(val, ref, dec));
    return obj;
  }
  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) obj.set(i, decryptStringsIn(obj.get(i), ref, dec));
    return obj;
  }
  return obj;
}

/**
 * Decrypts every indirect object of `doc` in place and drops the
 * encryption dictionary. Returns false when the document cannot be
 * opened with the empty user password, leaving it untouched.
 */
function decryptInPlace(doc: PDFDocument): boolean {
  const ctx = doc.context;
  const encryptRef = ctx.trailerInfo.Encrypt;
  const encrypt = ctx.lookup(encryptRef);
  if (!(encrypt instanceof PDFDict)) return false;
  const idArray = ctx.lookup(ctx.trailerInfo.ID);
  const fileId =
    idArray instanceof PDFArray ? bytesOf(idArray.get(0)) ?? Buffer.alloc(0) : Buffer.alloc(0);

  const dec = buildDecryptor(encrypt, fileId);
  if (!dec) return false;

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (encryptRef instanceof PDFRef && ref === encryptRef) continue;
    if (obj instanceof PDFRawStream) {
      const type = obj.dict.lookup(PDFName.of("Type"));
      if (type === PDFName.of("XRef")) continue;
      decryptStringsIn(obj.dict, ref, dec);
      if (!dec.encryptMetadata && type === PDFName.of("Metadata")) continue;
      ctx.assign(ref, PDFRawStream.of(obj.dict, decryptBytes(obj.contents, ref, dec.stream, dec)));
      continue;
    }
    ctx.assign(ref, decryptStringsIn(obj, ref, dec));
  }
  ctx.trailerInfo.Encrypt = undefined;
  return true;
}

export type SlicedPdf = {
  buffer: Buffer;
  /**
   * Original 1-indexed page numbers, in the order they appear in the
   * sliced PDF. `originalPages[i]` is the source page for sliced page
   * `i + 1`, so map a model-reported page with `toOriginalPage`.
   */
  originalPages: number[];
};

/**
 * Copies `pages` (1-indexed, in ascending order) into a new PDF.
 * Returns null if the slice can't be produced, so callers fall back to
 * the full document rather than losing content.
 */
export async function slicePdfPages(
  buf: Buffer,
  pages: number[],
): Promise<SlicedPdf | null> {
  if (pages.length === 0) return null;
  try {
    // Vendor manuals are frequently a bit malformed; pdf-lib refuses them
    // outright unless it is allowed to tolerate that, and a document we
    // only want to re-page does not need strict parsing.
    const src = await PDFDocument.load(new Uint8Array(buf), {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
    });
    // An encrypted source copied as-is produces blank pages (see the
    // decryption section above). Never hand those to a vision model: a
    // null makes the caller fall back to the whole original document.
    if (src.isEncrypted && !decryptInPlace(src)) {
      console.warn("slicePdfPages: encrypted PDF could not be decrypted; not slicing");
      return null;
    }
    const total = src.getPageCount();

    // Drop anything out of range and de-duplicate while preserving order.
    // pdf.js and pdf-lib very occasionally disagree on page count for
    // damaged files, and an out-of-range index throws inside copyPages.
    const wanted: number[] = [];
    const seen = new Set<number>();
    for (const p of pages) {
      if (p >= 1 && p <= total && !seen.has(p)) {
        seen.add(p);
        wanted.push(p);
      }
    }
    if (wanted.length === 0) return null;

    const out = await PDFDocument.create();
    const copied = await out.copyPages(
      src,
      wanted.map((p) => p - 1),
    );
    for (const page of copied) out.addPage(page);

    const bytes = await out.save();
    return { buffer: Buffer.from(bytes), originalPages: wanted };
  } catch (err) {
    console.warn(
      "slicePdfPages: falling back to whole document:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Translates a page number reported against a sliced PDF back to the
 * original document. Out-of-range input returns null so a hallucinated
 * page number can't silently anchor a figure to the wrong page.
 */
export function toOriginalPage(
  slicedPage: number,
  originalPages: number[],
): number | null {
  if (!Number.isInteger(slicedPage) || slicedPage < 1) return null;
  return originalPages[slicedPage - 1] ?? null;
}
