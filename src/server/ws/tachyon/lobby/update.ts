import { broadcastLobbyChange, snapshotLobby } from "../../../lobbies/broadcast.js";
import type { LobbyPatch } from "../../../lobbies/patch.js";
import { applyGameOptions, applyRestrictions, applyTags, getLobby, getLobbyIdForUser, isValidAllyTeams, updateLobbyConfig } from "../../../lobbies/store.js";
import { canUpdateLobby, requiresVote } from "../../../lobbies/updatePolicy.js";
import type { TachyonContext, TachyonRequestFor, TachyonResponseFor } from "../types.js";

type LobbyUpdateFailReason = Extract<TachyonResponseFor<"lobby/update">, { status: "failed" }>["reason"];

export function handleLobbyUpdate(request: TachyonRequestFor<"lobby/update">, context: TachyonContext): TachyonResponseFor<"lobby/update"> {
    const failed = (reason: LobbyUpdateFailReason, details?: string): TachyonResponseFor<"lobby/update"> => ({
        type: "response",
        messageId: request.messageId,
        commandId: "lobby/update",
        status: "failed",
        reason,
        ...(details !== undefined && { details }),
    });

    const lobbyId = getLobbyIdForUser(context.userId);
    const lobby = lobbyId ? getLobby(lobbyId) : undefined;
    if (!lobbyId || !lobby || !canUpdateLobby(lobby, context.userId)) return failed("unauthorized");

    const changes = request.data;
    if (changes.name !== undefined && changes.name.trim().length === 0) return failed("invalid_request", "name must not be empty");
    if (changes.mapName !== undefined && changes.mapName.trim().length === 0) return failed("invalid_request", "mapName must not be empty");
    if (changes.allyTeamConfig !== undefined && !isValidAllyTeams(changes.allyTeamConfig)) return failed("invalid_request", "invalid allyTeamConfig");

    // Unreachable until some update requires a vote; votes are waiting on protocol changes.
    if (requiresVote(lobby, changes, context.userId)) return failed("internal_error", "lobby update votes are not supported yet");

    const before = snapshotLobby(lobbyId);
    updateLobbyConfig(lobbyId, { name: changes.name, mapName: changes.mapName, allyTeams: changes.allyTeamConfig });
    if (changes.gameOptions) applyGameOptions(lobbyId, changes.gameOptions);

    const extra: Omit<LobbyPatch, "id"> = {};
    const restrictions = changes.restrictions && applyRestrictions(lobbyId, changes.restrictions);
    if (restrictions) extra.restrictions = restrictions;
    const tags = changes.tags && applyTags(lobbyId, changes.tags);
    if (tags) extra.tags = tags;

    const after = snapshotLobby(lobbyId);
    setImmediate(() => broadcastLobbyChange(before, after, extra));

    return {
        type: "response",
        messageId: request.messageId,
        commandId: "lobby/update",
        status: "success",
    };
}
