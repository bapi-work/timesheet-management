# GCP GKE Deployment Configuration

This guide covers deploying the Timesheet Management System on Google Kubernetes Engine (GKE).

## Prerequisites

1. Google Cloud CLI (gcloud) installed and configured
2. kubectl installed
3. GCP project with billing enabled
4. Appropriate IAM permissions

## 1. Setup Project & Enable APIs

```bash
# Set project
export PROJECT_ID="your-project-id"
export REGION="us-central1"

gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable \
  container.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  storage.googleapis.com \
  compute.googleapis.com \
  monitoring.googleapis.com \
  logging.googleapis.com \
  servicenetworking.googleapis.com
```

## 2. Create Cloud SQL Instance (PostgreSQL)

```bash
# Create SQL instance
gcloud sql instances create timesheet-db-prod \
  --database-version POSTGRES_16 \
  --tier db-custom-2-8192 \
  --storage-size 100GB \
  --storage-auto-increase \
  --storage-auto-increase-limit 500 \
  --region $REGION \
  --availability-type REGIONAL \
  --backup-start-time 03:00 \
  --enable-bin-log \
  --retained-backups-count 30 \
  --transaction-log-retention-days 7 \
  --maintenance-window-day SUN \
  --maintenance-window-hour 03 \
  --require-ssl

# Create database
gcloud sql databases create timesheet_db \
  --instance timesheet-db-prod

# Create database user
gcloud sql users create timesheet_admin \
  --instance timesheet-db-prod \
  --password <STRONG_PASSWORD>

# Get connection string
gcloud sql instances describe timesheet-db-prod \
  --format='get(connectionName)'

# Output: project:region:instance
# Export for later use
export SQL_CONNECTION_NAME=$(gcloud sql instances describe timesheet-db-prod \
  --format='get(connectionName)')
```

## 3. Create Memorystore for Redis

```bash
# Create Redis instance
gcloud redis instances create timesheet-redis-prod \
  --size=2 \
  --region $REGION \
  --tier premium \
  --redis-version 7.0 \
  --auth-enabled \
  --transit-encryption-mode SERVER_AUTHENTICATION

# Get connection details
gcloud redis instances describe timesheet-redis-prod \
  --region $REGION

# Export for use
export REDIS_HOST=$(gcloud redis instances describe timesheet-redis-prod \
  --region $REGION \
  --format='get(host)')
export REDIS_PORT=$(gcloud redis instances describe timesheet-redis-prod \
  --region $REGION \
  --format='get(port)')
```

## 4. Create Cloud Storage Bucket

```bash
# Create bucket
gsutil mb -c STANDARD -l $REGION -b on gs://timesheet-uploads-prod

# Set versioning
gsutil versioning set on gs://timesheet-uploads-prod

# Configure lifecycle policy
cat > lifecycle.json <<EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"numNewerVersions": 5}
      },
      {
        "action": {"type": "SetStorageClass", "storageClass": "NEARLINE"},
        "condition": {"age": 90}
      }
    ]
  }
}
EOF

gsutil lifecycle set lifecycle.json gs://timesheet-uploads-prod

# Enable uniform bucket-level access
gsutil uniformbucketlevelaccess set on gs://timesheet-uploads-prod
```

## 5. Create Artifact Registry

```bash
# Create repository
gcloud artifacts repositories create timesheet \
  --repository-format docker \
  --location $REGION \
  --description "Timesheet Management System"

# Configure Docker authentication
gcloud auth configure-docker $REGION-docker.pkg.dev

# Build and push images
docker build -t $REGION-docker.pkg.dev/$PROJECT_ID/timesheet/timesheet-backend:latest ./backend
docker push $REGION-docker.pkg.dev/$PROJECT_ID/timesheet/timesheet-backend:latest

docker build -t $REGION-docker.pkg.dev/$PROJECT_ID/timesheet/timesheet-frontend:latest ./frontend
docker push $REGION-docker.pkg.dev/$PROJECT_ID/timesheet/timesheet-frontend:latest
```

