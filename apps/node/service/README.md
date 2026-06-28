# Scatter node — service install scaffolding

These templates run the Scatter node as a background OS service using the
**compiled** CLI. There are no runtime experimental flags and no extra npm
dependencies.

## 0. Build the binary first

```sh
pnpm --filter node build
```

This emits `apps/node/dist/`. The entry is `apps/node/dist/cli.js`, which keeps
its `#!/usr/bin/env node` shebang and is marked executable, so all of these are
equivalent:

```sh
node /abs/path/to/apps/node/dist/cli.js start   # explicit
/abs/path/to/apps/node/dist/cli.js start         # via shebang
scatter start                                    # if installed on PATH (npm i -g / pnpm link)
```

Config and shard storage live under `~/.scatter` (`config.json` + shard data)
by default; pass `--data-dir <path>` to relocate.

Throughout the templates, `EXEC_PATH` means the absolute path to the compiled
`cli.js` (or to the `scatter` shim if you installed it globally).

---

## Linux — systemd

Template: [`scatter-node.service`](./scatter-node.service). Placeholders:

| placeholder   | value                                              |
| ------------- | -------------------------------------------------- |
| `__USER__`    | the user/group the node runs as                    |
| `__EXEC_PATH__` | absolute path to `dist/cli.js` (or `scatter` shim) |

```sh
# Render the template (example using sed) and install it.
sed -e "s|__USER__|$USER|g" \
    -e "s|__EXEC_PATH__|$PWD/apps/node/dist/cli.js|g" \
    apps/node/service/scatter-node.service \
  | sudo tee /etc/systemd/system/scatter-node.service > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable --now scatter-node
sudo systemctl status scatter-node      # check
journalctl -u scatter-node -f           # logs
```

Uninstall:

```sh
sudo systemctl disable --now scatter-node
sudo rm /etc/systemd/system/scatter-node.service
sudo systemctl daemon-reload
```

---

## macOS — launchd

Template: [`tools.scatter.node.plist`](./tools.scatter.node.plist).
Placeholders:

| placeholder    | value                                       |
| -------------- | ------------------------------------------- |
| `__NODE_BIN__` | output of `command -v node`                 |
| `__EXEC_PATH__`| absolute path to `dist/cli.js`              |
| `__HOME__`     | the user's home dir (holds `~/.scatter`)    |

Install as a per-user agent (no sudo; runs while logged in):

```sh
mkdir -p ~/Library/LaunchAgents
sed -e "s|__NODE_BIN__|$(command -v node)|g" \
    -e "s|__EXEC_PATH__|$PWD/apps/node/dist/cli.js|g" \
    -e "s|__HOME__|$HOME|g" \
    apps/node/service/tools.scatter.node.plist \
  > ~/Library/LaunchAgents/tools.scatter.node.plist

launchctl load -w ~/Library/LaunchAgents/tools.scatter.node.plist
launchctl list | grep tools.scatter.node     # check
```

Logs go to `~/.scatter/node.out.log` and `~/.scatter/node.err.log`.

Uninstall:

```sh
launchctl unload -w ~/Library/LaunchAgents/tools.scatter.node.plist
rm ~/Library/LaunchAgents/tools.scatter.node.plist
```

---

## Windows

See [`windows-service.md`](./windows-service.md) (NSSM recommended, or
`sc.exe`).
