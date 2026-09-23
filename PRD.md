# Claude Code Activity Monitor — V1 PRD

## 1. Product Overview

Build an internal Claude Code Activity Monitoring System for 6AM Technologies.

The system will monitor Claude Code activity from developers' local machines and provide a centralized dashboard for engineering management.

V1 must support:

* macOS
* Windows
* Linux

The system consists of three major components:

1. Cross-platform Desktop Agent
2. Laravel Backend + MySQL
3. Vue + Inertia Dashboard

High-level architecture:

Developer Device
→ Claude Code
→ Desktop Agent
→ HTTPS
→ Laravel API
→ MySQL
→ Vue + Inertia Dashboard

## 2. V1 Platform Support

V1 must support all three major desktop operating systems:

* macOS
* Windows
* Linux

The Agent must use a shared cross-platform core with operating-system-specific adapters.

Architecture:

Desktop Agent
├── Shared Core
│   ├── Claude Data Reader
│   ├── Session Detection
│   ├── Token Extraction
│   ├── Project Detection
│   ├── Model Detection
│   ├── Settings Manager
│   ├── Authentication
│   ├── Sync Manager
│   └── Local Sync State
│
└── Platform Adapters
├── macOS
├── Windows
└── Linux

The backend and dashboard must remain platform-neutral.

Adding support for another operating system later should not require redesigning the core backend data model or synchronization protocol.

## 3. Technology Stack

### Backend

* Laravel
* MySQL

### Frontend

* Vue
* Inertia

### Desktop Agent

* Node.js
* TypeScript
* SQLite for minimal local synchronization state
* HTTPS/REST
* OS-specific background service/startup mechanism

The Agent must be packaged with its required runtime.

Developers must NOT be required to manually install:

* Node.js
* npm
* SQLite
* Development dependencies

## 4. Core Product Goal

The Head of Engineering/Admin should have a centralized view of Claude Code usage across all monitored developers and devices.

The system should provide:

* Developer activity
* Device activity
* Claude account usage
* Projects
* Sessions
* Models
* Token usage
* Session duration
* Usage trends
* Optional prompts
* Agent health
* Synchronization status

The system should allow management to understand:

* Who is using Claude Code
* Which devices are being used
* Which projects are being worked on
* Which models are being used
* How many sessions are created
* How many tokens are being consumed
* How usage changes over time
* Whether Agents are actively synchronizing

## 5. Zero Ongoing User Dependency

This is a core V1 requirement.

After initial installation and device pairing, normal monitoring must require no ongoing developer interaction.

The Agent must automatically:

* Start in the background
* Detect Claude Code
* Detect local Claude data
* Apply centrally managed tracking settings
* Detect new sessions
* Detect updated sessions
* Collect configured activity
* Synchronize automatically
* Recover from temporary network failures
* Resume synchronization when connectivity returns
* Maintain synchronization state
* Send incremental updates
* Continue operating after system restart

Developers must NOT be required to:

* Manually start the Agent
* Manually trigger synchronization
* Configure tracking settings
* Install Node.js
* Install npm
* Install SQLite
* Configure `.env`
* Configure API credentials
* Enter backend URLs
* Manage sync cursors
* Manage synchronization state
* Select tracking options

Manual actions such as:

* Sync Now
* View connection status
* Re-pair device
* View Agent diagnostics

may exist, but they must be optional.

They must never be required for normal monitoring.

Initial installation and first-time login/pairing are the only expected developer interactions.

## 6. Cross-Platform Agent Architecture

The Agent must be designed as one product rather than three independent Agents.

The shared core should contain:

* Claude data scanning
* Session detection
* Usage extraction
* Project detection
* Model detection
* Tracking settings
* Authentication
* Payload generation
* Synchronization
* Retry logic
* Local sync state

Platform adapters should handle:

* Claude data path discovery
* OS-specific permissions
* Background execution
* Installation
* Secure credential storage where required
* OS/device information
* Process detection where required

