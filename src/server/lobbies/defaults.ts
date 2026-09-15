import { config } from "../config.js";

export type LobbyDefaults = {
    mapName: string;
    gameVersion: string;
    engineVersion: string;
};

let defaults: LobbyDefaults = { ...config.lobbyDefaults };

export function getLobbyDefaults(): LobbyDefaults {
    return { ...defaults };
}

export function setLobbyDefaults(next: LobbyDefaults): void {
    defaults = { ...next };
}
