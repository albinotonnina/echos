# Oracle Cloud Vault Integration

> Securely manage your EchOS secrets using Oracle Cloud Infrastructure (OCI) Vault.

## Overview

Oracle Cloud Vault is a managed service for storing and retrieving secrets (API keys, passwords, certificates). This guide shows how to:
- Store your secrets in OCI Vault
- Retrieve them at runtime on your Oracle Cloud instance
- Remove the need to copy `.env` files to your server

## Prerequisites

- Oracle Cloud account with access to OCI Vault
- Oracle Cloud Infrastructure CLI (OCI CLI) installed on your server
- Existing Oracle Cloud compute instance running your EchOS deployment

---

## Step 1: Create a Vault (One-time Setup)

### Via OCI Console

1. **Log in** to [Oracle Cloud Console](https://console.oraclecloud.com)
2. Navigate to **Identity & Security** → **Vault**
3. Select your **Compartment** (or create a new one)
4. Click **Create Vault**
   - Name: `echos-vault`
   - Click **Create Vault**

### Via OCI CLI (Optional)

```bash
# Create vault
oci vault vault create --compartment-id <YOUR_COMPARTMENT_OCID> --display-name "echos-vault" --vault-type DEFAULT

# Get vault OCID (note the id from output)
oci vault vault list --compartment-id <YOUR_COMPARTMENT_OCID> --all
```

---

## Step 2: Create Secrets

Create a secret for each sensitive value:

### Via OCI Console

1. Go to your vault → **Secrets**
2. Click **Create Secret**
3. Fill in:
   - **Name**: `echos-telegram-bot-token`
   - **Secret Contents**: Your Telegram bot token
   - **Encryption Key**: Use the default key or create one
4. Repeat for:
   - `echos-anthropic-api-key`
   - `echos-allowed-user-ids`
   - `echos-openai-api-key` (if used)

### Via OCI CLI

```bash
# Get your vault OCID
VAULT_OCID=$(oci vault vault list --compartment-id <YOUR_COMPARTMENT_OCID> --query "data[0].id" --raw-output)

# Get the master encryption key OCID
KEY_OCID=$(oci vault key list --compartment-id <YOUR_COMPARTMENT_OCID> --vault-id $VAULT_OCID --query "data[0].id" --raw-output)

# Create secrets
oci vault secret create-base64 \
  --compartment-id <YOUR_COMPARTMENT_OCID> \
  --vault-id $VAULT_OCID \
  --encryption-key-id $KEY_OCID \
  --secret-name "echos-telegram-bot-token" \
  --secret-contents "$(echo -n 'YOUR_TELEGRAM_BOT_TOKEN' | base64)"

oci vault secret create-base64 \
  --compartment-id <YOUR_COMPARTMENT_OCID> \
  --vault-id $VAULT_OCID \
  --encryption-key-id $KEY_OCID \
  --secret-name "echos-anthropic-api-key" \
  --secret-contents "$(echo -n 'YOUR_ANTHROPIC_API_KEY' | base64)"

oci vault secret create-base64 \
  --compartment-id <YOUR_COMPARTMENT_OCID> \
  --vault-id $VAULT_OCID \
  --encryption-key-id $KEY_OCID \
  --secret-name "echos-allowed-user-ids" \
  --secret-contents "$(echo -n 'YOUR_USER_IDS' | base64)"
```

---

## Step 3: Set Up OCI CLI on Your Server

### Install OCI CLI

```bash
# SSH to your Oracle Cloud instance
ssh your-server

# Install OCI CLI
bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)"
```

### Configure OCI CLI

```bash
# Configure with your credentials
oci setup config

# This will prompt for:
# - User OCID: Get from Oracle Cloud Console → User Settings → OCID
# - Tenancy OCID: Get from Oracle Cloud Console → Tenancy Details
# - Region: Your region (e.g., uk-london-1)
# - Enter path to PEM private key: /home/opc/.oci/oci_api_key.pem
```

### Authenticate

The OCI CLI can authenticate using Instance Principal (recommended for compute instances):

```bash
# Enable instance principal authentication
oci auth instance-principal auth invoke --all-verbs --resource-type all --secret-name "test" 2>&1 || true

# If you get a permission error, you need to add a policy (see Step 4)
```

---

## Step 4: Grant Access to Secrets (IAM Policy)

Create an IAM policy to allow your compute instance to read secrets:

### Via OCI Console

1. Go to **Identity & Security** → **Policies**
2. Select your compartment
3. Click **Create Policy**
4. Configure:
   - **Name**: `echos-vault-access`
   - **Policy Versioning**: Static
   - **Policy Statements**:

```
Allow dynamic-group <YOUR_INSTANCE_DYNAMIC_GROUP> to read secret-family in compartment <YOUR_COMPARTMENT_NAME>
```

> **Note**: You may need to create a Dynamic Group for your compute instance:
> 1. Go to **Identity & Security** → **Dynamic Groups**
> 2. Create: `All instances in compartment <YOUR_COMPARTMENT_NAME>`

### Via OCI CLI

```bash
# Create dynamic group
oci iam dynamic-group create \
  --compartment-id <YOUR_COMPARTMENT_OCID> \
  --matching-rule 'Any {instance.compartment.id = "<YOUR_COMPARTMENT_OCID>"}' \
  --description "EchOS compute instances" \
  --display-name "echos-instances"

# Create policy
oci iam policy create \
  --compartment-id <YOUR_COMPARTMENT_OCID> \
  --name "echos-vault-access" \
  --description "Allow EchOS instances to read vault secrets" \
  --statements '["Allow dynamic-group echos-instances to read secret-family in compartment id <YOUR_COMPARTMENT_OCID>"]'
```

---

## Step 5: Create a Secret Retrieval Script

Create a script on your server to fetch secrets at startup:

```bash
# SSH to your Oracle Cloud instance
ssh your-server

# Create the secret fetcher script
mkdir -p ~/echos/scripts
cat > ~/echos/scripts/fetch-secrets.sh << 'EOF'
#!/bin/bash
set -e

# Configuration
VAULT_SECRET_NAMES=(
  "echos-telegram-bot-token"
  "echos-anthropic-api-key"
  "echos-allowed-user-ids"
  "echos-openai-api-key"
)

SECRETS_DIR="/home/opc/echos/secrets"
mkdir -p "$SECRETS_DIR"

echo "Fetching secrets from OCI Vault..."

for secret_name in "${VAULT_SECRET_NAMES[@]}"; do
  # Try to get secret, skip if doesn't exist
  secret_content=$(oci vault secret get-secret-content \
    --secret-name "$secret_name" \
    2>/dev/null | head -1) || continue
  
  if [ -n "$secret_content" ]; then
    # Convert to env variable format
    env_name=$(echo "$secret_name" | sed 's/echos-//' | tr '[:lower:]' '[:upper:]')
    echo "${env_name}=${secret_content}" > "$SECRETS_DIR/${secret_name}.env"
    echo "✓ Retrieved: $secret_name"
  fi
done

# Generate combined .env file
> "$SECRETS_DIR/.env"
for file in "$SECRETS_DIR"/*.env; do
  [ -f "$file" ] && cat "$file" >> "$SECRETS_DIR/.env"
done

echo "✓ Secrets saved to $SECRETS_DIR/.env"
EOF

chmod +x ~/echos/scripts/fetch-secrets.sh
```

---

## Step 6: Modify Docker Compose

Update your docker-compose.yml to use the secrets:

```yaml
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  echos:
    image: echos:latest
    restart: unless-stopped
    depends_on:
      redis:
        condition: service_healthy
    env_file:
      - /home/opc/echos/secrets/.env
    environment:
      - REDIS_URL=redis://redis:6379
      - NODE_ENV=production
    volumes:
      - ../data/knowledge:/app/data/knowledge
      - ../data/db:/app/data/db
      - ../data/sessions:/app/data/sessions
    ports:
      - "${WEB_PORT:-3000}:3000"

volumes:
  redis-data:
```

---

## Step 7: Update Deployment Script

Modify `scripts/deploy-fast.sh` to:
1. **Remove** the `.env` file upload
2. **Add** a step to fetch secrets on the server before starting

```bash
# In your deploy script, after loading the Docker image but before docker compose up,
# add this SSH command:

# Fetch secrets from Oracle Cloud Vault
ssh your-server << 'EOF'
cd ~/echos
./scripts/fetch-secrets.sh
EOF
```

---

## Step 8: Test the Setup

```bash
# SSH to your server
ssh your-server

# Fetch secrets manually
~/echos/scripts/fetch-secrets.sh

# Verify secrets exist
cat ~/echos/secrets/.env

# Restart the container
cd ~/echos/docker
docker compose restart echos

# Check logs
docker compose logs echos
```

---

## Updating Secrets

When you need to update a secret (e.g., rotate API key):

### Via OCI Console

1. Go to **Vault** → **Secrets**
2. Click on the secret
3. Click **Create New Version**
4. Enter the new value

### Via OCI CLI

```bash
# Get secret OCID
SECRET_OCID=$(oci vault secret list \
  --compartment-id <YOUR_COMPARTMENT_OCID> \
  --vault-id $VAULT_OCID \
  --query "data[?\"display-name\"]=='echos-anthropic-api-key'.id" \
  --raw-output)

# Create new version
oci vault secret create-base64 \
  --secret-id $SECRET_OCID \
  --secret-contents "$(echo -n 'NEW_API_KEY' | base64)"
```

After updating, restart your container:

```bash
ssh your-server '~/echos/scripts/fetch-secrets.sh && cd ~/echos/docker && docker compose restart echos'
```

---

## Troubleshooting

### "Permission denied" when reading secrets

- Verify the IAM policy is correctly applied
- Check your dynamic group matches your instance
- Ensure the vault and secrets are in the same compartment as the policy

### OCI CLI not authenticated

```bash
# Verify authentication
oci iam region list

# If using instance principal, check it's enabled
oci auth instance-principal validate
```

### Secrets not loading

- Check the secrets directory permissions: `ls -la ~/echos/secrets/`
- Verify `.env` file exists and has correct format
- Check Docker logs: `docker compose logs echos`

---

## Security Benefits

1. **No .env files on server** - Secrets are fetched at runtime
2. **Centralized management** - Update secrets from OCI Console
3. **Audit logging** - OCI Vault logs all secret access
4. **Encryption at rest** - Secrets are encrypted with master keys
5. **No commit risk** - Sensitive values never enter your git repo

---

## Alternative: Simpler Approach

If Oracle Cloud Vault feels like overkill, consider this simpler alternative:

### Host Environment Variables

Set environment variables directly on the Oracle Cloud server:

```bash
# SSH to server
ssh your-server

# Add to ~/.bashrc or create /etc/environment
echo 'export ANTHROPIC_API_KEY="your-key"' >> ~/.bashrc
echo 'export TELEGRAM_BOT_TOKEN="your-token"' >> ~/.bashrc
echo 'export ALLOWED_USER_IDS="your-ids"' >> ~/.bashrc
source ~/.bashrc

# Update docker-compose.yml to use environment instead of env_file
# (See docs/DEPLOYMENT.md)
```

This approach:
- ✅ No additional services needed
- ✅ Simple to set up
- ❌ Less secure than Vault
- ❌ Manual updates via SSH

---

## References

- [OCI Vault Documentation](https://docs.oracle.com/en-us/iaas/Content/KeyManagement/Concepts/keyoverview.htm)
- [OCI CLI Installation](https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/cliinstall.htm)
- [Instance Principal Authentication](https://docs.oracle.com/en-us/iaas/Content/Identity/Instances/schedulingjobs.htm)
