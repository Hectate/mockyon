import type { FastifyPluginAsync } from "fastify";
import { getPassword, setPassword } from "../auth/password.js";
import { getAutohostProcessState, startAutohostProcess, stopAutohostProcess } from "../autohost/process.js";
import { getConnectedClientCount, getConnectedClients } from "../ws/connectedClients.js";
import { isAutohostConnected } from "../ws/connectedAutohosts.js";
import { config } from "../config.js";
import { downloadAndExtractEngine, listInstalledEngines } from "../services/engineService.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
    app.get("/api/admin/status", async () => ({
        connectedClients: getConnectedClientCount(),
        clients: getConnectedClients(),
        autohost: { ...getAutohostProcessState(), connected: isAutohostConnected() },
    }));

    app.get("/api/admin/password", async () => ({ password: getPassword() }));

    app.put("/api/admin/password", async (request, reply) => {
        const password = (request.body as { password?: string }).password ?? "";
        if (password.length < 1 || password.length > 256) {
            return reply.code(400).send({ error: "invalid_password" });
        }
        setPassword(password);
        return { password };
    });

    app.post("/api/admin/autohost/start", async (request, reply) => {
        const result = startAutohostProcess(app.log);
        if (!result.ok) return reply.code(409).send({ error: result.error });
        return { ...getAutohostProcessState(), connected: isAutohostConnected() };
    });

    app.post("/api/admin/autohost/stop", async (request, reply) => {
        const result = stopAutohostProcess(app.log);
        if (!result.ok) return reply.code(409).send({ error: result.error });
        return { ...getAutohostProcessState(), connected: isAutohostConnected() };
    });

    app.get("/api/admin/engines/installed", async () => {
        const engines = await listInstalledEngines(config.enginesDir);
        return { engines };
    });

    app.post("/api/admin/engines/download", async (request, reply) => {
        const { version } = (request.body as { version?: string }) ?? {};
        if (!version || typeof version !== "string" || version.length === 0) {
            return reply.code(400).send({ error: "invalid_version" });
        }

        try {
            await downloadAndExtractEngine(version, config.engineReleaseUrl, config.enginesDir);
            const engines = await listInstalledEngines(config.enginesDir);
            return { success: true, engines };
        } catch (error) {
            app.log.error(error);
            return reply.code(500).send({
                error: "download_failed",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    });

    app.post("/api/admin/shutdown", async (request, reply) => {
        // Stop autohost if running
        stopAutohostProcess(app.log);

        // Send success response before shutting down
        reply.code(200).send({ success: true });

        // Give the response time to send, then gracefully shutdown
        setTimeout(() => {
            app.log.info("Server shutting down on admin request");
            app.close().catch((err) => {
                app.log.error(err, "Error closing server");
                process.exit(1);
            });
        }, 100);
    });
};
