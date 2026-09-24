<?php

use App\Enums\SyncBatchStatus;
use App\Enums\UserRole;
use App\Models\ClaudeModel;
use App\Models\Developer;
use App\Models\Device;
use App\Models\Project;
use App\Models\SyncBatch;
use App\Models\User;
use Database\Seeders\MonitorDemoSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;

uses(RefreshDatabase::class);

test('the demo seeder produces demo data through the real ingestion path', function () {
    $this->seed(MonitorDemoSeeder::class);

    expect(Developer::count())->toBe(6)
        ->and(Device::count())->toBe(9)
        ->and(Device::query()->distinct()->orderBy('platform')->pluck('platform')->all())->toBe(['linux', 'macos', 'windows'])
        ->and(ClaudeModel::count())->toBe(4)
        // 8 logical projects; with Git OFF (default) D13 keys are per device, so rows may exceed 8.
        ->and(Project::query()->distinct()->count('name'))->toBe(8)
        // 3 Claude accounts; rows are unique per (developer_id, account_key), so shared accounts appear once per developer.
        ->and(DB::table('claude_accounts')->distinct()->count('account_key'))->toBe(3);

    $admin = User::where('email', 'admin@example.com')->sole();
    expect($admin->role)->toBe(UserRole::Admin)
        ->and(User::where('role', UserRole::Viewer->value)->exists())->toBeTrue();

    expect(DB::table('session_usage')->count())->toBeGreaterThan(0)
        ->and(DB::table('claude_sessions')->count())->toBeGreaterThan(0)
        ->and(DB::table('usage_daily_rollups')->count())->toBeGreaterThan(0);

    // Every session total equals the sum of its usage rows.
    $sums = DB::table('session_usage')
        ->selectRaw('claude_session_id, COUNT(*) AS activity_count, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cache_creation_tokens) AS cache_creation_tokens, SUM(cache_read_tokens) AS cache_read_tokens, SUM(actual_consumed_tokens) AS actual_consumed_tokens, SUM(total_token_activity) AS total_token_activity')
        ->groupBy('claude_session_id');

    $mismatches = DB::table('claude_sessions as s')
        ->leftJoinSub($sums, 'u', 'u.claude_session_id', '=', 's.id')
        ->where(function ($query) {
            foreach (['activity_count', 'input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens', 'actual_consumed_tokens', 'total_token_activity'] as $column) {
                $query->orWhereRaw("s.{$column} <> COALESCE(u.{$column}, 0)");
            }
        })
        ->count();

    expect($mismatches)->toBe(0);

    // Rollups agree with the usage rows overall.
    expect((int) DB::table('usage_daily_rollups')->sum('total_token_activity'))
        ->toBe((int) DB::table('session_usage')->sum('total_token_activity'))
        ->and((int) DB::table('usage_daily_rollups')->sum('message_count'))
        ->toBe(DB::table('session_usage')->count());

    expect(SyncBatch::count())->toBeGreaterThan(0)
        ->and(SyncBatch::where('status', '!=', SyncBatchStatus::Succeeded->value)->count())->toBe(0);
})->group('seeder');
