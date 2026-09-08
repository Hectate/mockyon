export const genericLobbyClient = {
    clientId: "generic_lobby",
    clientName: "Generic Lobby Client",
    scope: "tachyon.lobby",
    redirectPath: "/oauth2callback",
};

export function isValidRedirectUri(value: string): boolean {
    try {
        const uri = new URL(value);
        return (
            uri.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname) &&
            uri.pathname === genericLobbyClient.redirectPath &&
            uri.username === "" &&
            uri.password === "" &&
            uri.hash === ""
        );
    } catch {
        return false;
    }
}
