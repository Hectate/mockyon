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
    engineHostIP: process.env.ENGINE_HOST_IP,
    // build/server/config.js -> ../client
    publicDir: path.resolve(here, "../client"),
    // build/server/config.js -> repo root -> vendor/recoil-autohost
    vendorAutohostDir: path.resolve(here, "../../vendor/recoil-autohost"),
    // build/server/config.js -> repo root
    repoRoot: path.resolve(here, "../.."),
    // Engine release API endpoint (mirrors bar-lobby's engineReleaseUrl)
    engineReleaseUrl: process.env.ENGINE_RELEASE_URL ?? "https://files-cdn.beyondallreason.dev/find",
    // Engines directory (relative to repo root)
    enginesDir: path.resolve(here, "../../engines"),
    // Per-battle autohost instance directories, kept alongside the engines directory
    instancesDir: path.resolve(here, "../../instances"),
    // Seed assets for admin-created custom lobbies, deliberately independent of the matchmaking playlist
    lobbyDefaults: {
        mapName: process.env.LOBBY_DEFAULT_MAP ?? "Gods of War Remake v1.3",
        gameVersion: process.env.LOBBY_DEFAULT_GAME ?? "Beyond All Reason test-30903-2990072",
        engineVersion: process.env.LOBBY_DEFAULT_ENGINE ?? "2026.07.04",
    },
};
