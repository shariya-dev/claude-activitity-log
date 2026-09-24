<?php

namespace App\Http\Requests\Agent;

use App\Actions\Agent\Support\AgentError;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Validation\Rule;

/**
 * POST /register body (schema register.request). Every field is required; nullable ones must be sent as null.
 */
class RegisterRequest extends FormRequest
{
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
            'pairing_code' => ['required', 'string', 'max:32'],
            'device' => ['required', 'array'],
            'device.hostname' => ['present', 'nullable', 'string', 'max:191'],
            'device.platform' => ['required', 'string', Rule::in(config('monitor.platforms'))],
            'device.platform_version' => ['present', 'nullable', 'string', 'max:64'],
            'device.architecture' => ['required', 'string', 'max:64'],
            'device.machine_fingerprint' => ['required', 'string', 'regex:/^[0-9a-f]{64}$/'],
            'device.agent_version' => ['required', 'string', 'max:32', 'regex:/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/'],
            'device.claude_code_version' => ['present', 'nullable', 'string', 'max:64'],
        ];
    }

    /**
     * A problem with only the pairing code is the generic invalid_pairing_code; anything else is invalid_payload.
     */
    protected function failedValidation(Validator $validator): never
    {
        $errors = $validator->errors()->toArray();

        if (array_keys($errors) === ['pairing_code']) {
            throw new HttpResponseException(AgentError::invalidPairingCode());
        }

        unset($errors['pairing_code']);

        /** @var array<string, array<int, string>> $errors */
        throw new HttpResponseException(AgentError::invalidPayload($errors));
    }
}