The backend must receive normalized data regardless of operating system.

## 7. Platform-Specific Background Execution

Each operating system should use its native background mechanism.

### macOS

Use:

* macOS LaunchAgent or equivalent supported mechanism

### Windows

Use:

* Windows background service/startup mechanism

### Linux

Use:

* systemd user service or equivalent supported mechanism

The shared Agent Core must not directly depend on any one operating system's background execution system.

## 8. Installation Experience

Each operating system will have its own installer/package.

Examples:

* macOS → `.pkg` or equivalent
* Windows → Windows installer/package
* Linux → appropriate supported package/installer

The user experience should remain consistent:

Download Installer
→ Install
→ Login/Pair Device
→ Agent Detects OS
→ Agent Detects Claude Code
→ Agent Detects Claude Data
→ Initial Sync
→ Background Monitoring
→ Done

The installer must bundle the required runtime.

Developers should not need to configure development tools manually.

## 9. First-Time Device Pairing

The first launch should provide a controlled company authentication/pairing flow.

After successful pairing:

Backend:

* Identifies developer
* Registers device
* Creates unique device identity
* Issues Agent authentication credentials
* Returns tracking configuration

Agent:

* Stores required credentials securely
* Detects Claude Code
* Detects Claude local data
* Performs initial synchronization
* Starts background monitoring

## 10. Developer Identity

Each developer must have one central monitoring identity.

Developer information may include:

* Name
* Company email
* Team/department
* Status

A developer may have:

* Multiple devices
* Multiple Claude accounts
* Multiple networks

These must not create multiple developer identities.

Example:

Developer
├── MacBook
├── Windows PC
└── Linux workstation

All devices remain associated with the same developer.

## 11. Device Management

Each physical/virtual machine running the Agent must have a unique device identity.

Device information:

* Device ID
* Developer
* Hostname
* Operating system
* OS version
* CPU architecture
* Agent version
* Claude Code version
* First registered time
* Last seen time
* Last successful sync
* Device status

Possible statuses:

* Active
* Offline
* Disabled
* Uninstalled

Historical activity must remain available when a device is disabled or uninstalled.

## 12. Platform Identification

Every device must report its platform.

Example:

{
"device_id": "device_xxx",
"platform": "macos",
"platform_version": "26.x",
"architecture": "arm64",
"agent_version": "1.0.0"
}

Other devices may report:

{
"platform": "windows"
}

or:

{
"platform": "linux"
}

The backend must not require a separate schema for each operating system.

## 13. Claude Data Discovery

The Agent must automatically detect Claude Code's local data.

The data location must be platform-aware.

The Agent should:

1. Detect operating system
2. Detect Claude Code installation
3. Locate Claude Code data
4. Validate the data source
5. Start monitoring

The exact paths and file structures must be verified during implementation.

Do not assume undocumented Claude Code internals.

If automatic discovery fails during initial setup, a manual folder-selection fallback may be provided.

Normal operation should not require manual configuration.

## 14. Technical Feasibility Requirement

Before implementing the complete Agent, inspect actual Claude Code data on:

* macOS
* Windows
* Linux

Verify:

* Session structure
* Stable session identifiers
* Token fields
* Project information
* Model information
* Account information where available
* Timestamps
* Session updates
* Message/prompt availability
* How completed and active sessions are represented

The system must be based on verified available data rather than assumptions.

If a field is not reliably available on one platform, the data model should allow it to be nullable rather than creating platform-specific hacks.

## 15. Claude Account Tracking

Where reliably available, track the Claude account associated with activity.

Store:

* Account identifier/email
* Developer
* Device
* First seen
* Last seen
* Status

A developer can use multiple Claude accounts.

Account identity must remain separate from developer and device identity.

## 16. Session Tracking

Each Claude Code session should be tracked.

A session may contain:

