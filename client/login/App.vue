<script setup lang="ts">
import { ref } from "vue";

// Stub only: no real auth request is wired up yet.
const username = ref("");
const password = ref("");
</script>

<template>
    <main class="page">
        <h1>Mockyon Login</h1>
        <p class="notice">This is a stub page &mdash; login is not yet functional.</p>
        <form>
            <label>
                Username
                <input v-model="username" type="text" name="username" autocomplete="username" />
            </label>
            <label>
                Password
                <input v-model="password" type="password" name="password" autocomplete="current-password" />
            </label>
            <button type="submit" disabled>Log in</button>
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
form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}
</style>
