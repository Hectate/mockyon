import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomBytes } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));

function generatePassword(): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let password = "";
    while (password.length < 16) {
        for (const byte of randomBytes(16)) {
            if (byte < 248) {
                password += alphabet[byte % alphabet.length];
                if (password.length === 16) break;
            }
        }
    }
    return password;
}

const configuredPassword = process.env.TACHYON_PASSWORD;
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 8080);

export const config = {
    host,
    port,
    logLevel: process.env.LOG_LEVEL ?? "info",
    initialPassword: configuredPassword ?? generatePassword(),
    passwordFromEnv: configuredPassword !== undefined,
    publicUrl: process.env.PUBLIC_URL ?? `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`,
    // build/server/config.js -> ../client
    publicDir: path.resolve(here, "../client"),
    // build/server/config.js -> repo root -> vendor/recoil-autohost
    vendorAutohostDir: path.resolve(here, "../../vendor/recoil-autohost"),
    // build/server/config.js -> repo root
    repoRoot: path.resolve(here, "../.."),
};