* Source session ID
* Developer
* Device
* Claude account
* Project
* Model
* Start time
* Last activity time
* End time where reliably available
* Duration
* Message/activity count
* Token usage
* Session status

The Agent must detect:

1. New sessions
2. Updated sessions

The Agent must not only scan for newly created sessions.

## 17. Project Tracking

Track projects associated with Claude Code sessions.

Project information may include:

* Project identifier
* Project name
* Project path
* Developer
* First activity
* Last activity
* Session count
* Token usage

The same project can be used by multiple developers.

## 18. Model Tracking

Track the Claude model used by each session/activity where available.

The system must not hard-code a fixed model list.

Model values should be stored dynamically so new models can be supported without schema changes.

## 19. Token Usage — Mandatory V1

Token usage is mandatory in V1.

The Agent must collect raw usage information available from Claude Code.

At minimum:

* Input tokens
* Output tokens
* Cache creation tokens
* Cache read tokens

Raw values must be preserved.

## 20. Actual Consumed Token Calculation

V1 must provide a separate monitoring calculation for actual consumed tokens.

### Total Token Activity

Input Tokens

* Output Tokens
* Cache Creation Tokens
* Cache Read Tokens

### Actual Consumed Tokens

Input Tokens

* Output Tokens
* Cache Creation Tokens

Cache Read Tokens are excluded from Actual Consumed Tokens.

Example:

Input = 100,000

Output = 20,000

Cache Creation = 30,000

Cache Read = 500,000

Total Token Activity = 650,000

Actual Consumed Tokens = 150,000

Cache Read Tokens = 500,000

"Actual Consumed Tokens" is the system's V1 monitoring calculation.

It must not automatically be represented as an exact Anthropic billing/subscription quota value unless the source data explicitly establishes that equivalence.

## 21. Token Storage

The backend should store:

* input_tokens
* output_tokens
* cache_creation_tokens
* cache_read_tokens
* actual_consumed_tokens
* total_token_activity

The backend is responsible for authoritative calculation.

This allows calculation logic to change centrally without requiring every Agent to update.

## 22. Token Aggregation

Token analytics must be available by:

* Developer
* Device
* Claude account
* Project
* Session
* Model
* Day
* Week
* Month
* Year
* Custom date range

Metrics:

* Total Token Activity
* Actual Consumed Tokens
* Input Tokens
* Output Tokens
* Cache Creation Tokens
* Cache Read Tokens

## 23. Central Tracking Settings

The backend must provide a centralized Settings section controlling what the Agent collects.

V1 tracking categories:

* Session
* Usage/token
* Project
* Model
* Device
* Account
* Prompt/message
* Git
* Network

Recommended defaults:

* Session: ON
* Usage: ON
* Project: ON
* Model: ON
* Device: ON
* Account: ON
* Prompt: OFF
* Git: OFF
* Network: OFF

The administrator can change these settings centrally.

Developers must not be able to override them locally.

## 24. Prompt Tracking

Prompt/message tracking is optional.

Default:

OFF

When disabled:

* Raw prompts are not collected
* Raw prompts are not transmitted
* Raw prompt content is not stored

When enabled:

* Collect only where reliably available
* Associate with the appropriate session
* Restrict access
* Audit access

Prompt data must be treated as sensitive internal information.

## 25. Git Tracking

Git tracking is optional.

If enabled, the system may collect information such as:

* Repository/project association
* Branch
* Commit information

Only reliably available information should be collected.

Git tracking should be OFF by default.

## 26. Network Tracking

Network tracking is optional.

Network identity must never be used as the primary developer/device identity.

For example, switching between:

* Starlink
* Office WiFi
* Home WiFi
* Other networks

must not create a new device or developer.

Network data should only be collected when enabled.

## 27. Offline Synchronization

No external queue infrastructure is required.

Do NOT introduce:

* Redis queues
* RabbitMQ
* Kafka
* SQS
* Other message queue systems

Offline synchronization should use:

