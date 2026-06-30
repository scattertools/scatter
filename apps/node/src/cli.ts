#!/usr/bin/env node
import { Command } from 'commander';
import { setTimeout as sleep } from 'timers/promises';
import {
  loadConfig,
  saveConfig,
  parseSize,
  formatSize,
  type Config,
} from './config.ts';
import { startDaemon, VERSION } from './daemon.ts';
import { startHeadlessLogger } from './logger.ts';
import { CoordinatorClient } from './coordinator.ts';

const program = new Command();

// TTY-aware colour output helpers.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) =>
  useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
const c = {
  green: paint('32'),
  red: paint('31'),
  yellow: paint('33'),
  cyan: paint('36'),
  dim: paint('2'),
  bold: paint('1'),
};

function ok(msg: string) {
  console.log(`${c.green('✓')} ${msg}`);
}
function fail(msg: string): never {
  console.error(`${c.red('✗')} ${msg}`);
  process.exit(1);
}

/** Resolve and persist config from common --data-dir/--coordinator options. */
function configFor(opts: { dataDir?: string; coordinator?: string }): Config {
  return loadConfig({ dataDir: opts.dataDir, coordinator: opts.coordinator });
}

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
  .option('--json', 'output raw JSON')
  .action(async (opts) => {
    const config = loadConfig({ dataDir: opts.dataDir });

    // Best-effort: enrich with the signed-in account + credits when linked.
    let account: { email: string; username: string; credits: number } | null =
      null;
    if (config.sessionToken) {
      try {
        const client = new CoordinatorClient(config.coordinator);
        const [user, credits] = await Promise.all([
          client.me(config.sessionToken),
          client.credits(config.sessionToken).catch(() => 0),
        ]);
        account = { email: user.email, username: user.username, credits };
      } catch {
        /* offline or session expired — show config without account */
      }
    }

    if (opts.json) {
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
            account,
          },
          null,
          2,
        ),
      );
      return;
    }

    const row = (label: string, value: string) =>
      console.log(`  ${c.dim(label.padEnd(12))} ${value}`);
    console.log(c.bold('\nScatter node'));
    row('node id', config.nodeId ?? c.dim('not registered yet'));
    row('coordinator', config.coordinator);
    row('storage', formatSize(config.capacityBytes));
    row('port', String(config.port));
    row('data dir', config.dataDir);
    if (account) {
      console.log(c.bold('\nAccount'));
      row('email', account.email);
      row('username', account.username || c.dim('—'));
      row('credits', c.cyan(account.credits.toLocaleString()));
    } else if (config.sessionToken) {
      console.log(
        c.yellow('\nlinked, but could not reach coordinator for account info'),
      );
    } else {
      console.log(
        c.dim('\nnot linked to an account — run `scatter login` to earn credits'),
      );
    }
    console.log('');
  });

program
  .command('login')
  .description('link this node to your scatter account')
  .option('--code <code>', 'sign in with a one-time login code from the web')
  .option('--coordinator <url>', 'coordinator URL')
  .option('--data-dir <path>', 'data directory')
  .action(async (opts) => {
    const config = configFor(opts);
    const client = new CoordinatorClient(config.coordinator);

    // Path A: one-time login code from the web account settings.
    if (opts.code) {
      const { session, user } = await client.loginWithCode(opts.code);
      saveConfig({ ...config, sessionToken: session });
      ok(`signed in as ${c.bold(user.email)}`);
      return;
    }

    // Path B: OAuth-style device flow — open the browser, then poll.
    const device = await client.startDeviceLogin();
    console.log(c.bold('\nTo sign in, open:'));
    console.log(`  ${c.cyan(device.verificationUrlComplete)}`);
    console.log(`\nand confirm this code: ${c.bold(device.userCode)}\n`);
    console.log(c.dim('waiting for approval...'));

    const intervalMs = Math.max(device.pollIntervalSeconds, 1) * 1000;
    const deadline = Date.now() + device.expiresInMinutes * 60_000;
    for (;;) {
      if (Date.now() > deadline) fail('sign-in timed out, please try again');
      await sleep(intervalMs);
      const result = await client.pollDeviceLogin(device.deviceCode);
      if (result.status === 'approved') {
        saveConfig({ ...config, sessionToken: result.session });
        ok(`signed in as ${c.bold(result.user.email)}`);
        return;
      }
      if (result.status === 'expired' || result.status === 'not_found') {
        fail('sign-in code expired, please try again');
      }
    }
  });

