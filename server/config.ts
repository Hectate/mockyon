import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 8080),
    // dist/config.js -> ../public
    publicDir: path.resolve(here, "../public"),
};