## 6. Create GKE Cluster

```bash
# Create GKE cluster
gcloud container clusters create timesheet-prod \
  --region $REGION \
  --num-nodes 2 \
  --machine-type n1-standard-2 \
  --enable-autoscaling \
  --min-nodes 2 \
  --max-nodes 10 \
  --enable-autorepair \
  --enable-autoupgrade \
  --enable-ip-alias \
  --enable-stackdriver-kubernetes \
  --addons HorizontalPodAutoscaling,HttpLoadBalancing,GcePersistentDiskCsiDriver \
  --workload-pool $PROJECT_ID.svc.id.goog \
  --labels environment=production,app=timesheet \
  --network-policy \
  --release-channel regular

# Get credentials
gcloud container clusters get-credentials timesheet-prod \
  --region $REGION

# Verify cluster
kubectl cluster-info
kubectl get nodes
```

## 7. Configure Workload Identity

```bash
# Create Kubernetes service account
kubectl create namespace timesheet
kubectl create serviceaccount timesheet-app -n timesheet

# Create Google service account
gcloud iam service-accounts create timesheet-app \
  --display-name "Timesheet Application"

# Grant permissions for Cloud SQL
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:timesheet-app@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

# Grant permissions for Cloud Storage
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:timesheet-app@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

# Bind Kubernetes SA to Google SA
gcloud iam service-accounts add-iam-policy-binding \
  timesheet-app@$PROJECT_ID.iam.gserviceaccount.com \
  --role roles/iam.workloadIdentityUser \
  --member "serviceAccount:$PROJECT_ID.svc.id.goog[timesheet/timesheet-app]"

# Annotate Kubernetes SA
kubectl annotate serviceaccount timesheet-app \
  -n timesheet \
  iam.gke.io/gcp-service-account=timesheet-app@$PROJECT_ID.iam.gserviceaccount.com
```

## 8. Configure Cloud SQL Proxy

```bash
# Create Cloud SQL Auth Proxy deployment
cat > cloudsql-proxy.yaml <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloud-sql-proxy
  namespace: timesheet
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cloud-sql-proxy
  template:
    metadata:
      labels:
        app: cloud-sql-proxy
    spec:
      serviceAccountName: timesheet-app
      containers:
      - name: cloud-sql-proxy
        image: gcr.io/cloudsql-docker/cloud-sql-proxy:1.33.2
        args:
          - "$SQL_CONNECTION_NAME"
          - "--port=5432"
        ports:
        - containerPort: 5432
---
apiVersion: v1
kind: Service
metadata:
  name: cloud-sql-proxy
  namespace: timesheet
spec:
  selector:
    app: cloud-sql-proxy
  ports:
  - port: 5432
    targetPort: 5432
EOF

kubectl apply -f cloudsql-proxy.yaml
```

## 9. Create Secrets

```bash
# Create secret for database password
kubectl create secret generic cloudsql-db-credentials \
  -n timesheet \
  --from-literal=password="<DB_PASSWORD>"

# Create secret for other configurations
kubectl create secret generic app-secrets \
  -n timesheet \
  --from-literal=jwt-secret="<JWT_SECRET>" \
  --from-literal=jwt-refresh-secret="<JWT_REFRESH_SECRET>" \
  --from-literal=smtp-password="<SMTP_PASSWORD>"
```

## 10. Deploy Applications

### Update Kubernetes Manifests

In `secrets-configmap.yaml`:
```yaml
data:
  DATABASE_URL: "postgresql://timesheet_admin:password@cloud-sql-proxy:5432/timesheet_db"
  REDIS_URL: "redis://:password@${REDIS_HOST}:${REDIS_PORT}"
```

In `backend-deployment.yaml`:
```yaml
image: us-central1-docker.pkg.dev/your-project/timesheet/timesheet-backend:latest
```

