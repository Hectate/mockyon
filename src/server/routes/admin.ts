import type { FastifyPluginAsync } from "fastify";
import { getPassword, setPassword } from "../auth/password.js";
import { getAutohostProcessState, startAutohostProcess, stopAutohostProcess } from "../autohost/process.js";
import { getConnectedClientCount, getConnectedClients } from "../ws/connectedClients.js";
import { isAutohostConnected } from "../ws/connectedAutohosts.js";

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
};
