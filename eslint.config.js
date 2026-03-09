import tseslint from "@typescript-eslint/eslint-plugin";
import parser   from "@typescript-eslint/parser";

export default [
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parser,
            parserOptions: {
                project: "./tsconfig.json",
            },
        },
        plugins: { "@typescript-eslint": tseslint },
        rules: {
            "@typescript-eslint/no-explicit-any":        "warn",
            "@typescript-eslint/no-unused-vars":         "error",
            "@typescript-eslint/no-floating-promises":   "error",
            "@typescript-eslint/await-thenable":         "error",
            "@typescript-eslint/no-unnecessary-type-assertion": "warn",
        },
    },
];