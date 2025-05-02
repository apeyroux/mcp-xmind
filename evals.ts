//evals.ts

import { EvalConfig } from 'mcp-evals';
import { openai } from "@ai-sdk/openai";
import { grade, EvalFunction } from "mcp-evals";

const read_xmindEval: EvalFunction = {
    name: "read_xmind Tool Evaluation",
    description: "Evaluates the parsing and analysis of XMind files",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Given the XMind file at \"/test_files/mind_map.xmind\", parse it and return a JSON structure that includes all nodes, relationships, callouts, hierarchical paths, and external references.");
        return JSON.parse(result);
    }
};

const list_xmind_directoryEval: EvalFunction = {
    name: "list_xmind_directory",
    description: "Evaluates the comprehensive XMind file discovery and analysis tool",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please recursively scan the '/User/Documents' directory for .xmind files created or modified after January 1st, 2022. Search for files containing the phrase 'project plan', group them by category, detect duplicate mind maps, provide directory statistics, and verify file integrity. Include a summary of findings in the output.");
        return JSON.parse(result);
    }
};

const read_multiple_xmind_filesEval: EvalFunction = {
    name: 'read_multiple_xmind_files Evaluation',
    description: 'Evaluates the advanced multi-file analysis and correlation of multiple XMind files',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please read multiple XMind files from /tmp/xmind1.xmind and /tmp/xmind2.xmind, compare them, and produce a single JSON analysis. Also highlight any changes or inconsistencies between the files.");
        return JSON.parse(result);
    }
};

const search_xmind_filesEval: EvalFunction = {
    name: 'search_xmind_files Tool Evaluation',
    description: 'Evaluates advanced file search with partial name matching in subdirectories',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Search all subdirectories in /Users/test/Documents for items containing the text 'ProjectX' in their names (case-insensitive). Include both files and directories, and provide their full paths if found.");
        return JSON.parse(result);
    }
};

const extract_nodeEval: EvalFunction = {
    name: 'extract_node Tool Evaluation',
    description: 'Evaluates the fuzzy path matching for node extraction in an xmind file',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please extract the nodes related to 'Project > Feature API' from the xmind file located at '/home/user/maps/project.xmind'.");
        return JSON.parse(result);
    }
};

const config: EvalConfig = {
    model: openai("gpt-4"),
    evals: [read_xmindEval, list_xmind_directoryEval, read_multiple_xmind_filesEval, search_xmind_filesEval, extract_nodeEval]
};
  
export default config;
  
export const evals = [read_xmindEval, list_xmind_directoryEval, read_multiple_xmind_filesEval, search_xmind_filesEval, extract_nodeEval];