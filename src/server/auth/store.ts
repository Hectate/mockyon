import { randomBytes } from "node:crypto";

const pendingTtl = 10 * 60 * 1000;
const codeTtl = 60 * 1000;
const accessTtl = 60 * 60 * 1000;

export type PendingAuthRequest = {
    clientId: string;
    redirectUri: string;
    state?: string;
    codeChallenge: string;
    scope: string;
    createdAt: number;
};

type Session = { username: string; createdAt: number };
type AuthCode = PendingAuthRequest & { sessionId: string; expiresAt: number };
type AccessToken = { scope: string; expiresAt: number } & ({ actor: "user"; sessionId: string } | { actor: "autohost"; clientId: string });
type RefreshToken = { sessionId: string; clientId: string; scope: string };

const sessions = new Map<string, Session>();
const pendingRequests = new Map<string, PendingAuthRequest>();
const authCodes = new Map<string, AuthCode>();
const accessTokens = new Map<string, AccessToken>();
const refreshTokens = new Map<string, RefreshToken>();
const userIds = new Map<string, string>();

// Never reused, never swept: an id stays valid for the lifetime of the process.
let nextUserId = 1;

function token(): string {
    return randomBytes(32).toString("base64url");
}

export function createSession(username: string): string {
    const id = token();
    sessions.set(id, { username, createdAt: Date.now() });
    return id;
}

export function getSession(sessionId: string): Session | undefined {
    return sessions.get(sessionId);
}

export function getUserId(username: string): string {
    const existing = userIds.get(username);
    if (existing) return existing;
    const id = String(nextUserId++);
    userIds.set(username, id);
    return id;
}

export function createPendingRequest(request: PendingAuthRequest): string {
    const id = token();
    pendingRequests.set(id, request);
    return id;
}

export function getPendingRequest(id: string): PendingAuthRequest | undefined {
    const request = pendingRequests.get(id);
    return request && Date.now() - request.createdAt <= pendingTtl ? request : undefined;
}

export function consumePendingRequest(id: string): PendingAuthRequest | undefined {
    const request = getPendingRequest(id);
    if (request) pendingRequests.delete(id);
    return request;
}

export function createAuthCode(sessionId: string, request: PendingAuthRequest): string {
    const code = token();
    authCodes.set(code, { ...request, sessionId, expiresAt: Date.now() + codeTtl });
    return code;
}

export function consumeAuthCode(code: string): AuthCode | undefined {
    const value = authCodes.get(code);
    authCodes.delete(code);
    return value && value.expiresAt > Date.now() ? value : undefined;
}

export function issueTokens(sessionId: string, clientId: string, scope: string) {
    const accessToken = token();
    const refreshToken = token();
    accessTokens.set(accessToken, { actor: "user", sessionId, scope, expiresAt: Date.now() + accessTtl });
    refreshTokens.set(refreshToken, { sessionId, clientId, scope });
    return { accessToken, refreshToken, expiresIn: accessTtl / 1000, scope };
}

// Client-credentials grant for the autohost actor: no session/refresh token, just a short-lived access token.
export function issueAutohostAccessToken(clientId: string, scope: string) {
    const accessToken = token();
    accessTokens.set(accessToken, { actor: "autohost", clientId, scope, expiresAt: Date.now() + accessTtl });
    return { accessToken, expiresIn: accessTtl / 1000, scope };
}

export function rotateRefreshToken(value: string, clientId: string) {
    const existing = refreshTokens.get(value);
    if (!existing || existing.clientId !== clientId) return undefined;
    refreshTokens.delete(value);
    return issueTokens(existing.sessionId, existing.clientId, existing.scope);
}

export type ValidatedAccess = { scope: string } & ({ actor: "user"; username: string } | { actor: "autohost"; clientId: string });

export function validateAccessToken(value: string): ValidatedAccess | undefined {
    const access = accessTokens.get(value);
    if (!access || access.expiresAt <= Date.now()) {
        accessTokens.delete(value);
        return undefined;
    }
    if (access.actor === "autohost") return { actor: "autohost", clientId: access.clientId, scope: access.scope };
    const session = sessions.get(access.sessionId);
    return session ? { actor: "user", username: session.username, scope: access.scope } : undefined;
}

export function revokeToken(value: string): void {
    const refresh = refreshTokens.get(value);
    refreshTokens.delete(value);
    accessTokens.delete(value);
    if (refresh) {
        for (const [accessToken, access] of accessTokens) {
            if (access.actor === "user" && access.sessionId === refresh.sessionId) accessTokens.delete(accessToken);
        }
    }
}

const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, request] of pendingRequests) if (now - request.createdAt > pendingTtl) pendingRequests.delete(id);
    for (const [code, value] of authCodes) if (value.expiresAt <= now) authCodes.delete(code);
    for (const [accessToken, value] of accessTokens) if (value.expiresAt <= now) accessTokens.delete(accessToken);
}, 60_000);
sweep.unref();
