declare module "7zip-min" {
    function unpack(archive: string, destination: string, callback: (error: Error | null) => void): void;
    function pack(source: string, destination: string, callback: (error: Error | null) => void): void;
    function list(archive: string, callback: (error: Error | null, entries?: unknown[]) => void): void;
    function cmd(command: string, callback: (error: Error | null) => void): void;

    export { unpack, pack, list, cmd };
}
