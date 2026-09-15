import type { TachyonContext, TachyonEventFor } from "../types.js";
import { createEvent } from "../messages.js";
import { getConnectedClientMatchmaking } from "../../connectedClients.js";
import { getLobbyIdForUser } from "../../../lobbies/store.js";

export function createSelfEvent(context: TachyonContext): TachyonEventFor<"user/self"> {
    const currentLobby = getLobbyIdForUser(context.userId) ?? null;
    return createEvent("user/self", {
        user: {
            userId: context.userId,
            username: context.username,
            displayName: context.username,
            clanBaseData: null,
            status: currentLobby ? "lobby" : "menu",
            party: null,
            invitedToParties: [],
            friendIds: [],
            outgoingFriendRequest: [],
            incomingFriendRequest: [],
            ignoreIds: [],
            currentLobby,
            clanInvites: [],
            matchmaking: getConnectedClientMatchmaking(context.username) ?? { state: "no_matchmaking" },
        },
    });
}
