/**
 * WinZip AES-256（WzAES）ZIP：archiver-zip-encrypted 建立、@zip.js/zip.js 驗證／解壓
 */
import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import archiverZipEncrypted from 'archiver-zip-encrypted';
import { ZipReader, BlobWriter, configure } from '@zip.js/zip.js';
import { lstat_is_reparse_or_symlink } from './path_guard.js';
import { normalize_and_validate_import_member_path } from './import_path_rules.js';
import { redact_sync_zip_secrets } from './sync_zip_password.js';
import { ENV_ALLOW_7Z_PASSWORD_STDIN } from './constants.js';

configure({ useWebWorkers: false });

archiver.registerFormat('zip-encrypted', archiverZipEncrypted);

export const WZAES_MAX_ZIP_ENTRIES = 50000;
export const WZAES_MAX_UNCOMPRESSED_RATIO = 200;
export const WZAES_MAX_TOTAL_UNCOMPRESSED_BYTES = 8 * 1024 * 1024 * 1024;

/**
 * @param {string} file_path
 */
class NodeFsRandomAccessReader {
  constructor(file_path) {
    this.filePath = file_path;
    this.size = fs.statSync(file_path).size;
    /** @type {number | null} */
    this.fd = null;
    this.initialized = false;
  }

  get readable() {
    return this.createReadable();
  }

  /**
   * @param {{ offset?: number, size?: number, chunkSize?: number }} [options]
   */
  createReadable(options) {
    const reader = this;
    const offset = options && options.offset != null ? options.offset : 0;
    const total =
      options && options.size != null ? options.size : reader.size - offset;
    const chunkSize =
      options && options.chunkSize != null ? options.chunkSize : 65536;
    let chunkOffset = 0;
    return new ReadableStream({
      async pull(controller) {
        if (chunkOffset >= total) {
          controller.close();
          return;
        }
        const dataSize = Math.min(chunkSize, total - chunkOffset);
        const data = await reader.readUint8Array(
          offset + chunkOffset,
          dataSize
        );
        if (data.length) {
          controller.enqueue(data);
          chunkOffset += data.length;
        }
        if (chunkOffset >= total || (!data.length && dataSize > 0)) {
          controller.close();
        }
      },
    });
  }

  init() {
    this.fd = fs.openSync(this.filePath, 'r');
    this.initialized = true;
  }

  /**
   * @param {number} offset
   * @param {number} length
   */
  async readUint8Array(offset, length) {
    if (this.fd == null) {
      this.init();
    }
    const buf = Buffer.alloc(length);
    const read = fs.readSync(this.fd, buf, 0, length, offset);
    if (read < length) {
      return new Uint8Array(buf.subarray(0, read));
    }
    return new Uint8Array(buf);
  }
}

class FsPathWriter {
  /**
   * @param {string} dest_path
   */
  constructor(dest_path) {
    this.destPath = dest_path;
    this.bytesWritten = 0;
    this.initialized = false;
    /** @type {number | null} */
    this.fd = null;
    const writer = this;
    this._writable = new WritableStream({
      write(chunk) {
        if (!writer.initialized) {
          writer.init();
        }
        return writer.writeUint8Array(new Uint8Array(chunk));
      },
      close() {
        writer.closeFd();
      },
      abort() {
        writer.closeFd();
      },
    });
  }

  get writable() {
    return this._writable;
  }

  init() {
    if (this.initialized) {
      return;
    }
    fs.mkdirSync(path.dirname(this.destPath), { recursive: true });
    this.fd = fs.openSync(this.destPath, 'w');
    this.initialized = true;
  }

  closeFd() {
    if (this.fd != null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }

  /**
   * @param {Uint8Array} array
   */
  writeUint8Array(array) {
    if (!this.initialized) {
      this.init();
    }
    if (this.fd == null) {
      throw new Error('FsPathWriter 未初始化');
    }
    fs.writeSync(this.fd, Buffer.from(array));
    this.bytesWritten += array.length;
  }

  getData() {
    this.closeFd();
    return Promise.resolve(this.destPath);
  }
}

/**
 * @param {string} staging_root
 * @returns {{ rel: string, abs: string }[]}
 */
function collect_staging_files(staging_root) {
  /** @type {{ rel: string, abs: string }[]} */
  const out = [];
  /**
   * @param {string} dir
   * @param {string} rel_prefix
   */
  function walk(dir, rel_prefix) {
    const names = fs.readdirSync(dir);
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const abs = path.join(dir, name);
      if (lstat_is_reparse_or_symlink(abs)) {
        throw new Error('staging 含 symlink／reparse，拒絕封裝：' + name);
      }
      const rel = rel_prefix ? rel_prefix + '/' + name : name;
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) {
        walk(abs, rel.replace(/\\/g, '/'));
      } else if (st.isFile()) {
        out.push({ rel: rel.replace(/\\/g, '/'), abs: abs });
      }
    }
  }
  walk(staging_root, '');
  return out;
}

/**
 * @param {object} options
 * @param {string} options.output_zip
 * @param {string} options.staging_root
 * @param {string} options.password
 */