* Claude's local data
* Agent's local sync state
* Last successful synchronization cursor

When internet is unavailable:

Agent
→ detects no connectivity
→ does not upload
→ keeps synchronization cursor unchanged

When internet returns:

Agent
→ scans activity since last successful sync
→ builds batch
→ sends to Laravel
→ backend persists
→ backend acknowledges
→ Agent advances cursor

## 28. Local Sync State

SQLite is used only for minimal synchronization state.

It may contain:

* Device ID
* Agent credentials/configuration
* Last settings sync
* Last successful sync
* Synchronization cursor/checkpoint
* Agent version

SQLite must NOT become a second history database.

The Claude local data remains the source of local activity history.

## 29. Incremental Synchronization

The Agent must not upload the entire Claude history on every synchronization.

Normal synchronization should include:

* New records
* Updated records
* Records affected by new activity

Stable source IDs should be used whenever available.

## 30. Sync Cursor

The synchronization cursor represents the last successfully synchronized position.

The cursor must only advance after successful backend persistence.

If synchronization fails:

* Cursor must not advance
* Unsynchronized records remain eligible for retry
* Agent retries later

This prevents data loss during temporary failures.

## 31. Initial Synchronization

During first-time setup, the Agent performs an initial synchronization.

The backend should control the initial history range.

Supported options:

* Last 1 day
* Last 7 days
* Last 30 days
* All available history

Recommended default:

Last 7 days.

Initial synchronization may display:

* Sessions found
* Projects found
* Usage found
* Records synchronized
* Progress

## 32. Agent Synchronization Flow

Agent starts
↓
Load local configuration
↓
Load sync state
↓
Fetch latest tracking settings
↓
Scan Claude data
↓
Detect new/updated records
↓
Apply tracking settings
↓
Build normalized payload
↓
Check connectivity
↓
Send HTTPS request
↓
Backend validates and persists
↓
Backend acknowledges
↓
Agent updates successful cursor
↓
Wait for next synchronization cycle

## 33. Heartbeat

The Agent should periodically send a lightweight heartbeat.

Heartbeat may contain:

* Device ID
* Agent version
* Claude Code version
* Last local activity
* Last successful sync
* Current Agent status

This allows the dashboard to identify:

* Online Agents
* Offline Agents
* Stale Agents
* Outdated Agents

## 34. Backend API

Conceptual endpoints:

POST /api/agent/register

Register a device.

POST /api/agent/heartbeat

Update Agent status.

GET /api/agent/settings

Retrieve tracking configuration.

POST /api/agent/sync

Upload activity data.

POST /api/agent/sync/status

Retrieve or verify synchronization state if required.

Exact route names may change during implementation, but responsibilities must remain.

## 35. Agent Authentication

Every Agent/device must have a unique authentication identity.

Requirements:

* HTTPS only
* Device-level credentials
* Secure local credential storage
* Disabled devices cannot synchronize
* Backend validates device identity
* Frontend must never expose Agent credentials

## 36. Sync Payload

Conceptual payload:

{
"agent": {
"device_id": "device_xxx",
"platform": "macos",
"platform_version": "26.x",
"architecture": "arm64",
"agent_version": "1.0.0",
"claude_code_version": "x.x.x"
},
"sync": {
"cursor": "abc123"
},
"developers": [],
"accounts": [],
"projects": [],
"sessions": [],
"usage": []
}

Only enabled and relevant new/updated records should be sent.

## 37. Sync Response

Conceptual response:

{
"success": true,
"sync": {
"accepted": 42,
"created": 35,
"updated": 7,
"rejected": 0
},
"cursor": "xyz789",
"server_time": "2026-09-21T12:50:00Z"
}

The Agent advances its cursor only after a successful response.

## 38. Idempotency

Duplicate synchronization must be safe.

The backend must use:

* Stable source identifiers
* Unique constraints
* Upsert/update behavior where appropriate

If the same batch is submitted twice:

