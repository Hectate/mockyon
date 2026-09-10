import axios from "axios";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import * as sevenZip from "7zip-min";

export interface EngineReleaseInfo {
    filename: string;
    springname: string;
    md5: string;
    category: string;
    version: string;
    path: string;
    tags: string[];
    size: number;
    timestamp: string;
    mirrors: string[];
}

export interface InstalledEngine {
    version: string;
    exists: boolean;
}

/**
 * Gets available engine versions from the remote engine release API.
 * Follows bar-lobby's pattern: queries engineReleaseUrl with platform-specific category.
 */
export async function getAvailableEngines(
    engineReleaseUrl: string,
    engineVersion: string,
): Promise<EngineReleaseInfo> {
    const archStr = process.platform === "win32" ? "engine_windows64" : "engine_linux64";
    const url = new URL(engineReleaseUrl);
    url.searchParams.set("category", archStr);
    url.searchParams.set("springname", engineVersion);

    const response = await axios.get(url.toString());
    if (!Array.isArray(response.data) || response.data.length === 0) {
        throw new Error(`No engine found for version ${engineVersion}`);
    }

    return response.data[0] as EngineReleaseInfo;
}

/**
 * Lists installed engines by scanning the engines directory.
 * An engine is considered installed if it has the spring-dedicated executable.
 */
export async function listInstalledEngines(enginesDir: string): Promise<InstalledEngine[]> {
    try {
        await fs.mkdir(enginesDir, { recursive: true });
        const entries = await fs.readdir(enginesDir, { withFileTypes: true });
        const engines: InstalledEngine[] = [];

        for (const entry of entries) {
            if (entry.isDirectory()) {
                // On Windows, look for spring-dedicated.exe; on other platforms, spring-dedicated
                const executableName = process.platform === "win32" ? "spring-dedicated.exe" : "spring-dedicated";
                const executablePath = path.join(enginesDir, entry.name, executableName);
                const exists = await fs
                    .stat(executablePath)
                    .then(() => true)
                    .catch(() => false);

                engines.push({
                    version: entry.name,
                    exists,
                });
            }
        }

        return engines.sort((a, b) => b.version.localeCompare(a.version));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
        }
        throw error;
    }
}

/**
 * Downloads and extracts an engine to the engines directory.
 * Downloads the 7z archive from the first mirror, extracts to engines/{version}/,
 * then deletes the temporary archive file.
 */
export async function downloadAndExtractEngine(
    engineVersion: string,
    engineReleaseUrl: string,
    enginesDir: string,
    onProgress?: (progress: { phase: string; loaded: number; total: number }) => void,
): Promise<void> {
    // Create engines directory
    await fs.mkdir(enginesDir, { recursive: true });

    // Get engine release info
    const engineInfo = await getAvailableEngines(engineReleaseUrl, engineVersion);

    if (!engineInfo.mirrors || engineInfo.mirrors.length === 0) {
        throw new Error(`No download mirrors available for engine ${engineVersion}`);
    }

    const downloadedFilePath = path.join(enginesDir, engineInfo.filename);
    const engineDestinationPath = path.join(enginesDir, engineVersion);

    try {
        // Download 7z archive
        onProgress?.({ phase: "downloading", loaded: 0, total: engineInfo.size });

        const response = await axios({
            url: engineInfo.mirrors[0],
            method: "get",
            responseType: "stream",
            headers: { "Content-Type": "application/7z" },
        });

        const contentLength = response.headers["content-length"];
        const totalSize = contentLength ? parseInt(String(contentLength), 10) : engineInfo.size;
        let downloadedBytes = 0;

        response.data.on("data", (chunk: Buffer) => {
            downloadedBytes += chunk.length;
            onProgress?.({ phase: "downloading", loaded: downloadedBytes, total: totalSize });
        });

        // Write to file
        await pipeline(response.data, createWriteStream(downloadedFilePath));

        // Extract 7z
        onProgress?.({ phase: "extracting", loaded: 0, total: 100 });
        await fs.mkdir(engineDestinationPath, { recursive: true });

        // Use 7zip-min's unpack function
        return new Promise<void>((resolve, reject) => {
            sevenZip.unpack(downloadedFilePath, engineDestinationPath, (error: Error | null) => {
                if (error) {
                    reject(new Error(`7z extraction failed: ${error.message}`));
                } else {
                    onProgress?.({ phase: "complete", loaded: 100, total: 100 });
                    resolve();
                }
            });
        }).then(async () => {
            // Clean up archive
            await fs.unlink(downloadedFilePath).catch(() => {
                /* ignore */
            });
        });
    } catch (error) {
        // Cleanup on failure
        await fs.rm(downloadedFilePath, { force: true }).catch(() => {
            /* ignore */
        });
        await fs.rm(engineDestinationPath, { force: true, recursive: true }).catch(() => {
            /* ignore */
        });
        throw error;
    }
}
