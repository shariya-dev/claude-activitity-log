<?php

namespace App\Http\Requests\Agent;

use App\Actions\Ingestion\Support\AgentErrorResponse;
use App\Models\Device;
use App\Models\TrackingSetting;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Validation\Rule;

/**
 * Envelope validation for POST /sync (docs/contracts/sync-api-v1.md §6.1). Record internals are NOT validated
 * here: record-level problems become per-record rejections inside a 200 (IngestSyncBatch).
 *
 * The body is always decoded from the raw bytes (gunzipped when `Content-Encoding: gzip`), so global input
 * middleware (TrimStrings, ConvertEmptyStringsToNull) never alters record values such as prompt content.
 * Check order: body size 413 → 426 → array limits 413 → 422.
 */
class SyncRequest extends FormRequest
{
    /** Contract array limits; config('monitor.sync_limits') overrides the keys it defines. */
    private const DEFAULT_LIMITS = [
        'accounts' => 50,
        'projects' => 200,
        'sessions' => 200,
        'usage' => 500,
        'messages' => 200,
        'bytes' => 2097152,
    ];

    private const RECORD_ARRAYS = ['accounts', 'projects', 'sessions', 'usage', 'messages'];

    private const INFLATE_READ_BYTES = 8192;

    /** @var array<string, mixed> */
    private array $payload = [];

    private int $payloadBytes = 0;

    public function authorize(): bool
    {
        return $this->device() instanceof Device;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'agent' => ['required', 'array'],
            'agent.device_id' => ['required', 'string', Rule::in([$this->device()?->device_uid])],
            'agent.platform' => ['required', 'string', Rule::in(config('monitor.platforms'))],
            'agent.platform_version' => ['present', 'nullable', 'string', 'min:1', 'max:64'],
            'agent.architecture' => ['required', 'string', 'max:64'],
            'agent.agent_version' => ['required', 'string', 'max:32', 'regex:/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/'],
            'agent.claude_code_version' => ['present', 'nullable', 'string', 'min:1', 'max:64'],
            'sync' => ['required', 'array'],
            'sync.batch_id' => ['required', 'string', 'uuid:4'],
            'sync.cursor' => ['present', 'nullable', 'string', 'max:255'],
            'sync.is_initial' => ['required', 'boolean:strict'],
            'sync.settings_version' => ['required', 'integer:strict', 'min:1'],
            'sync.sequence' => ['required', 'integer:strict', 'min:1'],
            ...collect(self::RECORD_ARRAYS)->flatMap(fn (string $key): array => [
                $key => ['present', 'array', 'list'],
                $key.'.*' => ['array', $this->jsonObject(...)],
            ])->all(),
        ];
    }

    /**
     * A record must be a JSON object: a decoded JSON list (other than the ambiguous empty `[]`) is not.
     *
     * @param  Closure(string): mixed  $fail
     */
    public function jsonObject(string $attribute, mixed $value, Closure $fail): void
    {
        if (is_array($value) && $value !== [] && array_is_list($value)) {
            $fail("The {$attribute} field must be an object.");
        }
    }

    public function device(): ?Device
    {
        $device = $this->user('sanctum');

        return $device instanceof Device ? $device : null;
    }

    public function payloadBytes(): int
    {
        return $this->payloadBytes;
    }

    /**
     * @return array<string, mixed>
     */
    public function validationData(): array
    {
        return $this->payload;
    }

    protected function prepareForValidation(): void
    {
        $limits = array_merge(self::DEFAULT_LIMITS, (array) config('monitor.sync_limits'));
        $maxBytes = (int) $limits['bytes'];

        $body = $this->decodedBody($maxBytes);

        if ($body === null) {
            throw new HttpResponseException(AgentErrorResponse::batchTooLarge());
        }

        $this->payloadBytes = strlen($body);
        $decoded = $body === '' ? null : json_decode($body, true, 64);
        $payload = is_array($decoded) && ! array_is_list($decoded) ? $decoded : null;

        $this->ensureAgentIsCurrent($payload);

        if ($payload === null) {
            throw new HttpResponseException(AgentErrorResponse::invalidPayload([
                'body' => ['The request body must be a JSON object.'],
            ]));
        }

        foreach (self::RECORD_ARRAYS as $key) {
            if (is_array($payload[$key] ?? null) && count($payload[$key]) > (int) $limits[$key]) {
                throw new HttpResponseException(AgentErrorResponse::batchTooLarge());
            }
        }

        $this->payload = $payload;
    }

    protected function failedValidation(Validator $validator): void
    {
        /** @var array<string, list<string>> $errors */
        $errors = $validator->errors()->toArray();

        throw new HttpResponseException(AgentErrorResponse::invalidPayload($errors));
    }

    /**
     * The decompressed body, or null when it exceeds $maxBytes. A corrupt gzip stream yields '' (invalid payload).
     */
    private function decodedBody(int $maxBytes): ?string
    {
        $raw = $this->getContent();

        if (strtolower(trim((string) $this->header('Content-Encoding'))) !== 'gzip') {
            return strlen($raw) > $maxBytes ? null : $raw;
        }

        $inflater = inflate_init(ZLIB_ENCODING_GZIP);

        if ($inflater === false) {
            return '';
        }

        $body = '';

        foreach (str_split($raw, self::INFLATE_READ_BYTES) as $piece) {
            $chunk = @inflate_add($inflater, $piece, ZLIB_SYNC_FLUSH);

            if ($chunk === false) {
                return '';
            }

            $body .= $chunk;

            if (strlen($body) > $maxBytes) {
                return null;
            }
        }

        return $body;
    }

    /**
     * 426 when the agent is older than min_agent_version: body agent.agent_version when the body parses,
     * otherwise the X-Agent-Version header, otherwise the stored device version.
     *
     * @param  array<string, mixed>|null  $payload
     */
    private function ensureAgentIsCurrent(?array $payload): void
    {
        $agent = $payload['agent'] ?? null;
        $version = is_array($agent) && is_string($agent['agent_version'] ?? null)
            ? $agent['agent_version']
            : ($this->header('X-Agent-Version') ?: $this->device()?->agent_version);

        if (! is_string($version) || $version === '') {
            return;
        }

        $minimum = TrackingSetting::current()->min_agent_version;

        if (version_compare($version, $minimum, '<')) {
            throw new HttpResponseException(AgentErrorResponse::agentOutdated($minimum));
        }
    }
}
