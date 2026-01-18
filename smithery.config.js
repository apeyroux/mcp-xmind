// Smithery build configuration
// https://smithery.ai/docs/build/deployments/typescript

export default {
    esbuild: {
        // Mark these packages as external (don't bundle them)
        external: [
            "@modelcontextprotocol/sdk",
            "@modelcontextprotocol/sdk/server/mcp.js",
            "@modelcontextprotocol/sdk/server/stdio.js",
            "zod",
            "adm-zip",
            "glob",
            "minimatch"
        ],
        // Set Node.js target version
        target: "node18",
    }
};
