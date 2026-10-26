// Role inference from config/roles.json (docs/decisions.md D7).
import { readFileSync } from "node:fs";
import type { Role } from "./event.ts";

interface Rule {
  role: Role;
  tools?: string[];
  toolPrefix?: string[];
  shellTools?: boolean;
  cmd?: string[];
}

interface RoleConfig {
  dispatchTools: string[];
  rules: Rule[];
  shellTools: string[];
  agentTypes: Record<string, Role>;
  defaultToolRole: Role;
  defaultAgentRole: Role;
}

export interface RoleMatcher {
  isDispatch(tool: string): boolean;
  forTool(tool: string, command?: string): Role;
  forAgent(agentType: string | undefined): Role;
}

export function loadRoles(path = new URL("../../../config/roles.json", import.meta.url)): RoleMatcher {
  const cfg = JSON.parse(readFileSync(path, "utf8")) as RoleConfig;
  const shell = new Set(cfg.shellTools);
  const compiled = cfg.rules.map((r) => ({ ...r, re: (r.cmd ?? []).map((s) => new RegExp(s)) }));
  return {
    isDispatch: (tool) => cfg.dispatchTools.includes(tool),
    forTool(tool, command) {
      for (const r of compiled) {
        if (r.shellTools) {
          if (shell.has(tool) && command !== undefined && r.re.some((re) => re.test(command))) return r.role;
          continue;
        }
        if (r.tools?.includes(tool)) return r.role;
        if (r.toolPrefix?.some((p) => tool.startsWith(p))) return r.role;
      }
      return cfg.defaultToolRole;
    },
    forAgent: (agentType) => (agentType && cfg.agentTypes[agentType]) || cfg.defaultAgentRole,
  };
}
