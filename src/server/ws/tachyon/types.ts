import type { GetCommandData, GetCommandIds, GetCommands } from "tachyon-protocol";

export type RawData = Buffer | ArrayBuffer | Buffer[];

export type TachyonRequestCommandId = GetCommandIds<"user", "server", "request">;
export type TachyonResponseCommandId = GetCommandIds<"server", "user", "response">;
export type TachyonEventCommandId = GetCommandIds<"server", "user", "event">;
export type TachyonAutohostRequestCommandId = GetCommandIds<"server", "autohost", "request">;
export type TachyonAutohostResponseCommandId = GetCommandIds<"autohost", "server", "response">;
export type TachyonAutohostEventCommandId = GetCommandIds<"autohost", "server", "event">;

export type TachyonRequest = GetCommands<"user", "server", "request">;
export type TachyonResponse = GetCommands<"server", "user", "response">;
export type TachyonEvent = GetCommands<"server", "user", "event">;
export type TachyonAutohostRequest = GetCommands<"server", "autohost", "request">;
export type TachyonAutohostResponse = GetCommands<"autohost", "server", "response">;
export type TachyonAutohostEvent = GetCommands<"autohost", "server", "event">;
export type TachyonAutohostIncomingMessage = TachyonAutohostResponse | TachyonAutohostEvent;

export type TachyonRequestFor<CommandId extends TachyonRequestCommandId> = GetCommands<"user", "server", "request", CommandId> & {
    type: "request";
    messageId: string;
    commandId: CommandId;
};
export type TachyonResponseFor<CommandId extends TachyonResponseCommandId> = GetCommands<"server", "user", "response", CommandId> & {
    type: "response";
    messageId: string;
    commandId: CommandId;
};
export type TachyonSuccessResponseFor<CommandId extends TachyonResponseCommandId> = Extract<TachyonResponseFor<CommandId>, { status: "success" }>;
export type TachyonEventFor<CommandId extends TachyonEventCommandId> = GetCommands<"server", "user", "event", CommandId> & {
    type: "event";
    messageId: string;
    commandId: CommandId;
};
export type TachyonEventDataFor<CommandId extends TachyonEventCommandId> = GetCommandData<TachyonEventFor<CommandId>>;
export type TachyonOutgoingMessage = TachyonResponse | TachyonEvent | TachyonAutohostRequest;

export type TachyonContext = {
    username: string;
    userId: string;
};
