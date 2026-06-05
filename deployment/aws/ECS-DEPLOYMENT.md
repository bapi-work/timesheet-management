# AWS ECS Deployment Configuration

This is an example ECS task definition for deploying the Timesheet Management System on AWS.

## Prerequisites

1. AWS ECR repositories created:
   ```bash
   aws ecr create-repository --repository-name timesheet-backend
   aws ecr create-repository --repository-name timesheet-frontend
   ```

2. Images pushed to ECR:
   ```bash
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com
   docker tag timesheet-backend:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/timesheet-backend:latest
   docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/timesheet-backend:latest
   ```

3. RDS PostgreSQL instance created
4. ElastiCache Redis cluster created
5. S3 bucket for uploads created

## ECS Task Definition

Save as `ecs-task-definition.json`:

```json
{
  "family": "timesheet-backend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::ACCOUNT_ID:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT_ID:role/ecsTaskRole",
  "containerDefinitions": [
    {
      "name": "timesheet-backend",
      "image": "ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/timesheet-backend:latest",
      "portMappings": [
        {
          "containerPort": 4000,
          "hostPort": 4000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "PORT",
          "value": "4000"
        },
        {
          "name": "FRONTEND_URL",
          "value": "https://timesheet.yourdomain.com"
        },
        {
          "name": "VITE_API_URL",
          "value": "https://timesheet.yourdomain.com/api"
        },
        {
          "name": "VITE_WS_URL",
          "value": "wss://timesheet.yourdomain.com"
        },
        {
          "name": "SMTP_HOST",
          "value": "email-smtp.us-east-1.amazonaws.com"
        },
        {
          "name": "SMTP_PORT",
          "value": "587"
        },
        {
          "name": "SMTP_USER",
          "value": "your-ses-smtp-user"
        },
        {
          "name": "SMTP_FROM",
          "value": "noreply@timesheet.yourdomain.com"
        },
        {
          "name": "AWS_REGION",
          "value": "us-east-1"
        }
      ],
      "secrets": [
        {
          "name": "JWT_SECRET",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:timesheet/jwt-secret"
        },
        {
          "name": "JWT_REFRESH_SECRET",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:timesheet/jwt-refresh-secret"
        },
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:timesheet/database-url"
        },
        {
          "name": "REDIS_URL",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:timesheet/redis-url"
        },
        {
          "name": "SMTP_PASS",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:timesheet/smtp-password"
        }
      ],
      "mountPoints": [
        {
          "sourceVolume": "uploads",
          "containerPath": "/app/uploads",
          "readOnly": false
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/timesheet-backend",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": [
          "CMD-SHELL",
          "curl -f http://localhost:4000/api/health || exit 1"
        ],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ],
  "volumes": [
    {
      "name": "uploads",
      "efsVolumeConfiguration": {
        "fileSystemId": "fs-12345678",
        "transitEncryption": "ENABLED",
        "authorizationConfig": {
          "accessPointId": "fsap-12345678"
        }
      }
    }
  ]
}
```

## Deployment Commands

### Register Task Definition
```bash
aws ecs register-task-definition --cli-input-json file://ecs-task-definition.json
```

### Create ECS Service
```bash
aws ecs create-service \
  --cluster timesheet-prod \
  --service-name timesheet-backend \
  --task-definition timesheet-backend:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --load-balancers targetGroupArn=arn:aws:elasticloadbalancing:us-east-1:ACCOUNT_ID:targetgroup/timesheet/abcdef,containerName=timesheet-backend,containerPort=4000 \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-12345,subnet-67890],securityGroups=[sg-12345],assignPublicIp=DISABLED}" \
  --platform-version LATEST \
  --enable-ecs-managed-tags
```

### Update Service
```bash
aws ecs update-service \
  --cluster timesheet-prod \
  --service timesheet-backend \
  --task-definition timesheet-backend:2 \
  --force-new-deployment
```

### Scale Service
```bash
aws ecs update-service \
  --cluster timesheet-prod \
  --service timesheet-backend \
  --desired-count 4
```

### View Logs
```bash
aws logs tail /ecs/timesheet-backend --follow
```

## Auto Scaling Configuration

```bash
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/timesheet-prod/timesheet-backend \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10 \
  --region us-east-1

aws application-autoscaling put-scaling-policy \
  --policy-name cpu-scaling \
  --service-namespace ecs \
  --resource-id service/timesheet-prod/timesheet-backend \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration file://scaling-policy.json
```

## Secrets Manager Configuration

```bash
# Store secrets in AWS Secrets Manager
aws secretsmanager create-secret \
  --name timesheet/jwt-secret \
  --secret-string "your-jwt-secret-value"

aws secretsmanager create-secret \
  --name timesheet/database-url \
  --secret-string "postgresql://user:password@db.xxx.rds.amazonaws.com:5432/timesheet_db"

aws secretsmanager create-secret \
  --name timesheet/redis-url \
  --secret-string "redis://:password@timesheet-redis.xxx.cache.amazonaws.com:6379"
```

## CloudWatch Monitoring

### Create Log Group
```bash
aws logs create-log-group --log-group-name /ecs/timesheet-backend
aws logs put-retention-policy --log-group-name /ecs/timesheet-backend --retention-in-days 30
```

### Create Alarms
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name timesheet-backend-cpu \
  --alarm-description "Alert when CPU exceeds 70%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 70 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:timesheet-alerts
```

## Load Balancer Configuration

### Create Target Group
```bash
aws elbv2 create-target-group \
  --name timesheet-backend \
  --protocol HTTP \
  --port 4000 \
  --vpc-id vpc-12345 \
  --health-check-protocol HTTP \
  --health-check-path /api/health \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3
```

## Cost Optimization Tips

1. Use Fargate Spot for non-critical workloads (70% savings)
2. Configure autoscaling to scale down during off-peak hours
3. Use Reserved Capacity for predictable workloads
4. Monitor CloudWatch metrics for cost anomalies
5. Use S3 Intelligent-Tiering for uploads

