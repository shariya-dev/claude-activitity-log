<?php

namespace App\Http\Requests\Dashboard;

use App\Actions\Agent\Support\AgentVersion;
use App\Enums\InitialSyncRange;
use App\Enums\TrackingCategory;
use App\Models\TrackingSetting;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateTrackingSettingsRequest extends FormRequest
{
    public const int INTERVAL_MIN = 60;

    public const int INTERVAL_MAX = 3600;

    public const int RETENTION_MIN = 30;

    public function authorize(): bool
    {
        return $this->user()?->can('configureTracking') ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $rules = [];

        foreach (TrackingCategory::cases() as $category) {
            $rules[$category->value] = ['required', 'boolean'];
        }

        return $rules + [
            'prompt_confirmed' => ['sometimes', 'boolean'],
            'initial_sync_range' => ['required', Rule::enum(InitialSyncRange::class)],
            'sync_interval_seconds' => ['required', 'integer', 'between:'.self::INTERVAL_MIN.','.self::INTERVAL_MAX],
            'heartbeat_interval_seconds' => ['required', 'integer', 'between:'.self::INTERVAL_MIN.','.self::INTERVAL_MAX],
            'min_agent_version' => ['required', 'string', 'max:32', 'regex:'.AgentVersion::PATTERN],
            'retention_days' => ['nullable', 'integer', 'min:'.self::RETENTION_MIN, 'max:36500'],
        ];
    }

    /**
     * Turning prompt tracking on is a deliberate two-step action: the form must send the confirmation too.
     *
     * @return array<int, callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if ($validator->errors()->isNotEmpty()) {
                    return;
                }

                if ($this->boolean('prompt') && ! TrackingSetting::current()->prompt && ! $this->boolean('prompt_confirmed')) {
                    $validator->errors()->add('prompt_confirmed', 'Confirm that raw prompt text will be collected from all developers\' machines.');
                }
            },
        ];
    }

    /**
     * @return array{session: bool, usage: bool, project: bool, model: bool, device: bool, account: bool, prompt: bool, git: bool, network: bool, initial_sync_range: string, sync_interval_seconds: int, heartbeat_interval_seconds: int, min_agent_version: string, retention_days: int|null}
     */
    public function settings(): array
    {
        $settings = [];

        foreach (TrackingCategory::cases() as $category) {
            $settings[$category->value] = $this->boolean($category->value);
        }

        return $settings + [
            'initial_sync_range' => $this->string('initial_sync_range')->value(),
            'sync_interval_seconds' => $this->integer('sync_interval_seconds'),
            'heartbeat_interval_seconds' => $this->integer('heartbeat_interval_seconds'),
            'min_agent_version' => $this->string('min_agent_version')->value(),
            'retention_days' => $this->filled('retention_days') ? $this->integer('retention_days') : null,
        ];
    }
}
