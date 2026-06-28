#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig, saveConfig, parseSize, formatSize } from './config.ts';
import { startDaemon, VERSION } from './daemon.ts';
import { startHeadlessLogger } from './logger.ts';

const program = new Command();

program
  .name('scatter')
  .description('Scatter node — contribute storage, help the network')
  .version(VERSION);

program
  .command('start')
  .description('start the node')
  .option('--storage <size>', 'storage allocation (e.g., 50GB)')
  .option('--coordinator <url>', 'coordinator URL')
  .option('--port <n>', 'local HTTP port', (v) => parseInt(v, 10))
  .option('--data-dir <path>', 'data directory (default: ~/.scatter)')
  .action(async (opts) => {
    const config = loadConfig({
      coordinator: opts.coordinator,
      capacityBytes: opts.storage ? parseSize(opts.storage) : undefined,
      port: opts.port,
      dataDir: opts.dataDir,
    });
    saveConfig(config);

    const daemon = await startDaemon(config);

    startHeadlessLogger(daemon);
    // Graceful shutdown
    const shutdown = async () => {
      console.log('\nshutting down...');
      await daemon.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program
  .command('status')
  .description("show config + status of this machine's node")
  .option('--data-dir <path>', 'data directory')
  .action((opts) => {
    const config = loadConfig({ dataDir: opts.dataDir });
    console.log(
      JSON.stringify(
        {
          nodeId: config.nodeId,
          coordinator: config.coordinator,
          capacity: formatSize(config.capacityBytes),
          capacityBytes: config.capacityBytes,
          port: config.port,
          dataDir: config.dataDir,
          linked: Boolean(config.sessionToken),
        },
        null,
        2,
      ),
    );
  });

program
  .command('reset')
  .description('forget node ID (will re-register on next start)')
  .option('--data-dir <path>', 'data directory')
  .action((opts) => {
    const config = loadConfig({ dataDir: opts.dataDir });
    config.nodeId = null;
    saveConfig(config);
    console.log('✓ node ID cleared');
  });

program.parseAsync().catch((err) => {
  console.error('\n✗', err.message);
  process.exit(1);
});
