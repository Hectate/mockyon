import type { FastifyPluginAsync } from "fastify";

// Stub routes only: no real credential checks or token issuance yet.
export const authRoutes: FastifyPluginAsync = async (app) => {
    app.post("/api/auth/login", async () => ({
        // Placeholder mock token, not a real credential.
        accessToken: "mock-access-token",
        tokenType: "Bearer",
    }));

    app.get("/api/auth/me", async () => ({
        userId: null,
        authenticated: false,
    }));
};
