import type { Daemon } from "./daemon.ts";
import { formatSize } from "./config.ts";

const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

export function startHeadlessLogger(daemon: Daemon) {
  const ts = () => c.dim(new Date().toISOString().slice(11, 19));

  console.log(c.bold("\n🌐 Scatter Node"));
  console.log(c.dim(`   version 0.1.0`));
  console.log(c.dim(`   id      ${daemon.config.nodeId}`));
  console.log(c.dim(`   api     ${daemon.config.coordinator}`));
  console.log(c.dim(`   data    ${daemon.config.dataDir}`));
  console.log(
    c.dim(`   storage ${formatSize(daemon.state.usedBytes)} / ${formatSize(daemon.config.capacityBytes)}\n`),
  );

  daemon.events.onEvent((e) => {
    switch (e.kind) {
      case "uploaded":
        console.log(
          `${ts()} ${c.green("↑")} stored ${c.cyan(`${e.fileId.slice(0, 8)}#${e.shardIndex}`)} (${formatSize(e.size)})`,
        );
        break;
      case "downloaded":
        console.log(
          `${ts()} ${c.cyan("↓")} served ${c.cyan(`${e.fileId.slice(0, 8)}#${e.shardIndex}`)} (${formatSize(e.size)})`,
        );
        break;
      case "deleted":
        console.log(`${ts()} ${c.dim("✗")} removed ${c.cyan(`${e.fileId.slice(0, 8)}#${e.shardIndex}`)}`);
        break;
      case "heartbeat":
        break;
      case "registered":
        console.log(`${ts()} ${c.green("✓")} ${e.message}`);
        break;
      case "error":
        console.log(`${ts()} ${c.red("✗")} ${e.message}`);
        break;
    }
  });
}