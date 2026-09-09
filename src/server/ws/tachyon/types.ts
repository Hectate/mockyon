export type RawData = Buffer | ArrayBuffer | Buffer[];

export type TachyonMessage = {
    type: string;
    messageId: string;
    commandId: string;
    data?: unknown;
};

export type TachyonRequest = TachyonMessage & {
    type: "request";
};

export type TachyonContext = {
    username: string;
    userId: string;
};

export type TachyonResponse = {
    type: "response";
    messageId: string;
    commandId: string;
    status: "success" | "failed";
    reason?: string;
    details?: string;
    data?: unknown;
};

export type TachyonEvent = {
    type: "event";
    messageId: string;
    commandId: string;
    data: unknown;
};
