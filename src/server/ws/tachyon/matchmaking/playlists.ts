import type { TachyonSuccessResponseFor } from "../types.js";

export type MatchmakingPlaylist = TachyonSuccessResponseFor<"matchmaking/list">["data"]["playlists"][number];

export const matchmakingPlaylists: MatchmakingPlaylist[] = [
    {
        id: "1",
        version: "1",
        name: "1v1",
        numOfTeams: 2,
        teamSize: 1,
        ranked: false,
        engines: [{ version: "2026.07.04" }],
        games: [{ springName: "Beyond All Reason test-30903-2990072" }],
        maps: [{ springName: "Gods of War Remake v1.3" }],
    },
];

export function findMatchmakingPlaylist(id: string): MatchmakingPlaylist | undefined {
    return matchmakingPlaylists.find((playlist) => playlist.id === id);
}
