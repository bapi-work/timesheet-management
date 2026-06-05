# Feature Verification & Testing Guide

## Application Features Overview

This guide verifies that all features of the Timesheet Management System are working correctly.

---

## Core Features

### 1. Authentication & Authorization ✓

#### Feature: User Login
**Test Steps:**
1. Navigate to login page: `http://localhost:3000/login`
2. Use default credentials:
   - Email: `admin@acme.com`
   - Password: `Admin@123`
3. Verify dashboard loads
4. Check JWT token in local storage

**Expected Result:** User logs in and JWT token is stored

#### Feature: Logout
**Test Steps:**
1. Click logout button
2. Verify redirected to login page
3. Verify local storage cleared

**Expected Result:** User is logged out and session cleared

#### Feature: Token Refresh
**Test Steps:**
1. Wait for token to expire (15 min)
2. Make API request
3. Verify automatic token refresh
4. Verify no interruption to user experience

**Expected Result:** Token silently refreshes without user action

#### Feature: MFA (2FA) Support
**Test Steps:**
1. Enable 2FA in user profile
2. Scan QR code with authenticator app
3. Log out
4. Log in again
5. Enter 6-digit code when prompted

**Expected Result:** 2FA successfully configured and working

#### Feature: Role-Based Access Control (RBAC)
**Test Steps:**
1. Log in as Employee
2. Verify can only access own timesheets
3. Log in as Manager
4. Verify can access team timesheets
5. Log in as Admin
6. Verify can access all timesheets

**Expected Result:** Users can only access resources based on their role

---

### 2. Timesheet Management ✓

#### Feature: Create Timesheet
**Test Steps:**
1. Navigate to Timesheets
2. Click "New Timesheet"
3. Select week/date range
4. Add entries:
   - Date
   - Hours (8)
   - Project
   - Description
5. Click "Save"

**Expected Result:** Timesheet created with status "Draft"

**Verify API:**
```bash
curl -X POST http://localhost:4000/api/timesheets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "weekStart": "2024-01-01",
    "entries": [{
      "date": "2024-01-01",
      "hours": 8,
      "projectId": "proj-1",
      "description": "Development"
    }]
  }'
```

#### Feature: Edit Timesheet
**Test Steps:**
1. Open draft timesheet
2. Edit hours or entries
3. Click "Update"
4. Verify changes saved

**Expected Result:** Timesheet updated successfully

#### Feature: Copy from Previous Week
**Test Steps:**
1. Open new timesheet
2. Click "Copy from Previous Week"
3. Verify entries populated
4. Adjust as needed
5. Save

**Expected Result:** Previous week's timesheet copied to new week

#### Feature: Submit for Approval
**Test Steps:**
1. Open draft timesheet
2. Click "Submit"
3. Verify status changes to "Pending Approval"
4. Verify cannot edit after submission

**Expected Result:** Timesheet submitted and locked

#### Feature: Lock Timesheet
**Test Steps:**
1. As manager, approve timesheet
2. Verify status changes to "Approved"
3. Verify employee cannot edit
4. Verify shows as locked in timesheet list

**Expected Result:** Approved timesheet is locked

---

### 3. Approval Workflow ✓

#### Feature: Manager Approves Timesheet
**Test Steps:**
1. Log in as manager
2. Navigate to "Approvals" → "Pending"
3. Review timesheet
4. Click "Approve"
5. Add optional comment
6. Submit

**Expected Result:** 
- Timesheet status changes to "Approved"
- Employee receives approval notification email

**Verify API:**
```bash
curl -X PATCH http://localhost:4000/api/approvals/<ID>/approve \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"comments": "Looks good"}'
```

#### Feature: Manager Rejects Timesheet
**Test Steps:**
1. Log in as manager
2. Navigate to "Approvals" → "Pending"
3. Review timesheet
4. Click "Reject"
5. Enter rejection reason
6. Submit

**Expected Result:**
- Timesheet status changes to "Rejected"
- Employee receives rejection email with reason
- Employee can edit and resubmit

#### Feature: Bulk Approve
**Test Steps:**
1. Log in as manager
2. Navigate to "Approvals"
3. Select multiple timesheets
4. Click "Bulk Approve"
5. Confirm

**Expected Result:** All selected timesheets approved at once

---

### 4. Leave Management ✓

#### Feature: Request Leave
**Test Steps:**
1. Navigate to Leave → "Request Leave"
2. Select leave type (Annual, Sick, Maternity, etc.)
3. Select date range
4. Add reason (optional)
5. Submit

**Expected Result:** Leave request created with "Pending" status

#### Feature: View Leave Balance
**Test Steps:**
1. Navigate to Leave
2. View "Available Balance" section
3. Verify balance decrements when leave approved

