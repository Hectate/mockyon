import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const clientDir = fileURLToPath(new URL(".", import.meta.url));

// Multi-page build: each subfolder here becomes a standalone static page under /public.
export default defineConfig({
    root: clientDir,
    plugins: [vue()],
    build: {
        outDir: resolve(clientDir, "../public"),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                login: resolve(clientDir, "login/index.html"),
                admin: resolve(clientDir, "admin/index.html"),
            },
        },
    },
});