* No duplicate records should be created
* Existing records may be updated
* Retry must remain safe

## 39. Partial Failure

If persistence fails:

* Backend must return an explicit failure
* Agent must not incorrectly advance its cursor
* Unsynchronized records must remain eligible for retry

No silent data loss is acceptable.

## 40. Database Model

Core tables:

### users

Application users/admins/developers as appropriate.

### developers

Central developer monitoring identity.

### claude_accounts

Claude account information.

### devices

Registered desktop Agents.

### projects

Detected projects.

### sessions

Claude Code sessions.

### session_usage

Raw and calculated token usage.

### session_messages

Optional prompt/message information.

### tracking_settings

Central Agent tracking configuration.

### agent_sync_states

Synchronization state.

### audit_logs

Administrative and sensitive-data access logs.

## 41. Device Database Requirements

The device record should support:

* device_id
* developer_id
* hostname
* platform
* platform_version
* architecture
* agent_version
* claude_code_version
* first_seen_at
* last_seen_at
* last_sync_at
* status

The schema must be platform-neutral.

## 42. Session Usage Data

Conceptual fields:

* session_id
* input_tokens
* output_tokens
* cache_creation_tokens
* cache_read_tokens
* actual_consumed_tokens
* total_token_activity
* recorded_at
* timestamps

Calculated fields should be generated/validated by the backend.

## 43. Organization Dashboard

The main dashboard should show:

* Total developers
* Active devices
* Sessions today
* Active projects
* Total Token Activity
* Actual Consumed Tokens
* Cache Read Tokens
* Usage trends
* Recent activity
* Offline/stale Agents

Date filters:

* Today
* Yesterday
* This Week
* This Month
* This Year
* Custom Range

## 44. Developer Dashboard

For each developer:

* Name
* Email
* Claude accounts
* Devices
* Projects
* Sessions
* Token usage
* Actual consumed tokens
* Cache reads
* Activity trends
* Last activity
* Last synchronization

Date filters:

* Today
* Yesterday
* Week
* Month
* Year
* Custom

## 45. Developer Activity Details

Navigation:

Developer
→ Device
→ Account
→ Project
→ Session
→ Usage

Session details:

* Session ID
* Project
* Model
* Device
* Account
* Start time
* End time
* Duration
* Activity count
* Token metrics

## 46. Project Analytics

Project page:

* Project name
* Project path
* Developers
* Devices
* Session count
* Total Token Activity
* Actual Consumed Tokens
* Cache Read Tokens
* Last activity
* Usage trends

## 47. Session List

Filters:

* Developer
* Device
* Account
* Project
* Model
* Date range
* Search

Columns:

* Developer
* Project
* Model
* Device
* Start
* Duration
* Token Activity
* Actual Consumed
* Last activity

## 48. Session Details

Show:

* Session metadata
* Developer
* Device
* Account
* Project
* Model
* Start/end
* Duration
* Activity count
* Token breakdown

If prompt tracking is enabled and the viewer has permission, messages/prompts may also be shown.

## 49. Agent/Device Monitoring

Admin should be able to monitor:

* Developer
* Device
* Operating system
* OS version
* Architecture
* Agent version
* Claude Code version
* Last seen
* Last sync
* Connection status
* Synchronization status

The dashboard should make it easy to identify Agents that are no longer syncing.

## 50. Sync Monitoring

Provide a synchronization monitoring page.

Information may include:

* Device
* Developer
* Last successful sync
* Last failed sync
* Sync status
* Records created
* Records updated
* Error information
* Agent version

Statuses:

* Healthy
* Offline
* Sync Failed
* Disabled

## 51. Manual Sync

A Sync Now action may be provided.

It is a diagnostic/manual feature.

It must not be necessary for normal operation.

## 52. Audit Logging

Audit sensitive actions including:

* Tracking setting changes
* Prompt tracking changes
* Prompt content access
* Device disable
* Device re-pair
* Manual synchronization
* Administrative configuration changes