### Deploy to GKE
```bash
# Create namespace
kubectl apply -f deployment/kubernetes/namespace.yaml

# Create secrets and configmaps
kubectl apply -f deployment/kubernetes/secrets-configmap.yaml

# Deploy storage
kubectl apply -f deployment/kubernetes/ingress-storage.yaml

# Deploy backend
kubectl apply -f deployment/kubernetes/backend-deployment.yaml

# Deploy frontend
kubectl apply -f deployment/kubernetes/frontend-deployment.yaml

# Verify deployment
kubectl get deployments -n timesheet
kubectl get pods -n timesheet
```

## 11. Configure Ingress with Cloud Load Balancer

```bash
# Install NGINX Ingress Controller
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install nginx-ingress ingress-nginx/ingress-nginx \
  --namespace ingress-basic \
  --create-namespace \
  --set controller.service.type=LoadBalancer

# Get external IP
kubectl get service -n ingress-basic

# Update DNS with external IP
```

## 12. Configure SSL/TLS

### Using Google-Managed Certificates
```bash
cat > managed-cert.yaml <<EOF
apiVersion: compute.cnrm.cloud.google.com/v1beta1
kind: ComputeManagedCertificate
metadata:
  name: timesheet-cert
spec:
  domains:
  - timesheet.yourdomain.com
EOF

kubectl apply -f managed-cert.yaml
```

### Using Let's Encrypt with cert-manager
```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml

# Create ClusterIssuer
cat > letsencrypt-issuer.yaml <<EOF
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

kubectl apply -f letsencrypt-issuer.yaml
```

## 13. Setup Monitoring

### Enable GKE Monitoring
```bash
# Already enabled during cluster creation

# View monitoring in Cloud Console:
# https://console.cloud.google.com/monitoring/dashboards
```

### Create Custom Alerts
```bash
# Create alert policy
gcloud alpha monitoring policies create \
  --notification-channels=<CHANNEL_ID> \
  --display-name="High Error Rate" \
  --condition-display-name="Error rate > 5%" \
  --condition-expression='
    resource.type="k8s_container" AND
    metric.type="logging.googleapis.com/user/error_count" AND
    resource.labels.namespace_name="timesheet"'
```

## 14. Backup & Recovery

### Backup Cloud SQL
```bash
# Create backup
gcloud sql backups create \
  --instance timesheet-db-prod

# List backups
gcloud sql backups list --instance timesheet-db-prod

# Restore from backup
gcloud sql backups restore <BACKUP_ID> \
  --backup-instance timesheet-db-prod
```

### Backup Cloud Storage
```bash
# Cloud Storage is geo-redundant by default
# For additional backup, use Cloud Storage Transfer Service
gcloud transfer jobs create \
  --source-path gs://timesheet-uploads-prod \
  --destination-path gs://timesheet-uploads-backup \
  --display-name "Timesheet uploads backup"
```

## 15. Cost Optimization

```bash
# View cluster costs
gcloud container clusters describe timesheet-prod \
  --region $REGION \
  --format='table(resource.labels.cluster_name, autopilot)'

# Use Autopilot for simplified management and cost optimization
gcloud container autopilot clusters create timesheet-autopilot \
  --region $REGION
```

## Scaling & Maintenance

### Scale Cluster
```bash
# Update node pool size
gcloud container node-pools update default-pool \
  --cluster timesheet-prod \
  --num-nodes 5 \
  --region $REGION
```

### Update Application
```bash
# Trigger redeployment
kubectl rollout restart deployment/timesheet-backend -n timesheet

# Check status
kubectl rollout status deployment/timesheet-backend -n timesheet
```

### View Logs
```bash
# Application logs
kubectl logs -f deployment/timesheet-backend -n timesheet

# Cloud Logging
gcloud logging read "resource.type=k8s_container AND resource.labels.namespace_name=timesheet" \
  --limit 50 \
  --format json
```

