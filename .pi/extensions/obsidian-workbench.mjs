import { configureObsidian, obsidianStatus, createObsidianProject } from '../lib/obsidian-workbench.mjs';

export default function obsidianWorkbench(pi) {
  if (process.env.PI_SUBAGENT_CHILD === '1') return;

  pi.registerTool({
    name: 'research_setup_obsidian',
    label: 'Configure Obsidian',
    description: 'Bind an independent Obsidian vault and configure the project MCPVault server. Preserves existing notes. Parent session only. Reload after setup.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, project: { type: 'string' } }, required: ['path'] },
    async execute(_id, params, _signal, _update, ctx) {
      const result = await configureObsidian({ cwd: ctx.cwd, vault: params.path, project: params.project });
      return { content: [{ type: 'text', text: JSON.stringify(result) + '\nRun /reload before using the updated MCP connection.' }], details: result };
    },
  });

  pi.registerTool({
    name: 'research_create_project',
    label: 'Create research project',
    description: 'Create a project from the generic Obsidian template and update project indexes. Existing projects and human edits are preserved.',
    parameters: {
      type: 'object',
      properties: { project: { type: 'string' }, title: { type: 'string' } },
      required: ['project'],
    },
    async execute(_id, params, _signal, _update, ctx) {
      const result = await createObsidianProject({ cwd: ctx.cwd, project: params.project, title: params.title || params.project });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], details: result };
    },
  });

  pi.registerCommand('research-setup', {
    description: 'Configure the paired Obsidian vault',
    handler: async (args, ctx) => {
      const current = await obsidianStatus(ctx.cwd);
      const vault = args.trim() || (ctx.hasUI ? await ctx.ui.input('Obsidian vault path', current.vault || '') : null);
      if (!vault) return;
      try {
        const result = await configureObsidian({ cwd: ctx.cwd, vault });
        ctx.ui.notify(`Obsidian: ${result.vault}. Run /reload to refresh MCP.`, 'info');
      } catch (error) { ctx.ui.notify(error.message, 'error'); }
    },
  });

  pi.on('session_start', async (_event, ctx) => {
    const status = await obsidianStatus(ctx.cwd);
    if (status.state === 'ready') {
      if (ctx.hasUI) ctx.ui.notify(`Obsidian: ${status.vault}`, 'info');
    } else {
      pi.sendMessage({ customType: 'obsidian-setup', content: `Obsidian setup required (${status.state}). Run /research-setup with an independent vault path, or ask to configure the research vault.`, display: true }, { triggerTurn: false });
    }
  });

  pi.on('before_agent_start', async (event, ctx) => {
    const status = await obsidianStatus(ctx.cwd);
    const guidance = status.state === 'ready'
      ? `Paired Obsidian vault: ${status.vault}. Use MCP server research-obsidian for local knowledge retrieval. Only the parent session publishes knowledge; subagents return evidence. Use wiki links, preserve human review outside pi-agent managed blocks, and keep large artifacts under results. Finalize runs through research_summarize_run only after the persistent research_loop evidence gate is answerable.`
      : `Obsidian setup is incomplete (${status.state}). Configure the independent vault with research_setup_obsidian before knowledge writes. Do not claim knowledge has been saved.`;
    const outputGuidance = 'For research subagents, resolve output files to absolute paths under the chosen run directory before passing the subagent output argument. Relative output paths can be redirected into session artifacts by pi-subagents. Read the actual returned file and use research_summarize_run output paths in the final report, rather than copying paths from input evidence.';
    return { systemPrompt: `${event.systemPrompt}\n\n${guidance}\n${outputGuidance}` };
  });
}
