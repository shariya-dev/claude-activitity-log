<?php

namespace App\Http\Requests\Agent;

use App\Actions\Agent\Support\AgentError;
use App\Actions\Agent\Support\AgentTimestamp;
use App\Actions\Agent\Support\AgentVersion;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Validation\Rule;

/**
 * POST /heartbeat body (schema heartbeat.request). Every field is required; nullable ones must be sent as null.
 */
class HeartbeatRequest extends FormRequest
{
    public const AGENT_STATES = [
        'ok', 'syncing', 'backoff', 'claude_data_unavailable', 'update_required', 'needs_repair', 'device_disabled', 'error',
    ];

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'agent_version' => ['required', 'string', 'max:32', 'regex:'.AgentVersion::PATTERN],
            'claude_code_version' => ['present', 'nullable', 'string', 'max:64'],
            'platform_version' => ['present', 'nullable', 'string', 'max:64'],
            'hostname' => ['present', 'nullable', 'string', 'max:191'],
            'agent_state' => ['required', 'string', Rule::in(self::AGENT_STATES)],
            'last_local_activity_at' => ['present', 'nullable', ...AgentTimestamp::rules()],
            'last_successful_sync_at' => ['present', 'nullable', ...AgentTimestamp::rules()],
            'last_error' => ['present', 'nullable', 'string', 'max:500'],
        ];
    }

    protected function failedValidation(Validator $validator): never
    {
        /** @var array<string, array<int, string>> $errors */
        $errors = $validator->errors()->toArray();

        throw new HttpResponseException(AgentError::invalidPayload($errors));
    }
}
