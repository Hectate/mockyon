import type { FastifyPluginAsync } from "fastify";
import { createAuthCode, createSession, consumePendingRequest, getPendingRequest, validateAccessToken } from "../auth/store.js";
import { verifyPassword } from "../auth/password.js";
import { genericLobbyClient } from "../auth/clients.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
    app.get<{ Params: { id: string } }>("/api/auth/request/:id", async (request, reply) => {
        const pending = getPendingRequest(request.params.id);
        if (!pending) return reply.code(404).send({ error: "authorization_request_not_found" });
        return { clientName: genericLobbyClient.clientName, scope: pending.scope };
    });

    app.post("/api/auth/login", async (request, reply) => {
        const body = request.body as { requestId?: string; username?: string; password?: string };
        const username = body.username?.trim() ?? "";
        if (!body.requestId || username.length === 0 || username.length > 128 || !verifyPassword(body.password ?? "")) {
            return reply.code(401).send({ error: "invalid_credentials" });
        }
        const pending = consumePendingRequest(body.requestId);
        if (!pending) return reply.code(400).send({ error: "authorization_request_not_found" });
        const sessionId = createSession(username);
        const code = createAuthCode(sessionId, pending);
        const redirect = new URL(pending.redirectUri);
        redirect.searchParams.set("code", code);
        if (pending.state) redirect.searchParams.set("state", pending.state);
        return { redirectUri: redirect.toString() };
    });

    app.get("/api/auth/me", async (request) => {
        const match = request.headers.authorization?.match(/^Bearer\s+(.+)$/i);
        const access = match ? validateAccessToken(match[1]) : undefined;
        return access ? { authenticated: true, username: access.username } : { authenticated: false, username: null };
    });
};
