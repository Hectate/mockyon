import type { TachyonContext, TachyonEvent } from "../types.js";
import { createEvent } from "../messages.js";

export function createSelfEvent(context: TachyonContext): TachyonEvent {
    return createEvent("user/self", {
        user: {
            userId: context.username,
            username: context.username,
            displayName: context.username,
            clanBaseData: null,
            status: "menu",
            party: null,
            invitedToParties: [],
            friendIds: [],
            outgoingFriendRequest: [],
            incomingFriendRequest: [],
            ignoreIds: [],
            currentLobby: null,
            clanInvites: [],
            matchmaking: { state: "no_matchmaking" },
        },
    });
}
