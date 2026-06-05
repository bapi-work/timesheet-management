# Testing & Verification Guide

## Pre-Production Testing

### Unit & Integration Tests

```bash
# Run backend tests
cd backend
npm install
npm test

# Run frontend tests
cd ../frontend
npm install
npm test
```

### API Endpoint Testing

Use Postman, Insomnia, or curl to test all API endpoints:

#### Authentication
```bash
# Register user
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword@123",
    "firstName": "Test",
    "lastName": "User"
  }'

# Login
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword@123"
  }'

# Health check
curl http://localhost:4000/api/health
```

#### Timesheet Operations
```bash
# Create timesheet
curl -X POST http://localhost:4000/api/timesheets \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "weekStart": "2024-01-01",
    "entries": [
      {
        "date": "2024-01-01",
        "hours": 8,
        "projectId": "proj-1",
        "description": "Development work"
      }
    ]
  }'

# Get timesheets
curl http://localhost:4000/api/timesheets \
  -H "Authorization: Bearer <TOKEN>"

# Submit timesheet for approval
curl -X PATCH http://localhost:4000/api/timesheets/<ID>/submit \
  -H "Authorization: Bearer <TOKEN>"
```

#### Approval Workflow
```bash
# Get pending approvals
curl http://localhost:4000/api/approvals/pending \
  -H "Authorization: Bearer <MANAGER_TOKEN>"

# Approve timesheet
curl -X PATCH http://localhost:4000/api/approvals/<ID>/approve \
  -H "Authorization: Bearer <MANAGER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"comments": "Approved"}'

# Reject timesheet
curl -X PATCH http://localhost:4000/api/approvals/<ID>/reject \
  -H "Authorization: Bearer <MANAGER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Incomplete entries"}'
```

### Load Testing

#### Using Apache Bench
```bash
# Test homepage
ab -n 1000 -c 100 http://localhost:3000/

# Test API endpoint
ab -n 1000 -c 50 http://localhost:4000/api/health
```

#### Using k6
```bash
# Install k6
# https://k6.io/docs/getting-started/installation/

# Create test script
cat > load-test.js <<'EOF'
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 50,
  duration: '5m',
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
  },
};

export default function () {
  const res = http.get('http://localhost:4000/api/health');
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}
EOF

# Run test
k6 run load-test.js
```

### Performance Testing

#### Database Query Performance
```bash
# Connect to database
psql postgresql://user:pass@localhost:5432/timesheet_db

# Check slow queries
SELECT query, calls, mean_exec_time, max_exec_time 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;

# Analyze query plan
EXPLAIN ANALYZE 
SELECT * FROM timesheets 
WHERE status = 'pending' 
ORDER BY created_at DESC;
```

#### Redis Performance
```bash
# Connect to Redis
redis-cli -p 6380 -a password

# Monitor commands
MONITOR

# Check memory usage
INFO memory

# Check keyspace
INFO keyspace
```

### Security Testing

#### OWASP Top 10 Validation

**1. SQL Injection**
```bash
# Test SQL injection protection
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com\" OR 1=1--",
    "password": "anything"
  }'
# Should reject or sanitize, not execute
```

**2. Cross-Site Scripting (XSS)**
```bash
# Test XSS protection
curl -X POST http://localhost:4000/api/users \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "<script>alert(\"XSS\")</script>",
    "email": "test@example.com"
  }'
# Should escape or reject script tags
```

**3. CSRF Protection**
- Verify CSRF tokens required for state-changing operations

**4. Broken Authentication**
```bash
# Test JWT validation
curl http://localhost:4000/api/users \
  -H "Authorization: Bearer invalid-token"
# Should reject

# Test token expiration
# Create token, wait for expiration, try to use
```

**5. Sensitive Data Exposure**
```bash
# Verify HTTPS enforcement
curl -i http://localhost:3001
# Should redirect to HTTPS or reject

# Check response headers
curl -i https://yourdomain.com
# Should include security headers
```

#### Security Headers Verification
```bash
# Check security headers
curl -i https://yourdomain.com

# Expected headers:
# Strict-Transport-Security: max-age=31536000; includeSubDomains
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
# X-XSS-Protection: 1; mode=block
# Content-Security-Policy: ...
```