**Expected Result:** Leave balances shown accurately

#### Feature: Approve/Reject Leave
**Test Steps:**
1. Log in as HR/Manager
2. Navigate to Leave → "Pending Requests"
3. Review request
4. Click "Approve" or "Reject"
5. Add comment if rejecting

**Expected Result:**
- Leave request status updated
- Employee receives notification email

---

### 5. Attendance Tracking ✓

#### Feature: Clock In/Out
**Test Steps:**
1. Navigate to Attendance
2. Click "Clock In"
3. Verify clock shows current time
4. Click "Clock Out"
5. Verify shift duration calculated

**Expected Result:** Clock in/out recorded with automatic duration

#### Feature: View Attendance History
**Test Steps:**
1. Navigate to Attendance → "History"
2. Select date range
3. Verify all clock in/out records shown
4. Verify work hours calculated

**Expected Result:** Attendance history displayed correctly

#### Feature: Daily Work Hours Summary
**Test Steps:**
1. Clock in at 9:00 AM
2. Clock out at 5:00 PM
3. Verify 8 hours recorded
4. Check attendance dashboard shows 8h

**Expected Result:** Daily hours calculated correctly

---

### 6. Project Management ✓

#### Feature: Create Project
**Test Steps:**
1. Navigate to Projects
2. Click "New Project"
3. Enter:
   - Project name
   - Client
   - Budget
   - Start/end date
4. Add team members
5. Save

**Expected Result:** Project created with status "Active"

**Verify API:**
```bash
curl -X POST http://localhost:4000/api/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Project Name",
    "clientId": "client-1",
    "budget": 50000
  }'
```

#### Feature: Allocate Resources
**Test Steps:**
1. Open project
2. Click "Add Team Member"
3. Select employee
4. Set allocation % and role
5. Save

**Expected Result:** Employee allocated to project

#### Feature: View Project Budget
**Test Steps:**
1. Open project
2. View "Budget Status"
3. Verify actual hours vs budgeted
4. Verify cost calculation

**Expected Result:** Budget tracking accurate

---

### 7. Reports & Analytics ✓

#### Feature: Generate Utilization Report
**Test Steps:**
1. Navigate to Reports → "Utilization"
2. Select date range and department
3. Click "Generate"
4. Verify report shows:
   - Employee names
   - Total hours
   - Utilization percentage
   - Billable hours

**Expected Result:** Utilization report generated correctly

**Verify API:**
```bash
curl "http://localhost:4000/api/reports/utilization?startDate=2024-01-01&endDate=2024-01-31" \
  -H "Authorization: Bearer $TOKEN"
```

#### Feature: Project Effort Report
**Test Steps:**
1. Navigate to Reports → "Project Effort"
2. Select project and date range
3. Click "Generate"
4. Verify shows:
   - Employee effort hours per project
   - Cost breakdown
   - Timeline

**Expected Result:** Project effort report generated

#### Feature: Overtime Analysis
**Test Steps:**
1. Navigate to Reports → "Overtime"
2. Select date range
3. Generate report
4. Verify identifies employees with:
   - Hours > 40/week
   - Hours > standard shift

**Expected Result:** Overtime correctly identified

#### Feature: Missing Timesheet Report
**Test Steps:**
1. Navigate to Reports → "Missing Timesheets"
2. Select date range
3. Generate report
4. Verify lists employees with incomplete timesheets

**Expected Result:** Missing timesheets identified

#### Feature: Export Report to Excel
**Test Steps:**
1. Generate any report
2. Click "Export to Excel"
3. Verify file downloads
4. Open in Excel
5. Verify formatting and data

**Expected Result:** Report exports to Excel correctly

#### Feature: Export Report to PDF
**Test Steps:**
1. Generate any report
2. Click "Export to PDF"
3. Verify file downloads
4. Open in PDF reader
5. Verify formatting

**Expected Result:** Report exports to PDF correctly

#### Feature: Analytics Dashboard
**Test Steps:**
1. Log in as manager or admin
2. Navigate to Analytics
3. Verify displays:
   - Total hours tracked
   - Employee utilization trends
   - Project status
   - Overtime hours
   - Key metrics

**Expected Result:** Dashboard displays all key metrics

---

### 8. Payroll Processing ✓

#### Feature: Create Payroll Period
**Test Steps:**
1. Navigate to Payroll → "Periods"
2. Click "New Period"
3. Enter:
   - Period name
   - Start date
   - End date
4. Save

**Expected Result:** Payroll period created

#### Feature: Lock Timesheets for Payroll
**Test Steps:**
1. Navigate to Payroll → "Periods"
2. Select period
3. Click "Lock for Payroll"
4. Verify all timesheets in period locked
5. Verify employees cannot edit

