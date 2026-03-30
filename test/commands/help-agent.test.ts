import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';

describe('Help Agent Command', () => {
  let program: Command;

  beforeEach(async () => {
    vi.resetModules();

    // Import command and register it
    const { registerHelpAgentCommand } = await import('../../src/commands/help-agent');
    program = new Command();
    registerHelpAgentCommand(program);
  });

  describe('quickstart', () => {
    it('should display quickstart guide', async () => {
      await program.parseAsync(['node', 'test', 'quickstart']);

      expect(console.log).toHaveBeenCalled();
      const output = (console.log as any).mock.calls[0][0];
      expect(output).toContain('Quick Reference');
      expect(output).toContain('Setup');
    });

    it('should include workspace discovery commands', async () => {
      await program.parseAsync(['node', 'test', 'quickstart']);

      const output = (console.log as any).mock.calls[0][0];
      expect(output).toContain('notion db list');
      expect(output).toContain('notion db schema');
      expect(output).toContain('workspace structure');
    });

    it('should include search and query examples', async () => {
      await program.parseAsync(['node', 'test', 'quickstart']);

      const output = (console.log as any).mock.calls[0][0];
      expect(output).toContain('notion search');
      expect(output).toContain('notion db query');
    });

    it('should include create and update examples', async () => {
      await program.parseAsync(['node', 'test', 'quickstart']);

      const output = (console.log as any).mock.calls[0][0];
      expect(output).toContain('notion page create');
      expect(output).toContain('notion page update');
      expect(output).toContain('notion bulk update');
    });

    it('should include batch operations', async () => {
      await program.parseAsync(['node', 'test', 'quickstart']);

      const output = (console.log as any).mock.calls[0][0];
      expect(output).toContain('notion batch');
    });

    it('should include tips', async () => {
      await program.parseAsync(['node', 'test', 'quickstart']);

      const output = (console.log as any).mock.calls[0][0];
      expect(output).toContain('Tips');
      expect(output).toContain('case-sensitive');
      expect(output).toContain('dry-run');
    });

    it('should include property type documentation', async () => {
      await program.parseAsync(['node', 'test', 'quickstart']);

      const output = (console.log as any).mock.calls[0][0];
      expect(output).toContain('filter-prop-type');
      expect(output).toContain('status');
      expect(output).toContain('select');
      expect(output).toContain('checkbox');
    });
  });

  describe('quickstart alias', () => {
    it('should work with qs alias', async () => {
      await program.parseAsync(['node', 'test', 'qs']);

      expect(console.log).toHaveBeenCalled();
      const output = (console.log as any).mock.calls[0][0];
      expect(output).toContain('Quick Reference');
    });
  });
});
