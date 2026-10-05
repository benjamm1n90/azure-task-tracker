# Infrastructure as Code

This folder reproduces every Azure resource from the Portal walkthrough, as a Bicep template instead of manual clicking.

## Prerequisites

- Azure CLI, logged in (`az login`)
- The resource group already exists (or create one: `az group create --name rg-task-tracker --location westus2`)

## Deploy

Two values are intentionally **not** in `main.parameters.json` because they're either secret or specific to whoever is deploying — pass them on the command line instead:

```bash
# Your Entra object ID — grants you Key Vault write access after deployment
DEPLOYER_ID=$(az ad signed-in-user show --query id -o tsv)

az deployment group create \
  --resource-group rg-task-tracker \
  --template-file main.bicep \
  --parameters main.parameters.json \
  --parameters deployerPrincipalId="$DEPLOYER_ID" \
  --parameters sqlAdminPassword='<pick a strong password, do not reuse the old one>'
```

That creates: the App Service Plan + Web App (with managed identity turned on), the SQL Server + Database (Serverless, auto-pause), the Log Analytics workspace + Application Insights, and the Key Vault — plus the two role assignments (the Web App can *read* secrets, you can *read and write* them).

## After it finishes: set the actual secret

The template deliberately does **not** write the real connection string as part of the deployment (see the comment in `main.bicep` for why — it's the same RBAC propagation race condition we hit doing this by hand). Set it yourself, right after:

```bash
az keyvault secret set \
  --vault-name <keyVaultName from the deployment output> \
  --name "ConnectionStrings--TaskDb" \
  --value "Server=tcp:<sqlServerFqdn from the output>,1433;Initial Catalog=taskdb;User ID=benja;Password=<the password you just picked>;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;"
```

Then restart the Web App so it picks up the secret:

```bash
az webapp restart --name <webAppHostName's first segment> --resource-group rg-task-tracker
```

## Create the database schema

Same as before — point EF Core's migrations at the new server:

```bash
dotnet user-secrets set "ConnectionStrings:TaskDb" "<same connection string as above>"
dotnet ef database update
```

## Tear down everything

This is the other half of why IaC is worth it — deleting and recreating the whole environment is trivial:

```bash
az group delete --name rg-task-tracker --yes --no-wait
```

Then re-run the `az deployment group create` command above whenever you want it back.
