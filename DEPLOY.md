# Deploying KeelCat (APISteward)

Single Docker container (API + dashboard in one origin) behind **Caddy** for
automatic HTTPS and compression, with config/state on a persistent volume.
This matches the app's design: one always-on instance, real filesystem with
`git`/`python3`, a public URL for webhooks.

Use GitHub and/or Google OAuth with a stable `SESSION_SECRET` for public,
multi-user deployments. `APP_PASSWORD` is the fallback for a shared,
single-operator workspace when OAuth is not configured. Never publish an
unauthenticated instance with real repository credentials.

---

## Google Cloud Compute Engine (parallel competition demo)

Compute Engine is the closest equivalent to the current AWS Lightsail host.
The existing Dockerfile, Compose file, and Caddy configuration work unchanged.
The app writes tenant state to local files and polls changelogs in a background
timer, so do not move it to a default, autoscaling Cloud Run service as-is.
That would need a separate storage and background-job design.

Deploy a separate demo first. Leave the AWS instance, production DNS, existing
OAuth callbacks, and production webhooks unchanged. Confirm the competition's
rules separately: hosting on Google Cloud does not by itself prove that any
required Gemini or Vertex AI integration is satisfied.

### 1. Prepare the Google Cloud project
- Open [Google Cloud Console](https://console.cloud.google.com/), select or
  create the competition project, and attach billing or the competition credits.
- Enable the **Compute Engine API** if prompted.
- In **Billing -> Budgets & alerts**, create a budget and email alerts.
  Budget alerts are notifications, not a hard spending cap.
- The VM, disk, external IPv4 address, and network usage can incur charges.
  The suggested machine below is not an Always Free configuration.

### 2. Create the VM
Go to **Compute Engine -> VM instances -> Create instance**:
- Name: `keelcat-web`.
- Region: `asia-south1` (Mumbai), or the competition's required region.
- Machine: **E2 -> e2-medium**, 4 GB RAM with shared CPU, to leave room for
  building the frontend and running Docker. Revisit sizing after the demo.
- OS: **Ubuntu 24.04 LTS**, x86/64, with a **30 GB balanced persistent disk**.
- Allow **HTTP** and **HTTPS** traffic. Keep application port **8080 private**.
- Enable deletion protection. Restrict SSH to your IP or configure IAP access;
  do not add a new unrestricted SSH firewall rule.

Create the VM. Under **VPC network -> IP addresses**, promote its external IPv4
address from ephemeral to **static**. Keep this address for the demo DNS record.
The Docker volume lives on the VM's disk: it survives container rebuilds and VM
reboots, but it is not a backup and can be lost if that disk is deleted.

### 3. Install Docker and clone the repository
Open the VM's **SSH** button and follow **Ubuntu Docker installation** below.
After reconnecting to SSH, clone the repository:

```bash
git clone https://github.com/vinodyallur/keelcatv12.git
cd keelcatv12
```

Never commit tokens or `.env` files to the repository. No local Windows Docker
or Google Cloud CLI installation is needed for this Console-based path.

### 4. Configure a separate demo hostname and login
- Add an **A record** for a hostname you control, such as `gcp.keelcat.in`,
  pointing to the new static IP. Do not change the existing `keelcat.in` record.
- Create a **separate GitHub OAuth App** for the demo, because an existing GitHub
  OAuth App has one configured callback URL. Use the demo homepage and callback
  `https://gcp.keelcat.in/api/auth/callback`.
- For Google login, add `https://gcp.keelcat.in/api/auth/google/callback` as an
  authorized redirect URI, preserving the existing AWS URI, or use a separate
  OAuth client for the demo. Configure the consent screen/test users as needed.

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Set `SITE_ADDRESS=gcp.keelcat.in` (replace the example hostname everywhere), the
OAuth client values, `OWNER_GITHUB_LOGIN`, and a random `SESSION_SECRET` generated
privately with `openssl rand -hex 32`. Do not prefix the domain with a colon.
Keep secrets on the VM; do not paste them into chat. Use `nano` to edit `.env`
rather than pasting a shell heredoc. Escape literal dollar signs as `$$` when
needed for Docker Compose interpolation.

Use demo repositories and test billing credentials, not live customer payments.
Leave the test sandbox off on a public host. Keep server-side runs disabled
(the default); normal interactive runs execute in the visitor's browser.
Configure the desired LLM provider/model in **Connect** after signing in.

### 5. Build and verify
Run from `~/keelcatv12` after the demo DNS resolves:

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl --fail https://gcp.keelcat.in/api/health
```

The health endpoint should return `{"ok":true}` and both containers should be
running. Open the demo URL and verify HTTPS, sign-in, workspace isolation, a
changelog parse, and an on-machine run against a demo repository. Verify that
state survives `docker compose restart app`. Leave automation off until these
checks pass; use separate demo GitHub Apps/webhooks rather than changing the
production ones. Inspect `docker compose logs --tail=100 app caddy` if needed,
and redact secrets before sharing logs.

Never run `docker compose down -v` on an instance whose data you need. Before
retiring the demo, back up any needed data and review the VM, persistent disks,
snapshots, and static IP charges; stopping the VM does not stop all charges.

References: [Create a Compute Engine VM](https://docs.cloud.google.com/compute/docs/instances/create-start-instance),
[static external IP addresses](https://docs.cloud.google.com/compute/docs/ip-addresses/reserve-static-external-ip-address).

---

## Option A — AWS Lightsail (recommended, uses your credits)

### 1. Create the instance
- Lightsail → **Create instance** → Linux/Unix → **OS Only → Ubuntu 22.04 LTS**.
- Plan: **2 GB RAM / 2 vCPU** (the $12/mo plan). Snappy for LLM + sandbox runs.
  Bump to 4 GB if you'll enable the test sandbox heavily.
- Create. Then **Networking → IPv4 firewall** → add rules: **HTTP 80** and **HTTPS 443**
  (SSH 22 is already open).
- **Networking → Attach static IP** (so your DNS never breaks on reboot).

### 2. Install Docker
SSH in (Lightsail browser SSH or your key), then follow **Ubuntu Docker
installation** below. The Ubuntu commands are not for an existing Amazon Linux
host; leave the running AWS installation unchanged.

### 3. Get the code
```bash
git clone https://github.com/vinodyallur/keelcatv12.git
cd keelcatv12
```

### 4. Configure
```bash
cp .env.example .env
nano .env
```
Set at minimum:
- `SITE_ADDRESS=yourdomain.com`  (or `:80` to test by IP first)
- `APP_PASSWORD=<a strong password>`
- `LLM_API_KEY=<your OpenRouter/Gemini key>`
- `GITHUB_PAT=<token>`  *(or the `GITHUB_APP_*` values)*

### 5. Launch
```bash
docker compose up -d --build
docker compose logs -f app      # watch it boot; Ctrl-C to stop tailing
```
Health check:
```bash
docker compose exec -T app node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>{console.log(r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
```
Expect status `200`. Port 8080 is internal to the Compose network, not published
on the host. Once HTTPS is ready, also check the public `/api/health` URL.

### 6. Point your domain
- In your DNS provider: **A record** `yourdomain.com` → the Lightsail **static IP**.
- Once DNS resolves, Caddy auto-issues a Let's Encrypt cert (SITE_ADDRESS must be
  the domain, not `:80`). Visit `https://yourdomain.com`.

### 7. Wire GitHub (for instant webhooks)
- Open the app → **Connect** → create the GitHub App via the manifest flow. On a
  public URL it now auto-registers the webhook (skipped on localhost), enabling
  instant push detection. Or just use a PAT to start.

---

## Option B — EC2 (if you prefer raw EC2)
Same steps, but:
- Launch **t3.small** (or t3.medium) Ubuntu 22.04, 20 GB gp3 disk.
- Security Group: allow inbound **80**, **443**, **22**.
- Allocate + associate an **Elastic IP**.
- Then follow steps 2–7 above.

---

## Ubuntu Docker installation
For a **fresh Ubuntu VM** only, use Docker's official repository. These commands
also install Git and the nano editor.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git nano
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
printf '%s\n' \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Disconnect SSH and reconnect so group membership takes effect, then check:

```bash
docker compose version
docker run --rm hello-world
```

Docker group membership grants root-equivalent access; grant it only to trusted
operators. See [Docker's Ubuntu installation guide](https://docs.docker.com/engine/install/ubuntu/).

---

## Updating a running deploy
```bash
cd ~/keelcatv12
git pull
docker compose up -d --build      # rebuilds; data/ volume is preserved
```

## Backups
Your entire state is the `app-data` volume (`/app/server/data`). Back it up:
```bash
docker run --rm -v keelcatv12_app-data:/d -v $PWD:/b alpine \
  tar czf /b/keelcat-data-$(date +%F).tgz -C /d .
```

---

## Performance notes ("fast, no lags")
- `NODE_ENV=production` is set in the image.
- Caddy compresses responses (`zstd`/`gzip`); Vite assets are content-hashed and
  served with `immutable` 1-year cache headers — repeat loads are instant.
- Proxy read/write timeouts are 300s so long fan-out runs don't get cut off.
- Use **2 GB+ RAM**. The LLM calls are network-bound; the deterministic fix path
  is CPU-light. The **test sandbox** (git clone + running repo suites) is the only
  heavy part — keep it **off** unless you sized the box for it, and never run it
  open to the public (it executes third-party code).
- Put the instance in the AWS region closest to you / your users to cut latency.

## Security checklist
- [ ] OAuth and a stable `SESSION_SECRET` set for public multi-user use, or `APP_PASSWORD` for one shared operator
- [ ] `.env` is **not** committed and the local `data/` folder was **not** copied up
- [ ] Only 80/443/22 open; consider restricting 22 to your IP
- [ ] Test sandbox (`Run tests on the fix`) left OFF on shared/public hosts
- [ ] Rotate any token that was ever pasted into a non-TLS/local session
