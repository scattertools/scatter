# Running the Scatter node as a Windows service

Windows has no built-in equivalent of a simple systemd/launchd unit for an
arbitrary process, so use one of the two approaches below. Both run the
**compiled** CLI (`apps\node\dist\cli.js`) under plain `node` — no experimental
flags. Build it first:

```powershell
pnpm --filter node build
```

The node reads its config + shard storage from `%USERPROFILE%\.scatter`
(equivalent to `~/.scatter` on Unix).

## Option A — NSSM (recommended)

[NSSM](https://nssm.cc/) wraps any executable as a proper Windows service with
restart-on-crash and log redirection. It is **not** an npm dependency — install
it separately (`choco install nssm` or download the binary).

```powershell
# Resolve absolute paths first.
$node = (Get-Command node).Source
$cli  = "C:\opt\scatter\apps\node\dist\cli.js"   # adjust to your install

# Install the service.
nssm install ScatterNode "$node" "$cli start"
nssm set ScatterNode AppDirectory "C:\opt\scatter\apps\node"
nssm set ScatterNode AppEnvironmentExtra NODE_ENV=production
nssm set ScatterNode Start SERVICE_AUTO_START

# Start / stop / remove.
nssm start ScatterNode
nssm stop ScatterNode
nssm remove ScatterNode confirm
```

## Option B — sc.exe (built-in, no extra tooling)

`sc.exe` ships with Windows but expects a real service binary, so it cannot
restart a crashed plain process and offers no log handling. Acceptable for a
quick setup:

```powershell
$node = (Get-Command node).Source
$cli  = "C:\opt\scatter\apps\node\dist\cli.js"

sc.exe create ScatterNode binPath= "\"$node\" \"$cli\" start" start= auto
sc.exe start ScatterNode

# Remove later.
sc.exe stop ScatterNode
sc.exe delete ScatterNode
```

> A full native Windows service wrapper binary is out of scope for this unit;
> NSSM covers the realistic production case.
