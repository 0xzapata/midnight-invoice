import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/** The app environment when VITE_APP_ENV is not set. */
export function defaultAppEnv(isProductionBuild: boolean): "DEVELOPMENT" | "PRODUCTION" {
    return isProductionBuild ? "PRODUCTION" : "DEVELOPMENT";
}

export const env = createEnv({
    server: {
        // Add server-side environment variables here
    },
    client: {
        VITE_APP_NAME: z.string().min(1).optional().default("Midnight Invoice"),
        // Unset: DEVELOPMENT under the dev server, PRODUCTION in builds (so a deploy without a
        // .env never shows the "Development Mode" banner and dev favicon).
        VITE_APP_ENV: z.enum(["DEVELOPMENT", "STAGING", "PREVIEW", "PRODUCTION"]).optional().default(defaultAppEnv(import.meta.env.PROD)),
    },
    /**
     * The prefix that client-side variables must have. This is enforced both at
     * a type-level and at runtime.
     */
    clientPrefix: "VITE_",

    runtimeEnv: import.meta.env,

    /**
     * By default, this library will feed the environment variables directly to
     * the Zod validator.
     */
    emptyStringAsUndefined: true,
});
