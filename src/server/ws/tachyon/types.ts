import type { GetCommandData, GetCommandIds, GetCommands } from "tachyon-protocol";

export type RawData = Buffer | ArrayBuffer | Buffer[];

export type TachyonRequestCommandId = GetCommandIds<"user", "server", "request">;
export type TachyonResponseCommandId = GetCommandIds<"server", "user", "response">;
export type TachyonEventCommandId = GetCommandIds<"server", "user", "event">;
export type TachyonUserRequestCommandId = GetCommandIds<"server", "user", "request">;
export type TachyonUserResponseCommandId = GetCommandIds<"user", "server", "response">;
export type TachyonAutohostRequestCommandId = GetCommandIds<"server", "autohost", "request">;
export type TachyonAutohostResponseCommandId = GetCommandIds<"autohost", "server", "response">;
export type TachyonAutohostEventCommandId = GetCommandIds<"autohost", "server", "event">;

export type TachyonRequest = GetCommands<"user", "server", "request">;
export type TachyonResponse = GetCommands<"server", "user", "response">;
export type TachyonEvent = GetCommands<"server", "user", "event">;
export type TachyonUserRequest = GetCommands<"server", "user", "request">;
export type TachyonUserResponse = GetCommands<"user", "server", "response">;
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
export type TachyonUserRequestFor<CommandId extends TachyonUserRequestCommandId> = Extract<TachyonUserRequest, { commandId: CommandId }>;
export type TachyonUserResponseFor<CommandId extends TachyonUserResponseCommandId> = Extract<TachyonUserResponse, { commandId: CommandId }>;
export type TachyonAutohostRequestFor<CommandId extends TachyonAutohostRequestCommandId> = Extract<TachyonAutohostRequest, { commandId: CommandId }>;
export type TachyonAutohostResponseFor<CommandId extends TachyonAutohostResponseCommandId> = Extract<TachyonAutohostResponse, { commandId: CommandId }>;
export type TachyonEventDataFor<CommandId extends TachyonEventCommandId> = GetCommandData<TachyonEventFor<CommandId>>;
export type TachyonUserRequestDataFor<CommandId extends TachyonUserRequestCommandId> = GetCommandData<Extract<TachyonUserRequest, { commandId: CommandId }>>;
export type TachyonAutohostRequestDataFor<CommandId extends TachyonAutohostRequestCommandId> = GetCommandData<Extract<TachyonAutohostRequest, { commandId: CommandId }>>;
export type TachyonAutohostEventDataFor<CommandId extends TachyonAutohostEventCommandId> = GetCommandData<Extract<TachyonAutohostEvent, { commandId: CommandId }>>;
export type TachyonOutgoingMessage = TachyonResponse | TachyonEvent | TachyonUserRequest | TachyonAutohostRequest;

export type TachyonContext = {
    username: string;
    userId: string;
};
