import { randomBytes, randomUUID } from "node:crypto";

// No 0/O/1/I/L — codes get read aloud and typed from phones.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateGroupCode(length = 6): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

export function generateMemberToken(): string {
  return randomUUID();
}
