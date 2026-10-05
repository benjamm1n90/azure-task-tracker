#!/usr/bin/env bash
# One-time setup so GitHub Actions can deploy to your App Service without any
# stored password (OpenID Connect / workload identity federation).
#
# Usage:   ./setup-github-oidc.sh <github-owner>/<repo>
# Example: ./setup-github-oidc.sh janedoe/task-tracker
#
# Prereqs: az login done, and the App Service already exists.

set -euo pipefail

REPO="${1:?Usage: $0 <github-owner>/<repo>}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-task-tracker}"
WEBAPP_NAME="${WEBAPP_NAME:-task-tracker}"
APP_DISPLAY_NAME="github-deploy-${WEBAPP_NAME}"

SUBSCRIPTION_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

echo "Creating Entra app registration..."
APP_ID=$(az ad app create --display-name "$APP_DISPLAY_NAME" --query appId -o tsv)
APP_OBJECT_ID=$(az ad app show --id "$APP_ID" --query id -o tsv)

echo "Creating service principal..."
SP_OBJECT_ID=$(az ad sp create --id "$APP_ID" --query id -o tsv)

echo "Granting 'Website Contributor' on just the one web app (least privilege)..."
WEBAPP_SCOPE="/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Web/sites/${WEBAPP_NAME}"
# Role assignment can race the new service principal's replication; retry briefly.
for i in 1 2 3 4 5; do
  if az role assignment create --role "Website Contributor" \
      --assignee-object-id "$SP_OBJECT_ID" --assignee-principal-type ServicePrincipal \
      --scope "$WEBAPP_SCOPE" >/dev/null 2>&1; then break; fi
  echo "  principal not replicated yet, retrying in 10s..."; sleep 10
done

echo "Trusting tokens issued to pushes on main of ${REPO}..."
az ad app federated-credential create --id "$APP_OBJECT_ID" --parameters "{
  \"name\": \"github-main\",
  \"issuer\": \"https://token.actions.githubusercontent.com\",
  \"subject\": \"repo:${REPO}:ref:refs/heads/main\",
  \"audiences\": [\"api://AzureADTokenExchange\"]
}" >/dev/null

cat <<EOF

Done. In GitHub: repo -> Settings -> Secrets and variables -> Actions ->
New repository secret. Add these three (they identify, not authenticate —
there is no password anywhere):

  AZURE_CLIENT_ID       = ${APP_ID}
  AZURE_TENANT_ID       = ${TENANT_ID}
  AZURE_SUBSCRIPTION_ID = ${SUBSCRIPTION_ID}
EOF
