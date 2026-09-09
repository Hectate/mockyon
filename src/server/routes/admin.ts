import type { FastifyPluginAsync } from "fastify";
import { getPassword, setPassword } from "../auth/password.js";
import { getConnectedClientCount, getConnectedClients } from "../ws/connectedClients.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
    app.get("/api/admin/status", async () => ({
        connectedClients: getConnectedClientCount(),
        clients: getConnectedClients(),
        connectedAutohosts: 0,
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
};
