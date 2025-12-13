import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
    server: {
        // Add server-side environment variables here
    },
    client: {
        VITE_APP_NAME: z.string().min(1),
        VITE_APP_ENV: z.enum(["DEVELOPMENT", "STAGING", "PREVIEW", "PRODUCTION"]).optional().default("DEVELOPMENT"),
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
