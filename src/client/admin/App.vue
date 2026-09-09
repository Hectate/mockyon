<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

type AutohostStatus = {
    status: "stopped" | "starting" | "running" | "stopping";
    pid?: number;
    startedAt?: number;
    connected: boolean;
};

const password = ref("");
const status = ref("");
const error = ref("");
const clientError = ref("");
const connectedClients = ref<{ username: string; userId: string }[]>([]);
const autohost = ref<AutohostStatus>({ status: "stopped", connected: false });
const autohostError = ref("");
const autohostActionPending = ref(false);
let statusTimer: ReturnType<typeof setInterval> | undefined;

async function loadStatus() {
    const response = await fetch("/api/admin/status");
    if (!response.ok) throw new Error("Unable to load server status");
    const data = (await response.json()) as { clients?: { username: string; userId: string }[]; autohost?: AutohostStatus };
    connectedClients.value = data.clients ?? [];
    if (data.autohost) autohost.value = data.autohost;
}

onMounted(async () => {
    const response = await fetch("/api/admin/password");
    if (response.ok) password.value = (await response.json()).password;
    try {
        await loadStatus();
        statusTimer = setInterval(() => void loadStatus().catch(() => (clientError.value = "Unable to load server status.")), 5000);
    } catch {
        clientError.value = "Unable to load server status.";
    }
});

onUnmounted(() => clearInterval(statusTimer));

async function savePassword() {
    status.value = "";
    error.value = "";
    const response = await fetch("/api/admin/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.value }),
    });
    if (response.ok) status.value = "Password updated.";
    else error.value = "Password could not be updated.";
}

async function startAutohost() {
    autohostError.value = "";
    autohostActionPending.value = true;
    try {
        const response = await fetch("/api/admin/autohost/start", { method: "POST" });
        if (response.ok) autohost.value = await response.json();
        else autohostError.value = "Could not start autohost.";
    } finally {
        autohostActionPending.value = false;
    }
}

async function stopAutohost() {
    autohostError.value = "";
    autohostActionPending.value = true;
    try {
        const response = await fetch("/api/admin/autohost/stop", { method: "POST" });
        if (response.ok) autohost.value = await response.json();
        else autohostError.value = "Could not stop autohost.";
    } finally {
        autohostActionPending.value = false;
    }
}
</script>

<template>
    <main class="page">
        <h1>Mockyon Admin</h1>
        <p class="notice">This is a stub page &mdash; no live data yet.</p>
        <section>
            <h2>Server Password</h2>
            <form @submit.prevent="savePassword">
                <label>
                    Password
                    <input v-model="password" type="text" autocomplete="off" />
                </label>
                <button type="submit">Save password</button>
            </form>
            <p v-if="status" class="success">{{ status }}</p>
            <p v-if="error" class="error">{{ error }}</p>
        </section>
        <section>
            <h2>Connected Clients</h2>
            <p v-if="clientError" class="error">{{ clientError }}</p>
            <p v-else-if="connectedClients.length === 0">No clients connected.</p>
            <ul v-else>
                <li v-for="client in connectedClients" :key="client.userId">{{ client.username }} (ID: {{ client.userId }})</li>
            </ul>
        </section>
        <section>
            <h2>Autohost</h2>
            <p>
                Status: <strong>{{ autohost.connected ? "connected" : autohost.status }}</strong>
                <span v-if="autohost.pid"> (pid {{ autohost.pid }})</span>
            </p>
            <button type="button" :disabled="autohostActionPending || autohost.status !== 'stopped'" @click="startAutohost">
                Start autohost
            </button>
            <button type="button" :disabled="autohostActionPending || autohost.status === 'stopped'" @click="stopAutohost">
                Stop autohost
            </button>
            <p v-if="autohostError" class="error">{{ autohostError }}</p>
        </section>
    </main>
</template>

<style>
.page {
    font-family: system-ui, sans-serif;
    max-width: 40rem;
    margin: 4rem auto;
    padding: 0 1rem;
}
.notice {
    color: #666;
}
.success {
    color: #067647;
}
.error {
    color: #b42318;
}
section {
    border-top: 1px solid #ddd;
    padding-top: 1rem;
    margin-top: 1rem;
}
</style>
