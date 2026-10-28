# InvoiceNinja v5.13.50 — Tasks, Projects & Time Tracking FRD

> **Sources:** `app/Models/Task.php`, `app/Models/Project.php`, `app/Models/TaskStatus.php`, `app/Http/Controllers/TaskController.php`, `app/Http/Controllers/ProjectController.php`, `app/Http/Controllers/TaskStatusController.php`, `app/Services/Task/TaskService.php`

## 1. System Overview & Boundaries

### Scope
- Project creation and management
- Time-tracking tasks with start/pause/stop
- Task status management (custom statuses)
- Task-to-invoice conversion (tracked hours billed to clients)
- Project metrics: progress, remaining hours, budgeted hours
- Task sorting and organization within projects

### Out-of-scope
- Project billing rates (rates live on client/project settings)
- Gantt charts / advanced scheduling (UI concern)

### Actors
| Actor | Role |
|---|---|
| **Authenticated User** | Creates/edits projects/tasks; starts/stops timers |
| **Client** | View tasks assigned to client (portal) |
| **System** | Generates invoice line items from completed tasks |

### Triggers
| Trigger | Type | Source |
|---|---|---|
| `POST /api/v1/projects` | User | Project creation |
| `POST /api/v1/tasks` | User | Task creation |
| `tasks/{task}/start|stop` | User | Timer control |
| `tasks/{task}/resume` | User | Resume timer |
| `tasks/sort` | User | Drag-drop reorder |
| Cron | Scheduled | Running task hour calculation |

---

## 2. Task Entity

### Key Fields
| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `user_id` | int | Creator |
| `assigned_user_id` | int\|null | Responsible user |
| `client_id` | int\|null | Billable client |
| `project_id` | int\|null | Parent project |
| `name` | string | Task name |
| `description` | string\|null | Description |
| `status_id` | int\|null | Task status |
| `rate` | float\|null | Hourly rate |
| `calculation` | float\|null | Calculated amount |
| `taxes` | object\|null | Tax configuration |
| `discount` | float\|null | Discounter |
| `is_amount_discount` | bool | Fixed vs percentage |
| `custom_value1/2/3/4` | float\|null | Custom numeric fields |
| `start_date` | datetime\|null | Task start |
| `end_date` | datetime\|null | Task deadline |
| `duration` | int\|null | Total seconds tracked |
| `is_completed` | bool | Completed flag |
| `is_deleted` | bool | Soft-delete |
| `time_log` | string (JSON) | Array of `{start, end, duration}` entries |
| `invited_user_ids` | array | Users invited to task |

### 2.1 Task Status Enum
> **Source:** `app/Models/TaskStatus.php`

| Value | Meaning |
|---|---|
| `STATUS_PENDING` | 1 (default — not started) |
| `STATUS_IN_PROGRESS` | 2 (timer running) |
| `STATUS_COMPLETED` | 0 (done) |
| **Custom** | 5+ user-defined statuses |

### 2.2 Task Lifecycle
| From | To | Trigger |
|---|---|---|
| Active | DELETED (soft) | `DELETE` endpoint |
| DELETED | Active | `PUT` with `is_deleted=false` |
| Any | Completed | `PUT` with `is_completed=true` |
| Completed | Active | `PUT` with `is_completed=false` |
| In Progress | Paused | Stop timer |

### 2.3 Time Tracking
The `time_log` field stores an array of entries:
```json
[
  {"start": 1700000000, "end": 1700003600, "duration": 3600},
  {"start": 1700007200, "end": null, "duration": 0}
]
```

**Timer control API:**
- `PUT /api/v1/tasks/{id}/start` — starts timer (sets last entry start, end=null)
- `PUT /api/v1/tasks/{id}/stop` — stops timer (sets end = now, computes duration)
- `PUT /api/v1/tasks/{id}/resume` — resumes last entry (if end is null, leave; else add new entry)
- `PUT /api/v1/tasks/{id}/set_duration` — manually set total duration

**Duration calculation:** Cron computes `duration` field by summing all time_log entries' durations.
```
TaskService::calculateDuration():
├─ Parse time_log JSON
├─ duration = 0
├─ For each entry:
│   ├─ IF end_time is null AND start_time exists:
│   │   └─ Add (now() - start_time) to duration
│   └─ IF both exist:
│       └─ Add (end_time - start_time) to duration
└─ Return total seconds
```

---

## 3. Project Entity

