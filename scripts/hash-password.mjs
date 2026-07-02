// Generate an ADMIN_PASSWORD_HASH for wrangler secret / .dev.vars
// Usage: npm run hash-password -- "your-strong-password"
import { pbkdf2Sync, randomBytes } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-password -- "your-strong-password"');
  process.exit(1);
}

const ITER = 210000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, ITER, 32, "sha256");
const b64url = (b) => b.toString("base64url");

console.log(`pbkdf2$${ITER}$${b64url(salt)}$${b64url(hash)}`);
console.error("\nSet it with:");
console.error("  wrangler secret put ADMIN_PASSWORD_HASH");
console.error("Then paste the line above when prompted.");
