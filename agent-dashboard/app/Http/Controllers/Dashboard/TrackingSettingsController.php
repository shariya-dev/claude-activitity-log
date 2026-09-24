<?php

namespace App\Http\Controllers\Dashboard;

use App\Actions\Tracking\UpdateTrackingSettings;
use App\Enums\TrackingCategory;
use App\Http\Controllers\Controller;
use App\Http\Requests\Dashboard\UpdateTrackingSettingsRequest;
use App\Models\TrackingSetting;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Central tracking settings (PRD §23–26, §31, §56). There is no developer-side override anywhere.
 */
class TrackingSettingsController extends Controller
{
    /**
     * PRD §23 recommended defaults, label and explanation per category.
     *
     * @var array<string, array{0: string, 1: bool, 2: string}>
     */
    private const array CATEGORIES = [
        'session' => ['Session', true, 'Claude Code sessions: start, last activity, duration and status.'],
        'usage' => ['Usage / tokens', true, 'Raw token counts per message (input, output, cache creation, cache read).'],
        'project' => ['Project', true, 'The project folder a session ran in.'],
        'model' => ['Model', true, 'The Claude model used for each message.'],
        'device' => ['Device', true, 'Hostname, platform, OS version and agent version of each machine.'],
        'account' => ['Account', true, 'The Claude account (email and organization) signed in on the device.'],
        'prompt' => ['Prompt / message text', false, 'Raw prompt text typed by developers. Sensitive: only users with prompt permission can read it, and every view is audited.'],
        'git' => ['Git', false, 'Repository, branch and commit information read from the project\'s .git folder.'],
        'network' => ['Network', false, 'Network details for connectivity diagnostics. Never used to identify a developer or device.'],
    ];

    private const array INITIAL_SYNC_RANGES = [
        '1d' => 'Last 1 day',
        '7d' => 'Last 7 days',
        '30d' => 'Last 30 days',
        'all' => 'All available history',
    ];

    public function edit(): Response
    {
        $settings = TrackingSetting::current()->load('updatedBy:id,name');

        /** @var User|null $updatedBy */
        $updatedBy = $settings->updatedBy;
        $categories = [];

        foreach (TrackingCategory::cases() as $category) {
            $categories[$category->value] = $settings->enabled($category);
        }

        return Inertia::render('Admin/TrackingSettings', [
            'settings' => [
                'categories' => $categories,
                'initial_sync_range' => $settings->initial_sync_range->value,
                'sync_interval_seconds' => (int) $settings->sync_interval_seconds,
                'heartbeat_interval_seconds' => (int) $settings->heartbeat_interval_seconds,
                'min_agent_version' => $settings->min_agent_version,
                'retention_days' => $settings->retention_days,
                'version' => (int) $settings->version,
                'updated_at' => $settings->updated_at?->toIso8601String(),
                'updated_by' => $updatedBy?->name,
            ],
            'categories' => collect(TrackingCategory::cases())->map(fn (TrackingCategory $category): array => [
                'key' => $category->value,
                'label' => self::CATEGORIES[$category->value][0],
                'default' => self::CATEGORIES[$category->value][1],
                'description' => self::CATEGORIES[$category->value][2],
            ])->all(),
            'initialSyncRanges' => collect(self::INITIAL_SYNC_RANGES)
                ->map(fn (string $label, string $value): array => ['value' => $value, 'label' => $label])
                ->values()
                ->all(),
            'limits' => [
                'interval_min' => UpdateTrackingSettingsRequest::INTERVAL_MIN,
                'interval_max' => UpdateTrackingSettingsRequest::INTERVAL_MAX,
                'retention_min' => UpdateTrackingSettingsRequest::RETENTION_MIN,
            ],
        ]);
    }

    public function update(UpdateTrackingSettingsRequest $request, UpdateTrackingSettings $action): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $action->handle($request->settings(), $user);

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Tracking settings saved.')]);

        return to_route('tracking-settings.edit');
    }
}