### Email Functionality Testing

```bash
# Test email service health
curl -X POST http://localhost:4000/api/test/email \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "test@example.com",
    "template": "timesheet-approved",
    "data": {
      "name": "John Doe",
      "period": "Jan 1-7, 2024"
    }
  }'

# Check email logs
tail -f logs/combined.log | grep -i email
```

### Notification Testing

```bash
# Submit timesheet to trigger approval notification
curl -X PATCH http://localhost:4000/api/timesheets/<ID>/submit \
  -H "Authorization: Bearer <TOKEN>"

# Manager should receive notification

# Approve timesheet to trigger employee notification
curl -X PATCH http://localhost:4000/api/approvals/<ID>/approve \
  -H "Authorization: Bearer <MANAGER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"comments": "Looks good"}'

# Employee should receive approval notification

# Check notification logs
kubectl logs -f deployment/timesheet-backend -n timesheet | grep -i notification
```

### File Upload Testing

```bash
# Test file upload
curl -X POST http://localhost:4000/api/users/avatar \
  -H "Authorization: Bearer <TOKEN>" \
  -F "file=@/path/to/image.jpg"

# Verify file is stored and accessible
curl http://localhost:4000/uploads/avatars/<filename>
```

### WebSocket Testing

```bash
# Install wscat
npm install -g wscat

# Test WebSocket connection
wscat -c ws://localhost:4000

# Send test message (from browser console or wscat)
{
  "type": "notification",
  "data": {"message": "Test"}
}
```

## Production Verification Checklist

### Functionality Tests
- [ ] User login with valid credentials
- [ ] User login rejects invalid credentials
- [ ] Create timesheet
- [ ] Edit timesheet
- [ ] Submit timesheet for approval
- [ ] Approve/reject timesheet
- [ ] Request leave
- [ ] Approve/reject leave
- [ ] Generate timesheet report
- [ ] View analytics dashboard
- [ ] View payroll information
- [ ] Receive email notifications
- [ ] WebSocket real-time updates working

### Performance Tests
- [ ] API response time < 500ms (p95)
- [ ] Database queries < 200ms
- [ ] Page load time < 3 seconds
- [ ] Handle 500+ concurrent users
- [ ] Memory usage stable
- [ ] No memory leaks

### Security Tests
- [ ] HTTPS enforced
- [ ] SQL injection prevention verified
- [ ] XSS protection verified
- [ ] CSRF protection verified
- [ ] Authentication required for protected routes
- [ ] Authorization rules enforced
- [ ] Rate limiting working
- [ ] Secrets not exposed in logs

### Data Integrity
- [ ] Database backups working
- [ ] Data integrity constraints enforced
- [ ] Audit logging enabled
- [ ] No data loss on failover

### Monitoring & Alerting
- [ ] Application metrics collected
- [ ] Logs aggregated and searchable
- [ ] Error alerts configured
- [ ] Performance alerts configured

## Regression Testing

Before each deployment:

```bash
# Run automated test suite
npm test -- --coverage

# Check code quality
npm run lint
npm run type-check

# Build for production
npm run build

# Run security audit
npm audit
```

## Browser Compatibility Testing

Test on:
- [ ] Chrome (latest 2 versions)
- [ ] Firefox (latest 2 versions)
- [ ] Safari (latest 2 versions)
- [ ] Edge (latest 2 versions)
- [ ] Mobile browsers (iOS Safari, Chrome Android)

## Accessibility Testing

```bash
# Install axe DevTools browser extension
# https://www.deque.com/axe/devtools/

# Run automated accessibility checks
# Report any WCAG 2.1 Level AA violations
```

## Disaster Recovery Testing

Quarterly:

```bash
# Test database restore
# 1. Create backup
# 2. Restore to separate database
# 3. Verify data integrity
# 4. Test application with restored data

# Test application failover
# 1. Stop primary instance
# 2. Verify traffic switches to backup
# 3. Check no data loss
# 4. Restore primary
```