export function create_aes256_zip_from_staging(options) {
  if (!options.password) {
    return { ok: false, reason_zh: '缺少 ZIP 加密密碼' };
  }
  try {
    const files = collect_staging_files(options.staging_root);
    if (files.length < 1) {
      return { ok: false, reason_zh: 'staging 無可封裝檔案' };
    }
    return new Promise(function (resolve) {
      const out = fs.createWriteStream(options.output_zip);
      const archive = archiver.create('zip-encrypted', {
        zlib: { level: 6 },
        encryptionMethod: 'aes256',
        password: options.password,
      });
      out.on('close', function () {
        resolve({ ok: true });
      });
      out.on('error', function (err) {
        resolve({
          ok: false,
          reason_zh: redact_sync_zip_secrets(
            err instanceof Error ? err.message : String(err),
            options.password
          ),
        });
      });
      archive.on('error', function (err) {
        resolve({
          ok: false,
          reason_zh: redact_sync_zip_secrets(
            err instanceof Error ? err.message : String(err),
            options.password
          ),
        });
      });
      archive.pipe(out);
      for (let i = 0; i < files.length; i += 1) {
        archive.file(files[i].abs, { name: files[i].rel });
      }
      archive.finalize();
    });
  } catch (err) {
    return Promise.resolve({
      ok: false,
      reason_zh: redact_sync_zip_secrets(
        err instanceof Error ? err.message : String(err),
        options.password
      ),
    });
  }
}

/**
 * @param {import('@zip.js/zip.js').Entry} entry
 */
function entry_is_wzaes(entry) {
  if (!entry.encrypted) {
    return false;
  }
  if (entry.zipCrypto) {
    return false;
  }
  return true;
}

/**
 * @param {object} [manifest]
 * @param {string[] | null | undefined} [members]
 */
function resolve_extract_limits(manifest, members) {
  let max_total = WZAES_MAX_TOTAL_UNCOMPRESSED_BYTES;
  if (manifest && typeof manifest.total_bytes === 'number') {
    max_total = Math.min(
      WZAES_MAX_TOTAL_UNCOMPRESSED_BYTES,
      manifest.total_bytes * 3 + 16 * 1024 * 1024
    );
  }
  let max_entries = WZAES_MAX_ZIP_ENTRIES;
  if (members && members.length) {
    max_entries = Math.min(max_entries, members.length + 5);
  }
  return {
    max_total: max_total,
    max_entries: max_entries,
    max_ratio: WZAES_MAX_UNCOMPRESSED_RATIO,
  };
}

/**
 * @param {string} zip_path
 * @param {string} password
 * @returns {Promise<{ ok: true, reader: ZipReader, entries: import('@zip.js/zip.js').Entry[] } | { ok: false, reason_zh: string }>}
 */
async function open_wzaes_zip(zip_path, password) {
  const reader = new NodeFsRandomAccessReader(zip_path);
  const zip_reader = new ZipReader(reader, { password: password });
  try {
    const entries = await zip_reader.getEntries();
    if (!entries || entries.length < 1) {
      await zip_reader.close();
      return { ok: false, reason_zh: 'ZIP 無成員或無法讀取' };
    }
    if (entries.length > WZAES_MAX_ZIP_ENTRIES) {
      await zip_reader.close();
      return {
        ok: false,
        reason_zh: 'ZIP 成員數量超過安全上限（' + entries.length + '）',
      };
    }
    for (let i = 0; i < entries.length; i += 1) {
      const ent = entries[i];
      if (ent.directory) {
        continue;
      }
      if (!entry_is_wzaes(ent)) {
        await zip_reader.close();
        return {
          ok: false,
          reason_zh:
            'ZIP 未使用 WinZip AES-256（WzAES）；偵測到未加密或 ZipCrypto：' +
            ent.filename,
        };
      }
    }
    return { ok: true, reader: zip_reader, entries: entries };
  } catch (err) {
    try {
      await zip_reader.close();
    } catch {
      /* */
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/password|decrypt|invalid/i.test(msg)) {
      return { ok: false, reason_zh: 'ZIP 密碼錯誤' };
    }
    return {
      ok: false,
      reason_zh: redact_sync_zip_secrets(msg, password),
    };
  }
}

/**
 * @param {object} options
 * @param {string} options.zip_path
 * @param {string} options.password
 */
export async function verify_zip_encryption_and_list(options) {
  const opened = await open_wzaes_zip(options.zip_path, options.password);
  if (!opened.ok) {
    return { ok: false, reason_zh: opened.reason_zh, entries: [] };
  }
  /** @type {{ path: string, size: number | null }[]} */
  const listed = [];
  try {
    let password_probed = false;
    for (let i = 0; i < opened.entries.length; i += 1) {
      const ent = opened.entries[i];
      if (ent.directory) {
        continue;
      }
      const name = ent.filename.replace(/\\/g, '/');
      const path_check = normalize_and_validate_import_member_path(name);
      if (!path_check.ok) {
        return {
          ok: false,
          reason_zh: 'ZIP 成員路徑不安全：' + path_check.reason_zh,
          entries: [],
        };
      }
      if (!password_probed) {
        try {
          await ent.getData(new BlobWriter(), { checkPasswordOnly: true });
          password_probed = true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/password|decrypt|invalid/i.test(msg)) {
            return {
              ok: false,
              reason_zh: 'ZIP 密碼錯誤',
              entries: [],
            };
          }
          return {
            ok: false,
            reason_zh: redact_sync_zip_secrets(msg, options.password),
            entries: [],
          };
        }
      }
      listed.push({
        path: path_check.normalized,
        size:
          typeof ent.uncompressedSize === 'number'
            ? ent.uncompressedSize
            : null,
      });
    }
    return { ok: true, entries: listed };
  } finally {
    await opened.reader.close();
  }
}