**Expected Result:** Timesheets locked and unavailable for editing

#### Feature: Process Payroll
**Test Steps:**
1. Navigate to Payroll → "Process"
2. Select payroll period
3. Review summary of hours and costs
4. Click "Process Payroll"
5. Verify status changes to "Processed"

**Expected Result:** Payroll processed successfully

#### Feature: Export Payroll to Excel
**Test Steps:**
1. Navigate to Payroll → "Processed"
2. Select payroll
3. Click "Export"
4. Verify Excel file downloads
5. Verify includes:
   - Employee names
   - Hours
   - Rate
   - Total pay

**Expected Result:** Payroll exported to Excel for accounting system

---

### 9. Notifications ✓

#### Feature: Real-time Notifications
**Test Steps:**
1. Log in as manager
2. Have employee submit timesheet in another window
3. Verify manager receives real-time notification without refresh
4. Click notification to view timesheet

**Expected Result:** Notification appears instantly (WebSocket working)

#### Feature: Email Notifications
**Test Steps:**
1. Submit timesheet as employee
2. Check email inbox
3. Verify submission confirmation email received
4. Have manager approve
5. Check email for approval notification

**Expected Result:** Emails received for key events

#### Feature: In-App Notifications
**Test Steps:**
1. Navigate to Notifications → "Inbox"
2. Verify all notifications listed
3. Mark as read
4. Filter by type
5. Verify count matches

**Expected Result:** In-app notification system working

#### Feature: Notification Preferences
**Test Steps:**
1. Navigate to Profile → "Notifications"
2. Configure which notifications to receive
3. Toggle email notifications on/off
4. Trigger notification event
5. Verify settings respected

**Expected Result:** Notification preferences applied

---

### 10. Employee Management ✓

#### Feature: Create Employee
**Test Steps:**
1. Navigate to Admin → "Employees"
2. Click "Add Employee"
3. Enter:
   - Name
   - Email
   - Department
   - Role
   - Manager
4. Save

**Expected Result:** Employee created and welcome email sent

**Verify API:**
```bash
curl -X POST http://localhost:4000/api/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "employee@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "departmentId": "dept-1",
    "role": "EMPLOYEE"
  }'
```

#### Feature: Edit Employee
**Test Steps:**
1. Open employee profile
2. Edit details:
   - Department
   - Role
   - Manager
   - Avatar
3. Save

**Expected Result:** Employee details updated

#### Feature: Bulk Import Employees
**Test Steps:**
1. Navigate to Admin → "Import"
2. Download template Excel file
3. Fill with employee data
4. Upload file
5. Verify employees created

**Expected Result:** Multiple employees imported in bulk

#### Feature: Bulk Export Employees
**Test Steps:**
1. Navigate to Admin → "Employees"
2. Click "Export"
3. Verify Excel file downloads
4. Open and verify all employee data

**Expected Result:** Employee list exported to Excel

#### Feature: Deactivate/Reactivate Employee
**Test Steps:**
1. Open employee profile
2. Click "Deactivate"
3. Verify employee cannot log in
4. Click "Reactivate"
5. Verify employee can log in again

**Expected Result:** Employee status toggles between active/inactive

---

### 11. Admin Features ✓

#### Feature: Organization Settings
**Test Steps:**
1. Navigate to Admin → "Settings"
2. Update:
   - Organization name
   - Logo
   - Primary colors
   - Footer text
3. Save
4. Verify changes on login page

**Expected Result:** Organization settings updated and visible

#### Feature: Holiday Calendar
**Test Steps:**
1. Navigate to Admin → "Holidays"
2. Add holiday:
   - Name
   - Date
   - Type (National, Company, etc.)
3. Save
4. Verify displays on calendar
5. Verify excluded from utilization reports

**Expected Result:** Holiday added to calendar and factored in calculations

#### Feature: Audit Logs
**Test Steps:**
1. Navigate to Admin → "Audit Logs"
2. View all system actions:
   - User login/logout
   - Timesheet submissions
   - Approvals
   - Data changes
3. Filter by user/action
4. Export logs

**Expected Result:** All actions logged and searchable

#### Feature: RBAC Management
**Test Steps:**
1. Navigate to Admin → "Roles"
2. View role permissions:
   - EMPLOYEE
   - TEAM_LEAD
   - PROJECT_MANAGER
   - DEPARTMENT_MANAGER
   - HR_ADMIN
   - PAYROLL_ADMIN
   - SYSTEM_ADMIN
   - EXECUTIVE
3. Verify permissions appropriate

**Expected Result:** All 8 roles with correct permissions

---

### 12. User Profile & Settings ✓

