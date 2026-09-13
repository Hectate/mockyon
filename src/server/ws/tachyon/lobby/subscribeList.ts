import type { TachyonRequestFor, TachyonSuccessResponseFor } from "../types.js";

// Subscriptions aren't tracked: every connected client is treated as subscribed.
export function handleLobbySubscribeList(request: TachyonRequestFor<"lobby/subscribeList">): TachyonSuccessResponseFor<"lobby/subscribeList"> {
    return {
        type: "response",
        messageId: request.messageId,
        commandId: "lobby/subscribeList",
        status: "success",
    };
}