### Key Fields
| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `user_id` | int | Creator |
| `assigned_user_id` | int\|null | Project manager |
| `client_id` | int\|null | Associated client |
| `name` | string | Project name |
| `description` | string\|null | Description |
| `is_deleted` | bool | Soft-delete |
| `is_active` | bool | Active projects only |
| `is_shared` | bool | Shared with client portal |
| `budgeted_hours` | float\|null | Budget threshold |
| `custom_value1/2/3/4` | float\|null | Custom fields |

### 3.1 Project Metrics
| Metric | Calculation |
|---|---|
| Total Tasks | `Task::where('project_id', this.id)->where('is_deleted', false)->count()` |
| Completed Tasks | Same, filtered by `is_completed = true` |
| Tracked Hours | `SUM(tasks.duration)` |
| Remaining Hours | `SUM(tasks.duration)` where `is_completed = false` |
| Budget Utilization | `tracked_hours / budgeted_hours × 100` |
| Progress % | `(completed_tasks / total_tasks) × 100` |

### 3.2 Project Lifecycle
| From | To | Trigger |
|---|---|---|
| Active | DELETED (soft) | `DELETE` endpoint |
| DELETED | Active | `PUT` with `is_deleted=false` |
| Active | Inactive | `PUT` with `is_active=false` |
| Inactive | Active | `PUT` with `is_active=true` |

---

## 4. Task-to-Invoice Conversion

> **Source:** `app/Models/Task.php` (`invoiceId`, `service()`). When a task is converted to invoice line items:

```
TaskService::createInvoiceFromTasks(tasks):
1. Collect ALL tasks to be invoiced
2. For each task:
   a. Determine invoicing unit (per-hour, fixed, per-project)
   b. Calculate amount: rate × tracked_hours (or fixed calculation)
   c. Apply task-specific taxes from task->taxes
3. Generate InvoiceEntity with all task line items aggregated
4. Assign to task.client (or project.client)
5. Invoice created in DRAFT state
```

**Invoicing modes:**
- Per hour (default): `rate × (duration / 3600)`
- Per project: project budget / total project hours × task hours
- Fixed: per-task fixed amount

### 4.1 Line Item Generation from Tasks
| Source | Invoice Line Item Field |
|---|---|
| `task.name` | `notes` |
| `task.description` | (appended to notes) |
| `task.rate` | `cost` |
| `duration / 3600 × rate` | `cost` (total) |
| `task.taxes` | Tax name/rate fields |

---

## 5. Task Status Management

> **Source:** `app/Models/TaskStatus.php`, `app/Services/TaskStatusService.php`

### 5.1 Custom Statuses
- Companies can define custom task statuses beyond the 3 built-in (pending, in_progress, completed)
- Statuses have: `name`, `sort_order`, `color`, `is_completed` flag
- `is_completed = true` on a custom status means tasks marked with it are treated as completed

### 5.2 Status Transitions
| From → To | Allowed |
|---|---|
| Pending → In Progress | Yes |
| In Progress → Paused | Yes (stop timer) |
| Paused → In Progress | Yes (resume) |
| Any → Completed | Yes |
| Completed → Any | Yes (revert) |
| Any custom status → Any | Yes (unless `is_completed`) |

---

## 6. API Endpoints

| Endpoint | Verb | Description |
|---|---|---|
| `tasks` | GET/POST | List/create tasks |
| `tasks/{task}` | GET/PUT/DELETE | Manage task |
| `tasks/{task}/start` | PUT | Start timer |
| `tasks/{task}/stop` | PUT | Stop timer |
| `tasks/{task}/resume` | PUT | Resume timer |
| `tasks/{task}/set_duration` | PUT | Set duration manually |
| `tasks/bulk` | POST | Bulk actions |
| `tasks/sort` | POST | Sort/reorder tasks |
| `tasks/{task}/upload` | PUT | Upload task attachment |
| `projects` | GET/POST | List/create projects |
| `projects/{id}` | GET/PUT/DELETE | Manage project |
| `projects/bulk` | POST | Bulk project actions |
| `projects/{id}/upload` | PUT | Upload project file |
| `task_statuses` | GET/POST | Manage task statuses |
| `task_statuses/bulk` | POST | Bulk task status actions |

## Source Files
| File |
|---|
| `app/Models/Task.php` |
| `app/Models/Project.php` |
| `app/Models/TaskStatus.php` |
| `app/Services/Task/TaskService.php` |
| `app/Http/Controllers/TaskController.php` |
| `app/Http/Controllers/ProjectController.php` |
| `app/Http/Controllers/TaskStatusController.php` |
| `routes/api.php` |
