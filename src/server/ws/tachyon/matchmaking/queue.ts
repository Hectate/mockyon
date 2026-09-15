import { getConnectedClientMatchmaking, setConnectedClientMatchmaking } from "../../connectedClients.js";
import type { MatchmakingState } from "../../connectedClients.js";
import { getLobbyIdForUser } from "../../../lobbies/store.js";
import type { TachyonContext, TachyonRequestFor, TachyonResponseFor } from "../types.js";
import { recordQueued, tryFormMatches } from "./matchmaker.js";
import { findMatchmakingPlaylist } from "./playlists.js";

export function handleMatchmakingQueue(request: TachyonRequestFor<"matchmaking/queue">, context: TachyonContext): TachyonResponseFor<"matchmaking/queue"> {
    const playlists = request.data.queues.map((queue) => findMatchmakingPlaylist(queue.id));
    if (playlists.some((playlist) => playlist === undefined)) {
        return {
            type: "response",
            messageId: request.messageId,
            commandId: "matchmaking/queue",
            status: "failed",
            reason: "invalid_queue_specified",
        };
    }

    if (getLobbyIdForUser(context.userId)) {
        return {
            type: "response",
            messageId: request.messageId,
            commandId: "matchmaking/queue",
            status: "failed",
            reason: "invalid_request",
            details: "cannot queue while in a lobby",
        };
    }

    if (getConnectedClientMatchmaking(context.username)?.state === "queuing") {
        return {
            type: "response",
            messageId: request.messageId,
            commandId: "matchmaking/queue",
            status: "failed",
            reason: "already_queued",
        };
    }

    const matchmaking: MatchmakingState = {
        state: "queuing",
        queues: playlists.filter((playlist) => playlist !== undefined).map(({ id, version }) => ({ id, version })),
    };

    setConnectedClientMatchmaking(context.username, matchmaking);
    recordQueued(context.username);

    // Deferred so this request's success response reaches the client before any found event.
    const queueIds = matchmaking.queues.map((queue) => queue.id);
    setImmediate(() => {
        for (const queueId of queueIds) tryFormMatches(queueId);
    });

    return {
        type: "response",
        messageId: request.messageId,
        commandId: "matchmaking/queue",
        status: "success",
    };
}