/**
 * @param {string} extract_root
 * @param {string} rel_posix
 * @returns {string | null}
 */
function safe_extract_destination(extract_root, rel_posix) {
  const rel = rel_posix.replace(/\\/g, '/');
  const check = normalize_and_validate_import_member_path(rel);
  if (!check.ok) {
    return null;
  }
  const abs = path.resolve(
    extract_root,
    check.normalized.split('/').join(path.sep)
  );
  const root_real = path.resolve(extract_root);
  const rel_check = path.relative(root_real, abs);
  if (!rel_check || rel_check.startsWith('..') || path.isAbsolute(rel_check)) {
    return null;
  }
  return abs;
}

/**
 * @param {object} options
 * @param {string} options.zip_path
 * @param {string} options.output_dir
 * @param {string} options.password
 * @param {string[] | null | undefined} [options.members]
 * @param {object | null | undefined} [options.manifest]
 */
export async function extract_zip_to_directory(options) {
  fs.mkdirSync(options.output_dir, { recursive: true });
  const limits = resolve_extract_limits(options.manifest, options.members);
  const opened = await open_wzaes_zip(options.zip_path, options.password);
  if (!opened.ok) {
    return { ok: false, reason_zh: opened.reason_zh };
  }

  /** @type {Set<string> | null} */
  let member_filter = null;
  if (options.members && options.members.length) {
    member_filter = new Set(
      options.members.map(function (m) {
        return m.replace(/\\/g, '/');
      })
    );
  }

  /** @type {Map<string, number> | null} */
  let manifest_sizes = null;
  if (options.manifest && options.manifest.files) {
    manifest_sizes = new Map();
    for (let m = 0; m < options.manifest.files.length; m += 1) {
      const row = options.manifest.files[m];
      manifest_sizes.set(row.path, row.size);
    }
    manifest_sizes.set('export-manifest.json', null);
  }

  let total_uncompressed = 0;
  try {
    for (let i = 0; i < opened.entries.length; i += 1) {
      const ent = opened.entries[i];
      const name = ent.filename.replace(/\\/g, '/');
      if (member_filter && !member_filter.has(name)) {
        continue;
      }
      if (ent.directory) {
        const dir_abs = safe_extract_destination(options.output_dir, name);
        if (!dir_abs) {
          return { ok: false, reason_zh: 'ZIP 目錄路徑不安全：' + name };
        }
        fs.mkdirSync(dir_abs, { recursive: true });
        continue;
      }

      const dest = safe_extract_destination(options.output_dir, name);
      if (!dest) {
        return { ok: false, reason_zh: 'ZIP 解壓路徑不安全：' + name };
      }

      const uncompressed =
        typeof ent.uncompressedSize === 'number' ? ent.uncompressedSize : 0;
      const compressed =
        typeof ent.compressedSize === 'number' ? ent.compressedSize : 0;
      const norm_name = name;
      if (manifest_sizes && manifest_sizes.has(norm_name)) {
        const expected = manifest_sizes.get(norm_name);
        if (expected != null && expected !== uncompressed) {
          return {
            ok: false,
            reason_zh:
              'ZIP 成員大小與 manifest 不符：' +
              norm_name +
              ' zip=' +
              uncompressed +
              ' manifest=' +
              expected,
          };
        }
      } else if (
        compressed > 0 &&
        uncompressed > 512 * 1024 &&
        uncompressed / compressed > limits.max_ratio
      ) {
        return {
          ok: false,
          reason_zh: 'ZIP 壓縮比異常，疑似 ZIP bomb：' + name,
        };
      }
      total_uncompressed += uncompressed;
      if (total_uncompressed > limits.max_total) {
        return {
          ok: false,
          reason_zh: '解壓總量超過安全上限，停止解壓',
        };
      }

      const writer = new FsPathWriter(dest);
      try {
        await ent.getData(writer);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/password|decrypt|invalid/i.test(msg)) {
          return { ok: false, reason_zh: 'ZIP 密碼錯誤' };
        }
        return {
          ok: false,
          reason_zh: redact_sync_zip_secrets(msg, options.password),
        };
      }
      if (lstat_is_reparse_or_symlink(dest)) {
        return { ok: false, reason_zh: '解壓結果為 symlink／reparse：' + name };
      }
    }
    return { ok: true };
  } finally {
    await opened.reader.close();
  }
}

