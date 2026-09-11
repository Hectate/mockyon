import type { TachyonRequestFor, TachyonSuccessResponseFor } from "../types.js";
import { matchmakingPlaylists } from "./playlists.js";

export function handleMatchmakingList(request: TachyonRequestFor<"matchmaking/list">): TachyonSuccessResponseFor<"matchmaking/list"> {
    return {
        type: "response",
        messageId: request.messageId,
        commandId: "matchmaking/list",
        status: "success",
        data: {
            playlists: matchmakingPlaylists,
        },
    };
}