## 53. Access Control

At minimum:

### Admin

Can:

* View all monitoring data
* Configure tracking
* View developers
* View devices
* View projects
* View sessions
* View token analytics
* Manage Agents
* View audit logs

### Monitoring Viewer

Can:

* View allowed dashboards
* View activity
* View usage
* View allowed session information

Prompt content should require appropriate permission.

## 54. Privacy and Data Minimization

Only collect data enabled by central tracking settings.

Do not monitor arbitrary files or unrelated filesystem contents.

When prompt tracking is disabled:

* No raw prompt collection
* No raw prompt upload
* No raw prompt storage

Sensitive information must have appropriate access control and audit logging.

## 55. Error Handling

Agent must handle:

* No internet
* Backend unavailable
* Authentication failure
* Invalid API response
* Claude data unavailable
* Claude Code updates
* Unexpected local data
* Permission issues
* Partial synchronization failure

The Agent must not lose its synchronization position because of an error.

Retry should use a simple backoff strategy.

## 56. Data Retention

The system should support configurable retention policies.

Historical monitoring data should remain available for the configured retention period.

Disabling/uninstalling a device must not automatically delete historical activity.

## 57. Performance Requirements

The Agent must remain lightweight.

Requirements:

* Incremental scanning
* Incremental synchronization
* Batch API uploads
* Minimal local database usage
* No unnecessary CPU usage
* No full-history upload on every sync

Backend must use appropriate indexes and aggregation strategies for dashboard queries.

## 58. V1 Development Phases

### Phase 0 — Cross-Platform Feasibility

Before full implementation:

* Inspect Claude Code local data on macOS
* Inspect Claude Code local data on Windows
* Inspect Claude Code local data on Linux
* Verify session structure
* Verify token fields
* Verify project detection
* Verify model detection
* Verify account detection
* Verify stable IDs
* Verify timestamps
* Verify session updates
* Verify prompt availability
* Identify OS-specific paths
* Identify OS-specific permissions
* Identify background execution options

This phase must produce a verified data contract before the full Agent is implemented.

### Phase 1 — Database Schema

Implement/finalize:

* developers
* Claude accounts
* devices
* projects
* sessions
* session usage
* messages
* tracking settings
* sync states
* audit logs

Add indexes and uniqueness constraints.

### Phase 2 — Sync Contract

Define:

* Registration
* Authentication
* Settings
* Sync payload
* Sync response
* Cursor behavior
* Idempotency
* Error responses
* Partial failure handling

### Phase 3 — Laravel Backend

Implement:

* Agent registration
* Authentication
* Heartbeat
* Settings API
* Sync API
* Persistence
* Token calculations
* Aggregations
* Dashboard APIs
* Audit logging

### Phase 4 — Vue + Inertia Dashboard

Implement:

* Organization dashboard
* Developer management
* Device monitoring
* Project analytics
* Session list
* Session details
* Token analytics
* Sync monitoring
* Tracking settings
* Audit logs

### Phase 5 — Cross-Platform Agent Core

Implement shared:

* Claude scanner
* Session detector
* Usage extractor
* Project/model detector
* Settings manager
* Authentication
* Sync manager
* Cursor management
* Retry handling
* Heartbeat

### Phase 6 — Platform Adapters

Implement:

#### macOS

* Claude discovery
* Permissions
* Device information
* LaunchAgent
* Installer

#### Windows

* Claude discovery
* Permissions
* Device information
* Background service/startup
* Installer

#### Linux

* Claude discovery
* Permissions
* Device information
* systemd/background service
* Installer/package

### Phase 7 — End-to-End Testing

Test all three platforms for:

* Installation
* Pairing
* Claude detection
* Data detection
* Initial sync
* New sessions
* Updated sessions
* Projects
* Models
* Token usage
* Cache handling
* Offline periods
* Internet recovery
* Duplicate sync
* Failed sync
* Agent restart
* OS restart
* Device disable
* Settings changes

