# Azure AKS Deployment Configuration

This guide covers deploying the Timesheet Management System on Azure Kubernetes Service (AKS).

## Prerequisites

1. Azure CLI installed: `az --version`
2. kubectl installed: `kubectl version --client`
3. Azure subscription with appropriate permissions
4. Resource group created

## 1. Create Azure Resources

### Create Resource Group
```bash
az group create \
  --name timesheet-prod \
  --location eastus
```

### Create Azure Database for PostgreSQL
```bash
az postgres server create \
  --resource-group timesheet-prod \
  --name timesheet-db-prod \
  --location eastus \
  --admin-user timesheet_admin \
  --admin-password <STRONG_PASSWORD> \
  --sku-name B_Gen5_2 \
  --storage-size 102400 \
  --backup-retention-period 35 \
  --geo-redundant-backup Enabled \
  --enable-log-backups true \
  --ssl-enforcement Enabled

# Create firewall rule for app servers
az postgres server firewall-rule create \
  --resource-group timesheet-prod \
  --server-name timesheet-db-prod \
  --name AllowAppServers \
  --start-ip-address 10.0.0.0 \
  --end-ip-address 10.255.255.255
```

### Create Azure Cache for Redis
```bash
az redis create \
  --resource-group timesheet-prod \
  --name timesheet-redis-prod \
  --location eastus \
  --sku Premium \
  --vm-size p1 \
  --minimum-tls-version 1.2 \
  --enable-non-ssl-port false \
  --zones 1 2 3

# Get Redis connection string
REDIS_URL=$(az redis show-connection-string \
  --resource-group timesheet-prod \
  --name timesheet-redis-prod \
  --admin-key)
```

### Create Storage Account for Uploads
```bash
az storage account create \
  --resource-group timesheet-prod \
  --name timesheetuploads \
  --location eastus \
  --sku Standard_GRS \
  --encryption-services blob \
  --https-only true

# Create container
az storage container create \
  --account-name timesheetuploads \
  --name uploads \
  --public-access off

# Enable soft delete
az storage blob service-properties update \
  --account-name timesheetuploads \
  --enable-soft-delete true \
  --delete-retention-days 30
```

### Create Container Registry
```bash
az acr create \
  --resource-group timesheet-prod \
  --name timesheetregistry \
  --sku Premium \
  --location eastus
```

## 2. Create AKS Cluster

```bash
az aks create \
  --resource-group timesheet-prod \
  --name timesheet-aks \
  --node-count 2 \
  --vm-set-type VirtualMachineScaleSets \
  --load-balancer-sku standard \
  --network-plugin azure \
  --network-policy azure \
  --enable-managed-identity \
  --zones 1 2 3 \
  --node-vm-size Standard_B2s \
  --enable-cluster-autoscaling \
  --min-count 2 \
  --max-count 10 \
  --generate-ssh-keys \
  --attach-acr timesheetregistry \
  --enable-log-analytics-workspace \
  --workspace-resource-id /subscriptions/<SUB_ID>/resourcegroups/<RG>/providers/microsoft.operationalinsights/workspaces/<WORKSPACE>

# Get cluster credentials
az aks get-credentials \
  --resource-group timesheet-prod \
  --name timesheet-aks \
  --overwrite-existing
```

## 3. Configure kubectl

```bash
# Verify cluster connection
kubectl cluster-info

# List nodes
kubectl get nodes
```

## 4. Deploy Applications

### Push Docker Images to ACR
```bash
az acr login --name timesheetregistry

docker tag timesheet-backend:latest timesheetregistry.azurecr.io/timesheet-backend:latest
docker push timesheetregistry.azurecr.io/timesheet-backend:latest

docker tag timesheet-frontend:latest timesheetregistry.azurecr.io/timesheet-frontend:latest
docker push timesheetregistry.azurecr.io/timesheet-frontend:latest

# List images
az acr repository list --name timesheetregistry
```

### Update Kubernetes Manifests

In `secrets-configmap.yaml`, update:
```yaml
stringData:
  DATABASE_URL: "postgresql://timesheet_admin:PASSWORD@timesheet-db-prod.postgres.database.azure.com:5432/timesheet_db?sslmode=require"
  REDIS_URL: "rediss://:PASSWORD@timesheet-redis-prod.redis.cache.windows.net:6380"
```

In `backend-deployment.yaml`, update:
```yaml
image: timesheetregistry.azurecr.io/timesheet-backend:latest
```

