# 🛰 Self-hosting the TURN relay on Oracle Free Tier

SyncPad's calls are peer-to-peer WebRTC. STUN only finds a **direct** path; when
two people are in different cities / on mobile data / behind AP-isolating wifi
(the usual Indian-ISP reality), there is no direct path and **zero media flows**
— the call "connects" but tiles stay dark. That is exactly what the call-tracer
showed: `gathered host ×12, srflx ×2, relay ×0` → no relay candidate → dead call.

The fix is a **TURN relay** both peers can reach. Free public ones (OpenRelay)
are now account-gated / dead, so we run our own on an **Oracle Cloud Always-Free
VM** — free forever, and a genuinely strong DevOps portfolio piece.

> Do the whole thing in ~30–40 min. When you hit the two ⚠️ TRAPS, don't panic —
> they're the reason "installed coturn but still no media" happens to everyone.

---

## 0. What you'll end up with

```
   Muskan (Delhi)                Diya (Mumbai)
        \                            /
         \   no direct path (NAT)   /
          \                        /
            ┌──────────────────────┐
            │  Oracle VM (coturn)  │  ← relay carries the audio/video
            │  public IP : 3478    │
            └──────────────────────┘
   Signaling still flows through the Render CRDT server (unchanged).
```

You only need **3 values** at the end: the VM's **public IP**, its **private IP**,
and the **password** you choose. Everything else is copy-paste.

---

## 1. Create the Oracle account + VM

1. Sign up at <https://signup.cloud.oracle.com> — choose a **home region close to
   you** (e.g. **India West (Mumbai)** or **Hyderabad**). Home region is permanent,
   so pick the one where you + your friends are.
2. Compute → **Instances** → **Create instance**.
3. Name: `syncpad-turn`.
4. **Image**: `Ubuntu 22.04` (Canonical).
5. **Shape**: `Ampere` → `VM.Standard.A1.Flex` (Always Free, up to 4 OCPU / 24 GB)
   or the `AMD VM.Standard.E2.1.Micro` (Always Free, 1 GB). coturn is tiny —
   either is fine. Make sure it says **Always Free**.
6. **Network**:
   - VCN + subnet: let Oracle create the defaults.
   - ✅ **Assign a public IPv4 address** (Reserved or ephemeral — you need one).
7. **SSH keys**: download the private key (`syncpad-turn.key`) — you'll SSH with it.
8. Create. Wait for it to go **RUNNING**. Note the **public IP** from the instance page.

---

## 2. ⚠️ TRAP #1 — open ports in the Oracle Security List (cloud firewall)

Oracle has a **cloud-level** firewall separate from the OS. By default it only
allows SSH. Go to the instance → **Virtual network interface** → **Subnet** →
**Security List** → **Add Ingress Rules**, and add **three**:

| Source CIDR | IP proto | Dest port | Why |
|---|---|---|---|
| `0.0.0.0/0` | TCP | `3478` | TURN signaling + TCP relay |
| `0.0.0.0/0` | UDP | `3478` | TURN over UDP |
| `0.0.0.0/0` | UDP | `49160-49200` | the relay media port range |

If you skip this, the OS firewall (step 5) won't even matter — packets are
dropped before they reach the VM.

---

## 3. SSH in

```bash
chmod 400 syncpad-turn.key
ssh -i syncpad-turn.key ubuntu@YOUR_PUBLIC_IP
```

Get the **private IP** (you need it for the config):

```bash
hostname -I        # first address = private ip, e.g. 10.0.0.5
```

---

## 4. Install coturn

```bash
sudo apt update && sudo apt -y install coturn
# Ubuntu ships coturn DISABLED — this line is what actually lets it start:
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
```

---

## 5. Configure it

Open the config and paste the contents of
[`turnserver.conf`](./turnserver.conf) from this folder:

```bash
sudo nano /etc/turnserver.conf
```

Then replace the 4 placeholders:

| Placeholder | Replace with |
|---|---|
| `YOUR_PUBLIC_IP` (in `external-ip` and `realm`) | the VM public IP |
| `YOUR_PRIVATE_IP` (×3: external-ip tail, listening-ip, relay-ip) | `hostname -I` value |
| `CHANGE_ME_STRONG_PASSWORD` | a secret **you** invent (this becomes `VITE_TURN_PASS`) |

