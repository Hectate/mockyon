import { createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";
import { genericLobbyClient, isValidRedirectUri } from "../auth/clients.js";
import { createPendingRequest, consumeAuthCode, issueTokens, revokeToken, rotateRefreshToken } from "../auth/store.js";

const scope = genericLobbyClient.scope;

function params(value: unknown): Record<string, string> {
    return (value ?? {}) as Record<string, string>;
}

function oauthError(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, error: string, description: string) {
    return reply.code(400).send({ error, error_description: description });
}

export const oauthRoutes: FastifyPluginAsync = async (app) => {
    app.get("/.well-known/oauth-authorization-server", async (_request, reply) => {
        reply.header("Cache-Control", "public, max-age=3600");
        return {
            issuer: config.publicUrl,
            authorization_endpoint: `${config.publicUrl}/oauth2/authorize`,
            token_endpoint: `${config.publicUrl}/oauth2/token`,
            revocation_endpoint: `${config.publicUrl}/oauth2/revoke`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none"],
            revocation_endpoint_auth_methods_supported: ["none"],
            scopes_supported: [scope],
        };
    });

    app.get("/oauth2/authorize", async (request, reply) => {
        const query = params(request.query);
        const redirectUri = query.redirect_uri;
        const state = query.state;
        if (query.client_id !== genericLobbyClient.clientId || !redirectUri || !isValidRedirectUri(redirectUri)) {
            return reply.code(400).type("text/html").send("Invalid client or redirect URI");
        }
        const redirect = new URL(redirectUri);
        const fail = (error: string, description: string) => {
            redirect.searchParams.set("error", error);
            redirect.searchParams.set("error_description", description);
            if (state) redirect.searchParams.set("state", state);
            return reply.redirect(redirect.toString());
        };
        if (query.response_type !== "code") return fail("unsupported_response_type", "response_type must be code");
        if (query.code_challenge_method !== "S256" || !query.code_challenge) {
            return fail("invalid_request", "S256 PKCE is required");
        }
        if (query.scope !== scope) return fail("invalid_scope", `scope must be ${scope}`);
        const requestId = createPendingRequest({
            clientId: genericLobbyClient.clientId,
            redirectUri,
            state,
            codeChallenge: query.code_challenge,
            scope,
            createdAt: Date.now(),
        });
        return reply.redirect(`/login/?request_id=${encodeURIComponent(requestId)}`);
    });

    app.post("/oauth2/token", async (request, reply) => {
        const body = params(request.body);
        reply.header("Cache-Control", "no-store");
        if (body.client_id !== genericLobbyClient.clientId) return oauthError(reply, "invalid_client", "Unknown client");
        if (body.grant_type === "authorization_code") {
            const authorizationCode = body.code ? consumeAuthCode(body.code) : undefined;
            if (!authorizationCode || authorizationCode.clientId !== body.client_id || authorizationCode.redirectUri !== body.redirect_uri) {
                return oauthError(reply, "invalid_grant", "Invalid authorization code");
            }
            const verifier = body.code_verifier ?? "";
            const challenge = createHash("sha256").update(verifier).digest("base64url");
            if (challenge !== authorizationCode.codeChallenge) return oauthError(reply, "invalid_grant", "Invalid code verifier");
            const tokens = issueTokens(authorizationCode.sessionId, body.client_id, authorizationCode.scope);
            return { access_token: tokens.accessToken, token_type: "Bearer", expires_in: tokens.expiresIn, refresh_token: tokens.refreshToken, scope: tokens.scope };
        }
        if (body.grant_type === "refresh_token") {
            const tokens = body.refresh_token ? rotateRefreshToken(body.refresh_token, body.client_id) : undefined;
            if (!tokens) return oauthError(reply, "invalid_grant", "Invalid refresh token");
            return { access_token: tokens.accessToken, token_type: "Bearer", expires_in: tokens.expiresIn, refresh_token: tokens.refreshToken, scope: tokens.scope };
        }
        return oauthError(reply, "unsupported_grant_type", "Unsupported grant type");
    });

    app.post("/oauth2/revoke", async (request, reply) => {
        const body = params(request.body);
        if (body.token) revokeToken(body.token);
        return reply.code(200).send();
    });
};