program
  .command('logout')
  .description('unlink this node from your account')
  .option('--data-dir <path>', 'data directory')
  .action((opts) => {
    const config = loadConfig({ dataDir: opts.dataDir });
    if (!config.sessionToken) {
      console.log(c.dim('not signed in'));
      return;
    }
    saveConfig({ ...config, sessionToken: null });
    ok('signed out');
  });

program
  .command('account')
  .alias('whoami')
  .description('show the linked account and credit balance')
  .option('--data-dir <path>', 'data directory')
  .option('--json', 'output raw JSON')
  .action(async (opts) => {
    const config = loadConfig({ dataDir: opts.dataDir });
    if (!config.sessionToken) {
      fail('not signed in — run `scatter login`');
    }
    const client = new CoordinatorClient(config.coordinator);
    const [user, credits] = await Promise.all([
      client.me(config.sessionToken!),
      client.credits(config.sessionToken!).catch(() => 0),
    ]);
    if (opts.json) {
      console.log(
        JSON.stringify(
          { email: user.email, username: user.username, credits },
          null,
          2,
        ),
      );
      return;
    }
    console.log(c.bold('\nAccount'));
    console.log(`  ${c.dim('email'.padEnd(10))} ${user.email}`);
    console.log(`  ${c.dim('username'.padEnd(10))} ${user.username || c.dim('—')}`);
    console.log(`  ${c.dim('credits'.padEnd(10))} ${c.cyan(credits.toLocaleString())}\n`);
  });

program
  .command('username <name>')
  .description('set your account username')
  .option('--data-dir <path>', 'data directory')
  .action(async (name, opts) => {
    const config = loadConfig({ dataDir: opts.dataDir });
    if (!config.sessionToken) {
      fail('not signed in — run `scatter login`');
    }
    const client = new CoordinatorClient(config.coordinator);
    const user = await client.updateUsername(config.sessionToken!, name);
    ok(`username set to ${c.bold(user.username)}`);
  });

program
  .command('set-storage <size>')
  .description('change the storage allocation (e.g., 50GB)')
  .option('--data-dir <path>', 'data directory')
  .action((size, opts) => {
    const config = loadConfig({ dataDir: opts.dataDir });
    const capacityBytes = parseSize(size);
    saveConfig({ ...config, capacityBytes });
    ok(`storage allocation set to ${c.bold(formatSize(capacityBytes))}`);
    if (config.nodeId) {
      console.log(c.dim('  applies on next heartbeat (restart not required)'));
    }
  });

program
  .command('set-coordinator <url>')
  .description('point this node at a different coordinator')
  .option('--data-dir <path>', 'data directory')
  .action((url, opts) => {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/]+/.test(trimmed)) {
      fail('coordinator url must start with http:// or https:// and include a host');
    }
    const config = loadConfig({ dataDir: opts.dataDir });
    saveConfig({ ...config, coordinator: trimmed });
    ok(`coordinator set to ${c.bold(trimmed)}`);
    console.log(c.dim('  restart the node for the change to take effect'));
  });

program
  .command('reset')
  .description('forget node ID (will re-register on next start)')
  .option('--data-dir <path>', 'data directory')
  .action((opts) => {
    const config = loadConfig({ dataDir: opts.dataDir });
    config.nodeId = null;
    config.nodeToken = null;
    saveConfig(config);
    ok('node ID cleared');
  });

program.parseAsync().catch((err) => {
  console.error('\n✗', err.message);
  process.exit(1);
});