So `external-ip=YOUR_PUBLIC_IP/YOUR_PRIVATE_IP` becomes e.g.
`external-ip=141.22.33.44/10.0.0.5`.

> ⚠️ This `external-ip=PUBLIC/PRIVATE` line is the **#1 fix** for "coturn running
> but still no media" on any cloud VM. The VM only sees its private IP; without
> telling coturn the public mapping, relayed packets leave with a private address
> and never come back.

Save (`Ctrl+O`, `Enter`, `Ctrl+X`).

---

## 6. ⚠️ TRAP #2 — open ports in the OS firewall too

Oracle's Ubuntu image ships a restrictive `iptables` (persistent), so the cloud
Security List alone isn't enough — open the same ports on the host:

```bash
sudo iptables -I INPUT -p udp --dport 3478 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 3478 -j ACCEPT
sudo iptables -I INPUT -p udp --match udp --dport 49160:49200 -j ACCEPT
sudo apt -y install iptables-persistent
sudo netfilter-persistent save
```

(If the box uses `firewalld` instead — not default on Oracle — it'd be
`sudo firewall-cmd --permanent --add-port=3478/udp --add-port=3478/tcp
--add-port=49160-49200/udp && sudo firewall-cmd --reload`.)

---

## 7. Start + verify

```bash
sudo systemctl enable coturn
sudo systemctl restart coturn
sudo systemctl status coturn --no-pager     # want: active (running)
sudo journalctl -u coturn -b --no-pager | tail -n 20
```

You should see `Configuration complete` / `TURNS server started` with **no**
`ALERT: failed to open` or `udp server create error`.

---

## 8. Prove the relay is reachable (optional but smart)

From your **laptop** (not the VM):

```bash
# returns Allocate SUCCESS response if TURN is reachable + authing
turnutils_uclient -u syncpad -w 'YOUR_PASSWORD' -n 1 -p 3478 YOUR_PUBLIC_IP
```

Or skip the tool and just re-run a SyncPad call — open DevTools, type
`copyCallLog()`, and confirm the log now shows `gathered relay cand` and the tile
badge flips to `📶 relay→relay`.

---

## 9. Point the app at your relay

Set these three on **Vercel** (Project → Settings → Environment Variables →
Production), then redeploy:

```
VITE_TURN_URLS = turn:YOUR_PUBLIC_IP:3478,turn:YOUR_PUBLIC_IP:3478?transport=tcp
VITE_TURN_USER = syncpad
VITE_TURN_PASS = YOUR_PASSWORD
```

Tell me the **public IP** and I'll run the `vercel env add` + redeploy for you.
The client reads them at build time (see `RTC_CONFIG` in
`apps/web/src/components/CallOverlay.jsx`) — no code change needed to swap IPs.

---

## 10. Confirm from the console

After redeploy, hard-refresh both laptops, start a call, run `copyCallLog()`.
The boot line must say:

```
🎥 [call] ice: TURN ON → turn:YOUR_PUBLIC_IP:3478 , ...
```

and during gathering you should now see `gathered relay cand`. If you see
`ice: TURN OFF`, the env var didn't reach the build (wrong scope / not redeployed).

---

## Troubleshooting matrix

| Symptom | Likely cause | Fix |
|---|---|---|
| `relay ×0` still, TURN ON | Security List or OS firewall closed | redo steps 2 & 6 |
| relay candidate appears but `inbound v=0KB` | wrong `external-ip` mapping | fix `PUBLIC/PRIVATE` in step 5 |
| `448 Allocation Error` / auth fail | user/pass mismatch | `VITE_TURN_PASS` must equal `user=` password |
| coturn `inactive (dead)` | `TURNSERVER_ENABLED` not set | step 4 sed, then restart |
| works on wifi, fails on mobile data | mobile ISP blocks UDP 3478 | the `?transport=tcp` URL covers this |
| `ice: TURN OFF` in console | env not in prod build | set var scope = Production **before** redeploy |

---

## Hardening (later, not required to go live)

- Move to **time-limited RESTRICTED long-term credentials** (`use-auth-secret` +
  a tiny backend endpoint that mints per-session creds) so the browser never
  holds a static password.
- Add **TLS** (`turns:` on 5349) with a real cert (Caddy/certbot) for networks
  that only allow 443.
- Rate-limit + `denied-peer-ip` for the internet to stop your relay being abused
  as a DDoS amplifier.