### Phase 8 — Token Validation

Run controlled sessions and verify:

* Input extraction
* Output extraction
* Cache creation extraction
* Cache read extraction
* Total Token Activity
* Actual Consumed Tokens
* Session aggregation
* Developer aggregation
* Project aggregation
* Date-range aggregation

## 59. V1 Out of Scope

The following are outside V1:

* Additional operating systems beyond macOS, Windows and Linux
* Mobile Agent
* Exact Anthropic billing reconciliation unless directly supported by source data
* AI-based developer productivity scoring
* Developer performance ranking
* Automated code-quality evaluation
* Arbitrary filesystem monitoring
* Advanced Git analytics
* Advanced network analytics
* Complex distributed queue infrastructure
* Redis/RabbitMQ/Kafka/SQS-based synchronization
* Mobile dashboard
* Public-facing dashboard

Windows and Linux are NOT out of scope for V1. Their implementation is a mandatory part of V1.

## 60. Future Extensions

Possible future capabilities:

* Additional desktop platforms
* Agent auto-update
* Central Agent deployment
* Cost estimation
* Advanced usage alerts
* Usage thresholds
* Team-level analytics
* Budget monitoring
* Advanced Git analytics
* Additional AI coding tool monitoring
* More detailed account analytics

## 61. V1 Acceptance Criteria

V1 is complete when:

1. macOS Agent works.
2. Windows Agent works.
3. Linux Agent works.
4. All three platforms use the same backend.
5. All three platforms use the same normalized data model.
6. Developers can install the Agent without manually installing runtime dependencies.
7. Developer performs only initial login/pairing.
8. Agent automatically detects Claude Code.
9. Agent automatically detects Claude local data.
10. Agent automatically starts in the background.
11. Agent automatically collects configured activity.
12. Agent automatically synchronizes data.
13. Network changes do not create duplicate devices/developers.
14. Offline activity is synchronized after connectivity returns.
15. No external queue infrastructure is required.
16. Duplicate synchronization does not create duplicate records.
17. Failed synchronization does not incorrectly advance the cursor.
18. Backend stores session information.
19. Backend stores project information.
20. Backend stores model information.
21. Backend stores device information.
22. Backend stores Claude account relationships where available.
23. Token usage is available in V1.
24. Input, output, cache creation and cache read tokens are stored separately.
25. Actual Consumed Tokens follow the defined V1 calculation.
26. Cache Read Tokens are displayed separately.
27. Admin can centrally configure tracking settings.
28. Prompt tracking is OFF by default.
29. Prompt content is not collected when disabled.
30. Admin can view developer activity.
31. Admin can view device activity.
32. Admin can view project activity.
33. Admin can view session details.
34. Admin can view token analytics.
35. Admin can filter data by date range.
36. Admin can monitor Agent health.
37. Admin can monitor synchronization status.
38. Sensitive actions are audited.
39. Historical data remains after device disable/uninstall.
40. Normal operation requires zero ongoing developer interaction after initial setup.
41. Adding another supported platform later does not require redesigning the core backend or sync architecture.

## 62. Core Design Principle

Keep the system simple and platform-independent.

The core architecture is:

Developer Device
→ Cross-Platform Desktop Agent
→ Laravel API
→ MySQL
→ Vue + Inertia Dashboard

The Desktop Agent is responsible for:

Collect → Detect → Normalize → Sync

The Laravel Backend is responsible for:

Validate → Persist → Calculate → Aggregate → Report

The Dashboard is responsible for:

View → Filter → Analyze → Configure

Platform-specific code should remain inside platform adapters.

The Agent should not become a second backend.

The system should not introduce unnecessary infrastructure.

Offline synchronization should not require a queue system.

Developers should not manually manage monitoring.

The target V1 experience is:

**Install once → Pair once → Everything else happens automatically.**
