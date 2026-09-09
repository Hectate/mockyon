export default {
    useTabs: false,
    trailingComma: "es5",
    tabWidth: 4,
    semi: true,
    singleQuote: false,
    printWidth: 200,
    endOfLine: "crlf",
    overrides: [
        {
            files: "src/client/**/*.vue",
            options: {
                printWidth: 140,
            },
        },
    ],
};
