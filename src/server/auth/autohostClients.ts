// Tracks the single OAuth2 client-credentials pair generated for the currently spawned autohost.
let current: { clientId: string; clientSecret: string } | undefined;

export function registerAutohostCredentials(clientId: string, clientSecret: string): void {
    current = { clientId, clientSecret };
}

export function clearAutohostCredentials(): void {
    current = undefined;
}

export function validateAutohostCredentials(clientId: string, clientSecret: string): boolean {
    return current?.clientId === clientId && current?.clientSecret === clientSecret;
}
