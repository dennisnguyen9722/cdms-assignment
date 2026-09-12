import { createHash } from 'crypto';

/** Các trường không tính vào hash vì chúng đổi liên tục mà không phải thay đổi thật */
const VOLATILE_FIELDS = ['updated_at', 'synced_at', 'last_seen'];

export function canonicalize(obj: Record<string, any>): string {
  const clean: Record<string, any> = {};
  for (const key of Object.keys(obj).sort()) {
    if (VOLATILE_FIELDS.includes(key)) continue;
    clean[key] = obj[key];
  }
  return JSON.stringify(clean);
}

export function contentHash(obj: Record<string, any>): string {
  return createHash('sha256').update(canonicalize(obj)).digest('hex');
}
