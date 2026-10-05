// main.bicep
//
// Reproduces everything we built by hand in the Portal:
//   Resource Group (created separately, this deploys INTO it)
//     -> App Service Plan (Linux, F1 Free) + App Service (.NET 10)
//     -> SQL Server + Database (Serverless, auto-pause)
//     -> Log Analytics Workspace + Application Insights
//     -> Key Vault (RBAC-authorized) holding the SQL connection string
//     -> Role assignments wiring the App Service's managed identity to Key Vault
//
// Deploy with (resource group must already exist):
//   az deployment group create \
//     --resource-group rg-task-tracker \
//     --template-file main.bicep \
//     --parameters main.parameters.json \
//     --parameters sqlAdminPassword='<prompted, not stored in the file>'

@description('Short name used as the base for every resource name (lowercase, no spaces).')
param baseName string = 'task-tracker'

@description('Azure region for every resource.')
param location string = resourceGroup().location

@description('SQL Server admin login name.')
param sqlAdminLogin string

@secure()
@description('SQL Server admin password. Pass this at deploy time — never commit it to a parameters file.')
param sqlAdminPassword string

@description('Your current public IP, so you can run EF Core migrations from your own machine. Leave blank to skip.')
param clientIpAddress string = ''

@description('Your own Entra object ID (run: az ad signed-in-user show --query id -o tsv). Lets you set the Key Vault secret yourself after this deployment finishes.')
param deployerPrincipalId string

var uniqueSuffix = uniqueString(resourceGroup().id)
var appServicePlanName = '${baseName}-plan'
var webAppName = '${baseName}-${uniqueSuffix}'
var sqlServerName = '${baseName}-sql-${uniqueSuffix}'
var sqlDatabaseName = 'taskdb'
var keyVaultName = '${baseName}-kv-${uniqueSuffix}'
var logAnalyticsName = '${baseName}-logs'
var appInsightsName = '${baseName}-insights'

// ---- Compute: App Service Plan + Web App ----------------------------------
resource appServicePlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: appServicePlanName
  location: location
  sku: {
    name: 'F1'
    tier: 'Free'
  }
  kind: 'linux'
  properties: {
    reserved: true // required for Linux plans
  }
}

resource webApp 'Microsoft.Web/sites@2024-04-01' = {
  name: webAppName
  location: location
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned' // this is the "turn on managed identity" step, as code
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|10.0'
      appSettings: [
        {
          name: 'KeyVaultUri'
          value: keyVault.properties.vaultUri
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
      ]
    }
  }
}

// ---- Data: Azure SQL Server + Database (Serverless, auto-pause) -----------
resource sqlServer 'Microsoft.Sql/servers@2021-11-01' = {
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword
    publicNetworkAccess: 'Enabled'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2021-11-01' = {
  parent: sqlServer
  name: sqlDatabaseName
  location: location
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 1 // max vCores
  }
  properties: {
    minCapacity: json('0.5')
    autoPauseDelay: 60 // minutes idle before auto-pause
  }
}

// Lets any Azure resource (including this App Service) reach the server —
// the equivalent of the "Allow Azure services and resources to access this
// server" toggle we ticked by hand.
resource sqlAllowAzureServices 'Microsoft.Sql/servers/firewallRules@2021-11-01' = {
  parent: sqlServer
  name: 'AllowAllWindowsAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// Optional: lets you run `dotnet ef database update` from your own machine.
resource sqlAllowClientIp 'Microsoft.Sql/servers/firewallRules@2021-11-01' = if (!empty(clientIpAddress)) {
  parent: sqlServer
  name: 'AllowClientIp'
  properties: {
    startIpAddress: clientIpAddress
    endIpAddress: clientIpAddress
  }
}

// ---- Observability: Log Analytics + Application Insights ------------------
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
  }
}

// ---- Secrets: Key Vault (RBAC-authorized) ----------------------------------
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true // RBAC, not the legacy access-policy model
  }
}

// Note: the actual secret VALUE is deliberately not created here. Writing a
// secret through a Bicep/ARM deployment means the deploying principal needs
// Key Vault data-plane rights at the moment this template runs — granting
// that via a role assignment created earlier in the SAME deployment is a
// known race condition (RBAC propagation isn't guaranteed instant, which is
// exactly the "wait several minutes" error we hit doing this by hand). Safer
// and more realistic: this template provisions the infrastructure and grants
// both identities the right roles; the secret's actual value is set as a
// separate step after the deployment completes (see the README).

// ---- Identity wiring: Key Vault role assignments ---------------------------
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6' // read-only: for the App Service
var keyVaultSecretsOfficerRoleId = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7' // read/write: for you

resource webAppKeyVaultAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, webApp.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource deployerKeyVaultAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, deployerPrincipalId, keyVaultSecretsOfficerRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsOfficerRoleId)
    principalId: deployerPrincipalId
    principalType: 'User'
  }
}

// ---- Outputs ----------------------------------------------------------------
output webAppHostName string = webApp.properties.defaultHostName
output keyVaultUri string = keyVault.properties.vaultUri
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output sqlConnectionStringToStore string = 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Initial Catalog=${sqlDatabaseName};User ID=${sqlAdminLogin};Password=<YOUR-PASSWORD-HERE>;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;'
