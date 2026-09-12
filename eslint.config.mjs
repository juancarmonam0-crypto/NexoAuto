// ESLint 9 flat config.
//
// `eslint-config-next/core-web-vitals` is a complete flat config array: it
// already includes typescript-eslint, eslint-plugin-react, react-hooks,
// eslint-plugin-import, jsx-a11y, the Next.js plugin, globals and the Next
// parser. Adding `eslint-config-next/typescript` on top would re-register the
// same plugins and fail, so it is deliberately not imported here.
import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  {
    // Build output, dependencies, generated code and local runtime storage.
    // src/generated holds the Prisma client (~thousands of generated files).
    ignores: [
      "node_modules/**",
      ".next/**",
      ".npm-cache/**",
      "src/generated/**",
      "var/**",
      "coverage/**",
      "out/**",
      "build/**",
      "dist/**",
      "next-env.d.ts",
    ],
  },
  ...nextVitals,
];

export default config;
