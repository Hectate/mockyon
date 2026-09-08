import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import json from "@eslint/json";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
    {
        ignores: ["**/build", "**/node_modules", "package-lock.json"],
    },
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
    },
    { files: ["**/*.{js,mjs,cjs,ts,vue}"], ...pluginJs.configs.recommended },
    ...tseslint.configs.recommended.map((c) => ({ files: ["**/*.{js,mjs,cjs,ts,vue}"], ...c })),
    ...pluginVue.configs["flat/essential"].map((c) => ({ files: ["**/*.vue"], ...c })),
    { files: ["**/*.vue"], languageOptions: { parserOptions: { parser: tseslint.parser } } },
    {
        files: ["**/*.{js,mjs,cjs,ts,vue}"],
        rules: {
            "vue/multi-word-component-names": "off",
            "@typescript-eslint/no-unused-vars": "warn",
            "@typescript-eslint/no-explicit-any": "warn",
        },
    },
    {
        files: ["**/*.json"],
        ignores: ["package-lock.json"],
        plugins: { json },
        language: "json/json",
        rules: {
            ...json.configs.recommended.rules,
        },
    },
    eslintConfigPrettier,
];
