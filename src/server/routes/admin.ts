import type { FastifyPluginAsync } from "fastify";

// Stub route only: real connection counts require the ws plugins to track state.
export const adminRoutes: FastifyPluginAsync = async (app) => {
    app.get("/api/admin/status", async () => ({
        connectedClients: 0,
        connectedAutohosts: 0,
    }));
};