### Deploy to Kubernetes
```bash
# Create namespace
kubectl apply -f deployment/kubernetes/namespace.yaml

# Create secrets and configmaps
kubectl apply -f deployment/kubernetes/secrets-configmap.yaml

# Create storage class and PVC
kubectl apply -f deployment/kubernetes/ingress-storage.yaml

# Deploy backend
kubectl apply -f deployment/kubernetes/backend-deployment.yaml

# Deploy frontend
kubectl apply -f deployment/kubernetes/frontend-deployment.yaml

# Deploy ingress
kubectl apply -f deployment/kubernetes/ingress-storage.yaml

# Verify deployments
kubectl get deployments -n timesheet
kubectl get pods -n timesheet
```

## 5. Configure Ingress Controller

### Install NGINX Ingress Controller
```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install nginx-ingress ingress-nginx/ingress-nginx \
  --namespace ingress-basic \
  --create-namespace \
  --set controller.service.type=LoadBalancer \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/azure-load-balancer-health-probe-request-path"=/healthz
```

### Get Load Balancer IP
```bash
kubectl get service nginx-ingress-ingress-nginx-controller -n ingress-basic
```

### Update DNS
Point your domain to the Load Balancer IP in your DNS provider.

## 6. Configure SSL/TLS with Let's Encrypt

### Install cert-manager
```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml

# Wait for cert-manager to be ready
kubectl wait --for=condition=Available --timeout=300s deployment/cert-manager -n cert-manager
```

### Create ClusterIssuer
```bash
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF
```

## 7. Application Insights & Monitoring

### Enable Monitoring
```bash
az aks enable-addons \
  --resource-group timesheet-prod \
  --name timesheet-aks \
  --addons monitoring

# Verify monitoring pod
kubectl get daemonset omsagent -n kube-system
```

### Create Alert Rules
```bash
az monitor metrics alert create \
  --resource-group timesheet-prod \
  --name "High CPU Usage" \
  --description "Alert when CPU exceeds 80%" \
  --scopes /subscriptions/<SUB_ID>/resourcegroups/timesheet-prod \
  --condition "avg Percentage CPU > 80" \
  --window-size 5m \
  --evaluation-frequency 1m \
  --action /subscriptions/<SUB_ID>/resourceGroups/timesheet-prod/providers/microsoft.insights/actionGroups/TimeSheetAlerts
```

## 8. Manage Secrets with Key Vault

### Create Key Vault
```bash
az keyvault create \
  --resource-group timesheet-prod \
  --name timesheet-kv \
  --location eastus

# Add secrets
az keyvault secret set \
  --vault-name timesheet-kv \
  --name JWT-SECRET \
  --value "your-jwt-secret"

az keyvault secret set \
  --vault-name timesheet-kv \
  --name SMTP-PASSWORD \
  --value "your-smtp-password"
```

### Link Key Vault to AKS
```bash
# Create identity
az identity create \
  --name timesheet-pod-identity \
  --resource-group timesheet-prod

# Get identity info
IDENTITY_ID=$(az identity show \
  --name timesheet-pod-identity \
  --resource-group timesheet-prod \
  --query id -o tsv)

# Grant access to Key Vault
az keyvault set-policy \
  --name timesheet-kv \
  --object-id $(az identity show \
    --name timesheet-pod-identity \
    --resource-group timesheet-prod \
    --query principalId -o tsv) \
  --secret-permissions get
```

## 9. Scale & Update

### Scale Deployment
```bash
kubectl scale deployment timesheet-backend \
  --replicas 5 \
  -n timesheet
```

### Update Image
```bash
kubectl set image deployment/timesheet-backend \
  backend=timesheetregistry.azurecr.io/timesheet-backend:v2 \
  -n timesheet
```

### Rollback
```bash
kubectl rollout undo deployment/timesheet-backend \
  -n timesheet
```

## 10. Monitoring & Logs

### View Logs
```bash
# Pod logs
kubectl logs -f deployment/timesheet-backend -n timesheet

# All pods
kubectl logs -f -l app=timesheet-backend -n timesheet

# Previous logs (if crashed)
kubectl logs --previous pod-name -n timesheet
```

### Monitor Cluster
```bash
# Top nodes
kubectl top nodes

# Top pods
kubectl top pods -n timesheet

# Describe pod
kubectl describe pod pod-name -n timesheet
```

## Cost Optimization

1. Use Standard tier VMs for non-critical workloads
2. Enable cluster autoscaling
3. Use spot instances for batch jobs
4. Monitor and right-size nodes
5. Use reserved instances for predictable workloads

## Troubleshooting

### Pod not starting
```bash
kubectl describe pod pod-name -n timesheet
kubectl logs pod-name -n timesheet
```

### Service not accessible
```bash
kubectl get svc -n timesheet
kubectl describe ingress -n timesheet
```

### Image pull errors
```bash
az acr show --name timesheetregistry --query loginServer
kubectl get secret regsecret -o jsonpath='{.data.*}' | base64 -d
```

