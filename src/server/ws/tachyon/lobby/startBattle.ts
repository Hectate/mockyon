import { buildLobbyStartScript, launchBattle, sendBattleStartRequests } from "../../../battles/launch.js";
import { getLobby, getLobbyIdForUser } from "../../../lobbies/store.js";
import type { TachyonContext, TachyonRequestFor, TachyonResponseFor } from "../types.js";

export async function handleLobbyStartBattle(request: TachyonRequestFor<"lobby/startBattle">, context: TachyonContext): Promise<TachyonResponseFor<"lobby/startBattle">> {
    const lobbyId = getLobbyIdForUser(context.userId);
    const lobby = lobbyId ? getLobby(lobbyId) : undefined;
    if (!lobbyId || !lobby) {
        return {
            type: "response",
            messageId: request.messageId,
            commandId: "lobby/startBattle",
            status: "failed",
            reason: "not_in_lobby",
        };
    }

    try {
        const battle = await launchBattle("lobby", buildLobbyStartScript(lobby), lobbyId);
        setImmediate(() => sendBattleStartRequests(battle));
        return {
            type: "response",
            messageId: request.messageId,
            commandId: "lobby/startBattle",
            status: "success",
        };
    } catch (error) {
        return {
            type: "response",
            messageId: request.messageId,
            commandId: "lobby/startBattle",
            status: "failed",
            reason: "internal_error",
            details: error instanceof Error ? error.message : "battle launch failed",
        };
    }
}
