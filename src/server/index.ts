import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = await buildApp();

try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info({ password: config.initialPassword, source: config.passwordFromEnv ? "environment" : "generated" }, "tachyon server password");
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
