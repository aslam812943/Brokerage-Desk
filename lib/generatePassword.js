import crypto from "crypto";

// Avoids visually ambiguous characters (0/O, 1/l/I) since this is read aloud
// or typed by hand when an admin hands it to a new user.
const CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

export function generateTempPassword(length = 12) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += CHARSET[bytes[i] % CHARSET.length];
  return out;
}
