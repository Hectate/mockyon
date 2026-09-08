<script setup lang="ts">
import { onMounted, ref } from "vue";

const username = ref("");
const password = ref("");
const clientName = ref("Tachyon Client");
const error = ref("");
const loading = ref(false);
const requestId = new URLSearchParams(window.location.search).get("request_id");

onMounted(async () => {
    if (!requestId) {
        error.value = "This login page was not opened by a client authorization request.";
        return;
    }
    const response = await fetch(`/api/auth/request/${encodeURIComponent(requestId)}`);
    if (!response.ok) error.value = "This authorization request has expired.";
    else clientName.value = (await response.json()).clientName;
});

async function login() {
    if (!requestId) return;
    loading.value = true;
    error.value = "";
    const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, username: username.value, password: password.value }),
    });
    if (!response.ok) {
        error.value = "The username or password is incorrect.";
        loading.value = false;
        return;
    }
    window.location.replace((await response.json()).redirectUri);
}
</script>

<template>
    <main class="page">
        <h1>Mockyon Login</h1>
        <p class="notice">Sign in to continue to {{ clientName }}.</p>
        <p v-if="error" class="error">{{ error }}</p>
        <form @submit.prevent="login">
            <label>
                Username
                <input v-model="username" type="text" name="username" autocomplete="username" />
            </label>
            <label>
                Password
                <input v-model="password" type="password" name="password" autocomplete="current-password" />
            </label>
            <button type="submit" :disabled="loading || !requestId">{{ loading ? "Signing in..." : "Log in" }}</button>
        </form>
    </main>
</template>

<style>
.page {
    font-family: system-ui, sans-serif;
    max-width: 24rem;
    margin: 4rem auto;
    padding: 0 1rem;
}
.notice {
    color: #666;
}
.error {
    color: #b42318;
}
form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}
</style>
