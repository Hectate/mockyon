import { buildApp } from "./app.js";
import { config } from "./config.js";
import { loadMapNames } from "./services/mapService.js";

const app = await buildApp();
loadMapNames(config.mapsMetadataUrl, app.log);

try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info({ password: config.initialPassword, source: config.passwordFromEnv ? "environment" : "generated" }, "tachyon server password");
    app.log.info(`admin panel: ${config.publicUrl.replace(/\/+$/, "")}/admin/`);
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