#### Feature: Update Profile
**Test Steps:**
1. Click profile icon → "My Profile"
2. Update:
   - Name
   - Email
   - Phone
   - Avatar (upload image)
3. Save
4. Verify changes reflected

**Expected Result:** Profile updated successfully

#### Feature: Change Password
**Test Steps:**
1. Navigate to Profile → "Security"
2. Click "Change Password"
3. Enter old password
4. Enter new password twice
5. Save
6. Verify can log in with new password

**Expected Result:** Password changed successfully

#### Feature: Upload Avatar
**Test Steps:**
1. Navigate to Profile
2. Click avatar
3. Select image file
4. Verify preview
5. Upload
6. Verify avatar displays in app

**Expected Result:** Avatar uploaded and displayed

---

## Email & Notifications Verification

### SMTP Configuration Check

**Test Email Sending:**
```bash
# Check email service is configured
curl -X POST http://localhost:4000/api/test/email \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "test@example.com",
    "template": "timesheet-approved",
    "data": {
      "name": "John Doe",
      "period": "Week of Jan 1-7, 2024"
    }
  }'

# Check logs for email delivery
grep -i "email sent" logs/combined.log
```

**Test Email Templates:**
1. ✅ Timesheet Approved
2. ✅ Timesheet Rejected
3. ✅ Approval Pending
4. ✅ Leave Request Status
5. ✅ Weekly Reminders

---

## Performance & Scalability Tests

### API Response Time
```bash
# Test response times
ab -n 100 -c 10 http://localhost:4000/api/health

# Expected: < 500ms p95
```

### Database Query Performance
```bash
# Check slow queries
docker exec timesheet-postgres psql -U timesheet -d timesheet_db -c \
  "SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"
```

### Load Test
```bash
# Test with 100 concurrent users
# Using k6 (see TESTING_GUIDE.md)
k6 run load-test.js
```

---

## Security Verification

### SSL/TLS Certificate
```bash
# Check certificate validity
curl -I https://yourdomain.com

# Verify strong ciphers
openssl s_client -connect yourdomain.com:443
```

### Security Headers
```bash
curl -I https://yourdomain.com
# Should include:
# - Strict-Transport-Security
# - X-Content-Type-Options
# - X-Frame-Options
# - Content-Security-Policy
```

### Rate Limiting
```bash
# Test rate limiting (should reject after 500 requests in 15 min)
for i in {1..600}; do
  curl http://localhost:4000/api/health
done

# Should get 429 (Too Many Requests) after limit
```

---

## Feature Completion Checklist

- [ ] Authentication & Authorization
  - [ ] User login
  - [ ] User logout
  - [ ] Token refresh
  - [ ] MFA (2FA)
  - [ ] RBAC working

- [ ] Timesheet Management
  - [ ] Create timesheet
  - [ ] Edit timesheet
  - [ ] Copy from previous
  - [ ] Submit for approval
  - [ ] Lock after approval

- [ ] Approval Workflow
  - [ ] Manager can view pending
  - [ ] Manager can approve
  - [ ] Manager can reject
  - [ ] Bulk approve
  - [ ] Email notifications sent

- [ ] Leave Management
  - [ ] Request leave
  - [ ] View balance
  - [ ] Approve/reject leave
  - [ ] Email notifications

- [ ] Attendance
  - [ ] Clock in/out
  - [ ] View history
  - [ ] Hours calculated

- [ ] Projects
  - [ ] Create project
  - [ ] Allocate resources
  - [ ] View budget

- [ ] Reports
  - [ ] Utilization report
  - [ ] Project effort report
  - [ ] Overtime analysis
  - [ ] Missing timesheet report
  - [ ] Export to Excel
  - [ ] Export to PDF

- [ ] Analytics
  - [ ] Dashboard displays
  - [ ] Charts load
  - [ ] Metrics accurate

- [ ] Payroll
  - [ ] Create period
  - [ ] Lock timesheets
  - [ ] Process payroll
  - [ ] Export for accounting

- [ ] Notifications
  - [ ] Real-time updates
  - [ ] Email notifications sent
  - [ ] In-app notifications
  - [ ] Preferences respected

- [ ] User Management
  - [ ] Create employee
  - [ ] Edit employee
  - [ ] Bulk import
  - [ ] Deactivate/reactivate

- [ ] Admin
  - [ ] Organization settings
  - [ ] Holiday calendar
  - [ ] Audit logs
  - [ ] RBAC

- [ ] User Profile
  - [ ] Update profile
  - [ ] Change password
  - [ ] Upload avatar

---

## Sign-Off

**Verification Completed By:** _____________________

**Date:** _____________________

**Notes:** _____________________

